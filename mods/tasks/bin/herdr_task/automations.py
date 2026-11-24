"""Automations (a saved task added again by a time or an event), and the scheduler's loop."""

import datetime
import fcntl
import fnmatch
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time

from . import analytics
from .base import ENTRY, Fail, guard, hc_json, layout, now, plugin_off, STORE, WHERE
from .when import parse_at
from .settings import bare, set_task, settings_for, SET_KEYS, worker_argv, worktrees_on
from .agents import agent_running, live_agents, starting, status_of, task_status
from .sessions import session_of
from .launch import default_space
from .store import locate, open_store, read_list, Store, store_files
from .queues import queue_reason
from .launch import own_path
from .archive import archive_pass
from .output import say
from .scheduler import ensure_scheduler, script_hash
from .commands import begin
from .news import news_pass
from .tick import end_done_pass, lost_logs_pass, memory_guard, stopped_pass, tick_store
from .machines import machines_pass
from .takeover import cli_check_pass


# ---- schedules (stored as automations) ---------------------------------------------------------
# A schedule is a recipe: when (a time, a repeat or an event, in this machine's time zone), what to do, the
# space and the agent. People see "schedule"; the store, the CLI (`herdr-task auto ...`) and the code keep
# "automation", so nothing migrates. Every run starts a new, ordinary task named after it (3.2, step 42),
# which carries its schedule (automation, automation_title). Agents make them with `herdr-task auto ...`;
# the scheduler (`herdr-task scheduler`, one per machine, kept by herdr-core as herdr-automations) fires them.
# A run missed while the machine was off runs once when it is back. A one-off leaves the list after its run.

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
EVENTS = ["added", "ready", "failed", "checks-fail", "needs-you", "done", "merged", "stalled"]
EVENT_WORDS = {"added": "a task is added", "ready": "a task is ready", "failed": "a task fails", "checks-fail": "checks fail",
               "needs-you": "a task needs the person", "done": "a task is done", "merged": "a task is merged",
               "stalled": "a task stalls"}
RUNS_KEPT = 50
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


# A time of day as people write it: 9:00, 17.30, 9am, 5:30 pm (a bare number is not one).
TIME = r"\d{1,2}(?:[:.]\d{2})?(?: ?[ap]m)|\d{1,2}[:.]\d{2}"


def parse_hhmm(text):
    m = re.fullmatch(r"(\d{1,2})(?:[:.](\d{2}))?(?: ?([ap])m)?", text.strip().lower())
    if not m or (m.group(2) is None and not m.group(3)):
        raise Fail(f"Unknown time {text!r}. " + HOW)
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3):
        if not 1 <= h <= 12:
            raise Fail(f"Unknown time {text!r}. " + HOW)
        h = h % 12 + (12 if m.group(3) == "p" else 0)
    if h > 23 or mi > 59:
        raise Fail(f"Unknown time {text!r}. " + HOW)
    return f"{h:02d}:{mi:02d}"


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
    m = re.fullmatch(r"every (\d+) ?(minutes?|mins?|m|hours?|hrs?|h)(?: on ([a-z ,]+?))?(?: (?:from|between) (%s) (?:to|and|-) (%s))?(?: on ([a-z ,]+))?" % (TIME, TIME), t)
    if m:
        n = int(m.group(1)) * (60 if m.group(2).startswith("h") else 1)
        if n < 5:
            raise Fail("At most every 5 minutes.")
        frm, to = (parse_hhmm(m.group(4)), parse_hhmm(m.group(5))) if m.group(4) else ("00:00", "23:59")
        return {"text": text.strip(), "kind": "interval", "minutes": n, "days": parse_days(m.group(3) or m.group(6) or ""),
                "from": frm, "to": to}
    m = re.fullmatch(r"(?:(.*?) )?((?:%s)(?: ?(?:,|and) ?(?:%s))*)" % (TIME, TIME), re.sub(r"(^| )at (?=\d)", r"\1", t).strip())
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


