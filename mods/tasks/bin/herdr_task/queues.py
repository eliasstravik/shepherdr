"""Queues: tasks that come after others, and how many may run at once."""

import json
import os
import re
import subprocess
import sys

from .base import ENTRY, Fail, guard, now, STORE
from .agents import agent_running, live_agents
from .store import parse_ref, prefixes_in_use, read_list, store_path


# ---- queues ---------------------------------------------------------------------------------

# Another machine's task, as Shepherdr names it: its machine first ("vm-b:SHE-12", or "vm-b/SHE-12").
REMOTE = re.compile(r"(.+?)[:/]([A-Za-z]+[0-9]*-[0-9]+)")
EXT_EVERY = 60000  # how often a queue asks another machine about a task it waits for (ms)


def parse_after(s, text):
    """--after "HAT-3, HAT-5" (or 3,5): (this folder's task numbers, other tasks). Another task is
    another folder's on this machine by its prefix ("WEB-2"), or another machine's with the
    machine first ("vm-b:HAT-12"): {ref, machine, prefix, id}."""
    ids, ext = [], []
    for part in re.split(r"[,\s]+", text or ""):
        part = part.strip()
        if not part:
            continue
        m = REMOTE.fullmatch(part)
        if m:
            pre, n = parse_ref(m.group(2))
            ext.append({"ref": f"{m.group(1)}:{pre}-{n}", "machine": m.group(1), "prefix": pre, "id": n})
            continue
        pre, n = parse_ref(part)
        if pre and pre != s.prefix:
            ext.append({"ref": f"{pre}-{n}", "machine": None, "prefix": pre, "id": n})
            continue
        ids.append(n)
    return ids, ext


def ext_state(x):
    """Another task's state now ("done", "running", ...): None when it isn't there (removed: it
    holds nothing up); raises Fail when its machine or folder can't be asked."""
    ref = f"{x['prefix']}-{x['id']}"
    if not x.get("machine"):
        folder = prefixes_in_use().get(x["prefix"])
        if not folder:
            return None
        d = read_list(store_path(folder)[1])
        if d is None:
            raise Fail(f"Couldn't read {ref}'s list.")
        return next((t.get("state") for t in d.get("tasks") or [] if t.get("id") == x["id"]), None)
    args = [sys.executable, ENTRY, "--on", x["machine"], "show", ref, "--json"]
    guard(["hc"])
    try:
        r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
    except subprocess.TimeoutExpired:
        raise Fail(f"{x['machine']} didn't answer.")
    try:
        d = json.loads(r.stdout)
    except ValueError:
        d = None
    if isinstance(d, dict) and d.get("state"):
        return d["state"]
    err = (d or {}).get("error") if isinstance(d, dict) else None
    if err and ("No task" in err or "isn't a task" in err):
        return None
    last = ((r.stderr or "").strip().splitlines() or [f"Couldn't ask {x['machine']}."])[-1]
    raise Fail(err or re.sub(r"^[\w.]*Fail: ", "", last))


def refresh_ext(s, task, force=False, budget=None):
    """Asks again about the other tasks it waits for: another folder's at once, another machine's
    at most every EXT_EVERY (budget: how many machine calls are left this pass, a [n] list)."""
    for x in task.get("after_ext") or []:
        if x.get("state") == "done":
            continue
        if x.get("machine") and not force:
            if now() - (x.get("checked") or 0) < EXT_EVERY or (budget is not None and budget[0] <= 0):
                continue
            if budget is not None:
                budget[0] -= 1
        try:
            st = ext_state(x)
            x.pop("error", None)
            x["state"] = st or "gone"
        except Fail as e:
            x["error"] = str(e)
        x["checked"] = now()
        s.dirty = True


def waiting_ext(task):
    """The other tasks it waits for that aren't done (a removed one holds nothing up), as refs."""
    return [x["ref"] for x in task.get("after_ext") or [] if x.get("state") not in ("done", "gone")]


def after_refs(s, task):
    """Everything it comes after, as people write it: HAT-3, WEB-2, vm-b:HAT-12."""
    return [f"{s.prefix}-{i}" for i in task.get("after") or []] + [x["ref"] for x in task.get("after_ext") or []]


