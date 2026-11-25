"""Extra launch flags for a task's agent (#1222): `--advisor opus` for a Sonnet task, say. Only flags Claude Code and
Codex really have (their CLI references, and their own --help for one newer than these tables), none of Shepherdr's
own; the ones that clash with what Shepherdr sets itself (model, effort, permissions, resuming, print mode...) are
refused with why.

Flags are kept normalized, one word each where they take a value (`--advisor=opus`, `--add-dir=/x --add-dir=/y`):
a word then can't be taken for a first message or a session's id, and every place that starts the agent again
(resume, switch, restart, a crash's recovery: revive.base_argv, core/agents.js kept) keeps it as it is."""

import re
import shlex
import shutil
import subprocess

from .base import Fail

# How many values a flag takes: none, one, many (one or more: written once per value) or opt (one or none).
N, ONE, MANY, OPT = "none", "one", "many", "opt"

# Claude Code: https://code.claude.com/docs/en/cli-reference and `claude --help` (2.1.330). --advisor:
# https://code.claude.com/docs/en/advisor (not in --help).
CLAUDE = {
    "--add-dir": MANY, "--advisor": ONE, "--agent": ONE, "--agents": ONE, "--allow-dangerously-skip-permissions": N,
    "--allowedTools": MANY, "--allowed-tools": MANY, "--append-system-prompt": ONE, "--append-system-prompt-file": ONE,
    "--autocompact": ONE, "--ax-screen-reader": N, "--bare": N, "--betas": MANY, "--brief": N, "--channels": MANY,
    "--chrome": N, "--dangerously-load-development-channels": MANY, "--debug": OPT, "--debug-file": ONE,
    "--disable-slash-commands": N, "--disallowedTools": MANY, "--disallowed-tools": MANY,
    "--exclude-dynamic-system-prompt-sections": N, "--fallback-model": ONE, "--file": MANY, "--ide": N,
    "--mcp-config": MANY, "--name": ONE, "--no-chrome": N, "--plugin-dir": ONE, "--plugin-url": ONE,
    "--prompt-suggestions": OPT, "--remote-control": OPT, "--rc": OPT, "--remote-control-session-name-prefix": ONE,
    "--restricted": N, "--safe-mode": N, "--setting-sources": ONE, "--strict-mcp-config": N, "--system-prompt": ONE,
    "--system-prompt-file": ONE, "--system-prompt-snapshot": ONE, "--teammate-mode": ONE, "--tools": MANY,
    "--verbose": N,
}
CLAUDE_SHORT = {"-n": "--name", "-d": "--debug", "-c": "--continue", "-r": "--resume", "-p": "--print", "-w": "--worktree",
                "-v": "--version", "-h": "--help"}
_SET = "Shepherdr sets it from the task's"
_PRINT = "it only works with --print, and a task's agent is interactive"
CLAUDE_REFUSED = {
    "--model": f"{_SET} model: use --model (or --set model=...)",
    "--effort": f"{_SET} effort: use --effort (or --set effort=...)",
    "--settings": "Shepherdr passes its own --settings (speed, the chat's question card): put settings in ~/.claude/settings.json",
    "--permission-mode": "Shepherdr sets the permission mode from Settings › Agents (Task agent)",
    "--dangerously-skip-permissions": "Shepherdr sets the permission mode from Settings › Agents (Task agent): pick Bypass there",
    "--resume": "Shepherdr resumes the task's own session itself", "--continue": "Shepherdr resumes the task's own session itself",
    "--session-id": "Shepherdr resumes the task's own session itself", "--fork-session": "Shepherdr resumes the task's own session itself",
    "--from-pr": "Shepherdr resumes the task's own session itself", "--teleport": "the agent works here, not from a cloud session",
    "--print": "a task's agent is interactive (it would answer once and exit)",
    "--bg": "the agent must stay in its own terminal", "--background": "the agent must stay in its own terminal",
    "--desktop": "the agent must stay in its own terminal", "--cloud": "the agent works here, not in a cloud session",
    "--remote": "the agent works here, not in a cloud session", "--environment": "the agent works here, not in a cloud session",
    "--correlation-id": "it is for cloud sessions (--environment)", "--metadata": "it is for cloud sessions (--environment)",
    "--ref": "it is for cloud sessions (--environment)", "--exec": "it runs a background job (--bg), not an agent",
    "--worktree": "Shepherdr gives each task its own worktree already", "--tmux": "Shepherdr gives each task its own worktree already",
    "--init-only": "it exits before the agent starts", "--version": "it exits before the agent starts",
    "--help": "it exits before the agent starts", "--enable-auto-mode": "Claude Code removed it: pick Auto in Settings › Agents",
    **{f: _PRINT for f in ("--output-format", "--input-format", "--json-schema", "--max-budget-usd", "--max-turns",
                           "--no-session-persistence", "--forward-subagent-text", "--include-partial-messages",
                           "--include-hook-events", "--replay-user-messages", "--append-subagent-system-prompt",
                           "--append-subagent-system-prompt-file", "--init", "--maintenance", "--permission-prompts",
                           "--permission-prompt-tool")},
}

