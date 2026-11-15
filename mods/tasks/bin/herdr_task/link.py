"""The person's task actions on another machine, kept whole across its link dropping (SHEP-227,
GitHub #1055, #1016).

`hc exec --on` ends the program there the moment the link to that machine drops ("lost the line
to <m> during the call"), so an Accept could stop half done, and the window, which stops any
command after 30 s, said only "took longer than 30 s". Now an action runs there as its own
short-lived hc terminal (`hc run --bg --rm`, which a dropped link doesn't end) writing its result
to a file, and this side reads that result, waiting out a reconnect. When it isn't in within
WAIT seconds (a slow machine, a link still reconnecting) the answer is "pending" (exit PENDING,
JSON {"error", "pending": job, "machine"}), and `herdr-task --on <m> _job <job>` waits for it
again (core/pending.js does that for the window and the service). A link that never comes back
gets a clear error that says what may have happened. Reads (list, show, where) just run again
once the link is back.
"""

import json
import os
import secrets
import subprocess
import time

from .base import run

# What the person does from the window, the web app or a menu: run there whole, result read back.
ACTIONS = {"add", "start", "done", "accept", "reopen", "unarchive", "edit", "rm", "review", "review-more", "star",
           "fix", "merge", "resume", "switch"}
READS = {"list", "show", "where"}
WAIT = 25.0      # the window stops a command at 30 s: answer before that
PENDING = 75     # exit code: still running there, follow it with _job
STEP_MAX = 1.0

# There: run herdr-task with its output and exit code in files, as hc exec would run it (no terminal's ids:
# herdr-task would take the terminal for an agent's). Old results go after an hour.
RUN = r'''d="${TMPDIR:-/tmp}/herdr-task-jobs-$(id -u)"; mkdir -p "$d" && chmod 700 "$d" || exit 1
j=$1; b=${2:-$HOME/.local/bin/herdr-task}; shift 2
: > "$d/$j.out"
find "$d" -type f -mmin +60 -exec rm -f {} + 2>/dev/null
unset HC_TERMINAL_ID HC_TERMINAL_SOCKET TERM_PROGRAM
"$b" "$@" > "$d/$j.out" 2> "$d/$j.err" < /dev/null
echo $? > "$d/$j.rc.new" && mv "$d/$j.rc.new" "$d/$j.rc"'''

# There: "none" (never started), "running", or "done" and its {rc, out, err} on the next line. Kept: a reply lost
# on the way back is read again.
POLL = r'''import json, os, sys
d = os.path.join(os.environ.get("TMPDIR") or "/tmp", "herdr-task-jobs-%d" % os.getuid())
p = lambda e: os.path.join(d, sys.argv[1] + e)
if not os.path.exists(p(".rc")):
    print("running" if os.path.exists(p(".out")) else "none")
    sys.exit(0)
def read(e):
    try:
        with open(p(e), errors="replace") as f:
            return f.read()
    except OSError:
        return ""
print("done")
print(json.dumps({"rc": int(read(".rc").strip() or 1), "out": read(".out"), "err": read(".err")}))'''


def wait_s():
    try:
        return float(os.environ.get("HERDR_TASK_ACTION_WAIT") or WAIT)
    except ValueError:
        return WAIT


def lost(r):
    """Whether hc's call failed for the link (it says "unavailable", exit 5), not the program there."""
    if r.returncode != 5:
        return False
    for text in (r.stderr, r.stdout):
        try:
            err = json.loads(text or "").get("error") or {}
        except (ValueError, AttributeError):
            continue
        if isinstance(err, dict) and err.get("kind") == "unavailable":
            return True
    return "lost the line" in (r.stderr or "") or "unreachable" in (r.stderr or "")


def cut(r):
    """A lost call that had reached the machine ("lost the line … during the call"), not one refused before."""
    return "during the call" in (r.stderr or "") or "during the call" in (r.stdout or "")


def _done(argv, rc, out="", err=""):
    return subprocess.CompletedProcess(argv, rc, out, err)


def _say(argv, rc, data):
    """herdr-task's own way to fail: JSON on stdout with --json, else the words on stderr."""
    if "--json" in argv:
        return _done(argv, rc, json.dumps(data) + "\n", "")
    return _done(argv, rc, "", data["error"] + "\n")


