"""What each running agent's terminal says of its session (the label herdr.resume).

While an Assistant or a task's agent runs, each tick records on its terminal how it runs: the agent's
flags, the exact session id and log (session_of(), as the chat finds them), its folder, and the
terminal's own process. The chat reads its log from there, and so does news (what the person types).

From 3.2 an agent that crashes or exits stays stopped until the person restarts it (step 38: `herdr-task
resume`). One exception (#1545): an Assistant that was running when the machine went down (a reboot, a power
cut) starts again on its own conversation once it is back up (back_after_boot). Until 3.1 the tick typed the
agent back into that shell by itself (SHEP-30)."""

import fcntl
import json
import os
import re
import secrets
import subprocess
import time

from .base import hc_json, HOME, now, run, SHELLS, STORE
from .agents import agent_running, front, status_word
from .sessions import session_of
from .settings import ASSISTANT_TEMPLATES

LABEL = "herdr.resume"
# Flags whose next word is their value (core/agents.js CLAUDE_VALUE, CODEX_VALUE), so it isn't taken
# for a first message.
CLAUDE_VALUE = {"--add-dir", "--mcp-config", "--append-system-prompt", "--system-prompt", "--allowedTools", "--allowed-tools",
                "--disallowedTools", "--disallowed-tools", "--agent", "--agents", "--plugin-dir", "--fallback-model",
                "--output-format", "--input-format", "--name", "--setting-sources", "--betas", "--debug-file",
                "--model", "--effort", "--settings", "--permission-mode"}
CODEX_VALUE = {"-c", "--config", "-m", "--model", "-p", "--profile", "-s", "--sandbox", "-a", "--ask-for-approval",
               "-C", "--cd", "--add-dir", "-i", "--image", "--enable", "--disable", "--local-provider", "--oss"}


def kind_of(word):
    b = os.path.basename(str(word))
    return b if b in ("claude", "codex") else None


def base_argv(argv):
    """(kind, argv) for starting the agent in `argv` again: from its claude or codex word on, without
    what resumed a conversation or its first message (core/agents.js freshArgv), or (None, None)."""
    argv = list(argv or [])
    at = next((i for i, a in enumerate(argv) if (i == 0 or not str(a).startswith("-")) and kind_of(a)), None)
    if at is None:
        return None, None
    kind, rest, out = kind_of(argv[at]), argv[at + 1:], [argv[at]]
    i = 0
    while i < len(rest):
        a = rest[i]
        if kind == "claude":
            if a in ("--resume", "-r", "--session-id"):
                i += 2 if i + 1 < len(rest) and not rest[i + 1].startswith("-") else 1
                continue
            if re.match(r"^--(resume|session-id)=", a) or a in ("--continue", "-c", "--fork-session"):
                i += 1
                continue
            if a in CLAUDE_VALUE and i + 1 < len(rest):
                out += [a, rest[i + 1]]
                i += 2
                continue
        else:
            if i == 0 and a in ("resume", "fork"):
                i += 2 if i + 1 < len(rest) and not rest[i + 1].startswith("-") else 1
                continue
            if a == "--last":
                i += 1
                continue
            if a in CODEX_VALUE and i + 1 < len(rest):
                out += [a, rest[i + 1]]
                i += 2
                continue
        # A word that isn't a flag or a flag's value: a session's id or a first message.
        if a.startswith("-"):
            out.append(a)
        i += 1
    return kind, out


def resume_argv(kind, argv, session, message=None):
    """argv (base_argv's) resuming `session`, with a first message when given."""
    tail = [message] if message else []
    if kind == "claude":
        return [*argv, "--resume", session, *tail]
    return [argv[0], "resume", *argv[1:], session, *tail]


def read_record(k):
    try:
        rec = json.loads(((k.get("labels") or {}).get(LABEL)) or "null")
    except ValueError:
        return None
    return rec if isinstance(rec, dict) else None


def write_record(k, rec):
    return run(["hc", "label", k["address"], f"{LABEL}={json.dumps(rec, separators=(',', ':'))}"]).returncode == 0


def watched(k):
    """An Assistant or a task's agent (its worker or reviewer): what comes back."""
    labels = k.get("labels") or {}
    return labels.get("herdr.role") == "coordinator" or k.get("template") in ASSISTANT_TEMPLATES or bool(labels.get("herdr.task"))


def record_of(k):
    """How to start the running agent in `k` again on its own session, or None."""
    fg = k.get("foreground") or {}
    pid = fg.get("pid")
    if not pid:
        return None
    # Its launch argv says how it started (in the person's shell, as a task's agent, or not); one typed
    # into a shell (argv: the shell) has only its process's.
    kind, argv = base_argv(k.get("argv"))
    launch = k.get("argv") or []
    shell = any(os.path.basename(str(a)) in SHELLS for a in launch[:launch.index(argv[0])]) if kind else True
    if not kind:
        kind, argv = base_argv(fg.get("argv"))
        if kind:
            argv[0] = kind
    if not kind:
        return None
    sid, log = session_of(pid)
    if not sid:
        return None
    return {"kind": kind, "session": sid, "log": log, "argv": argv, "cwd": fg.get("cwd") or k.get("cwd"),
            "pid": k.get("pid"), "working": status_word(k) in ("working", "blocked"), "shell": shell, "boot": boot_id()}


