"""Autopilot: a space's Assistant woken like an automation (on a schedule or on task events), each
wake bringing it the space's heartbeat and its own saved progress. No sandbox: it is the same
regular Assistant, with its usual permissions."""

import contextlib
import datetime
import fcntl
import json
import os
import re
import time

from .base import addon_off, Fail, hc_json, HOME, now, run, STORE
from .settings import autopilot_layers, bare, read_settings, write_autopilot
from .agents import agent_running, status_word
from .launch import caller_labels, coordinator_in
from .store import locate, read_list, Store, store_files
from .output import say
from .news import news_send, typing
from .scheduler import ensure_scheduler
from .automations import EVENTS, events_in, HOW, next_run, parse_every, parse_on, trigger_words


# ---- autopilot ------------------------------------------------------------------------------
# How it wakes is a setting, kept with the others in Shepherdr settings (~/.herdr/shepherdr.json,
# which the window pushes to every machine and the web's host keeps in step): "autopilot" =
# {"every" (an --every rule as written, "" for none), "events" ([--on events]), "heartbeat" (its
# words)} in "everywhere", and a space's own in "spaces"[its id]: what a space sets wins, what it
# doesn't follows Everywhere's (resolve(); the same rule as core/autopilot.js pilotFor, tested on
# core/autopilot.cases.json). Before Settings kept it, Everywhere's schedule and events were in
# .autopilot.json's "everywhere" and the heartbeat in HEARTBEATS/everywhere.md: still read where
# Settings sets none.
# Each space's switch and how its wakes go, in STORE/.autopilot.json (the header's switch and the
# web read it; only herdr-task writes it, under its lock):
#   {"version": 2,
#    "everywhere": {"every", "events"} (from before Settings kept them),
#    "spaces": {"<space id>": {
#      "on" (its Assistant header's switch), "name", "folder", "next_run",
#      "applied" (what last applied: sync() acts on a change),
#      "pending" ({reasons, at}: a wake waiting for its Assistant to be idle),
#      "inflight" ({at, reason, to, turn}: a wake delivered, its turn not ended yet),
#      "last_wake" ({at, reason, outcome}), "wakes" (the last 10 of those),
#      "progress" ({text, at}), "completed" ({text, at}), "seen" (events_in's record per folder)}}}
# A schedule or events a space held of its own in version 1 are dropped on the next read.
# Each machine keeps its own spaces' records and its own scheduler wakes them (their Assistants run
# there): a space on another machine ("vm/sp1" here) is switched, shown and woken by herdr-task on
# that machine (forward()), never from here, so a wake is never sent twice and goes on while this
# computer sleeps. `list` asks every machine the window lists.

STATE = os.path.join(STORE, ".autopilot.json")
HEARTBEATS = os.environ.get("HERDR_AUTOPILOT_HOME") or os.path.join(HOME, ".config", "herdr-core", "autopilot")
DEFAULT_EVERY = "every 60 minutes"
REMOTE_WAIT = 30                 # seconds another machine has to answer
PENDING_MAX_MS = 6 * 3600000     # a wake that found no Assistant this long: missed
TURN_MAX_MS = 3600000            # a wake's turn not seen ending this long: closed anyway
IDLE_AFTER_MS = 120000           # a wake this old whose Assistant sits idle: its turn ended
HEARTBEAT_MAX = 8000             # characters of the heartbeat in a wake (the rest: read the file)
DIRECTION_MAX = 300              # a Direction's one line (core/autopilot.js DIRECTION_MAX)
# The heartbeat Everywhere has until someone writes one: a real one, ready as it is in any project
# (core/autopilot.js STARTER, the same words). The person edits it, Everywhere's or a space's own, to steer.
STARTER = """Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine. Never park on a task waiting for my Accept: go on with work that doesn't need it (step 4), and each wake it still holds tasks back, say in one line what waits on my Accept.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress: facts and your next step, never a limit of your own. Only this heartbeat and I set limits.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before, except what still waits on me. When there's truly nothing worth doing (nothing to unblock, check or start, and no next task worth adding), end with <hc no-reply why="what you checked and what it waits on"/>, never a bare <hc no-reply/>.

Stopping goal: none. Runs until I switch it off.
"""
# Starters earlier versions wrote: one never edited, wherever it is kept, stands for today's.
OLD_STARTERS = ("""Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding.

Stopping goal: none. Runs until I switch it off.
""", """Direction: push this project forward, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Add the most valuable next tasks, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
""", """Direction: keep this space's tasks moving to done, without wasting my time or money. Don't invent work or redo old asks from past chats.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. New tasks: only follow-ups I asked for or a finished task named. At most 2 a wake, each with a full brief.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Nothing new: reply only <hc no-reply/>, never with other words. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
""", """Direction: what Autopilot works toward in this space.

Priorities:
-

Constraints: what it must not do (e.g. never merge; ask before anything risky).

Reporting: what to tell me after a wake, and when to alert me.

Stopping goal (optional): a finite goal; when it's proven, Autopilot turns itself off.
""",)


