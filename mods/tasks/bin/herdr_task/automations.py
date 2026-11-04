"""Automations (a saved task added again by a time or an event), and the scheduler's loop."""

import datetime
import fcntl
import fnmatch
import json
import os
import re
import sys
import time

from .base import ENTRY, Fail, hc_json, now, STORE
from .settings import bare, settings_for, worker_argv, worktrees_on
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
from .tick import end_done_pass, memory_guard, retry_pass, tick_store
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
       '"every 2 hours on weekdays from 8:00 to 18:00", "hourly" or "once 2026-11-05 9:00" (this machine\'s time zone).')


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
    m = re.fullmatch(r"once (\d{4})-(\d{1,2})-(\d{1,2})[ t](\d{1,2}[:.]\d{2})", t)
    if m:
        y, mo, d = map(int, m.groups()[:3])
        hhmm = parse_hhmm(m.group(4))
        try:
            datetime.date(y, mo, d)
        except ValueError:
            raise Fail(f"No such date: {text}")
        return {"text": text.strip(), "kind": "once", "at": f"{y:04d}-{mo:02d}-{d:02d} {hhmm}"}
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
    v = {k: a.get(k) for k in ("id", "title", "prompt", "mode", "agent", "on", "match", "space", "paused",
                                "next_run", "last_run", "last_task", "last_error", "runs", "created")}
    v.update(ref=auto_ref(s, a), folder=s.loc["folder"], prefix=s.prefix, every=(a.get("every") or {}).get("text"),
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
    if not a.get("every") and not a.get("on"):
        raise Fail("Say when it runs: --every \"weekdays 9:00\" and/or --on ready,merged. " + HOW)
    if a.get("every") and a["every"]["kind"] == "once" and not a.get("next_run") and adding:
        raise Fail("That time has passed.")


def cmd_auto(args):
    sub = args.auto
    if sub == "list":
        return auto_list(args)
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
        else:
            a = find_auto(s, args.id)
            if sub == "edit":
                set_auto_fields(s, a, args)
                msg = f"{auto_ref(s, a)} saved: {trigger_words(a)}."
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
        v = auto_view(s, a)
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


def fire(s, a, why):
    """Adds the automation's task again and starts it (or queues it, as start would). Returns the
    task. A start that fails is the automation's last error, and the task needs the person."""
    t = s.new(a["title"], a.get("prompt") or "", a.get("mode") or ("worktree" if worktrees_on(s) else "here"))
    t["automation"] = a["id"]
    if a.get("agent"):
        t["agent"] = a["agent"]
    space = a.get("space")
    run_rec = {"at": now(), "why": why, "task": s.ref(t)}
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


def events_in(s, seen):
    """What happened to this folder's tasks since the last look: [(event, task)]. `seen` is this
    folder's record of how each task was, updated in place. The first look only records."""
    first = "_init" not in seen
    seen["_init"] = True
    out = []
    for t in s.data["tasks"]:
        key = str(t["id"])
        prev = seen.get(key)
        live = [k for k in live_agents(s.key(t))] if t["state"] in ("running", "ready") else []
        working_ones = [k for k in live if agent_running(k)]
        status = status_of(t, working_ones) if t["state"] == "running" else t["state"]
        needs = task_status(t, working_ones)[1]
        cur = {"state": t["state"], "status": status, "needs": needs, "attention": t.get("attention"),
               "quiet": (prev or {}).get("quiet"), "stalled": (prev or {}).get("stalled")}
        # Quiet since: a running task whose agents aren't working.
        cur["quiet"] = None if status in ("working",) or t["state"] != "running" else (cur["quiet"] or now())
        if prev is None:
            if not first and not t.get("automation") and t["state"] != "done":
                out.append(("added", t))
        else:
            if t["state"] == "ready" and prev["state"] != "ready":
                out.append(("ready", t))
            if t["state"] == "done" and prev["state"] != "done" and t.get("merged"):
                out.append(("merged", t))
            if t.get("attention") and t.get("attention") != prev.get("attention"):
                out.append(("failed", t))
            # Needs you: its agent asks something, or waits for a reply (the status people see).
            if needs in ("asks", "reply") and prev.get("needs") not in ("asks", "reply"):
                out.append(("needs-you", t))
            stalled = t["state"] == "running" and ((status == "stopped" and not starting(t)) or (cur["quiet"] and now() - cur["quiet"] >= STALL_MS))
            if stalled and not prev.get("stalled"):
                out.append(("stalled", t))
            cur["stalled"] = bool(stalled)
        seen[key] = cur
    return out


def automations_pass(s, seen, report):
    """Fires this folder's automations that are due: their time came, or an event they hear."""
    autos = [a for a in s.data.get("automations") or [] if not a.get("paused")]
    if not autos:
        return
    enabled = settings_for(s)["automations"].get("enabled", True)
    happened = events_in(s, seen) if any(a.get("on") for a in autos) else []
    for a in autos:
        on = settings_for(s, a.get("space"))["automations"].get("enabled", True) if a.get("space") else enabled
        whys = []
        if a.get("every") and a.get("next_run") and now() >= a["next_run"]:
            a["next_run"] = next_run(a["every"], now())
            s.dirty = True
            whys.append("time")
        for ev, t in happened:
            # Its own tasks never set it off again (no endless chains).
            if ev in (a.get("on") or []) and t.get("automation") != a["id"] and matches(a, t):
                whys.append(f"{ev}: {s.ref(t)}")
        if whys and on:
            t = fire(s, a, whys[0])
            report["fired"].append({"folder": s.loc["folder"], "automation": auto_ref(s, a), "task": s.ref(t), "why": whys[0]})


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
        for p in store_files():
            d = read_list(p)
            tasks = (d or {}).get("tasks") or []
            if not d or not os.path.isdir(d.get("folder") or ""):
                continue
            busy = any(t.get("state") == "queued" or (t.get("worktree") and t.get("state") in ("running", "ready")) for t in tasks)
            if not busy and not d.get("automations"):
                continue
            with Store(locate(d["folder"])) as s:
                seen = seen_all.setdefault(s.slug, {})
                automations_pass(s, seen, report)
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
    with open(os.path.join(STORE, ".scheduler.json"), "w") as f:
        json.dump({"pid": os.getpid(), "hash": started, "at": now(), "terminal": os.environ.get("HC_TERMINAL_ID")}, f)
    print(f"herdr-automations: watching {STORE} every 15 s.", flush=True)
    while True:
        report = {"started": [], "done": [], "attention": [], "fired": []}
        try:
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
        # Updated: carry on as the new version.
        if script_hash() != started:
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