def set_after(s, task, ids, ext=()):
    """Sets the tasks this one comes after, refusing unknown tasks and loops. Other folders' and
    machines' tasks must be there now (asked once here)."""
    known = {t["id"]: t for t in s.data["tasks"]}
    for i in ids:
        if i == task["id"]:
            raise Fail(f"{s.prefix}-{i} can't come after itself.")
        if i not in known:
            raise Fail(f"No task {s.prefix}-{i} here.")
    # A loop: following "after" from the new ones leads back to this task.
    seen, todo = set(), list(ids)
    while todo:
        i = todo.pop()
        if i == task["id"]:
            raise Fail(f"That makes a loop: {s.ref(task)} would end up waiting for itself.")
        if i in seen or i not in known:
            continue
        seen.add(i)
        todo.extend(known[i].get("after") or [])
    checked = []
    for x in ext:
        x = dict(x)
        try:
            st = ext_state(x)
        except Fail as e:
            raise Fail(f"Couldn't check {x['ref']}: {e}")
        if st is None:
            raise Fail(f"There is no task {x['ref']}" + (f" on {x['machine']}." if x.get("machine") else " on this machine."))
        x.update(state=st, checked=now())
        checked.append(x)
    task["after"] = ids
    if checked:
        task["after_ext"] = checked
    else:
        task.pop("after_ext", None)
    s.dirty = True


def waiting_for(s, task):
    """The tasks it comes after that aren't done yet (removed ones don't hold it up)."""
    known = {t["id"]: t for t in s.data["tasks"]}
    return [i for i in task.get("after") or [] if i in known and known[i]["state"] != "done"]


def working(s, task):
    """An agent is at work on it (or one started moments ago and hasn't shown up yet)."""
    if task["state"] != "running":
        return False
    last = task["agents"][-1] if task["agents"] else {}
    if now() - (last.get("at") or 0) < 30000:
        return True
    return any(agent_running(k) for k in live_agents(s.key(task)))


def running_count(s, skip=None):
    return sum(1 for t in s.data["tasks"] if t is not skip and working(s, t))


def queue_reason(s, task):
    """Why a start has to wait, in plain words: "after HAT-3, vm-b:WEB-5", "3 tasks are running
    here" or its machine too busy ("vm-a's memory is 92% full", HERD-40); None when it can go."""
    refresh_ext(s, task)
    wait = [f"{s.prefix}-{i}" for i in waiting_for(s, task)] + waiting_ext(task)
    if wait:
        return "after " + ", ".join(wait)
    n = running_count(s, task)
    if n >= s.max_running():
        return f"{n} tasks are running here" if n != 1 else "1 task is running here"
    return machine_hold()


# ---- the machine's room (HERD-40) -------------------------------------------------------------
# New tasks wait while this machine's memory, CPU load or disk is over its start limit (Settings
# > Machines, as Shepherdr's). Herdr's tick on another machine passes that machine's name and
# limits (--machine, --hold: the settings live where the window is); they're kept in .hold.json
# so a start or the scheduler's tick there use them too.

# Beside the task lists, not among them: the Tasks panel reads and watches every file there.
HOLD_FILE = os.path.join(os.path.dirname(STORE.rstrip("/")), "machine-hold.json")
_hold = {}


def set_hold(machine=None, limits=None):
    """This process's machine name and limits, as Herdr's tick sent them (kept for later runs,
    written only when they change)."""
    _hold.clear()
    _hold.update({"machine": machine, "limits": limits})
    try:
        with open(HOLD_FILE) as f:
            if json.load(f) == {"machine": machine, "limits": limits}:
                return
    except (OSError, ValueError):
        pass
    try:
        os.makedirs(os.path.dirname(HOLD_FILE), exist_ok=True)
        tmp = f"{HOLD_FILE}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump({"machine": machine, "limits": limits}, f)
        os.replace(tmp, HOLD_FILE)
    except OSError:
        pass


def machine_hold():
    """Why new tasks wait on this machine now ("vm-a's memory is 92% full"), or None. Sampled once per
    run; anything that fails to read leaves the queue alone."""
    if "reason" in _hold:
        return _hold["reason"]
    try:
        from .machine import hold_reason, sample
        from .settings import machine_limits, machine_name
        if "limits" not in _hold:
            try:
                with open(HOLD_FILE) as f:
                    _hold.update(json.load(f))
            except (OSError, ValueError):
                _hold.update({"machine": None, "limits": None})
        limits = _hold.get("limits") if _hold.get("limits") is not None else machine_limits(_hold.get("machine"))
        why = hold_reason(sample(), limits)
        name = _hold.get("machine") or machine_name()
        reason = (f"{name}'s {why}" if name else f"This computer's {why}") if why else None
    except Exception:
        reason = None
    _hold["reason"] = reason
    return reason