def heartbeat_path(space=None):
    """Everywhere's heartbeat file from before Settings kept it (read while Settings has none)."""
    return os.path.join(HEARTBEATS, "everywhere.md")


def heartbeat_words(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""


def heartbeat_of(space=None, cfg=None):
    """(words, where) of the heartbeat a space works from (None: Everywhere's): its own in Shepherdr
    settings ("space"), else Everywhere's there ("everywhere"), else Everywhere's file ("file"; the
    starter while there is none)."""
    every, own = autopilot_layers(read_settings() if cfg is None else cfg, space)
    for layer, where in ((own, "space"), (every, "everywhere")):
        if isinstance(layer.get("heartbeat"), str):
            return current(layer["heartbeat"]), where
    p = heartbeat_path()  # none yet: the starter, as the screens show it
    return (current(heartbeat_words(p)) if os.path.exists(p) else STARTER), "file"


def direction_of(space=None, cfg=None):
    """The one line a space steers toward (Shepherdr settings' "direction"): its own, else
    Everywhere's; "" when none is set (it then works out what matters from the project)."""
    every, own = autopilot_layers(read_settings() if cfg is None else cfg, space)
    for layer in (own, every):
        d = one_line(layer.get("direction"))
        if d:
            return d
    return ""


def one_line(words):
    return " ".join(str(words or "").split())[:DIRECTION_MAX] if isinstance(words, str) else ""


def old_starter(words):
    return words.strip() in {x.strip() for x in OLD_STARTERS}


def current(words):
    """A heartbeat's words, an earlier version's starter (never edited) as today's."""
    return STARTER if old_starter(words) else words


def blank(words):
    """A heartbeat nobody wrote: empty (the starter is a real one)."""
    return not current(words).strip()


def ensure_heartbeat(make=True):
    """Everywhere's file: written with STARTER when missing (make), or when it still holds an earlier
    version's starter, never edited (that one kept beside it as everywhere.md.bak). The person's own
    words are never touched."""
    p = heartbeat_path()
    words = heartbeat_words(p) if os.path.exists(p) else None
    old = words is not None and old_starter(words) and words != STARTER
    if old or (make and words is None):
        os.makedirs(HEARTBEATS, exist_ok=True)
        if old:
            with open(f"{p}.bak", "w") as f:
                f.write(words)
        tmp = f"{p}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            f.write(STARTER)
        os.replace(tmp, p)
    return p


def everywhere_default():
    return {"every": parse_every(DEFAULT_EVERY), "events": []}


def migrate(d):
    """One setting for every space: what a space held of its own (version 1's schedule and events,
    a switch on Everywhere) no longer applies, and goes."""
    for a in d.get("spaces", {}).values():
        a.pop("every", None)
        a.pop("events", None)
    (d.get("everywhere") or {}).pop("on", None)
    d["version"] = 2


@contextlib.contextmanager
def state(write=True):
    """The autopilot state, locked; written back (atomically) when write."""
    os.makedirs(STORE, exist_ok=True)
    lock = open(os.path.join(STORE, ".autopilot.lock"), "a")
    fcntl.flock(lock, fcntl.LOCK_EX if write else fcntl.LOCK_SH)
    try:
        d = read_list(STATE) or {}
        d.setdefault("spaces", {})
        migrate(d)
        e = d.setdefault("everywhere", {})
        for k, v in everywhere_default().items():
            e.setdefault(k, v)
        yield d
        if write:
            tmp = f"{STATE}.{os.getpid()}.tmp"
            with open(tmp, "w") as f:
                json.dump(d, f, indent=1)
            os.replace(tmp, STATE)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def window_spaces():
    """Every space in the window's list on this computer, other machines' too ("vm/sp1", with its
    machine): [{id, machine, name, folder}]; None when no window here can say (a VM has none)."""
    try:
        r = run(["herdr-app", "ls"])
        return [x for x in json.loads(r.stdout).get("spaces") or [] if x.get("id")]
    except (Fail, ValueError, OSError, AttributeError):
        return None


def local_spaces():
    """This computer's spaces in the window's list: [{id, name, folder}] ([] when it can't say)."""
    return [x for x in window_spaces() or [] if "/" not in x["id"] and not x.get("machine")]


def machine_of(space):
    """(machine, its id there) of a space as this computer names it: "vm/sp1" -> ("vm", "sp1");
    this computer's own -> (None, its id)."""
    m, cut, rest = (space or "").partition("/")
    return (m, rest) if cut else (None, space)


def there(v, machine):
    """Another machine's view of one of its spaces, named as this computer names it."""
    if v.get("space") and "/" not in v["space"]:
        v["space"] = f"{machine}/{v['space']}"
    v["machine"] = machine
    return v


def forward(args, machine, space):
    """A space on another machine: herdr-task there switches, wakes or shows it (installed there
    first when it isn't this one), told the space's name and folder (given, else from the window
    here: a machine without a window can't say them). Its view, named as this computer names it."""
    from .cli import remote_run
    argv = ["autopilot", args.autopilot, "--space", space, "--json"]
    if args.autopilot in ("on", "off", "run-now"):
        w = {"name": getattr(args, "name", None), "folder": getattr(args, "space_folder", None)}
        if not w["folder"]:
            w = next((x for x in window_spaces() or [] if x["id"] == f"{machine}/{space}"), None) or {}
        told = [x for flag, v in (("--name", w.get("name")), ("--space-folder", w.get("folder"))) if v for x in (flag, v)]
    else:
        told = []
    r = remote_run(machine, argv + told, timeout=REMOTE_WAIT)
    if told and "unrecognized arguments" in r.stderr:
        # a machine running its own older herdr-task (it has a window: it knows its spaces itself)
        r = remote_run(machine, argv, timeout=REMOTE_WAIT)
    try:
        v = json.loads(r.stdout)
    except ValueError:
        v = None
    if not isinstance(v, dict):
        why = ((r.stderr or r.stdout).strip().splitlines() or ["no answer"])[-1].replace("herdr-task: ", "")
        raise Fail(f"Couldn't reach {machine}: {why}")
    if v.get("error"):
        raise Fail(v["error"])
    return there(v, machine)


def remote_lists(machines):
    """Each other machine's own spaces (`autopilot list --here` there), asked at once:
    {machine: its list, or {"error": why}}."""
    from concurrent.futures import ThreadPoolExecutor
    from .cli import remote_run

    def one(m):
        try:
            r = remote_run(m, ["autopilot", "list", "--here", "--json"], timeout=REMOTE_WAIT)
            if "unrecognized arguments" in r.stderr:
                # its own older herdr-task, whose list holds only its own spaces
                r = remote_run(m, ["autopilot", "list", "--json"], timeout=REMOTE_WAIT)
            d = json.loads(r.stdout)
            if isinstance(d, dict) and not d.get("error"):
                return d
            return {"error": (d or {}).get("error") if isinstance(d, dict) else "no answer"}
        except (Fail, ValueError, OSError) as e:
            return {"error": str(e) or "no answer"}
    if not machines:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(machines))) as ex:
        return dict(zip(machines, ex.map(one, machines)))


