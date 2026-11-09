"""Automations (a saved task added again by a time or an event), and the scheduler's loop."""

import datetime
import fcntl
import fnmatch
import json
import os
import re
import subprocess
import sys
import threading
import time

from .base import ENTRY, Fail, guard, hc_json, layout, now, STORE, WHERE
from .when import parse_at
from .settings import bare, set_task, settings_for, SET_KEYS, worker_argv, worktrees_on
from .agents import agent_running, live_agents, starting, status_of, task_status
from .sessions import session_of
from .launch import default_space
from .store import locate, open_store, read_list, Store, store_files
from .queues import queue_reason
from .archive import archive_pass
from .output import say
from .scheduler import ensure_scheduler, script_hash
from .commands import begin
from .news import news_pass
from .tick import end_done_pass, lost_logs_pass, memory_guard, retry_pass, tick_store
from .backups import backup_pass
from .machines import machines_pass
from .takeover import cli_check_pass


# ---- automations ----------------------------------------------------------------------------
# A folder's saved task and a trigger that adds it again, each time with a fresh agent: times (in
# this machine's time zone), task events, or both. Agents (a coordinator) make them with
# `herdr-task auto ...`; the scheduler (`herdr-task scheduler`, one per machine, kept by
# herdr-core as herdr-automations) fires them, also while Herdr's window is closed.

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
EVENTS = ["added", "ready", "failed", "needs-you", "merged", "stalled"]
EVENT_WORDS = {"added": "a task is added", "ready": "a task is ready", "failed": "a task fails",
               "needs-you": "a task needs the person", "merged": "a task is merged", "stalled": "a task stalls"}
STALL_MS = 30 * 60000
HOW = ('Write times like "weekdays 9:00", "daily 9:00,17:30", "mon,thu 8:15", "every 30 minutes", '
       '"every 2 hours on weekdays from 8:00 to 18:00", "hourly", "once 2026-11-05 9:00" or "once tomorrow 9:00" (this machine\'s time zone).')


def parse_days(text):
    t = text.strip().lower().replace(" and ", ",")
    if t in ("", "daily", "day", "days", "every day", "everyday"):
        return list(range(7))
    if t in ("weekdays", "weekday", "every weekday"):
        return list(range(5))
    if t in ("weekends", "weekend", "every weekend"):
        return [5, 6]
    out = []
    for part in re.split(r"[,\s]+", re.sub(r"^every\s+", "", t)):
        if not part:
            continue
        hit = [i for i, d in enumerate(DAYS) if part.startswith(d)]
        if not hit:
            raise Fail(f"Unknown day {part!r}. " + HOW)
        out.append(hit[0])
    return sorted(set(out))


def parse_hhmm(text):
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})", text.strip())
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise Fail(f"Unknown time {text!r}. " + HOW)
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def parse_every(text):
    """A time rule from a few plain words, strictly: anything it doesn't know is refused."""
    t = re.sub(r"\s+", " ", text.strip().lower())
    if t in ("hourly", "every hour"):
        t = "every 1 hours"
    m = re.fullmatch(r"once (.+)", t)
    if m:
        # The same words as a task's --at (when.py): "once 2026-11-05 9:00", "once tomorrow 9:00", "once fri 8:15".
        at = datetime.datetime.fromtimestamp(parse_at(m.group(1), how=HOW) / 1000)
        return {"text": text.strip(), "kind": "once", "at": at.strftime("%Y-%m-%d %H:%M")}
    m = re.fullmatch(r"every (\d+) ?(minutes?|mins?|m|hours?|hrs?|h)(?: on ([a-z ,]+?))?(?: (?:from|between) (\d{1,2}[:.]\d{2}) (?:to|and|-) (\d{1,2}[:.]\d{2}))?(?: on ([a-z ,]+))?", t)
    if m:
        n = int(m.group(1)) * (60 if m.group(2).startswith("h") else 1)
        if n < 5:
            raise Fail("At most every 5 minutes.")
        frm, to = (parse_hhmm(m.group(4)), parse_hhmm(m.group(5))) if m.group(4) else ("00:00", "23:59")
        return {"text": text.strip(), "kind": "interval", "minutes": n, "days": parse_days(m.group(3) or m.group(6) or ""),
                "from": frm, "to": to}
    m = re.fullmatch(r"(?:(.*?) )?(\d{1,2}[:.]\d{2}(?: ?(?:,|and) ?\d{1,2}[:.]\d{2})*)", re.sub(r"(^| )at (?=\d)", r"\1", t).strip())
    if m:
        times = sorted({parse_hhmm(x) for x in re.split(r" ?(?:,|and) ?", m.group(2))})
        return {"text": text.strip(), "kind": "at", "days": parse_days(m.group(1) or ""), "times": times}
    raise Fail(HOW)


