"""Autopilot: a space's Assistant woken like an automation (on a schedule or on task events), each
wake bringing it the space's heartbeat and its own saved progress. No sandbox: it is the same
regular Assistant, with its usual permissions."""

import contextlib
import datetime
import fcntl
import json
import os
import time

from .base import addon_off, Fail, hc_json, HOME, now, run, STORE
from .settings import bare
from .agents import agent_running, status_word
from .launch import caller_labels, coordinator_in
from .store import locate, read_list, Store, store_files
from .output import say
from .news import news_send, typing
from .automations import EVENTS, events_in, HOW, next_run, parse_every, parse_on, trigger_words


# ---- autopilot ------------------------------------------------------------------------------
# Per space, in STORE/.autopilot.json (the sidebar's menu and Settings read it; only herdr-task
# writes it, under its lock):
#   {"version": 1, "spaces": {"<space id>": {
#      "on", "name", "folder", "every" (an --every rule), "events" ([--on events]), "next_run",
#      "pending" ({reasons, at}: a wake waiting for its Assistant to be idle),
#      "inflight" ({at, reason, to, turn}: a wake delivered, its turn not ended yet),
#      "last_wake" ({at, reason, outcome}), "wakes" (the last 10 of those),
#      "progress" ({text, at}), "completed" ({text, at}), "seen" (events_in's record per folder)}}}
# The heartbeat is plain text the person writes: HEARTBEATS/<space id>.md.

STATE = os.path.join(STORE, ".autopilot.json")
HEARTBEATS = os.environ.get("HERDR_AUTOPILOT_HOME") or os.path.join(HOME, ".config", "herdr-core", "autopilot")
DEFAULT_EVERY = "every 60 minutes"
PENDING_MAX_MS = 6 * 3600000     # a wake that found no Assistant this long: missed
TURN_MAX_MS = 3 * 3600000        # a wake's turn not seen ending this long: closed anyway
HEARTBEAT_MAX = 8000             # characters of the heartbeat in a wake (the rest: read the file)
STARTER = """Direction: what Autopilot works toward in this space.

Priorities:
-

Constraints: what it must not do (e.g. never merge; ask before anything risky).

Reporting: what to tell me after a wake, and when to alert me.

Stopping goal (optional): a finite goal; when it's proven, Autopilot turns itself off.
"""


def heartbeat_path(space):
    return os.path.join(HEARTBEATS, f"{bare(space)}.md")


def ensure_heartbeat(space):
    p = heartbeat_path(space)
    if not os.path.exists(p):
        os.makedirs(HEARTBEATS, exist_ok=True)
        with open(p, "w") as f:
            f.write(STARTER)
    return p


@contextlib.contextmanager
def state(write=True):
    """The autopilot state, locked; written back (atomically) when write."""
    os.makedirs(STORE, exist_ok=True)
    lock = open(os.path.join(STORE, ".autopilot.lock"), "a")
    fcntl.flock(lock, fcntl.LOCK_EX if write else fcntl.LOCK_SH)
    try:
        d = read_list(STATE) or {}
        d.setdefault("version", 1)
        d.setdefault("spaces", {})
        yield d
        if write:
            tmp = f"{STATE}.{os.getpid()}.tmp"
            with open(tmp, "w") as f:
                json.dump(d, f, indent=1)
            os.replace(tmp, STATE)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def space_info(space):
    """(name, task folder) of a space on this computer, from the window's list; (None, None) when
    the window doesn't know it."""
    r = run(["herdr-app", "ls"])
    try:
        sp = next((x for x in json.loads(r.stdout).get("spaces") or [] if x.get("id") == space), None)
    except ValueError:
        sp = None
    if not sp:
        return None, None
    folder = sp.get("folder")
    try:
        folder = locate(folder)["folder"] if folder else None
    except Fail:
        pass
    return sp.get("name"), folder


def my_space(args):
    """--space, else the caller's (an Assistant's own: its pane's, or its chat's)."""
    if getattr(args, "space", None):
        return bare(args.space)
    labels = caller_labels()
    sp = labels.get("herdr.space") or labels.get("herdr.coordinator.space")
    if not sp:
        raise Fail("Which space? Run this as the space's Assistant, or pass --space <space id>.")
    return bare(sp)