def list_all(here_only=False):
    """{everywhere, spaces}: each space the window lists, this computer's from its own records
    (one it no longer lists left out; every record where no window can say), then each other
    machine's as that machine has it (off where it has none; unreachable: why)."""
    win = window_spaces()
    with state(write=False) as d:
        ev = everywhere_view(d)
        if win is None:
            mine = list(d["spaces"].items())
        else:
            mine = [(x["id"], d["spaces"].get(x["id"]) or {"name": x.get("name"), "folder": x.get("folder")})
                    for x in win if "/" not in x["id"] and not x.get("machine")]
        spaces = [view(d, sp, a) for sp, a in mine]
    if here_only or not win:
        return {"everywhere": ev, "spaces": spaces}
    others = {}
    for x in win:
        m, sp = machine_of(x["id"])
        if m:
            others.setdefault(m, []).append((sp, x))
    for m, out in remote_lists(list(others)).items():
        views = {v.get("space"): v for v in out.get("spaces") or []}
        for sp, x in others[m]:
            v = views.get(sp) or {"space": sp, "on": False, "own": [],
                                  "trigger": (out.get("everywhere") or ev).get("trigger")}
            v["name"], v["folder"] = v.get("name") or x.get("name"), v.get("folder") or x.get("folder")
            if out.get("error"):
                v["unreachable"] = out["error"]
            spaces.append(there(v, m))
    return {"everywhere": ev, "spaces": spaces}


def folder_of(folder):
    try:
        return locate(folder)["folder"] if folder else None
    except Fail:
        return folder


def space_info(space):
    """(name, task folder) of a space on this computer, from the window's list; (None, None) when
    the window doesn't know it."""
    sp = next((x for x in local_spaces() if x.get("id") == space), None)
    if not sp:
        return None, None
    return sp.get("name"), folder_of(sp.get("folder"))


def my_space(args):
    """--space, else the caller's (an Assistant's own: its pane's, or its chat's). None: --everywhere."""
    if getattr(args, "everywhere", False):
        if getattr(args, "space", None):
            raise Fail("Pass --space or --everywhere, not both.")
        return None
    if getattr(args, "space", None):
        return bare(args.space)
    labels = caller_labels()
    sp = labels.get("herdr.space") or labels.get("herdr.coordinator.space")
    if not sp:
        raise Fail("Which space? Run this as the space's Assistant, or pass --space <space id> (or --everywhere).")
    return bare(sp)