# An event in plain words ("when a task is merged", "when checks fail"): the first that fits.
EVENT_SAID = [(r"checks? (?:fail\w*|(?:are |is |go(?:es)? |turn(?:s)? )?red)|ci (?:fails?|is red)|failing checks?", "checks-fail"),
              (r"\bmerged?\b|\bmerges\b", "merged"), (r"\bdone\b|finish\w*|complete\w*", "done"), (r"\bready\b", "ready"),
              (r"needs? (?:me|you|us|the person|someone|attention|an answer)|\basks?\b|has a question", "needs-you"),
              (r"stall\w*|\bstuck\b|goes quiet|went quiet", "stalled"), (r"\badded\b|\bcreated\b|new task", "added"),
              (r"fail\w*|\bstops?\b|stopped|crash\w*", "failed")]
WHEN_HOW = ('Say when in plain words: a time ("Mondays 9:00", "weekdays 9:00", "every 30 minutes", "once fri 9:00"), an event '
            '("when a task is merged", "when a task is done", "when checks fail", "when a task is ready", "when a task needs me", '
            '"when a task fails", "when a task stalls", "when a task is added"), or both ("weekdays 9:00, when checks fail").')


def parse_when(text):
    """One line of plain words as a trigger (3.2: a schedule's "when", typed by the person or their agent):
    (time rule or None, events or None). A time, a repeat, an event, or a time and events together."""
    t = " ".join(str(text or "").split())
    if not t:
        raise Fail(WHEN_HOW)
    m = re.search(r"(?:^|[,;]\s*|\s+(?:and|or)\s+|\s+)(?:when(?:ever)?|each time|every time|after|as soon as)\s+(.+)$", t, re.I)
    times, said = (t[:m.start()].strip(" ,;"), m.group(1)) if m else (t, "")
    events = []
    for part in re.split(r"\s*(?:,|;|\bor\b|\band\b)\s*(?:when(?:ever)?\s+)?", said):
        part = part.strip(" .").lower()
        if not part:
            continue
        hit = part if part in EVENTS else next((ev for rx, ev in EVENT_SAID if re.search(rx, part)), None)
        if not hit:
            raise Fail(f"Unknown event {part!r}. " + WHEN_HOW)
        events.append(hit)
    if not times and not events:
        raise Fail(WHEN_HOW)
    try:
        rule = parse_every(times) if times else None
    except Fail as e:
        raise Fail(f"{e} {WHEN_HOW}" if not events else str(e))
    return rule, (sorted(set(events), key=EVENTS.index) or None)


def when_words(a):
    """Its trigger as words `--when` takes back: the time as it was written, then its events."""
    parts = [a["every"]["text"]] if a.get("every") else []
    if a.get("on"):
        parts.append("when " + " or ".join(EVENT_WORDS[e] for e in a["on"]))
    return ", ".join(parts)


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


def quoted(title):
    from .store import quoted as q
    return q(title)


def find_auto(s, ref):
    """A schedule by its key (HAT-A1, A1, 1), else by its title: the exact one, else a unique part of one (SHEP-322).
    Two or more that fit are refused with each listed."""
    from .store import by_title
    r = str(ref).strip()
    m = re.fullmatch(r"(?:([A-Za-z]+[0-9]*)-)?[Aa]?([0-9]+)", r)
    autos = s.data.get("automations") or []
    if m and (not m.group(1) or m.group(1).upper() == s.prefix):
        for a in autos:
            if a["id"] == int(m.group(2)):
                return a
    hits = by_title(autos, r)
    if len(hits) == 1:
        return hits[0]
    if hits:
        raise Fail(f"{len(hits)} schedules here fit {quoted(r)}, so nothing was done. Name one by its key (for commands "
                   f"only; never say it to the person) or its full title:\n" +
                   "\n".join(f"  {auto_ref(s, a)}  {' '.join(str(a.get('title') or '').split())}" for a in hits[:12]))
    raise Fail(f"No schedule {quoted(r)} in {s.loc['folder']}.")