def start(machine, job, argv):
    return run(["hc", "run", "--bg", "--rm", "--no-parent", "--no-notify", "--json", "--label", "herdr.role=action",
                "--label", f"herdr.action={job}", "--on", machine, "--", "sh", "-c", RUN, "sh", job,
                os.environ.get("HERDR_TASK_REMOTE_BIN", ""), *argv])


def poll(machine, job):
    """("done", {rc, out, err}) | ("running"|"none", None) | ("lost", hc's run) | ("error", hc's run)."""
    r = run(["hc", "exec", "--on", machine, "--timeout", "15", "--", "python3", "-c", POLL, job])
    if r.returncode != 0:
        return ("lost" if lost(r) else "error"), r
    head, _, rest = r.stdout.partition("\n")
    if head.strip() == "done":
        try:
            return "done", json.loads(rest)
        except ValueError:
            return "error", r
    return head.strip(), None


def pending(argv, machine, job, why):
    msg = (f"Still running on {machine} ({why}): it finishes there whatever the link does. "
           f"`herdr-task --on {machine} _job {job}` gives its result.")
    return _say(argv, PENDING, {"error": msg, "pending": job, "machine": machine})


def gone(argv, machine, maybe):
    """The link didn't come back in time, the action not known to have started: what may have happened, plainly.
    maybe: its start was cut off mid-call (it may have run), else the machine was never reached (nothing ran)."""
    msg = (f"Lost the link to {machine} as the action started, and it hasn't come back: it may have run there. "
           "Check the task once the link is back." if maybe else
           f"Can't reach {machine}: its link is down, and nothing was run there. Try again once it's back.")
    return _say(argv, 1, {"error": msg, "machine": machine})


def follow(machine, job, argv, deadline, restart=None, maybe=False):
    """Reads the job's result until `deadline` (time.monotonic()), waiting out a dropped link.
    restart: the job's argv when its start was cut off (not known to have started): started
    again once the link is back and the machine says it never began. maybe: that start was cut off
    mid-call (it may have begun there), not refused before it reached the machine."""
    step, nones, last = 0.2, 0, None
    while True:
        state, got = poll(machine, job)
        if state == "done":
            return _done(argv, got.get("rc", 1), got.get("out", ""), got.get("err", ""))
        if state == "error":
            return got
        if state == "lost":
            last = got
        elif state == "none":
            nones += 1
            if restart is None and nones >= 4:
                # known to have started, yet nothing there: its files are gone (an old job id, another TMPDIR)
                msg = f"No action {job} on {machine}."
                return _say(argv, 1, {"error": msg})
            if restart is not None and nones >= 2:
                # twice "never began", the link up: it never started, so it starts now (once)
                r = start(machine, job, restart)
                if r.returncode == 0:
                    restart, nones = None, 0
                elif not lost(r):
                    return r
                else:
                    maybe = maybe or cut(r)
        else:
            last = None
        if time.monotonic() + step >= deadline:
            break
        time.sleep(step)
        step = min(step * 1.5, STEP_MAX)
    if restart is not None:
        # never known to have started: maybe it did, maybe not
        return gone(argv, machine, maybe)
    return pending(argv, machine, job, "its link dropped and hasn't come back yet" if last is not None else "it's slow to answer")


def action(machine, argv, install=None):
    """One of the person's actions on `machine`, its result read back across a dropped link.
    install(): puts herdr-task there when the job finds none (exit 127)."""
    deadline = time.monotonic() + wait_s()
    job = secrets.token_hex(6)
    r = start(machine, job, argv)
    if r.returncode != 0 and not lost(r):
        return r   # hc refused it (an unknown machine, ...): as it said
    got = follow(machine, job, argv, deadline, restart=None if r.returncode == 0 else argv, maybe=cut(r))
    if got.returncode == 127 and not got.stdout and install:
        install()
        job = secrets.token_hex(6)
        r = start(machine, job, argv)
        if r.returncode != 0 and not lost(r):
            return r
        got = follow(machine, job, argv, max(deadline, time.monotonic() + 5), restart=None if r.returncode == 0 else argv,
                     maybe=cut(r))
    return got


def again(machine, argv, call):
    """A read cut off by the link: run again once the machine answers (within WAIT)."""
    deadline = time.monotonic() + wait_s()
    r = call()
    step = 0.3
    while lost(r) and time.monotonic() + step < deadline:
        time.sleep(step)
        step = min(step * 1.5, STEP_MAX)
        r = call()
    return r