def when(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%a %H:%M") if ms else None


def rule_of(x):
    """A schedule as Settings keeps it (its words; "" or off: none) as a rule; False: not one."""
    if x is None or isinstance(x, dict):
        return x
    t = str(x).strip()
    if not t or t.lower() in ("off", "none", "never"):
        return None
    try:
        return parse_every(t)
    except Fail:
        return False


def resolve(d, a, space=None, cfg=None):
    """What applies in a space (its record `a` and id; None: Everywhere's own): {on, every, events,
    own}: its own on/off (off until switched on); the schedule and events it sets in Shepherdr
    settings (cfg, read when not given), else Everywhere's there, else Everywhere's from before
    (.autopilot.json), else the defaults. own: the fields the space sets itself."""
    e = {**everywhere_default(), **{k: v for k, v in (d.get("everywhere") or {}).items() if k in ("every", "events")}}
    every, mine = autopilot_layers(read_settings() if cfg is None else cfg, space)
    own = []
    for layer, is_own in ((every, False), (mine, True)):
        if "every" in layer and rule_of(layer["every"]) is not False:
            e["every"] = rule_of(layer["every"])
            own += ["every"] if is_own else []
        if isinstance(layer.get("events"), list):
            e["events"] = layer["events"]
            own += ["events"] if is_own else []
    if isinstance(mine.get("heartbeat"), str):
        own.append("heartbeat")
    if one_line(mine.get("direction")):
        own.append("direction")
    return {"on": bool((a or {}).get("on")), "every": e["every"], "events": [x for x in EVENTS if x in (e["events"] or [])], "own": own}


def trigger_of(eff):
    return trigger_words({"every": eff["every"], "on": eff["events"]}) if (eff["every"] or eff["events"]) else "Only Run now"


def sync(d, cfg=None):
    """Acts on what changed in what applies to each space (its switch, or its schedule and events,
    its own or Everywhere's): turned on (a fresh start: next wake, events from now on), off
    (nothing waits), a new schedule or events."""
    cfg = read_settings() if cfg is None else cfg
    for space, a in d["spaces"].items():
        eff = resolve(d, a, space, cfg)
        sig = {"on": eff["on"], "every": (eff["every"] or {}).get("text"), "events": eff["events"]}
        was = a.get("applied")
        a["applied"] = sig
        if was is None:
            if sig["on"] and not a.get("next_run"):
                a["next_run"] = next_run(eff["every"], now())
            continue
        if sig["on"] and not was.get("on"):
            a.pop("completed", None)
            a.pop("seen", None)
            a["next_run"] = next_run(eff["every"], now())
        elif not sig["on"] and was.get("on"):
            a.pop("pending", None)
            a.pop("inflight", None)
            a["next_run"] = None
        elif sig["on"] and sig["every"] != was.get("every"):
            a["next_run"] = next_run(eff["every"], now())
        if sig["events"] != was.get("events"):
            a.pop("seen", None)


def view(d, space, a, cfg=None):
    """A space's Autopilot as the screens read it: its switch, the schedule, events and heartbeat
    that apply there (own: the ones it sets itself; heartbeat_from: "space", "everywhere" or
    "file"), and the rest of its record. heartbeat: Everywhere's file from before."""
    a = a or {}
    cfg = read_settings() if cfg is None else cfg
    eff = resolve(d, a, space, cfg)
    words, where = heartbeat_of(space, cfg)
    v = {k: a.get(k) for k in ("name", "folder", "next_run", "pending", "inflight", "last_wake", "wakes", "progress", "completed")}
    v.update(space=space, on=eff["on"], every=(eff["every"] or {}).get("text"), events=eff["events"], own=eff["own"],
             heartbeat=heartbeat_path(), heartbeat_text=words, heartbeat_from=where, blank=blank(words), trigger=trigger_of(eff),
             direction=direction_of(space, cfg))
    return v


def everywhere_view(d, cfg=None):
    cfg = read_settings() if cfg is None else cfg
    e = resolve(d, None, None, cfg)
    words, where = heartbeat_of(None, cfg)
    return {"everywhere": True, "space": None, "every": (e["every"] or {}).get("text"), "events": e["events"],
            "heartbeat": heartbeat_path(), "heartbeat_text": words, "heartbeat_from": where, "blank": blank(words),
            "trigger": trigger_of(e)}


def shown_name(v):
    """A space as the screens call it (core/spaces.js spaceName): never "~"; another machine's
    with that machine after it."""
    name = v.get("name")
    if not name or name == "~":
        folder = (v.get("folder") or "").rstrip("/")
        # a home folder anywhere (core/spaces.js isHomeFolder: /home/<you>, /Users/<you>, /root)
        name = "Home" if not folder or folder == HOME.rstrip("/") or re.fullmatch(r"/(home|Users)/[^/]+|/root", folder) else os.path.basename(folder)
    return f"{name} on {v['machine']}" if v.get("machine") else name


def line_of(v):
    if v.get("everywhere"):
        return f"Everywhere: {v['trigger']}" + (", no heartbeat yet" if v.get("blank") else "")
    if v.get("unreachable"):
        return f"{shown_name(v)}: can't tell, {v['machine']} didn't answer"
    state_word = "on" if v["on"] else "off"
    nxt = f", next {when(v['next_run'])}" if v["on"] and v.get("next_run") else ""
    last = v.get("last_wake")
    last = f"; last {when(last['at'])} ({last['reason']}): {last['outcome']}" if last else ""
    own = f"; its own {', '.join(OWN_WORDS[k] for k in v.get('own') or [])}" if v.get("own") else ""
    return f"{shown_name(v)}: Autopilot {state_word} ({v['trigger']}{nxt}){own}{last}"


OWN_WORDS = {"every": "schedule", "events": "events", "heartbeat": "heartbeat", "direction": "direction"}


def log_wake(a, reason, outcome, at=None):
    w = {"at": at or now(), "reason": reason, "outcome": outcome}
    a["last_wake"] = w
    a["wakes"] = (a.get("wakes") or [])[-9:] + [w]


def queue(a, reason):
    """One wake at a time: a second reason joins the one waiting."""
    p = a.get("pending")
    if p:
        if reason not in p["reasons"]:
            p["reasons"] = (p["reasons"] + [reason])[:6]
    else:
        a["pending"] = {"reasons": [reason], "at": now()}


def waiting(space, a):
    """Ready tasks of this space that others wait behind (queued --after them, down the chain), in
    words: ["TG-2 is Ready, waiting on the person's Accept; TG-3 and TG-4 wait behind it"]. A fact
    for the wake, so a blocked chain is said, never parked on in silence."""
    out = []
    for p in store_files():
        d = read_list(p) or {}
        tasks = d.get("tasks") or []
        mine = lambda t: bare(t.get("space") or "") == space or (not t.get("space") and d.get("folder") == a.get("folder"))
        if not any(mine(t) for t in tasks):
            continue
        ref = lambda t: f"{d.get('prefix') or ''}-{t['id']}"
        for t in tasks:
            if t.get("state") != "ready" or not mine(t):
                continue
            behind, look = [], [t["id"]]
            while look:
                i = look.pop(0)
                for x in tasks:
                    if i in (x.get("after") or []) and x.get("state") in ("queued", "todo") and x not in behind:
                        behind.append(x)
                        look.append(x["id"])
            if behind:
                names = [ref(x) for x in behind]
                names = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
                out.append(f"{ref(t)} is Ready, waiting on the person's Accept; {names} wait{'s' if len(behind) == 1 else ''} behind it")
    return out


def message(space, a, reasons):
    """The wake: one tagged message. The chat shows it as one quiet line ("Autopilot woke · on schedule",
    core/chat-log.js pilotLine), never its words, then the Assistant's answer or "nothing new"."""
    beat, where = heartbeat_of(space)
    beat = "" if blank(beat) else beat.strip()
    path = heartbeat_path()
    src = {"space": "this space's own, Shepherdr settings > Autopilot",
           "everywhere": "Everywhere's, Shepherdr settings > Autopilot"}.get(where, path.replace(HOME, "~", 1))
    if len(beat) > HEARTBEAT_MAX:
        beat = beat[:HEARTBEAT_MAX] + (f"\n… (cut here: read the rest in {path})" if where == "file" else "\n… (cut here)")
    p = a.get("progress")
    prog = f"Saved progress ({when(p['at'])}):\n{p['text']}" if p else "Saved progress: none yet (this is the first wake)."
    why = reasons[0] + (f" (also: {', '.join(reasons[1:])})" if len(reasons) > 1 else "")
    waits = "\n".join(f"- {x}" for x in waiting(space, a))
    aim = direction_of(space)
    aim = (f"Direction (set by the person, Shepherdr settings > Autopilot): {aim}" if aim else
           "Direction: none set. Work out what matters most from the project itself: its README, docs and goals, "
           "recent commits and merged tasks, open issues and PRs, and what the person asked for lately.")
    body = (f"Autopilot wake: {why}, {when(now())}.\n"
            "You are on Autopilot in this space: you drive it forward and decide on your own; the person steers "
            "later. Never ask the person a question on a wake: make every call yourself (product and taste choices "
            "too: pick the best option and say in one line what you chose and why), answer workers' questions "
            "yourself and unblock them. The one exception is a take-over: something irreversible or outside this "
            "space that can't wait (spending money, deploying or publishing, deleting data, credentials, a security "
            "problem) or being stuck after retrying twice: don't do it, send one herdr-task alert \"<what>\" "
            "--body \"<why>\", say it in one line and carry on with other work. Read the heartbeat, the "
            "direction and your saved progress below, look at the tasks (herdr-task list --json), and do the most "
            "useful work the heartbeat permits: unblock and check what's open, start what's ready to start, and, "
            "unless the heartbeat says otherwise, look at the project and add and start the next most valuable "
            "tasks to push it toward the direction. Evaluate what the evidence shows, then save progress and your "
            "next step with herdr-task progress \"...\". When the heartbeat's stopping goal is met and proven: "
            "herdr-task complete \"evidence\" (this turns Autopilot off). A Ready task that others wait behind "
            "never parks you: go on with work that doesn't need it (tasks outside its chain, within the heartbeat's "
            "limits), and each wake it still holds them back, say in one line what waits on the person's Accept. "
            "Saved progress records facts and your next step, never a limit or pace of your own: only the heartbeat "
            "and the person set limits, and one in your saved progress that neither set doesn't apply (leave it out "
            "when you save). Only when there's truly nothing worth doing (nothing to unblock, check or start, and no "
            "next task worth adding): save progress saying so, and end with <hc no-reply why=\"...\"/>, its why one "
            "short line of what you checked and what it waits on (the chat shows it on the wake's line), never a "
            "bare <hc no-reply/>.\n\n"
            f"Heartbeat ({src}):\n{beat or '(not written yet: tell the person Autopilot has no heartbeat yet, and do nothing else)'}\n\n"
            f"{aim}\n\n"
            + (f"Waiting on the person:\n{waits}\n\n" if waits else "")
            + f"{prog}")
    body = body.replace("</herdr-autopilot", "</ herdr-autopilot")
    reason = reasons[0].replace('"', "'")
    return f'<herdr-autopilot reason="{reason}" space="{space}">\n{body}\n</herdr-autopilot>'


def deliver(space, a):
    """Sends the waiting wake when the space's Assistant is live and idle. Returns what happened, or
    None when it still waits."""
    p = a.get("pending")
    if not p or a.get("inflight"):
        return None
    to = coordinator_in(space)
    k = hc_json("get", to) if to else None
    if not k or k.get("state") != "live" or not agent_running(k):
        if now() - p["at"] > PENDING_MAX_MS:
            a.pop("pending")
            log_wake(a, p["reasons"][0], "Missed: no Assistant was running")
            return "missed"
        p["note"] = "Waiting for its Assistant to run"
        return None
    if status_word(k) in ("working", "blocked"):
        p["note"] = "Waiting for its Assistant to be idle" if status_word(k) == "working" else "Waiting: its Assistant asks you something"
        return None
    if typing(to, k):
        p["note"] = "Waiting: you're writing to its Assistant"
        return None
    if not news_send(to, message(space, a, p["reasons"]), check=False):
        p["note"] = "Waiting: its Assistant couldn't take it yet"
        return None
    a.pop("pending")
    a["inflight"] = {"at": now(), "reason": p["reasons"][0], "to": to, "turn": k.get("turn") or 0}
    log_wake(a, p["reasons"][0], "Delivered")
    return "delivered"


def settle(a):
    """A delivered wake's turn ended: its outcome."""
    f = a.get("inflight")
    if not f:
        return
    k = hc_json("get", f["to"]) or {}
    gone = k.get("state") != "live" or not agent_running(k)
    # Its turn counted, or (should the count miss it) the Assistant idle a while after the wake:
    # closed either way, so the header leaves "Waking" and the next wake can go.
    # A turn of a second (a quiet wake) can slip past the count: its status settling after the wake
    # (status_ms) says it ended too (SHEP-40: "Waking" held two minutes after a one-second turn).
    st = status_word(k)
    settled_since = st in ("idle", "done") and (k.get("status_ms") or 0) > f["at"]
    ended = st != "working" and ((k.get("turn") or 0) > f["turn"] or settled_since or (st in ("idle", "done") and now() - f["at"] > IDLE_AFTER_MS))
    if not (gone or ended or now() - f["at"] > TURN_MAX_MS):
        return
    a.pop("inflight")
    saved = (a.get("progress") or {}).get("at", 0) >= f["at"]
    outcome = ("Assistant stopped" if gone else "Turn ended" if ended else "No turn end seen") + \
              (", progress saved" if saved else ", no progress saved")
    w = a.get("last_wake")
    if w and w.get("at") and w["at"] >= f["at"] - 1000 and w["outcome"] == "Delivered":
        w["outcome"] = outcome
        if a.get("wakes"):
            a["wakes"][-1] = w
    else:
        log_wake(a, f["reason"], outcome, f["at"])


def events_for(space, a, events):
    """Task events since the last look that concern this space (its tasks, or its folder's tasks
    not started anywhere yet) among `events` (what applies there): ["event:ready HAT-4", ...].
    Records only, the first look."""
    seen_all = a.setdefault("seen", {})
    out = []
    for p in store_files():
        d = read_list(p)
        if not d or not os.path.isdir(d.get("folder") or ""):
            continue
        mine = lambda t: bare(t.get("space") or "") == space or (not t.get("space") and d["folder"] == a.get("folder"))
        # Its own folder always (so its first task added is news), others once they hold its tasks.
        if d["folder"] != a.get("folder") and not any(mine(t) for t in d.get("tasks") or []):
            continue
        with Store(locate(d["folder"]), write=False) as s:
            for ev, t in events_in(s, seen_all.setdefault(s.slug, {})):
                # Added while a wake is at work: its own doing, not news.
                if ev in events and mine(t) and not (ev == "added" and a.get("inflight")):
                    out.append(f"event:{ev} {s.ref(t)}")
    return out


def autopilot_pass(report):
    """The scheduler's round: due schedules and heard events queue a wake; a waiting wake goes to
    its idle Assistant; a delivered one is settled when its turn ends. Nothing while the
    autopilot add-on is off."""
    if addon_off("autopilot"):
        return
    cfg = read_settings()
    with state() as d:
        if any_on(d):
            ensure_heartbeat(make=False)  # an earlier version's starter: today's (the old one kept as .bak)
        sync(d, cfg)
        for space, a in d["spaces"].items():
            eff = resolve(d, a, space, cfg)
            if not eff["on"]:
                continue
            settle(a)
            if eff["every"] and a.get("next_run") and now() >= a["next_run"]:
                a["next_run"] = next_run(eff["every"], now())
                queue(a, "schedule")
            if eff["events"]:
                for why in events_for(space, a, eff["events"]):
                    queue(a, why)
            if deliver(space, a) == "delivered":
                report.setdefault("autopilot", []).append({"space": space, "to": a["inflight"]["to"], "why": a["inflight"]["reason"]})


def any_on(d=None):
    """Whether Autopilot is on in any space here."""
    d = d if d is not None else (read_list(STATE) or {})
    return any(a.get("on") for a in (d.get("spaces") or {}).values())


# ---- commands -------------------------------------------------------------------------------

PER_SPACE = "Autopilot is switched on per space, with the switch in its Assistant's header: pass --space."


def set_values(args):
    """set's --every, --on and --heartbeat as Settings keeps them; "default" unsets one at that
    level, so it follows the level above again."""
    out = {}
    dflt = lambda x: x.strip().lower() == "default"
    if args.every is not None:
        x = args.every.strip()
        out["every"] = None if dflt(x) else "" if not x or x.lower() in ("off", "none", "never") else parse_every(x)["text"]
    if args.on is not None:
        out["events"] = None if dflt(args.on) else parse_on(args.on)
    if getattr(args, "heartbeat", None) is not None:
        out["heartbeat"] = None if dflt(args.heartbeat) else args.heartbeat[:HEARTBEAT_MAX]
    if getattr(args, "direction", None) is not None:
        out["direction"] = None if dflt(args.direction) or not one_line(args.direction) else one_line(args.direction)
    if not out:
        raise Fail("Give --every, --on, --heartbeat or --direction (\"default\": follow Everywhere's again).")
    return out


def cmd_autopilot(args):
    sub = args.autopilot
    ensure_heartbeat(make=False)  # an earlier version's starter in the file: today's, before anyone reads it
    if sub == "list":
        out = list_all(getattr(args, "here", False))
        if args.json:
            print(json.dumps(out))
        else:
            print("\n".join([line_of(out["everywhere"])] + [line_of(v) for v in out["spaces"]]))
        return
    if sub == "check":
        # a schedule as Settings would keep it, checked without saving
        x = (args.every or "").strip()
        r = rule_of(x) if x.lower() not in ("off", "none", "never", "") else None
        if r is False:
            parse_every(x)  # says why
        v = {"every": (r or {}).get("text"), "trigger": trigger_of({"every": r, "events": []}) if r else "Off"}
        say(args, v, v["trigger"])
        return
    # Everywhere's (what every space works from unless it sets its own), a space's own, or its switch.
    machine, there_id = machine_of(getattr(args, "space", None) if not getattr(args, "everywhere", False) else None)
    if sub == "set":
        vals = set_values(args)
        # Settings name another machine's space as this computer does ("vm/sp1"); it gets its copy from here.
        write_autopilot(args.space if machine else my_space(args), vals)
        if machine:
            v = {"space": args.space, "machine": machine, "own": [k for k, x in vals.items() if x is not None]}
            say(args, v, f"Saved for this space; {machine} follows it once Settings reaches it.")
            return
    if machine:
        v = forward(args, machine, there_id)
        say(args, v, line_of(v))
        return
    space = None if sub == "heartbeat" and not getattr(args, "space", None) else my_space(args)
    if space is None and sub in ("on", "off", "run-now"):
        raise Fail(PER_SPACE if sub != "run-now" else "Run now wakes one space's Assistant: pass --space.")
    msg = ""
    with state(write=sub not in ("show", "heartbeat")) as d:
        a = None
        if space is not None:
            a = d["spaces"].get(space)
            if a is None:
                a = {} if sub in ("show", "heartbeat") else d["spaces"].setdefault(space, {})
            if sub not in ("show", "heartbeat") and not a.get("folder"):
                # Told by the machine whose window lists it (forward()), else this one's window.
                told = (getattr(args, "name", None), getattr(args, "space_folder", None))
                a["name"], a["folder"] = (told[0], folder_of(told[1])) if told[1] else space_info(space)
        if sub == "on":
            was = bool(a.get("on"))
            a["on"] = True
            ensure_heartbeat()
            sync(d)
            msg = f"Autopilot is on: {trigger_of(resolve(d, a, space))}."
            if not was:
                # Switched on: its first wake goes now (queued until its Assistant is idle), not one
                # interval later, so the person sees it work at once.
                queue(a, "switched on")
                got = deliver(space, a)
                msg += " Woke its Assistant." if got == "delivered" else f" First wake queued: {(a.get('pending') or {}).get('note') or 'it goes when its Assistant is idle'}."
        elif sub == "off":
            a["on"] = False
            sync(d)
            msg = "Autopilot is off."
        elif sub == "set":
            sync(d)
            eff = resolve(d, a, space)
            how = trigger_of(eff) if (eff["every"] or eff["events"]) else "only on Run now"
            msg = f"Autopilot wakes every space that follows Everywhere: {how}." if space is None else \
                f"Autopilot wakes this space: {how}" + (f" (its own {', '.join(OWN_WORDS[k] for k in eff['own'])})." if eff["own"] else " (Everywhere's).")
        elif sub == "run-now":
            if not a.get("on"):
                raise Fail("Autopilot is off in this space: turn it on first.")
            sync(d)
            settle(a)  # a wake whose turn has ended never holds this one back
            queue(a, "run now")
            got = deliver(space, a)
            msg = "Woke its Assistant." if got == "delivered" else f"Queued: {(a.get('pending') or {}).get('note') or 'it goes when its Assistant is idle'}."
        elif sub == "heartbeat":
            ensure_heartbeat()
        v = everywhere_view(d) if space is None else view(d, space, a)
    if sub in ("on", "run-now"):
        # This machine's scheduler wakes it (a machine with no window or service starts none by itself).
        ensure_scheduler(quiet=True)
    say(args, v, msg or line_of(v))


def cmd_progress(args):
    """The Assistant saves where Autopilot is and its next step; the next wake brings it back."""
    space = my_space(args)
    text = " ".join(args.text.split()) if "\n" not in args.text else args.text.strip()
    if not text:
        raise Fail("Say what was done and what's next.")
    if space is None:
        raise Fail("Progress is a space's: run this as its Assistant, or pass --space.")
    with state() as d:
        a = d["spaces"].get(space)
        if a is None:
            raise Fail("This space has no Autopilot.")
        a["progress"] = {"text": text[:4000], "at": now()}
        v = view(d, space, a)
    say(args, v, "Progress saved." + ("" if v["on"] else " (Autopilot is off here.)"))


def cmd_complete(args):
    """A finite goal met and proven: Autopilot turns off, with the evidence kept."""
    space = my_space(args)
    if not args.evidence.strip():
        raise Fail("Give the evidence that the goal is met.")
    if space is None:
        raise Fail("A goal is a space's: run this as its Assistant, or pass --space.")
    with state() as d:
        a = d["spaces"].get(space)
        if a is None or not a.get("on"):
            raise Fail("Autopilot isn't on in this space.")
        a.update(on=False, next_run=None, completed={"text": args.evidence.strip()[:4000], "at": now()})
        a.pop("pending", None)
        a["progress"] = {"text": f"Goal complete: {args.evidence.strip()[:3900]}", "at": now()}
        f = a.pop("inflight", None)
        w = a.get("last_wake")
        if f and w and w.get("at") == f["at"] and w["outcome"] == "Delivered":
            w["outcome"] = "Goal complete: Autopilot turned off"  # the wake it came from
            a["wakes"][-1] = w
        else:
            log_wake(a, (f or {}).get("reason") or "complete", "Goal complete: Autopilot turned off")
        sync(d)
        v = view(d, space, a)
    say(args, v, "Goal complete: Autopilot is now off in this space. Tell the person, with the evidence.")