def run_ended(s, r):
    """How one run ended, from its task as the list keeps it: "error" (it couldn't start), "queued", "working",
    "ready", "nothing" / "told" (ready --nothing / --told), "merged", "done", or "removed" (its task is gone)."""
    if r.get("error"):
        return "error"
    try:
        n = int(str(r.get("task") or "").rsplit("-", 1)[-1])
    except ValueError:
        return None
    t = next((t for t in s.data.get("tasks") or [] if t.get("id") == n), None)
    if not t:
        return "removed"
    if t["state"] == "done":
        return t.get("quiet") if t.get("quiet") in ("nothing", "told") else "merged" if t.get("merged") else "done"
    return {"running": "working", "ready": "ready"}.get(t["state"], "queued")


def auto_view(s, a):
    v = {k: a.get(k) for k in ("id", "title", "prompt", "mode", "agent", "set", "on", "match", "space", "paused",
                                "next_run", "last_run", "last_task", "last_error", "from_error", "created")}
    enabled = not plugin_off("schedules") and settings_for(s, a.get("space"))["automations"].get("enabled", True)
    runs = [{**r, "ended": run_ended(s, r)} for r in a.get("runs") or []]
    # 3.2, for the Scheduled tab: name, when (words `--when` takes back), what, once, active (it fires now: not paused,
    # its space not stopped, schedules on in Settings), its runs each with how it ended, and the last one.
    v.update(name=a.get("title"), what=a.get("prompt"), when=when_words(a), once=bool((a.get("every") or {}).get("kind") == "once"),
             events=a.get("on") or [], space_paused=bool(a.get("space_paused")), paused=bool(a.get("paused")),
             active=bool(enabled and not a.get("paused") and not a.get("space_paused")), runs=runs, last=runs[-1] if runs else None)
    # machine: None here; herdr-task --on <machine> names it (cli.remote), so a list across machines says whose it is
    v.update(ref=auto_ref(s, a), **{"from": from_text(a["from"]) if a.get("from") else None}, folder=s.loc["folder"], machine=None, prefix=s.prefix, every=(a.get("every") or {}).get("text"),
             trigger=trigger_words(a), enabled=enabled, may_update=bool(a.get("may_update")), last_update=a.get("last_update"))
    if a.get("from"):
        v.update(heard_words(a))
    return v


HEARD_STALE_MS = 3 * 60 * 1000  # a round asks every 15 s (an answer can take a minute): older than this, it isn't hearing


def heard_at(src):
    """When the scheduler last got an answer from this --from source (one_pass keeps it in .seen.json), or None."""
    try:
        with open(SEEN) as f:
            return ((json.load(f) or {}).get("_heard") or {}).get(from_text(src))
    except (OSError, ValueError, AttributeError):
        return None


def heard_words(a):
    """SHEP-423: auto show says when it last heard the folder it listens to, and when it can't hear it:
    {heard: ms or None, hearing: bool, heard_words}."""
    src, at, t = a["from"], heard_at(a["from"]), now()
    who = src.get("machine") or os.path.basename(src["folder"].rstrip("/")) or src["folder"]
    clock = lambda ms: f"{datetime.datetime.fromtimestamp(ms / 1000):%H:%M}" if t - ms < 20 * 3600 * 1000 else \
        f"{datetime.datetime.fromtimestamp(ms / 1000):%a %H:%M}"
    fe = a.get("from_error")
    if fe:
        words = f"can't hear {who} since {clock(fe.get('since') or fe.get('at') or t)}"
    elif not at:
        words = f"hasn't heard from {who} yet (is the scheduler running?)"
    elif t - at > HEARD_STALE_MS:
        words = f"can't hear {who}: last heard {clock(at)} (is the scheduler running?)"
    else:
        words = f"last heard from {who} {clock(at)}"
    return {"heard": at, "hearing": bool(at and not fe and t - at <= HEARD_STALE_MS), "heard_words": words}