def at_local(date, hhmm):
    h, mi = map(int, hhmm.split(":"))
    return int(datetime.datetime(date.year, date.month, date.day, h, mi).timestamp() * 1000)


def next_run(rule, after):
    """The rule's first time after `after` (ms), or None."""
    if not rule:
        return None
    if rule["kind"] == "once":
        d, hhmm = rule["at"].split(" ")
        at = at_local(datetime.date.fromisoformat(d), hhmm)
        return at if at > after else None
    start = datetime.datetime.fromtimestamp(after / 1000).date()
    for i in range(0, 9):
        day = start + datetime.timedelta(days=i)
        if day.weekday() not in rule["days"]:
            continue
        if rule["kind"] == "at":
            times = [at_local(day, x) for x in rule["times"]]
        else:
            first, last = at_local(day, rule["from"]), at_local(day, rule["to"])
            times = range(first, last + 1, rule["minutes"] * 60000)
        for at in times:
            if at > after:
                return at
    return None


def days_words(days):
    if days == list(range(7)):
        return "Every day"
    if days == list(range(5)):
        return "Weekdays"
    if days == [5, 6]:
        return "Weekends"
    return ", ".join(DAYS[d].capitalize() for d in days)


def trigger_words(a):
    """What sets it off, for people: "Weekdays at 9:00", "When a task is ready"."""
    parts = []
    r = a.get("every")
    if r and r["kind"] == "once":
        d = datetime.datetime.strptime(r["at"], "%Y-%m-%d %H:%M")
        parts.append(f"Once, {d.strftime('%b')} {d.day} at {d.strftime('%H:%M').lstrip('0') or '0'}".replace(" at :", " at 0:"))
    elif r and r["kind"] == "at":
        times = [x.lstrip("0") if not x.startswith("00") else x[1:] for x in r["times"]]
        parts.append(f"{days_words(r['days'])} at {', '.join(times[:-1]) + ' and ' + times[-1] if len(times) > 1 else times[0]}")
    elif r:
        n = r["minutes"]
        every = f"Every {n // 60} hours" if n % 60 == 0 and n > 60 else "Every hour" if n == 60 else f"Every {n} minutes"
        if r["days"] != list(range(7)):
            every += f", {days_words(r['days']).lower() if r['days'] in (list(range(5)), [5, 6]) else days_words(r['days'])}"
        if (r["from"], r["to"]) != ("00:00", "23:59"):
            every += f", {r['from'].lstrip('0') or '0'}–{r['to'].lstrip('0') or '0'}"
        parts.append(every)
    if a.get("on"):
        words = " or ".join(EVENT_WORDS[e] for e in a["on"])
        if a.get("from"):
            words += f" in {from_text(a['from'])}"
        if a.get("match"):
            words += f" ({a['match']})"
        parts.append(("when " if parts else "When ") + words)
    return ", ".join(parts) if parts else "Never"


def parse_on(text):
    evs = [e.strip().lower() for e in re.split(r"[,\s]+", text or "") if e.strip()]
    bad = [e for e in evs if e not in EVENTS]
    if bad:
        raise Fail(f"Unknown event {bad[0]!r}; events are {', '.join(EVENTS)}.")
    return sorted(set(evs), key=EVENTS.index)


def parse_from(text):
    """--from: another folder whose task events set it off, "vm-b:/path" (another machine's) or a
    folder here: {machine (None: this one), folder}; None for "" (its own folder again)."""
    t = (text or "").strip()
    if not t:
        return None
    m = re.fullmatch(r"([A-Za-z0-9][\w.-]*):(.+)", t)
    if m and not re.fullmatch(r"[A-Za-z]", m.group(1)):
        return {"machine": m.group(1), "folder": m.group(2).strip()}
    return {"machine": None, "folder": locate(t)["folder"]}


def from_text(src):
    return f"{src['machine']}:{src['folder']}" if src.get("machine") else src["folder"]


