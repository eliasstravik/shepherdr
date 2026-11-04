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
# Everywhere's, and per space, in STORE/.autopilot.json (Settings, the header's switch and the web
# read it; only herdr-task writes it, under its lock):
#   {"version": 2,
#    "everywhere": {"on", "every" (an --every rule, or null), "events" ([--on events])},
#    "spaces": {"<space id>": {
#      "on", "every", "events": only when the space sets its own (a key missing: Everywhere's),
#      "name", "folder", "next_run", "applied" (what last applied: sync() acts on a change),
#      "pending" ({reasons, at}: a wake waiting for its Assistant to be idle),
#      "inflight" ({at, reason, to, turn}: a wake delivered, its turn not ended yet),
#      "last_wake" ({at, reason, outcome}), "wakes" (the last 10 of those),
#      "progress" ({text, at}), "completed" ({text, at}), "seen" (events_in's record per folder)}}}
# A space follows Everywhere for whatever it doesn't set itself (resolve(); the same rule as
# core/autopilot.js pilotFor, tested on core/autopilot.cases.json). Version 1 had only spaces, each
# with all three: one that was on keeps them as its own; one that was off keeps only what differs
# from the defaults, so it follows Everywhere.
# The heartbeat is plain text the person writes: HEARTBEATS/everywhere.md, and a space's own
# HEARTBEATS/<space id>.md once it has words (not blank, not the starter).

STATE = os.path.join(STORE, ".autopilot.json")
HEARTBEATS = os.environ.get("HERDR_AUTOPILOT_HOME") or os.path.join(HOME, ".config", "herdr-core", "autopilot")
DEFAULT_EVERY = "every 60 minutes"
OWN_FIELDS = ("on", "every", "events")
LIST_EVERY_MS = 60000            # the spaces on this computer, looked at again while Everywhere is on
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
    """A space's own heartbeat file; Everywhere's for None."""
    return os.path.join(HEARTBEATS, f"{bare(space)}.md" if space else "everywhere.md")


