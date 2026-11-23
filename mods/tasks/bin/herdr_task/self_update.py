"""A schedule's run can update Shepherdr, outside its own terminal (SHEP-376).

The guard (guard.py, SHEP-323) refuses `shepherdr update` in every task's terminal, and it should: an agent there
must never replace the live install by mistake. But the person's "Update Shepherdr everywhere" schedule exists to do
exactly that. So the update is handed to a runner outside the task's terminal instead of opening a hole in the guard:

- The person lets one schedule do it: `herdr-task auto add|edit <id> --may-update-shepherdr on` (the schedule's
  may_update). It is refused inside a task's terminal (the guard's HERDR_GUARD_SESSION is set there), so a task's
  agent can't grant it, to itself or to a schedule.
- That schedule's run asks: `herdr-task update-shepherdr <its task> --folder <folder>`. It is refused unless the task
  is a run of a schedule the person allowed, still open, and the caller is that task's own terminal
  (HERDR_BROWSER_TASK). An ordinary task's agent is refused there as in the guard.
- The runner (`herdr-task _update-shepherdr`, its own process session, the guard taken off its PATH) runs
  `shepherdr update`, so it carries on if the task's terminal or the session ends meanwhile. Its outcome
  (running, ok or failed, the end of its output, a log) is kept on the task and on the schedule (last_update).
- The asking command waits for it and says how it went; the schedule's next run is told the last outcome in its brief.

Like the guard, this guards against mistakes, not against an agent set on getting round it."""

import os
import subprocess
import sys
import time

from .base import ENTRY, Fail, now, STORE

TIMEOUT_S = 30 * 60          # an update still running after this is stopped, and counts as failed
WAIT_S = 35 * 60             # how long the asking command waits for its outcome
TAIL_CHARS = 1200
LOGS = os.path.join(STORE, ".shepherdr-update")


def in_task_terminal(env=None):
    """Inside a task's terminal: the guard's session is set (guard_argv)."""
    return bool((env if env is not None else os.environ).get("HERDR_GUARD_SESSION"))


def set_allowed(a, value, env=None):
    """auto add|edit --may-update-shepherdr on|off: only the person (their own terminal, their Assistant, the app)."""
    v = str(value).strip().lower()
    if v not in ("on", "off", "yes", "no", "true", "false"):
        raise Fail("--may-update-shepherdr takes on or off.")
    if in_task_terminal(env):
        raise Fail("Only the person can let a schedule update Shepherdr: a task's agent can't. Ask them to set it from "
                   "their own terminal or their Assistant (`herdr-task auto edit <schedule> --may-update-shepherdr on`).")
    if v in ("on", "yes", "true"):
        a["may_update"] = True
    else:
        a.pop("may_update", None)


def schedule_of(s, t):
    return next((a for a in s.data.get("automations") or [] if a.get("id") == t.get("automation")), None) if t.get("automation") else None


def when(ms):
    try:
        return time.strftime("%Y-%m-%d %H:%M", time.localtime(ms / 1000))
    except (TypeError, ValueError, OverflowError):
        return "?"


def outcome_words(u):
    """One line: how an update went."""
    if not u:
        return "none yet"
    st = u.get("state")
    if st == "running":
        return f"still running (started {when(u.get('at'))})"
    if st == "ok":
        return f"updated at {when(u.get('done_at') or u.get('at'))}" + (f": {u['version']}" if u.get("version") else "")
    code = u.get("code")
    why = f"still running after {TIMEOUT_S // 60} min, stopped" if "code" in u and code is None else \
        f"ended with exit code {code}" if code is not None else "couldn't run"
    last = (u.get("tail") or "").strip().splitlines()
    return f"failed at {when(u.get('done_at') or u.get('at'))}: {why}" + (f": {last[-1][:200]}" if last else "") + \
        (f" (all its output: {u['log']})" if u.get("log") else "")


def brief_words(s, a, t, ht):
    """For a run of a schedule that may update Shepherdr: how, and how the last one went."""
    from shlex import quote
    return (f"This schedule may update Shepherdr on this machine. Never run `shepherdr update` in your terminal (it is "
            f"refused there): run `{ht} update-shepherdr {s.ref(t)} --folder {quote(s.loc['folder'])}`. It updates outside "
            f"your terminal, waits for it and says how it went (exit 0: updated). Its last update: "
            f"{outcome_words(a.get('last_update'))}.")