def auto_ref(s, a):
    return f"{s.prefix}-A{a['id']}"


def find_auto(s, ref):
    r = str(ref).strip()
    m = re.fullmatch(r"(?:([A-Za-z]+[0-9]*)-)?[Aa]?([0-9]+)", r)
    if not m:
        raise Fail(f"{ref!r} isn't an automation id; use one like {s.prefix}-A1.")
    if m.group(1) and m.group(1).upper() != s.prefix:
        raise Fail(f"{r} isn't an automation in {s.loc['folder']} (its are {s.prefix}-A<n>).")
    for a in s.data.get("automations") or []:
        if a["id"] == int(m.group(2)):
            return a
    raise Fail(f"No automation {s.prefix}-A{m.group(2)} in {s.loc['folder']}.")


def auto_view(s, a):
    v = {k: a.get(k) for k in ("id", "title", "prompt", "mode", "agent", "set", "on", "match", "space", "paused",
                                "next_run", "last_run", "last_task", "last_error", "runs", "created")}
    # machine: None here; herdr-task --on <machine> names it (cli.remote), so a list across machines says whose it is
    v.update(ref=auto_ref(s, a), **{"from": from_text(a["from"]) if a.get("from") else None}, folder=s.loc["folder"], machine=None, prefix=s.prefix, every=(a.get("every") or {}).get("text"),
             trigger=trigger_words(a), enabled=settings_for(s, a.get("space"))["automations"].get("enabled", True))
    return v


def auto_line(v):
    state = "paused" if v["paused"] else ("off in Settings" if not v["enabled"] else
                                          (f"next {datetime.datetime.fromtimestamp(v['next_run'] / 1000):%a %H:%M}" if v.get("next_run") else "on events"))
    err = f"  ! {v['last_error']['message']}" if v.get("last_error") else ""
    return f"{v['ref']:<9} {v['title']}  ({v['trigger']}; {state}){err}"


def set_auto_fields(s, a, args, adding=False):
    if getattr(args, "title", None):
        a["title"] = args.title.strip()
    if args.prompt is not None:
        a["prompt"] = args.prompt
    if args.prompt_file:
        with open(args.prompt_file) as f:
            a["prompt"] = f.read()
    if args.every is not None:
        a["every"] = parse_every(args.every) if args.every.strip() and args.every.strip().lower() not in ("off", "none", "never") else None
        a["next_run"] = next_run(a["every"], now())
    if args.on is not None:
        a["on"] = parse_on(args.on) or None
    if args.match is not None:
        a["match"] = args.match.strip() or None
    if getattr(args, "from_", None) is not None:
        src = parse_from(args.from_)
        if src and not src["machine"] and src["folder"] == s.loc["folder"]:
            src = None  # its own folder: what it hears anyway
        if src != a.get("from"):
            a["from"] = src
            a.pop("from_seen", None)
            if not src:
                a.pop("from", None)
            else:
                a["warning"] = watch_from(s, a)
    if args.agent:
        a["agent"] = args.agent
    if args.here or args.worktree:
        if args.worktree and s.loc["kind"] != "repo":
            raise Fail("Worktrees need a git repo.")
        a["mode"] = "here" if args.here else "worktree"
    if args.space:
        a["space"] = bare(args.space)
    if args.parent:
        a["parent"] = args.parent
    if getattr(args, "set", None):
        # Each task it adds gets these (#744: review=off for a run that only reads); checked now.
        sets = dict(a.get("set") or {})
        for pair in args.set:
            if "=" not in pair:
                raise Fail(f"--set takes key=value, not {pair!r}.")
            k, v = pair.split("=", 1)
            set_task({}, k, v)
            field = SET_KEYS[k.strip().lower()]
            key = next(x for x, f in SET_KEYS.items() if f == field)  # one name per setting
            v = v.strip().strip("\"'").strip()
            if not v or v.lower() == "default":
                sets.pop(key, None)
            else:
                sets[key] = v
        a["set"] = sets
        if not sets:
            a.pop("set")
    if not a.get("every") and not a.get("on"):
        raise Fail("Say when it runs: --every \"weekdays 9:00\" and/or --on ready,merged. " + HOW)
    if a.get("from") and not a.get("on"):
        raise Fail("--from says whose task events set it off: give --on too (merged, ready, ...).")
    if a.get("every") and a["every"]["kind"] == "once" and not a.get("next_run") and adding:
        raise Fail("That time has passed.")