def heartbeat_words(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""


def own_heartbeat(space):
    """Whether a space has its own heartbeat: its file has words (not blank, not the starter)."""
    beat = heartbeat_words(heartbeat_path(space)).strip()
    return bool(beat) and beat != STARTER.strip()


def heartbeat_for(space):
    """The heartbeat a space's wakes bring: its own, else Everywhere's."""
    return heartbeat_path(space) if space and own_heartbeat(space) else heartbeat_path(None)


def ensure_heartbeat(space, words=STARTER):
    p = heartbeat_path(space)
    if not os.path.exists(p) or (space and not own_heartbeat(space) and words != STARTER):
        os.makedirs(HEARTBEATS, exist_ok=True)
        with open(p, "w") as f:
            f.write(words)
    return p


def everywhere_default():
    return {"on": False, "every": parse_every(DEFAULT_EVERY), "events": []}


def migrate(d):
    """Version 1 (spaces only, each with all three) to 2: what was on stays as it was."""
    if d.get("version", 1) >= 2:
        return
    default = everywhere_default()
    for a in d.get("spaces", {}).values():
        if a.get("on"):
            continue
        a.pop("on", None)
        if (a.get("every") or {}).get("text") in (None, DEFAULT_EVERY):
            a.pop("every", None)
        if not a.get("events"):
            a.pop("events", None)
    d.setdefault("everywhere", default)
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


def local_spaces():
    """This computer's spaces in the window's list: [{id, name, folder}] ([] when it can't say)."""
    try:
        r = run(["herdr-app", "ls"])
        return [x for x in json.loads(r.stdout).get("spaces") or []
                if x.get("id") and "/" not in x["id"] and not x.get("machine")]
    except (Fail, ValueError, OSError, AttributeError):
        return []


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


_listed = [0]


def list_spaces(d, force=False):
    """While Everywhere is on, each space on this computer gets a record (the scheduler wakes only
    those), looked at again about once a minute."""
    if not force and (not d["everywhere"].get("on") or now() - _listed[0] < LIST_EVERY_MS):
        return
    _listed[0] = now()
    for sp in local_spaces():
        if sp["id"] not in d["spaces"]:
            d["spaces"][sp["id"]] = {"name": sp.get("name"), "folder": folder_of(sp.get("folder"))}


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


def resolve(d, a):
    """What applies in a space (its record `a`): {on, every, events}, each its own where it sets one,
    else Everywhere's; and own: {field: whether it sets it}."""
    e = {**everywhere_default(), **(d.get("everywhere") or {})}
    a = a or {}
    own = {f: f in a for f in OWN_FIELDS}
    eff = {f: a[f] if own[f] else e[f] for f in OWN_FIELDS}
    eff["on"] = bool(eff["on"])
    eff["events"] = [x for x in EVENTS if x in (eff["events"] or [])]
    return eff, own


def trigger_of(eff):
    return trigger_words({"every": eff["every"], "on": eff["events"]}) if (eff["every"] or eff["events"]) else "Only Run now"


def sync(d):
    """Acts on what changed in what applies to each space (its own, or Everywhere's): turned on
    (a fresh start: next wake, events from now on), off (nothing waits), a new schedule or events."""
    for a in d["spaces"].values():
        eff, _own = resolve(d, a)
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


def view(d, space, a):
    """A space's Autopilot as the screens read it: what applies, own (which it sets itself) and the
    rest of its record."""
    a = a or {}
    eff, own = resolve(d, a)
    own["heartbeat"] = own_heartbeat(space)
    v = {k: a.get(k) for k in ("name", "folder", "next_run", "pending", "inflight", "last_wake", "wakes", "progress", "completed")}
    v.update(space=space, on=eff["on"], every=(eff["every"] or {}).get("text"), events=eff["events"], own=own,
             heartbeat=heartbeat_for(space), trigger=trigger_of(eff))
    return v


def everywhere_view(d):
    e, _ = resolve(d, None)
    return {"everywhere": True, "space": None, "on": e["on"], "every": (e["every"] or {}).get("text"), "events": e["events"],
            "heartbeat": heartbeat_path(None), "trigger": trigger_of(e)}


def shown_name(v):
    """A space as the screens call it (core/spaces.js spaceName): never "~"."""
    name = v.get("name")
    if name and name != "~":
        return name
    folder = (v.get("folder") or "").rstrip("/")
    return "Home" if not folder or folder == HOME.rstrip("/") else os.path.basename(folder)


FIELD_WORDS = {"on": "on or off", "every": "schedule", "events": "events", "heartbeat": "heartbeat"}


def line_of(v):
    state_word = "on" if v["on"] else "off"
    nxt = f", next {when(v['next_run'])}" if v["on"] and v.get("next_run") else ""
    if v.get("everywhere"):
        return f"Everywhere: Autopilot {state_word} ({v['trigger']})"
    last = v.get("last_wake")
    last = f"; last {when(last['at'])} ({last['reason']}): {last['outcome']}" if last else ""
    mine = [FIELD_WORDS[f] for f in ("on", "every", "events", "heartbeat") if (v.get("own") or {}).get(f)]
    src = f" [its own: {', '.join(mine)}; the rest from Everywhere]" if mine and len(mine) < 4 else " [all its own]" if mine else " [all from Everywhere]"
    return f"{shown_name(v)}: Autopilot {state_word} ({v['trigger']}{nxt}){last}{src}"


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
    path = heartbeat_for(space)
    beat = heartbeat_words(path).strip()
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
    with state() as d:
        list_spaces(d)
        sync(d)
        for space, a in d["spaces"].items():
            eff, _own = resolve(d, a)
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
    """Whether Autopilot is on anywhere here (Everywhere's, or a space's own)."""
    d = d if d is not None else (read_list(STATE) or {})
    e = d.get("everywhere") or {}
    return bool(e.get("on")) or any(a.get("on") for a in (d.get("spaces") or {}).values())


# ---- commands -------------------------------------------------------------------------------

def set_own(d, a, field, value, same=lambda x, y: x == y):
    """A space's own value; the same as Everywhere's, it follows Everywhere again (as Settings'
    rows do: setting what it would inherit anyway unsets it)."""
    if same(value, resolve(d, None)[0][field]):
        a.pop(field, None)
    else:
        a[field] = value


def every_text(rule):
    return (rule or {}).get("text")


def reset(space, a, fields):
    """Back to Everywhere's: the space's own values go; its own heartbeat is kept as <id>.md.old."""
    for f in fields:
        if f == "heartbeat":
            p = heartbeat_path(space)
            if os.path.exists(p):
                os.replace(p, p + ".old")
        else:
            a.pop(f, None)


def cmd_autopilot(args):
    sub = args.autopilot
    if sub == "list":
        with state(write=False) as d:
            out = {"everywhere": everywhere_view(d), "spaces": [view(d, sp, a) for sp, a in d["spaces"].items()]}
        if args.json:
            print(json.dumps(out))
        else:
            print("\n".join([line_of(out["everywhere"])] + [line_of(v) for v in out["spaces"]]))
        return
    space = my_space(args)
    if space is None and sub in ("run-now", "reset"):
        raise Fail("Run now wakes one space's Assistant: pass --space." if sub == "run-now" else "Everywhere has nothing to go back to: pass --space.")
    msg = ""
    with state(write=sub != "show") as d:
        e = d["everywhere"]
        if space is None:
            a = e
        else:
            a = d["spaces"].get(space)
            if a is None:
                a = {} if sub == "show" else d["spaces"].setdefault(space, {})
            if sub != "show" and not a.get("folder"):
                a["name"], a["folder"] = space_info(space)
        def put(field, value, same=lambda x, y: x == y):
            """Where a change goes: Everywhere's, or the space's own (equal to Everywhere's: unset)."""
            if space is None:
                e[field] = value
            else:
                set_own(d, a, field, value, same)

        def same_every(x, y):
            return every_text(x) == every_text(y)

        if sub == "on":
            put("on", True)
            eff = resolve(d, a)[0] if space else resolve(d, None)[0]
            if not eff["every"] and not eff["events"]:
                put("every", parse_every(DEFAULT_EVERY), same_every)
            ensure_heartbeat(None)
            if space is None:
                list_spaces(d, force=True)
            sync(d)
            eff = resolve(d, a)[0] if space else resolve(d, None)[0]
            msg = f"Autopilot is on{' everywhere' if space is None else ''}: {trigger_of(eff)}."
        elif sub == "off":
            put("on", False)
            sync(d)
            msg = "Autopilot is off everywhere, except spaces that set their own." if space is None else "Autopilot is off."
        elif sub == "set":
            if args.every is not None:
                x = args.every.strip()
                put("every", parse_every(x) if x and x.lower() not in ("off", "none", "never") else None, same_every)
            if args.on is not None:
                put("events", parse_on(args.on))
            sync(d)
            eff = resolve(d, a)[0] if space else resolve(d, None)[0]
            msg = f"Autopilot wakes: {trigger_of(eff) if (eff['every'] or eff['events']) else 'only on Run now'}."
        elif sub == "reset":
            fields = [f.strip() for f in (getattr(args, "only", None) or "on,every,events,heartbeat").split(",") if f.strip()]
            bad = [f for f in fields if f not in OWN_FIELDS + ("heartbeat",)]
            if bad:
                raise Fail(f"Unknown setting {bad[0]!r}; they are on, every, events, heartbeat.")
            reset(space, a, fields)
            sync(d)
            msg = "Back to Everywhere's: " + ", ".join(FIELD_WORDS[f] for f in fields) + "."
        elif sub == "run-now":
            if not resolve(d, a)[0]["on"]:
                raise Fail("Autopilot is off in this space: turn it on first.")
            sync(d)
            queue(a, "run now")
            got = deliver(space, a)
            msg = "Woke its Assistant." if got == "delivered" else f"Queued: {(a.get('pending') or {}).get('note') or 'it goes when its Assistant is idle'}."
        elif sub == "heartbeat":
            if space is not None and getattr(args, "own", False):
                # Its own, starting from Everywhere's words.
                beat = heartbeat_words(heartbeat_path(None))
                msg = ensure_heartbeat(space, beat if beat.strip() else STARTER)
            else:
                msg = ensure_heartbeat(None) if space is None or not own_heartbeat(space) else heartbeat_path(space)
        v = everywhere_view(d) if space is None else view(d, space, a)
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
        if a is None and d["everywhere"].get("on"):
            a = d["spaces"][space] = {}
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
        if a is None or not resolve(d, a)[0]["on"]:
            raise Fail("Autopilot isn't on in this space.")
        # Off here, as its own (Everywhere's may stay on), with Reset in Settings to follow it again.
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