def auto_line(v):
    state = "paused" if v["paused"] else "its space is archived" if v.get("space_paused") else ("off in Settings" if not v["enabled"] else
                                          (f"next {datetime.datetime.fromtimestamp(v['next_run'] / 1000):%a %H:%M}" if v.get("next_run") else "on events"))
    err = (f"  ! {v['last_error']['message']}" if v.get("last_error") else
           f"  ~ {v['from_error']['message']} ({v['from_error']['misses']} round(s) so far)" if v.get("from_error") else "")
    heard = f"; {v['heard_words']}" if v.get("heard_words") else ""
    return f"{v['title']}  ({v['trigger']}; {state}{heard}{'; may update Shepherdr' if v.get('may_update') else ''}){err}  [key {v['ref']}]"


def set_auto_fields(s, a, args, adding=False):
    if getattr(args, "title", None):
        a["title"] = args.title.strip()
    if args.prompt is not None:
        a["prompt"] = args.prompt
    if args.prompt_file:
        with open(args.prompt_file) as f:
            a["prompt"] = f.read()
    if getattr(args, "when", None) is not None:
        # one line of plain words: a time, an event or both (parse_when); replaces both
        a["every"], a["on"] = parse_when(args.when)
        a["next_run"] = next_run(a["every"], now())
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
    if getattr(args, "may_update", None) is not None:
        from .self_update import set_allowed
        set_allowed(a, args.may_update)
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
        raise Fail("Say when it runs: --when \"weekdays 9:00\" or \"when a task is merged\" (or --every and/or --on ready,merged). " + HOW)
    if a.get("from") and not a.get("on"):
        raise Fail("--from says whose task events set it off: give --on too (merged, ready, ...).")
    if a.get("every") and a["every"]["kind"] == "once" and not a.get("next_run") and adding:
        raise Fail("That time has passed.")


def space_pause(args, stop):
    """auto pause|resume --space <id> --all (3.2: an archived space's schedules stop, and run again once it is
    back): every schedule of that space on this machine, in whichever folder. Kept apart from each one's own
    pause (space_paused), so resuming the space leaves a schedule the person paused by hand paused."""
    space, out = bare(args.space), []
    for p in store_files():
        d = read_list(p)
        if not d or not os.path.isdir(d.get("folder") or "") or not any(bare(a.get("space") or "") == space for a in d.get("automations") or []):
            continue
        with Store(locate(d["folder"])) as s:
            for a in s.data.get("automations") or []:
                if bare(a.get("space") or "") != space:
                    continue
                if bool(a.get("space_paused")) != stop:
                    if stop:
                        a["space_paused"] = True
                    else:
                        a.pop("space_paused", None)
                        a["next_run"] = next_run(a.get("every"), now())
                    s.dirty = True
                out.append(auto_view(s, a))
    if not stop and out:
        ensure_scheduler(quiet=True)
    say(args, out, f"{len(out)} schedule{'' if len(out) == 1 else 's'} of space {space} " + ("stopped." if stop else "running again."))


def cmd_auto(args):
    sub = args.auto
    if sub == "list":
        return auto_list(args)
    if sub in ("pause", "resume") and (getattr(args, "all", False) or not getattr(args, "id", None)):
        if not (getattr(args, "all", False) and getattr(args, "space", None)):
            raise Fail(f"Which one? herdr-task auto {sub} <id>, or every schedule of a space: auto {sub} --space <space id> --all.")
        return space_pause(args, sub == "pause")
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
            msg = f"{quoted(a['title'])} added: {trigger_words(a)}."
            if a.get("warning"):
                msg += f"\nWarning: {a['warning']}"
        else:
            a = find_auto(s, args.id)
            if sub == "edit":
                set_auto_fields(s, a, args)
                msg = f"{quoted(a['title'])} saved: {trigger_words(a)}."
                if a.get("warning"):
                    msg += f"\nWarning: {a['warning']}"
            elif sub == "pause":
                a["paused"] = True
                msg = f"{quoted(a['title'])} paused."
            elif sub == "resume":
                a["paused"] = False
                a["next_run"] = next_run(a.get("every"), now())
                msg = f"{quoted(a['title'])} resumed: {trigger_words(a)}."
            elif sub == "rm":
                autos.remove(a)
                msg = f"{quoted(a['title'])} removed."
            elif sub == "run-now":
                t = fire(s, a, "run now")
                msg = f"{quoted(a['title'])} added {s.name(t)}" + (f", but: {a['last_error']['message']}" if a.get("last_error") else ".")
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
             "merged": "was merged", "stalled": "stalled", "done": "is done", "checks-fail": "has failing checks"}[ev]
    # SHEP-322: the task by its title; its key only for a command that looks at it.
    return f"Set off by: the task \"{' '.join(str(f['title']).split())}\" {words}, in {where} (its key, for commands only: {f['ref']})."