def cmd_auto(args):
    sub = args.auto
    if sub == "list":
        return auto_list(args)
    if sub == "feed":
        # Another machine's automation asks (fetch_feed): this folder's tasks now. Reads only.
        print(json.dumps(feed(args.folder)))
        return
    with open_store(args) as s:
        autos = s.data.setdefault("automations", [])
        msg = ""
        if sub == "add":
            a = {"id": s.data.get("auto_next", 1), "title": args.title.strip(), "prompt": "", "created": now(), "paused": False,
                 "mode": "worktree" if s.loc["kind"] == "repo" else "here", "runs": []}
            set_auto_fields(s, a, args, adding=True)
            if not a.get("space"):
                a["space"] = default_space()
            if not a.get("parent") and os.environ.get("HC_TERMINAL_ID"):
                a["parent"] = os.environ["HC_TERMINAL_ID"]
            s.data["auto_next"] = a["id"] + 1
            autos.append(a)
            msg = f"{auto_ref(s, a)} added: {trigger_words(a)}."
            if a.get("warning"):
                msg += f"\nWarning: {a['warning']}"
        else:
            a = find_auto(s, args.id)
            if sub == "edit":
                set_auto_fields(s, a, args)
                msg = f"{auto_ref(s, a)} saved: {trigger_words(a)}."
                if a.get("warning"):
                    msg += f"\nWarning: {a['warning']}"
            elif sub == "pause":
                a["paused"] = True
                msg = f"{auto_ref(s, a)} paused."
            elif sub == "resume":
                a["paused"] = False
                a["next_run"] = next_run(a.get("every"), now())
                msg = f"{auto_ref(s, a)} resumed: {trigger_words(a)}."
            elif sub == "rm":
                autos.remove(a)
                msg = f"{auto_ref(s, a)} removed."
            elif sub == "run-now":
                t = fire(s, a, "run now")
                msg = f"{auto_ref(s, a)} added {s.ref(t)}" + (f", but: {a['last_error']['message']}" if a.get("last_error") else ".")
            elif sub == "show":
                msg = auto_line(auto_view(s, a))

        s.dirty = s.dirty or sub != "show"
        # The panel shows these as stored: what sets it off, in words.
        for x in autos:
            x["trigger"] = trigger_words(x)
        warning = a.pop("warning", None)
        v = auto_view(s, a)
        if warning:
            v["warning"] = warning
    if sub != "rm":
        ensure_scheduler(quiet=True)
    say(args, {**v, **({"removed": True} if sub == "rm" else {})}, msg)


def auto_list(args):
    out = []
    for p in store_files(None if args.all else locate(args.folder)["folder"]):
        d = read_list(p)
        if not d or not d.get("automations") or not os.path.isdir(d.get("folder") or ""):
            continue
        with Store(locate(d["folder"])) as s:
            out += [auto_view(s, a) for a in s.data.get("automations") or []]
    if args.json:
        print(json.dumps(out))
        return
    print("\n".join(auto_line(v) for v in out) if out else "No automations.")


def event_brief(ev, f, src=None):
    """What set a run off, for its brief: the task's ref, title and machine."""
    where = f"folder {src['folder']} on machine {src['machine']}" if src and src.get("machine") else \
        (f"folder {src['folder']} on this machine" if src else "this folder")
    words = {"added": "was added", "ready": "is ready", "failed": "failed", "needs-you": "needs the person",
             "merged": "was merged", "stalled": "stalled"}[ev]
    return f"Set off by: task {f['ref']} ({' '.join(str(f['title']).split())}) {words}, in {where}."