# Codex: `codex --help` and `codex resume --help` (0.163.0; resume takes the same flags).
CODEX = {"--config": ONE, "--enable": ONE, "--disable": ONE, "--strict-config": N, "--image": MANY, "--oss": N,
         "--local-provider": ONE, "--profile": ONE, "--dangerously-bypass-hook-trust": N, "--add-dir": ONE, "--search": N,
         "--no-alt-screen": N}
CODEX_SHORT = {"-c": "--config", "-i": "--image", "-p": "--profile", "-m": "--model", "-s": "--sandbox",
               "-a": "--ask-for-approval", "-C": "--cd", "-h": "--help", "-V": "--version"}
_PERM = "Shepherdr sets the sandbox and approvals from Settings › Agents (Task agent)"
CODEX_REFUSED = {
    "--model": f"{_SET} model: use --model (or --set model=...)", "--sandbox": _PERM, "--ask-for-approval": _PERM,
    "--dangerously-bypass-approvals-and-sandbox": _PERM + ": pick Full access there", "--approve-for-me": _PERM + ": pick Approve for me there",
    "--not-so-yolo": _PERM + ": pick Approve for me there",
    "--full-auto": _PERM, "--no-daemon": "Shepherdr passes it already",
    "--remote": "a task's agent runs on its own app server (--no-daemon)", "--remote-auth-token-env": "a task's agent runs on its own app server (--no-daemon)",
    "--cd": "Shepherdr starts the agent in the task's folder", "--worktree": "Shepherdr gives each task its own worktree already",
    "--last": "Shepherdr resumes the task's own session itself", "--all": "Shepherdr resumes the task's own session itself",
    "--include-non-interactive": "Shepherdr resumes the task's own session itself",
    "--help": "it exits before the agent starts", "--version": "it exits before the agent starts",
}
# -c keys Shepherdr sets itself.
CODEX_KEYS = {"model": f"{_SET} model: use --model", "model_reasoning_effort": f"{_SET} effort: use --effort",
              "service_tier": "Shepherdr sets the speed from Settings › Agents (Task agent)", "sandbox_mode": _PERM,
              "approval_policy": _PERM, "approvals_reviewer": _PERM + ": pick Approve for me there", "projects": "Shepherdr trusts the task's folder itself",
              "hooks": "Shepherdr sets the chat's question card's hook itself"}

TABLES = {"claude": (CLAUDE, CLAUDE_SHORT, CLAUDE_REFUSED), "codex": (CODEX, CODEX_SHORT, CODEX_REFUSED)}
NAMES = {"claude": "Claude Code", "codex": "Codex"}

_help = {}