def run_rules(s, t):
    """How a schedule's run ends, as words in its brief (thin layer: the agent decides which, code only files it)."""
    ht, ref, folder = own_path(), s.ref(t), shlex.quote(s.loc["folder"])
    return (f"This task is one run of a schedule. How it ends: if there was nothing to do, run `{ht} ready {ref} --folder {folder} "
            f"--nothing` (it is filed as done, and nobody is told). If you only have something to tell the person (a brief, "
            f"what you found), run `{ht} ready {ref} --folder {folder} --told \"<the text, as they should read it>\"` (it is "
            "posted in the space's chat and the task is done). If it is a reminder for the person to do something themselves, "
            "say it in your message and end your turn: it waits for them until they mark it as done. If you changed anything "
            "(files, commits), hand it in like any task with your usual ready and a summary: it is reviewed and merged as "
            "its Settings say.")


def fire(s, a, why, brief=None):
    """Adds the automation's task again and starts it (or queues it, as start would). Returns the
    task. A start that fails is the automation's last error, and the task needs the person.
    brief: what set it off (event_brief), added under its prompt."""
    prompt = a.get("prompt") or ""
    if brief:
        prompt = f"{prompt.rstrip()}\n\n{brief}" if prompt.strip() else brief
    t = s.new(a["title"], prompt, a.get("mode") or ("worktree" if worktrees_on(s) else "here"))
    # 3.2 (step 42): every run is an ordinary task named after its schedule, which it carries (started by its schedule)
    t["automation"], t["automation_title"], t["automation_ref"] = a["id"], a["title"], auto_ref(s, a)
    t["prompt"] = (t["prompt"].rstrip() + "\n\n" if t["prompt"].strip() else "") + run_rules(s, t)
    if a.get("may_update"):
        from .self_update import brief_words
        t["prompt"] += "\n\n" + brief_words(s, a, t, own_path())
    if a.get("space"):
        t["space"] = bare(a["space"])
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
    a["runs"] = (a.get("runs") or [])[-(RUNS_KEPT - 1):] + [run_rec]
    analytics.record("schedule.failed" if run_rec.get("error") else "schedule.ran", task=s.ref(t), space=t.get("space"),
                     kind=why.split(":")[0] if why else None)
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
            "needs": task_status(t, working_ones)[1], "attention": t.get("attention"),
            # SHEP-423: merged once stays merged, also reopened after it (to tag a release) and done again
            "merged": bool(t.get("merged") or t.get("was_merged")),
            "attention_head": t.get("attention_head") if t.get("attention") else None, "quiet": t.get("quiet"),
            "automation": t.get("automation"), "starting": bool(t["state"] == "running" and starting(t))}