def fire(s, a, why, brief=None):
    """Adds the automation's task again and starts it (or queues it, as start would). Returns the
    task. A start that fails is the automation's last error, and the task needs the person.
    brief: what set it off (event_brief), added under its prompt."""
    prompt = a.get("prompt") or ""
    if brief:
        prompt = f"{prompt.rstrip()}\n\n{brief}" if prompt.strip() else brief
    t = s.new(a["title"], prompt, a.get("mode") or ("worktree" if worktrees_on(s) else "here"))
    t["automation"] = a["id"]
    if a.get("agent"):
        t["agent"] = a["agent"]
    for k, v in (a.get("set") or {}).items():
        set_task(t, k, v)
    space = a.get("space")
    run_rec = {"at": now(), "why": why, "task": s.ref(t)}
    if a.get("from") and why.split(":")[0] in EVENTS:
        run_rec["from"] = from_text(a["from"])
    try:
        if not space:
            raise Fail("It has no space to start in.")
        argv = worker_argv(s, t, space)
        parent = a.get("parent")
        reason = queue_reason(s, t)
        if reason:
            t["state"], t["queued_at"] = "queued", now()
            t["queue"] = {"argv": argv, "space": space, "parent": parent}
            run_rec["queued"] = reason
        else:
            begin(s, t, argv, space, parent)
        a.pop("last_error", None)
    except Fail as e:
        run_rec["error"] = str(e)
        a["last_error"] = {"at": now(), "message": str(e), "kind": "start"}
        t["attention"] = f"Couldn't start: {e}"
    a["last_run"], a["last_task"] = now(), s.ref(t)
    a["runs"] = (a.get("runs") or [])[-9:] + [run_rec]
    s.dirty = True
    return t


def matches(a, t):
    m = (a.get("match") or "").strip()
    if not m:
        return True
    if m.lower().startswith("branch:"):
        return fnmatch.fnmatch(t.get("branch") or "", m.split(":", 1)[1].strip())
    title = t["title"].lower()
    return all(w in title for w in m.lower().split())


def task_facts(s, t):
    """How a task is now, as events read it. Another machine's come this way too (`auto feed`)."""
    live = [k for k in live_agents(s.key(t))] if t["state"] in ("running", "ready") else []
    working_ones = [k for k in live if agent_running(k)]
    return {"id": t["id"], "ref": s.ref(t), "title": t["title"], "branch": t.get("branch"), "state": t["state"],
            "status": status_of(t, working_ones) if t["state"] == "running" else t["state"],
            "needs": task_status(t, working_ones)[1], "attention": t.get("attention"), "merged": bool(t.get("merged")),
            "automation": t.get("automation"), "starting": bool(t["state"] == "running" and starting(t))}


def diff_events(facts, seen):
    """What happened to these tasks since the last look: [(event, facts)]. `seen` is the record of
    how each task was, updated in place. The first look only records."""
    first = "_init" not in seen
    seen["_init"] = True
    out = []
    for f in facts:
        key = str(f["id"])
        prev = seen.get(key)
        status, needs = f["status"], f["needs"]
        cur = {"state": f["state"], "status": status, "needs": needs, "attention": f.get("attention"),
               "quiet": (prev or {}).get("quiet"), "stalled": (prev or {}).get("stalled")}
        # Quiet since: a running task whose agents aren't working.
        cur["quiet"] = None if status in ("working",) or f["state"] != "running" else (cur["quiet"] or now())
        if prev is None:
            if not first and not f.get("automation") and f["state"] != "done":
                out.append(("added", f))
            # New since the last look and already on: what it went through meanwhile (an answer
            # missed while this side or the other was down).
            if not first and f["state"] == "ready":
                out.append(("ready", f))
            if not first and f["state"] == "done" and f.get("merged"):
                out.append(("merged", f))
        else:
            if f["state"] == "ready" and prev["state"] != "ready":
                out.append(("ready", f))
            if f["state"] == "done" and prev["state"] != "done" and f.get("merged"):
                out.append(("merged", f))
            if f.get("attention") and f.get("attention") != prev.get("attention"):
                out.append(("failed", f))
            # Needs you: its agent asks something, or waits for a reply (the status people see).
            if needs in ("asks", "reply") and prev.get("needs") not in ("asks", "reply"):
                out.append(("needs-you", f))
            stalled = f["state"] == "running" and ((status == "stopped" and not f.get("starting")) or (cur["quiet"] and now() - cur["quiet"] >= STALL_MS))
            if stalled and not prev.get("stalled"):
                out.append(("stalled", f))
            cur["stalled"] = bool(stalled)
        seen[key] = cur
    return out


def events_in(s, seen):
    """What happened to this folder's tasks since the last look: [(event, task)] (diff_events)."""
    by_id = {t["id"]: t for t in s.data["tasks"]}
    return [(ev, by_id[f["id"]]) for ev, f in diff_events([task_facts(s, t) for t in s.data["tasks"]], seen)]


