"""What each running agent's terminal says of its session (the label herdr.resume).

While an Assistant or a task's agent runs, each tick records on its terminal how it runs: the agent's
flags, the exact session id and log (session_of(), as the chat finds them), its folder, and the
terminal's own process. The chat reads its log from there, and so does news (what the person types).

From 3.2 nothing is started again from it: an agent that crashes, or that a restart of the machine
left a plain shell, stays stopped until the person restarts it (step 38: `herdr-task resume`). Until
3.1 the tick typed the agent back into that shell by itself (SHEP-30)."""

import fcntl
import json
import os
import re

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
            "pid": k.get("pid"), "working": status_word(k) in ("working", "blocked"), "shell": shell}


def record_pass(report):
    """Records each running Assistant's and task agent's session here on its terminal. Nothing is brought
    back: a terminal whose agent is gone is left as it is."""
    d = hc_json("ls") or {}
    mine = [k for k in d.get("terminals") or [] if "/" not in k.get("address", "") and k.get("state") == "live"]
    for k in (x for x in (hc_json("get", k["address"]) for k in mine) if x and watched(x)):
        if not agent_running(k):
            continue
        new = record_of(k)
        if new and {x: v for x, v in (read_record(k) or {}).items() if x not in ("how", "sent")} != new:
            write_record(k, new)
            report.setdefault("recorded", []).append(k["address"])


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
    its first message; the old terminal ends. A new one from the assistant template, the message its task, when its
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
        else:
            r = run([*base, "assistant", message])
        try:
            new = (json.loads(r.stdout or "{}") or {}).get("address") if r.returncode == 0 else None
        except ValueError:
            new = None
        if not new:
            return None
        run(["hc", "kill", addr])
        run(["hc", "rm", addr])
        return new
