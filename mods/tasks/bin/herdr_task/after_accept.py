"""A space's "When a task is accepted" command (#1102, SHEP-275): a shell command the person sets in
Settings > Tasks (Everywhere's or a space's own, tasks.accept_command) that Herdr runs itself in the
repo once a task is done (finish(): accepted and merged, or nothing to merge), to clean up what the
task made (test databases, containers, caches). Unlike the start and finish notes, no agent reads it.

It runs once per task, in the background (`herdr-task _after-accept`): Accept never waits on it and
never undoes for it. Its outcome is kept on the task (after_accept: {state, at, command, code?,
tail?, log?}): running, ok or failed. A failure shows on the task's Done row and is told to its
space's Assistant (news.py); its whole output is in a log file."""

import os
import shlex
import subprocess
import sys

from .base import ENTRY, now, STORE

TIMEOUT_S = 600          # a command still running after this is stopped, and counts as failed
TAIL_CHARS = 600         # the end of its output kept on the task
LOGS = os.path.join(STORE, ".after-accept")


def command_for(s, task):
    """The command for this task's space ("" for none)."""
    from .settings import settings_for
    return str(settings_for(s, task.get("space"))["tasks"].get("accept_command") or "").strip()


def log_path(s, task):
    return os.path.join(LOGS, f"{s.slug}-{task['id']}.log")


def env_for(s, task):
    """What the command is told about the task, as environment variables."""
    return {"HERDR_TASK_ID": s.ref(task), "HERDR_TASK_NUMBER": str(task["id"]), "HERDR_TASK_TITLE": task.get("title") or "",
            "HERDR_TASK_BRANCH": task.get("branch") or "", "HERDR_TASK_BASE": task.get("base") or "",
            "HERDR_TASK_WORKTREE": task.get("worktree") or "", "HERDR_TASK_FOLDER": s.loc["folder"]}


def spawn(folder, task_id):
    """Runs it in the background (patched in tests)."""
    subprocess.Popen([sys.executable, ENTRY, "_after-accept", str(task_id), "--folder", folder],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def start(s, task):
    """Called as a task becomes Done (finish()): starts its space's command once, if one is set."""
    if task.get("after_accept"):
        return False
    cmd = command_for(s, task)
    if not cmd:
        return False
    task["after_accept"] = {"state": "running", "at": now(), "command": cmd}
    s.dirty = True
    try:
        spawn(s.loc["folder"], task["id"])
    except OSError as e:
        task["after_accept"].update(state="failed", tail=f"Couldn't start it: {e.strerror or e}")
    return True


def run_command(cmd, cwd, env, log):
    """(exit code or None when it timed out, the end of its output). Its whole output goes to log."""
    os.makedirs(os.path.dirname(log), exist_ok=True)
    with open(log, "wb") as out:
        out.write(f"$ {cmd}\n".encode())
        out.flush()
        try:
            p = subprocess.Popen(["/bin/sh", "-c", cmd], cwd=cwd, env={**os.environ, **env}, stdin=subprocess.DEVNULL,
                                 stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as e:
            out.write(f"Couldn't start it: {e}\n".encode())
            return 127, f"Couldn't start it: {e.strerror or e}"
        try:
            code = p.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(p.pid, 9)
            except OSError:
                p.kill()
            p.wait()
            code = None
            out.write(f"\nStopped: still running after {TIMEOUT_S // 60} min.\n".encode())
    try:
        with open(log, "rb") as f:
            f.seek(max(0, os.path.getsize(log) - 4 * TAIL_CHARS))
            text = f.read().decode(errors="replace")
    except OSError:
        text = ""
    lines = [x.rstrip() for x in text.splitlines() if x.strip() and not x.startswith(("$ ", "Stopped: still running"))]
    return code, "\n".join(lines)[-TAIL_CHARS:]


def cmd_after_accept(args):
    """Background: runs a Done task's command (start() set it running) and keeps how it went."""
    from .store import locate, Store
    with Store(locate(args.folder)) as s:
        t = s.find(args.id)
        aa = t.get("after_accept") or {}
        if aa.get("state") != "running" or not aa.get("command"):
            return 0
        cmd, cwd, env, log = aa["command"], s.loc["folder"], env_for(s, t), log_path(s, t)
    if not os.path.isdir(cwd):
        code, tail = 127, f"Its folder is gone: {cwd}"
    else:
        code, tail = run_command(cmd, cwd, env, log)
    with Store(locate(args.folder)) as s:
        t = s.find(args.id)
        aa = t.setdefault("after_accept", {"command": cmd})
        aa.update(state="ok" if code == 0 else "failed", done_at=now(), code=code, log=log)
        if tail:
            aa["tail"] = tail
        else:
            aa.pop("tail", None)
        s.dirty = True
    return 0


def failure_words(aa):
    """How a failed run reads, in one line: why, then its last line of output."""
    code = aa.get("code")
    why = f"it was still running after {TIMEOUT_S // 60} min" if "code" in aa and code is None else f"it ended with exit code {code}" if code is not None else "it couldn't run"
    last = (aa.get("tail") or "").strip().splitlines()
    return why + (f": {last[-1][:200]}" if last else "")


def describe(aa):
    """For `herdr-task show`: how its command went."""
    st = aa.get("state")
    if st == "running":
        return "running"
    if st == "ok":
        return "done"
    return "failed, " + failure_words(aa) + (f" (all its output: {shlex.quote(aa['log'])})" if aa.get("log") else "")