# ---- another folder's events (--from) -------------------------------------------------------
# An automation can hear another folder's task events, on this machine or another one this one
# reaches over herdr-core (one-way reach is enough: this machine asks, the other one only
# answers). Each round the scheduler asks that folder's tasks as they are now (`herdr-task auto
# feed` there, as --after asks about another machine's task) and compares them with the last
# answer it kept on the automation itself ("from_seen"), saved with the runs it fires: a restart
# of either side neither fires twice nor drops what happened meanwhile (caught up on the next
# answer). Kept on this side only: the other machine stores and runs nothing for it.

FEED_TIMEOUT_S = 40


def feed(folder):
    """This machine's folder's tasks as events read them: {folder, prefix, tasks: [task_facts]}."""
    loc = locate(folder)
    with Store(loc, write=False) as s:
        return {"folder": loc["folder"], "prefix": s.prefix, "tasks": [task_facts(s, t) for t in s.data["tasks"]]}


def fetch_feed(src):
    """src's folder's tasks now (feed()), asked on its machine. Raises Fail when it can't be asked."""
    if not src.get("machine"):
        return feed(src["folder"])
    guard(["hc"])
    argv = [sys.executable, ENTRY, "--on", src["machine"], "auto", "feed", "--folder", src["folder"], "--json"]
    try:
        r = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=FEED_TIMEOUT_S + 20)
    except subprocess.TimeoutExpired:
        raise Fail(f"{src['machine']} didn't answer.")
    line = next((x for x in reversed(r.stdout.splitlines()) if x.startswith("{")), None)
    try:
        d = json.loads(line) if line else None
    except ValueError:
        d = None
    if isinstance(d, dict) and isinstance(d.get("tasks"), list):
        return d
    err = (d or {}).get("error") if isinstance(d, dict) else None
    last = ((r.stderr or "").strip().splitlines() or [f"Couldn't ask {src['machine']}."])[-1]
    raise Fail(err or re.sub(r"^[\w.]*Fail: ", "", last))


def watch_from(s, a):
    """At add or edit: checks --from's machine and folder, and takes the first look (from then
    on, every event is news). Unknown machine: refused. One that can't be asked now: a warning
    (the scheduler's first answer is then its first look)."""
    src = a["from"]
    if src.get("machine"):
        from .machines import connected_machines
        names = [m.get("name") for m in connected_machines()]
        if src["machine"] not in names:
            raise Fail(f"No machine {src['machine']} is linked to this one" + (f" (linked: {', '.join(names)})." if names else "."))
    try:
        d = fetch_feed(src)
    except Fail as e:
        if not src.get("machine"):
            raise
        return f"couldn't ask {src['machine']} now ({e}); its events count from the first answer."
    seen = {}
    diff_events(d["tasks"], seen)
    a["from_seen"] = seen
    return None