def same_failure(prev, f):
    """Whether a task's problem now is the one it had (#1089): the same kind ("Checks failing", the
    words before ":") at the same pull request commit. A second job failing on that commit
    ("Checks failing: a" -> "Checks failing: a, b") is no new failure; a fix pushed that fails
    again is."""
    kind = lambda x: str(x or "").split(":", 1)[0].strip()
    return bool(prev.get("attention")) and kind(prev.get("attention")) == kind(f.get("attention")) \
        and prev.get("attention_head") == f.get("attention_head")


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
        cur = {"state": f["state"], "status": status, "needs": needs, "attention": f.get("attention"), "attention_head": f.get("attention_head"),
               "quiet": (prev or {}).get("quiet"), "stalled": (prev or {}).get("stalled")}
        # SHEP-423: "merged" once per task, whenever its merge is first seen, whatever its state now: merged, then
        # reopened between two looks (to tag a release) was never seen as "done and merged", so it never fired. An
        # older record (no "merged" kept) counts a task it saw done as told already.
        told = bool(prev.get("merged") if prev and "merged" in prev else prev and prev["state"] == "done")
        cur["merged"] = told or bool(f.get("merged"))
        # A schedule's run that ended with nothing to review (ready --nothing / --told) is no "done" event: a
        # "look around every 30 minutes" would set off every schedule that hears "a task is done".
        ended = f["state"] == "done" and not f.get("quiet")
        # Quiet since: a running task whose agents aren't working.
        cur["quiet"] = None if status in ("working",) or f["state"] != "running" else (cur["quiet"] or now())
        if prev is None:
            if not first and not f.get("automation") and f["state"] != "done":
                out.append(("added", f))
            # New since the last look and already on: what it went through meanwhile (an answer
            # missed while this side or the other was down).
            if not first and f["state"] == "ready":
                out.append(("ready", f))
            if not first and ended:
                out.append(("done", f))
            if not first and f.get("merged"):
                out.append(("merged", f))
        else:
            if f["state"] == "ready" and prev["state"] != "ready":
                out.append(("ready", f))
            if ended and prev["state"] != "done":
                out.append(("done", f))
            if f.get("merged") and not told:
                out.append(("merged", f))
            if f.get("attention") and not same_failure(prev, f):
                out.append(("failed", f))
                if str(f["attention"]).startswith("Checks failing"):
                    out.append(("checks-fail", f))
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


# A --from source that fails every round for this long (and at least this many rounds) is flagged.
FROM_GRACE_MS = 15 * 60 * 1000
FROM_GRACE_MISSES = 3


def from_down_words(src, since):
    """A long --from outage in plain words: "Can't reach vm-b since 23:03" (a day or more: "since Mon 23:03")."""
    at = datetime.datetime.fromtimestamp(since / 1000)
    when = f"{at:%H:%M}" if now() - since < 20 * 3600 * 1000 else f"{at:%a %H:%M}"
    if src.get("machine"):
        return f"Can't reach {src['machine']} since {when}"
    return f"Can't read {os.path.basename(src['folder'].rstrip('/')) or src['folder']} since {when}"