def when(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%a %H:%M") if ms else None


def view(space, a):
    v = {k: a.get(k) for k in ("on", "name", "folder", "events", "next_run", "pending", "inflight", "last_wake",
                               "wakes", "progress", "completed")}
    v.update(space=space, every=(a.get("every") or {}).get("text"), heartbeat=heartbeat_path(space),
             trigger=trigger_words({"every": a.get("every"), "on": a.get("events")}) if (a.get("every") or a.get("events")) else "Only Run now")
    return v


def line_of(v):
    state_word = "on" if v["on"] else "off"
    nxt = f", next {when(v['next_run'])}" if v["on"] and v.get("next_run") else ""
    last = v.get("last_wake")
    last = f"; last {when(last['at'])} ({last['reason']}): {last['outcome']}" if last else ""
    return f"{v.get('name') or v['space']}: Autopilot {state_word} ({v['trigger']}{nxt}){last}"


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


def message(space, a, reasons):
    """The wake: one tagged message (the chat shows none of it, only the Assistant's answer)."""
    path = heartbeat_path(space)
    try:
        with open(path) as f:
            beat = f.read().strip()
    except OSError:
        beat = ""
    if beat == STARTER.strip():
        beat = ""  # the starter, never filled in
    if len(beat) > HEARTBEAT_MAX:
        beat = beat[:HEARTBEAT_MAX] + f"\n… (cut here: read the rest in {path})"
    p = a.get("progress")
    prog = f"Saved progress ({when(p['at'])}):\n{p['text']}" if p else "Saved progress: none yet (this is the first wake)."
    why = reasons[0] + (f" (also: {', '.join(reasons[1:])})" if len(reasons) > 1 else "")
    body = (f"Autopilot wake: {why}, {when(now())}.\n"
            "You are on Autopilot in this space. Read the heartbeat and your saved progress below, look at the tasks "
            "(herdr-task list --json), choose the most useful work the heartbeat permits, act (start tasks, follow up "
            "on them), evaluate what the evidence shows, then save progress and your next step with "
            "herdr-task progress \"...\". When the heartbeat's stopping goal is met and proven: "
            "herdr-task complete \"evidence\" (this turns Autopilot off). Nothing useful to do: save progress saying so, "
            "and stop.\n\n"
            f"Heartbeat ({path.replace(HOME, '~', 1)}):\n{beat or '(not written yet: tell the person Autopilot has no heartbeat yet, and do nothing else)'}\n\n"
            f"{prog}")
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
    gone = k.get("state") != "live"
    ended = (k.get("turn") or 0) > f["turn"] and status_word(k) != "working"
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


def events_for(space, a):
    """Task events since the last look that concern this space (its tasks, or its folder's tasks
    not started anywhere yet): ["event:ready HAT-4", ...]. Records only, the first look."""
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
                if ev in a.get("events") and mine(t) and not (ev == "added" and a.get("inflight")):
                    out.append(f"event:{ev} {s.ref(t)}")
    return out


def autopilot_pass(report):
    """The scheduler's round: due schedules and heard events queue a wake; a waiting wake goes to
    its idle Assistant; a delivered one is settled when its turn ends. Nothing while the
    autopilot add-on is off."""
    if addon_off("autopilot"):
        return
    with state() as d:
        for space, a in d["spaces"].items():
            if not a.get("on"):
                continue
            settle(a)
            if a.get("every") and a.get("next_run") and now() >= a["next_run"]:
                a["next_run"] = next_run(a["every"], now())
                queue(a, "schedule")
            if a.get("events"):
                for why in events_for(space, a):
                    queue(a, why)
            if deliver(space, a) == "delivered":
                report.setdefault("autopilot", []).append({"space": space, "to": a["inflight"]["to"], "why": a["inflight"]["reason"]})


def any_on():
    return any(a.get("on") for a in ((read_list(STATE) or {}).get("spaces") or {}).values())


# ---- commands -------------------------------------------------------------------------------

def cmd_autopilot(args):
    sub = args.autopilot
    if sub == "list":
        with state(write=False) as d:
            out = [view(sp, a) for sp, a in d["spaces"].items()]
        if args.json:
            print(json.dumps(out))
        else:
            print("\n".join(line_of(v) for v in out) if out else "No space has Autopilot set up.")
        return
    space = my_space(args)
    msg = ""
    with state(write=sub != "show") as d:
        a = d["spaces"].setdefault(space, {"on": False, "events": [], "every": None})
        if sub != "show" and not a.get("folder"):
            a["name"], a["folder"] = space_info(space)
        if sub == "on":
            if not a.get("every") and not a.get("events"):
                a["every"] = parse_every(DEFAULT_EVERY)
            a["on"] = True
            a.pop("completed", None)
            a["next_run"] = next_run(a.get("every"), now())
            a.pop("seen", None)  # events from now on, not old ones
            ensure_heartbeat(space)
            msg = f"Autopilot is on: {trigger_words({'every': a.get('every'), 'on': a.get('events')})}."
        elif sub == "off":
            a["on"] = False
            a.pop("pending", None)
            a.pop("inflight", None)
            a["next_run"] = None
            msg = "Autopilot is off."
        elif sub == "set":
            if args.every is not None:
                e = args.every.strip()
                a["every"] = parse_every(e) if e and e.lower() not in ("off", "none", "never") else None
                a["next_run"] = next_run(a["every"], now()) if a.get("on") else None
            if args.on is not None:
                a["events"] = parse_on(args.on)
                a.pop("seen", None)
            msg = f"Autopilot wakes: {trigger_words({'every': a.get('every'), 'on': a.get('events')}) if (a.get('every') or a.get('events')) else 'only on Run now'}."
        elif sub == "run-now":
            if not a.get("on"):
                raise Fail("Autopilot is off in this space: turn it on first.")
            queue(a, "run now")
            got = deliver(space, a)
            msg = "Woke its Assistant." if got == "delivered" else f"Queued: {(a.get('pending') or {}).get('note') or 'it goes when its Assistant is idle'}."
        elif sub == "heartbeat":
            msg = ensure_heartbeat(space)
        v = view(space, a)
    say(args, v, msg or line_of(v))


def cmd_progress(args):
    """The Assistant saves where Autopilot is and its next step; the next wake brings it back."""
    space = my_space(args)
    text = " ".join(args.text.split()) if "\n" not in args.text else args.text.strip()
    if not text:
        raise Fail("Say what was done and what's next.")
    with state() as d:
        a = d["spaces"].get(space)
        if not a:
            raise Fail("This space has no Autopilot.")
        a["progress"] = {"text": text[:4000], "at": now()}
        v = view(space, a)
    say(args, v, "Progress saved." + ("" if v["on"] else " (Autopilot is off here.)"))


def cmd_complete(args):
    """A finite goal met and proven: Autopilot turns off, with the evidence kept."""
    space = my_space(args)
    if not args.evidence.strip():
        raise Fail("Give the evidence that the goal is met.")
    with state() as d:
        a = d["spaces"].get(space)
        if not a or not a.get("on"):
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
        v = view(space, a)
    say(args, v, "Goal complete: Autopilot is now off in this space. Tell the person, with the evidence.")