def clean_env(env, store=None):
    """The runner's environment: the task's, without the guard (its folder on PATH and its session)."""
    from .guard import guard_dir
    try:
        gd = os.path.realpath(guard_dir(store))
    except OSError:
        gd = None
    e = {k: v for k, v in env.items() if k != "HERDR_GUARD_SESSION"}
    keep = [d for d in (env.get("PATH") or "").split(":")
            if d and os.path.realpath(d) != gd and not os.path.realpath(d).endswith(os.sep + os.path.join(".guard", "bin"))]
    e["PATH"] = ":".join(keep)
    return e


def spawn(folder, task_id, root=None):
    """Starts the runner in its own process session (patched in tests)."""
    argv = [sys.executable, ENTRY, "_update-shepherdr", str(task_id), "--folder", folder] + (["--root", root] if root else [])
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     env=clean_env(os.environ), start_new_session=True, close_fds=True)


def cmd_update_shepherdr(args):
    """A schedule's run asks for the update (see the module's words), then waits for how it went."""
    from .output import say
    from .store import locate, open_store, Store
    with open_store(args) as s:
        t = s.find(args.id)
        a = schedule_of(s, t)
        if not args.status:
            if not a or not a.get("may_update"):
                raise Fail("Refused: only a run of a schedule the person let update Shepherdr can ask for it "
                           "(`herdr-task auto edit <schedule> --may-update-shepherdr on`, set by the person). In any "
                           "other task, `shepherdr update` is for the person to run from their own terminal.")
            if os.environ.get("HERDR_BROWSER_TASK") != s.key(t):
                raise Fail(f"Refused: only {s.name(t)}'s own terminal can ask for its update.")
            if t.get("state") == "done":
                raise Fail(f"{s.name(t)} is done: the schedule's next run asks for it.")
        u = (t.get("shepherdr_update") or {}) if args.status else None
        if not args.status and (t.get("shepherdr_update") or {}).get("state") != "running":
            u = t["shepherdr_update"] = {"state": "running", "at": now()}
            a["last_update"] = dict(u)
            s.dirty = True
            try:
                spawn(s.loc["folder"], t["id"], getattr(args, "root", None))
            except OSError as e:
                u.update(state="failed", done_at=now(), tail=f"Couldn't start it: {e.strerror or e}")
                a["last_update"] = dict(u)
        folder, tid = s.loc["folder"], t["id"]
    deadline = time.time() + (0 if args.status or args.no_wait else WAIT_S)
    while u.get("state") == "running" and time.time() < deadline:
        time.sleep(2)
        with Store(locate(folder), False) as s:
            u = s.find(str(tid)).get("shepherdr_update") or {}
    say(args, u, f"Shepherdr update: {outcome_words(u if u else None)}")
    if args.status:
        return 0
    return {"ok": 0, "running": 75}.get(u.get("state"), 1)


def run_update(root, log):
    """(exit code or None when it timed out, the end of its output). Its whole output goes to log."""
    os.makedirs(os.path.dirname(log), exist_ok=True)
    argv = ["shepherdr", "update"] + (["--root", root] if root else [])
    with open(log, "wb") as out:
        out.write(f"$ {' '.join(argv)}\n".encode())
        out.flush()
        try:
            p = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT, env=clean_env(os.environ))
        except OSError as e:
            out.write(f"Couldn't start it: {e}\n".encode())
            return 127, f"Couldn't start it: {e.strerror or e}"
        try:
            code = p.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
            code = None
    try:
        with open(log, "rb") as f:
            f.seek(max(0, os.path.getsize(log) - 4 * TAIL_CHARS))
            text = f.read().decode(errors="replace")
    except OSError:
        text = ""
    lines = [x.rstrip() for x in text.splitlines() if x.strip() and not x.startswith("$ ")]
    return code, "\n".join(lines)[-TAIL_CHARS:]


def cmd_run(args):
    """Background (`_update-shepherdr`): runs the update a schedule's run asked for and keeps how it went."""
    import re
    from .store import locate, Store
    with Store(locate(args.folder)) as s:
        t = s.find(args.id)
        a = schedule_of(s, t)
        if (t.get("shepherdr_update") or {}).get("state") != "running" or not a or not a.get("may_update"):
            return 0
        log = os.path.join(LOGS, f"{s.slug}-{t['id']}.log")
    code, tail = run_update(args.root, log)
    with Store(locate(args.folder)) as s:
        t = s.find(args.id)
        u = t.setdefault("shepherdr_update", {})
        u.update(state="ok" if code == 0 else "failed", done_at=now(), code=code, log=log)
        m = re.findall(r"Shepherdr (\d+\.\d+\.\d+)", tail)
        if m:
            u["version"] = m[-1]
        if tail:
            u["tail"] = tail
        a = schedule_of(s, t)
        if a is not None:
            a["last_update"] = dict(u)
        s.dirty = True
    return 0