def from_events(s, a, feeds):
    """The --from folder's events since this automation last looked: [(event, facts)]. Its record
    changes in the store, with the runs they fire (one save)."""
    d = (feeds or {}).get(from_text(a["from"]))
    if d is None:
        return []
    if isinstance(d, Exception):
        # A blip (a busy line, a sleeping machine) is no news: it's kept in from_error for auto show,
        # and only becomes a Needs-you error once it failed every round for FROM_GRACE_MS.
        t = now()
        fe = a.get("from_error") or {}
        fe = {"since": fe.get("since") or t, "at": t, "misses": int(fe.get("misses") or 0) + 1,
              "message": f"Couldn't ask {from_text(a['from'])}: {d}"}
        a["from_error"] = fe
        s.dirty = True
        if t - fe["since"] >= FROM_GRACE_MS and fe["misses"] >= FROM_GRACE_MISSES:
            words = from_down_words(a["from"], fe["since"])
            if (a.get("last_error") or {}).get("message") != words:
                a["last_error"] = {"at": t, "message": words, "detail": fe["message"], "kind": "from"}
        return []
    if a.get("from_error"):
        a.pop("from_error")
        s.dirty = True
    if (a.get("last_error") or {}).get("kind") == "from":
        a.pop("last_error")
        s.dirty = True
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
    autos = [a for a in s.data.get("automations") or [] if not a.get("paused") and not a.get("space_paused")]
    if not autos:
        return
    gone = []
    # Settings › Plugins: Schedules off, no schedule starts a run (its record still moves on, as when it is off in Settings).
    plugin = not plugin_off("schedules")
    enabled = plugin and settings_for(s)["automations"].get("enabled", True)
    happened = events_in(s, seen) if any(a.get("on") and not a.get("from") for a in autos) else []
    for a in autos:
        on = plugin and settings_for(s, a.get("space"))["automations"].get("enabled", True) if a.get("space") else enabled
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
        # A one-off leaves the list after its run (3.2): its task carries on by itself.
        if any(w == "time" for w, _ in whys) and a["every"]["kind"] == "once" and not a.get("next_run") and not a.get("on"):
            gone.append(a)
    if gone:
        s.data["automations"] = [a for a in s.data["automations"] if a not in gone]
        s.dirty = True


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
    (SHEP-34: no automations ran for as long as they stayed in step)."""
    lock = open(os.path.join(STORE, ".tick.lock"), "a")
    if not take_lock(lock, LOCK_WAIT_S):
        lock.close()
        return
    try:
        seen_all = read_list(SEEN) or {}
        lists = [d for d in map(read_list, store_files()) if d and os.path.isdir(d.get("folder") or "")]
        feeds = feeds_for(lists)
        heard = seen_all.setdefault("_heard", {})
        for k, d in feeds.items():
            if not isinstance(d, Exception):
                heard[k] = now()
        for d in lists:
            tasks = d.get("tasks") or []
            busy = any(t.get("state") in ("queued", "scheduled") or (t.get("worktree") and t.get("state") in ("running", "ready")) for t in tasks)
            if not busy and not d.get("automations"):
                continue
            slug, kept = None, None
            try:
                with Store(locate(d["folder"])) as s:
                    slug, kept = s.slug, json.dumps(seen_all.get(s.slug) or {})
                    seen = seen_all.setdefault(s.slug, {})
                    automations_pass(s, seen, report, feeds)
                    tick_store(s, report)
            except Exception as e:  # SHEP-423: one folder's error never stops the rest's schedules. Nothing of it is
                # saved, and its record goes back as it was: its events stay news for the next round.
                if slug:
                    seen_all[slug] = json.loads(kept)
                print(f"{time.strftime('%H:%M:%S')} {d.get('folder')}: {e}", flush=True)
        try:
            stopped_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} stopped: {e}", flush=True)
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
            cli_check_pass(report)
        except Exception as e:  # never stops the scheduler
            print(f"{time.strftime('%H:%M:%S')} cli check: {e}", flush=True)
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
    from . import base
    if base.FOREIGN_TERMINAL and not args.once:
        # 3.2: a scheduler an older version left running in the default session (the Herdr app's) makes way
        # for one in Shepherdr's own session, and ends here.
        out = ensure_scheduler()
        say(args, out, f"This scheduler ran outside Shepherdr's own herdr-core session ({base.SESSION}). {out['note']}")
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
        for f in report.get("stopped") or []:
            print(f"{time.strftime('%H:%M:%S')} {f['task']} stopped ({f['by']}): {f['why']}", flush=True)
        for f in report.get("home") or []:
            print(f"{time.strftime('%H:%M:%S')} home news to {f['to']}: {len(f['lines'])} line(s)", flush=True)
        for m, e in (report.get("home_errors") or {}).items():
            print(f"{time.strftime('%H:%M:%S')} home: {m}: {e}", flush=True)
        for f in report.get("ended") or []:
            print(f"{time.strftime('%H:%M:%S')} {f['task']} is done: ended {', '.join(f['terminals'])}", flush=True)
        if (report.get("memory_guard") or {}).get("alert"):
            print(f"{time.strftime('%H:%M:%S')} memory guard: {report['memory_guard']['alert']}", flush=True)
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
