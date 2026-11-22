"""What each running agent's terminal says of its session (the label herdr.resume).

While an Assistant or a task's agent runs, each tick records on its terminal how it runs: the agent's
flags, the exact session id and log (session_of(), as the chat finds them), its folder, and the
terminal's own process. The chat reads its log from there, and so does news (what the person types).

From 3.2 nothing is started again from it: an agent that crashes, or that a restart of the machine
left a plain shell, stays stopped until the person restarts it (step 38: `herdr-task resume`). Until
3.1 the tick typed the agent back into that shell by itself (SHEP-30)."""

import json
import os
import re

from .base import hc_json, run, SHELLS
from .agents import agent_running, status_word
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