_boot = None


def boot_id():
    """This boot of the machine: a new one after every restart of it (Linux's boot_id, macOS's boot time).
    HERDR_TASK_BOOT_ID stands in for it in tests."""
    global _boot
    if os.environ.get("HERDR_TASK_BOOT_ID"):
        return os.environ["HERDR_TASK_BOOT_ID"]
    if _boot is None:
        try:
            with open("/proc/sys/kernel/random/boot_id") as f:
                _boot = f.read().strip()
        except OSError:
            try:
                out = subprocess.run(["sysctl", "-n", "kern.boottime"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     universal_newlines=True, timeout=5).stdout
                m = re.search(r"sec = (\d+), usec = (\d+)", out)
                _boot = f"{m.group(1)}.{m.group(2)}" if m else ""
            except (OSError, subprocess.SubprocessError):
                _boot = ""
    return _boot


def is_assistant(k):
    labels = k.get("labels") or {}
    return not labels.get("herdr.task") and (labels.get("herdr.role") == "coordinator" or k.get("template") in ASSISTANT_TEMPLATES)


def record_pass(report):
    """Records each running Assistant's and task agent's session here on its terminal. An agent that ended in this
    boot (the person's /exit or Ctrl+C, a crash) has its record marked stopped: it stays stopped. An Assistant whose
    record is from an earlier boot and not stopped was running when the machine went down: it starts again
    (back_after_boot)."""
    d = hc_json("ls") or {}
    mine = [k for k in d.get("terminals") or [] if "/" not in k.get("address", "") and k.get("state") == "live"]
    cut = []
    for k in (x for x in (hc_json("get", k["address"]) for k in mine) if x and watched(x)):
        if not agent_running(k):
            rec = read_record(k)
            if not rec or rec.get("stopped"):
                continue
            here = boot_id()
            if here and rec.get("boot") and rec["boot"] != here and is_assistant(k) and front(k) == "shell":
                cut.append((k, rec))
            elif not (here and rec.get("boot") and rec["boot"] != here):
                write_record(k, {**rec, "stopped": True})
            continue
        new = record_of(k)
        if new and {x: v for x, v in (read_record(k) or {}).items() if x not in ("how", "sent")} != new:
            write_record(k, new)
            report.setdefault("recorded", []).append(k["address"])
    if cut:
        back_after_boot(cut, report)
    cut_alert_pass(report)


# ---- Assistants back after a restart of the machine (#1545) -----------------------------------------------------------
# herdr-core brings every terminal back after a reboot, with its labels, but as a plain shell: the agent in it is gone.
# Each Assistant that was running then (its herdr.resume record from the last boot, never marked stopped) starts again
# on its own conversation, as the Stopped card's Restart does. One that can't (no conversation known, the start
# failed) is marked stopped and listed in one alert from the scheduler's terminal, whose "Restart all" (the web's
# restart-all action) starts them again; the alert goes once none of them is left a plain shell.
CUT = os.path.join(STORE, ".cut-off.json")   # {"id", "at", "left": [address, ...]}
CUT_TITLE = "Not back after the restart"
SETTLE_S = 8   # a restarted agent that can't run (its conversation gone, its CLI missing) has ended by then


def back_after_boot(cut, report):
    left, back = [], []
    for k, rec in cut:
        new = None
        if rec.get("kind") in ("claude", "codex") and rec.get("session") and rec.get("argv"):
            try:
                new = restart_assistant(k, None)
            except Exception:  # never stops the tick
                new = None
        if new:
            back.append({"was": k["address"], "now": new})
        else:
            write_record(k, {**rec, "stopped": True})
            left.append(k["address"])
    if back:
        time.sleep(float(os.environ.get("HERDR_TASK_BOOT_SETTLE") or SETTLE_S))
        for b in back:
            if (hc_json("get", b["now"]) or {}).get("state") == "live":
                report.setdefault("back", []).append(b)
            else:
                left.append(b["now"])  # it started and ended at once: its chat shows it Stopped
    if left:
        d = read_cut() or {"id": secrets.token_hex(4), "left": []}
        d["at"] = now()
        d["left"] = list(dict.fromkeys([*d["left"], *left]))
        write_cut(d)
        report.setdefault("not_back", []).extend(left)


def read_cut():
    try:
        with open(CUT) as f:
            d = json.load(f)
        return d if isinstance(d, dict) and isinstance(d.get("left"), list) else None
    except (OSError, ValueError):
        return None


def write_cut(d):
    os.makedirs(STORE, exist_ok=True)
    tmp = f"{CUT}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, CUT)


def cut_alert_pass(report):
    """Keeps the alert in step with the Assistants a restart left stopped: set (or set again, after the scheduler's
    terminal was replaced) while any is still a plain shell, taken off once none is."""
    d = read_cut()
    if not d:
        return
    from .scheduler import SCHEDULER
    from .settings import machine_name
    from .launch import core_spaces
    sched = hc_json("get", SCHEDULER)
    try:
        held = json.loads(((sched or {}).get("labels") or {}).get("herdr.alert") or "null")
    except ValueError:
        held = None
    ours = isinstance(held, dict) and held.get("id") == d.get("id")
    # still stopped: a plain shell, or one that ended at once; restarted (Restart, a message), it is gone
    still = [(a, k) for a, k in ((a, hc_json("get", a)) for a in d["left"]) if k and (k.get("state") != "live" or front(k) == "shell")]
    if not still:
        if ours:
            run(["hc", "label", SCHEDULER, "herdr.alert="])
        try:
            os.remove(CUT)
        except OSError:
            pass
        return
    if [a for a, _ in still] != d["left"]:
        d["left"] = [a for a, _ in still]
        write_cut(d)
    names = {str(x["id"]): x.get("name") or os.path.basename(str(x.get("folder") or "").rstrip("/")) for x in core_spaces()}
    who = [names.get(str(space_of(k) or "")) or os.path.basename(str(k.get("cwd") or "").rstrip("/")) or a for a, k in still]
    alert = {"id": d["id"], "at": d.get("at") or now(), "title": CUT_TITLE,
             "body": f"The machine's restart stopped {', '.join(who)}. Restart all, or write to each to start it again.",
             "about": True, "task": machine_name() or "This computer", "restart": [a for a, _ in still]}
    if ours and held == alert:
        return
    if (sched or {}).get("state") == "live" and run(["hc", "label", SCHEDULER, "herdr.alert=" + json.dumps(alert, ensure_ascii=False, separators=(",", ":"))]).returncode == 0:
        report["cut_alert"] = alert["body"]


def space_of(k):
    labels = (k or {}).get("labels") or {}
    return labels.get("herdr.space") or labels.get("herdr.coordinator.space")


# ---- an Assistant whose agent exited gets its message by starting again (SHEP-324) -----------------------------------
# herdr-core keeps an Assistant's terminal when its program is lost (a core restart, a crash): what's left is a plain
# shell, and a message typed there runs as a command. A message for it starts it again instead, as the web's Restart
# does (service/restart.sh): beside the old terminal, on its own conversation (its herdr.resume record), with the
# message as its first, then the old terminal ends. Nothing is ever typed into the shell.
RESTARTS = os.path.join(STORE, ".restarts.json")   # {address: when its restart was last tried}
RESTART_GAP_MS = 5 * 60000                          # a failed restart is tried again after this long, never in a loop
# What says where an Assistant lives (its space, tab or chat), carried to the new one as restart.sh does.
PLACE_LABELS = ("herdr.space", "herdr.tab", "herdr.coordinator.space", "herdr.coordinator.tab", "herdr.chat",
                "herdr.chat.slot", "herdr.chat.origin")


def restart_assistant(k, message):
    """Starts the Assistant in terminal k (its hc get), its agent gone (a plain shell in front), again with `message` as
    its first message (None: none, its conversation only resumed: back_after_boot); the old terminal ends. A new one from the assistant template, the message its task, when its
    conversation isn't known. This machine's terminals only. -> the new address, or None."""
    from .launch import clean_env
    addr = str((k or {}).get("address") or "")
    if not addr or "/" in addr:
        return None
    os.makedirs(STORE, exist_ok=True)
    with open(RESTARTS + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(RESTARTS) as f:
                tried = json.load(f)
        except (OSError, ValueError):
            tried = {}
        tried = {a: at for a, at in tried.items() if now() - at < RESTART_GAP_MS}
        if addr in tried:
            return None
        k = hc_json("get", addr)  # again, under the lock: another restart may have taken it
        if front(k) != "shell":
            return None
        tried[addr] = now()
        with open(RESTARTS, "w") as f:
            json.dump(tried, f)
        labels = k.get("labels") or {}
        place = [x for name in PLACE_LABELS if labels.get(name) for x in ("--label", f"{name}={labels[name]}")]
        keep = ["--keep"] if labels.get("herdr.chat") or not labels.get("herdr.tab") else []
        rec = read_record(k) or {}
        cwd = rec.get("cwd") or k.get("cwd") or HOME
        base = ["hc", "run", "--bg", "--json", "--no-parent", "--cwd", cwd, *keep, *place, "--label", "herdr.role=coordinator"]
        if rec.get("kind") in ("claude", "codex") and rec.get("session") and rec.get("argv"):
            argv = resume_argv(rec["kind"], list(rec["argv"]), rec["session"], message)
            r = run([*base, "--label", f"herdr.agent={rec['kind']}", "--", *clean_env(argv)])
        elif message:
            r = run([*base, "assistant", message])
        else:
            return None
        try:
            new = (json.loads(r.stdout or "{}") or {}).get("address") if r.returncode == 0 else None
        except ValueError:
            new = None
        if not new:
            return None
        run(["hc", "kill", addr])
        run(["hc", "rm", addr])
        return new