def feeds_for(lists):
    """Every --from source the automations in these lists hear, asked at once (in parallel):
    {from_text: feed or Fail}. Asked outside the folders' locks (another machine can be slow)."""
    srcs = {}
    for d in lists:
        for a in d.get("automations") or []:
            if a.get("from") and a.get("on") and not a.get("paused"):
                srcs[from_text(a["from"])] = a["from"]
    out = {}

    def ask(key, src):
        try:
            out[key] = fetch_feed(src)
        except Exception as e:  # one machine never stops the rest
            out[key] = e if isinstance(e, Fail) else Fail(str(e)[:200])
    threads = [threading.Thread(target=ask, args=kv) for kv in srcs.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def from_events(s, a, feeds):
    """The --from folder's events since this automation last looked: [(event, facts)]. Its record
    changes in the store, with the runs they fire (one save)."""
    d = (feeds or {}).get(from_text(a["from"]))
    if d is None:
        return []
    if isinstance(d, Exception):
        err = {"at": now(), "message": f"Couldn't ask {from_text(a['from'])}: {d}", "kind": "from"}
        if (a.get("last_error") or {}).get("message") != err["message"]:
            a["last_error"] = err
            s.dirty = True
        return []
    if (a.get("last_error") or {}).get("kind") == "from":
        a.pop("last_error")
    seen = a.setdefault("from_seen", {})
    before = json.dumps(seen, sort_keys=True)
    out = diff_events(d["tasks"], seen)
    ids = {str(f["id"]) for f in d["tasks"]}
    for k in [k for k in seen if k not in ids and k != "_init"]:
        seen.pop(k)
    if json.dumps(seen, sort_keys=True) != before:
        s.dirty = True
    return out


def automations_pass(s, seen, report, feeds=None):
    """Fires this folder's automations that are due: their time came (once), or an event they hear
    (once per event). feeds: the --from folders' tasks now (feeds_for)."""
    autos = [a for a in s.data.get("automations") or [] if not a.get("paused")]
    if not autos:
        return
    enabled = settings_for(s)["automations"].get("enabled", True)
    happened = events_in(s, seen) if any(a.get("on") and not a.get("from") for a in autos) else []
    for a in autos:
        on = settings_for(s, a.get("space"))["automations"].get("enabled", True) if a.get("space") else enabled
        whys = []
        if a.get("every") and a.get("next_run") and now() >= a["next_run"]:
            a["next_run"] = next_run(a["every"], now())
            s.dirty = True
            whys.append(("time", None))
        if a.get("from"):
            # Another folder's: its record moves on also while it's off (Settings), as its own folder's does.
            for ev, f in from_events(s, a, feeds) if a.get("on") else []:
                if ev in a["on"] and matches(a, f):
                    where = f"{a['from']['machine']}:" if a["from"].get("machine") else ""
                    whys.append((f"{ev}: {where}{f['ref']}", event_brief(ev, f, a["from"])))
        else:
            for ev, t in happened:
                # Its own tasks never set it off again (no endless chains).
                if ev in (a.get("on") or []) and t.get("automation") != a["id"] and matches(a, t):
                    whys.append((f"{ev}: {s.ref(t)}", event_brief(ev, {"ref": s.ref(t), "title": t["title"]})))
        if not on:
            continue
        for why, brief in whys:
            t = fire(s, a, why, brief)
            report["fired"].append({"folder": s.loc["folder"], "automation": auto_ref(s, a), "task": s.ref(t), "why": why})


SEEN = os.path.join(STORE, ".seen.json")


LOCK_WAIT_S = 60  # a round waits this long for a tick to finish (one takes about a second)


def take_lock(f, wait):
    """f's lock, waiting up to `wait` seconds for whoever holds it; False if still held."""
    end = time.monotonic() + wait
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            if time.monotonic() >= end:
                return False
            time.sleep(0.2)


def one_pass(report):
    """The scheduler's round: every folder with automations or tasks waiting on something. It
    waits for a tick that holds the lock rather than skipping: the window's (or the service's)
    tick also comes every 15 s, and once in step with it a round that gave way skipped every time
    (SHEP-34: no autopilot or automations ran for as long as they stayed in step)."""
    lock = open(os.path.join(STORE, ".tick.lock"), "a")
    if not take_lock(lock, LOCK_WAIT_S):
        lock.close()
        return
    try:
        seen_all = read_list(SEEN) or {}
        lists = [d for d in map(read_list, store_files()) if d and os.path.isdir(d.get("folder") or "")]
        feeds = feeds_for(lists)
        for d in lists:
            tasks = d.get("tasks") or []
            busy = any(t.get("state") in ("queued", "scheduled") or (t.get("worktree") and t.get("state") in ("running", "ready")) for t in tasks)
            if not busy and not d.get("automations"):
                continue
            with Store(locate(d["folder"])) as s:
                seen = seen_all.setdefault(s.slug, {})
                automations_pass(s, seen, report, feeds)
                tick_store(s, report)
        try:
            retry_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} retries: {e}", flush=True)
        try:
            archive_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} archive: {e}", flush=True)
        try:
            news_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} news: {e}", flush=True)
        try:
            end_done_pass(report)
            memory_guard(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} ending done agents: {e}", flush=True)
        try:
            lost_logs_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} lost logs: {e}", flush=True)
        try:
            backup_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} backup: {e}", flush=True)
        try:
            cli_check_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} cli check: {e}", flush=True)
        try:
            from .autopilot import autopilot_pass  # after this module: it reuses the time rules and events
            autopilot_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} autopilot: {e}", flush=True)
        try:
            machines_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} machines: {e}", flush=True)
        try:
            from .home import home_pass
            home_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} home: {e}", flush=True)
        tmp = f"{SEEN}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(seen_all, f)
        os.replace(tmp, SEEN)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def cmd_scheduler(args):
    if args.ensure:
        out = ensure_scheduler()
        say(args, out, out["note"])
        return
    os.makedirs(STORE, exist_ok=True)
    me = open(os.path.join(STORE, ".scheduler.lock"), "a")
    try:
        fcntl.flock(me, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        say(args, {"running": True}, "Another scheduler is running.")
        return
    started = script_hash()
    on_layout = WHERE.migrated
    test = bool(os.environ.get("HERDR_TASK_STORE"))
    with open(os.path.join(STORE, ".scheduler.json"), "w") as f:
        json.dump({"pid": os.getpid(), "hash": started, "at": now(), "terminal": os.environ.get("HC_TERMINAL_ID")}, f)
    print(f"herdr-automations: watching {STORE} every 15 s.", flush=True)
    while True:
        report = {"started": [], "done": [], "attention": [], "fired": []}
        try:
            if not test:
                layout.heal_back(WHERE)       # rolled back: what was written at the new paths just after, taken back
                for k in layout.heal(WHERE):  # an older writer's file at an old path: taken in
                    print(f"{time.strftime('%H:%M:%S')} took in {k} written at its old path", flush=True)
            one_pass(report)
        except Exception as e:  # one bad list never stops the rest
            print(f"{time.strftime('%H:%M:%S')} error: {e}", flush=True)
        for f in report["fired"]:
            print(f"{time.strftime('%H:%M:%S')} {f['automation']} -> {f['task']} ({f['why']})", flush=True)
        for f in report["started"]:
            print(f"{time.strftime('%H:%M:%S')} started {f['ref']}", flush=True)
        for f in report.get("news") or []:
            print(f"{time.strftime('%H:%M:%S')} news to {f['to']}: {len(f['lines'])} line(s)", flush=True)
        for f in report.get("backups") or []:
            print(f"{time.strftime('%H:%M:%S')} backup {f}", flush=True)
        for f in report.get("backups_started") or []:
            print(f"{time.strftime('%H:%M:%S')} {f['task']}: {f['to']} took over from {f['from']} ({f['why']})", flush=True)
        for f in report.get("home") or []:
            print(f"{time.strftime('%H:%M:%S')} home news to {f['to']}: {len(f['lines'])} line(s)", flush=True)
        for m, e in (report.get("home_errors") or {}).items():
            print(f"{time.strftime('%H:%M:%S')} home: {m}: {e}", flush=True)
        for f in report.get("ended") or []:
            print(f"{time.strftime('%H:%M:%S')} {f['task']} is done: ended {', '.join(f['terminals'])}", flush=True)
        if (report.get("memory_guard") or {}).get("alert"):
            print(f"{time.strftime('%H:%M:%S')} memory guard: {report['memory_guard']['alert']}", flush=True)
        for f in report.get("autopilot") or []:
            print(f"{time.strftime('%H:%M:%S')} autopilot woke {f['to']} ({f['why']})", flush=True)
        if args.once:
            say(args, report, None)
            return
        time.sleep(15)
        # Updated, or this machine's data moved since: carry on as the new version, on the new paths.
        if script_hash() != started or (not test and WHERE.migrated != on_layout):
            fcntl.flock(me, fcntl.LOCK_UN)
            os.execv(sys.executable, [sys.executable, ENTRY, "scheduler"])


def cmd_track(args):
    """Background: records an agent's session while it runs."""
    seen = None
    shell_since = None

    def ended(at):
        with Store(locate(args.folder)) as s:
            a = next((a for a in s.find(args.id)["agents"] if a["address"] == args.address), None)
            if a and not a.get("ended"):
                a["ended"] = at
                s.dirty = True

    while True:
        k = hc_json("get", args.address)
        if not k or k.get("state") != "live":
            return ended(now())
        if not agent_running(k):
            shell_since = shell_since or time.time()
            if time.time() - shell_since > 60:
                return ended(int(shell_since * 1000))
        else:
            shell_since = None
            pid = (k.get("foreground") or {}).get("pid")
            sid, log = session_of(pid) if pid else (None, None)
            if sid and (sid, log) != seen:
                with Store(locate(args.folder)) as s:
                    t = s.find(args.id)
                    a = next((a for a in t["agents"] if a["address"] == args.address), None)
                    if a and (a.get("session"), a.get("log")) != (sid, log):
                        a["session"], a["log"] = sid, log
                        s.dirty = True
                seen = (sid, log)
        time.sleep(5)