def help_flags(agent):
    """{flag: arity} the installed CLI's own --help lists: a flag newer than these tables still works. {} when it
    isn't installed or says nothing."""
    if agent in _help:
        return _help[agent]
    out = {}
    if shutil.which(agent):
        try:
            text = subprocess.run([agent, "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            text = ""
        # "  -n, --name <name>   ...", "  --allowedTools, --allowed-tools <tools...>", "      --search", "  -d, --debug [filter]"
        for m in re.finditer(r"^\s{1,8}((?:-{1,2}[\w-]+,?\s+)*?-{1,2}[\w-]+)(?:\s+([<\[])[^>\]]*?(\.\.\.)?[>\]](\.\.\.)?)?(?:\s|$)", text, re.M):
            arity = MANY if m.group(3) or m.group(4) else ONE if m.group(2) == "<" else OPT if m.group(2) == "[" else N
            for f in re.findall(r"--[\w-]+", m.group(1)):
                out[f] = arity
    _help[agent] = out
    return out


def parse(agent, given):
    """The flags `given` (a shell line or a list of words) for agent's CLI, normalized; Fail says what's wrong."""
    if agent not in TABLES:
        raise Fail(f"Extra flags are for Claude Code and Codex, not {agent}.")
    known, short, refused = TABLES[agent]
    if isinstance(given, str):
        try:
            words = shlex.split(given)
        except ValueError as e:
            raise Fail(f"Those flags don't parse: {e}.")
    else:
        words = [str(w) for w in given or []]
    out, i = [], 0
    while i < len(words):
        w = words[i]
        i += 1
        if not w.startswith("-") or w in ("-", "--"):
            raise Fail(f"{w!r} isn't a flag: extra flags are flags of {NAMES[agent]}, each with its value (no prompt or command).")
        name, eq, val = w.partition("=")
        if not name.startswith("--"):
            if len(name) > 2 and not eq:  # -nfoo
                name, eq, val = name[:2], "=", name[2:]
            name = short.get(name, name)
        why = refused.get(name)
        if why:
            raise Fail(f"{name} can't be an extra flag: {why}.")
        arity = known.get(name) or help_flags(agent).get(name)
        if not arity:
            raise Fail(f"{NAMES[agent]} has no {name} flag (see `{agent} --help`" + (", and Claude Code's CLI reference" if agent == "claude" else "") + f").")
        if arity == N:
            if eq:
                raise Fail(f"{name} takes no value.")
            out.append(name)
            continue
        vals = [val] if eq else []
        if not eq and i < len(words) and not words[i].startswith("-"):
            vals.append(words[i])
            i += 1
            while arity == MANY and i < len(words) and not words[i].startswith("-"):
                vals.append(words[i])
                i += 1
        if arity in (ONE, MANY) and (not vals or vals == [""]):
            raise Fail(f"{name} needs a value, like {name} <value>.")
        if arity == OPT and not vals:
            out.append(name)
            continue
        for v in vals:
            if agent == "codex" and name == "--config":
                key = re.split(r"[=.]", v, 1)[0].strip()
                if "=" not in v or not key:
                    raise Fail("--config takes key=value, like -c model_verbosity=\"high\".")
                if key in CODEX_KEYS:
                    raise Fail(f"-c {key} can't be an extra flag: {CODEX_KEYS[key]}.")
            out.append(f"{name}={v}")
    return out


def clean(agent, given):
    """The flags in `given` that still pass (a settings file edited by hand, a CLI updated since): a launch never
    breaks on one of them. Dropped ones are left out quietly; `parse` is where they're refused."""
    out = []
    for w in given or []:
        try:
            out += parse(agent, [w])
        except Fail:
            pass
    return out


def words(flags):
    """The flags as one shell line, for the brief and the web app: `--advisor=opus --add-dir='/my dir'`."""
    return shlex.join(flags or [])


def extra(agent, argv):
    """The extra flags in an agent's argv (those parse takes as they are written): what the Settings block shows."""
    if agent not in TABLES:
        return []
    known, _, _ = TABLES[agent]
    out = []
    for w in argv[1:]:
        name = str(w).partition("=")[0]
        if name in known or (name.startswith("--") and name in _help.get(agent, {})):
            if agent == "codex" and name == "--config" and "=" not in str(w).partition("=")[2]:
                continue
            if agent == "codex" and name == "--config":
                key = re.split(r"[=.]", str(w).partition("=")[2], 1)[0]
                if key in CODEX_KEYS:
                    continue
            if known.get(name, N) == N or "=" in str(w) or known.get(name) == OPT:
                out.append(str(w))
    return out


def cmd_flags(args):
    """herdr-task flags --agent claude -- --advisor opus: the flags checked and normalized (Settings › Tasks saves
    a space's own through this)."""
    from .output import say
    given = list(args.words or [])
    if given[:1] == ["--"]:
        given = given[1:]
    out = parse(args.agent, given[0] if len(given) == 1 else given)
    say(args, {"agent": args.agent, "flags": out, "words": words(out)}, words(out) or "(none)")
