"""Starting agents: their argv, labels, brief, tab and coordinator.

The launch allow-list ("an agent's own herdr-task commands never ask": OWN, own_rules, own_argv,
cmd_allow) is the one place an agent's launch is given commands it may run without asking; allow
another command (herdr-secret's, say) there."""

import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import time

from .base import ASK_HOME, ENTRY, Fail, git, hc_json, HOME, now, run, SHARE, WORKTREES
from .settings import agent_key, ASSISTANT_TEMPLATES, cli_env, CLAUDE_PROFILE, REVIEW_TOOLS, codex_too_old, codex_update_words, bare, BRANCH_PATTERN, branch_pattern_problem, keep_review, notes, notes_part, review_limits, settings_block, settings_for, TEMPLATES
from .templates import instructions
from .agents import detail, LINE_MAX, live_agents, ROW_MAX, SUMMARY_MAX
from .github import finish, remote_of
from .guard import guard_argv
from .browsers import browser_env, browser_line, browser_path, desktop_path


# ---- an agent's own herdr-task commands never ask -------------------------------------------
# As Shepherdr: at each launch the agent is allowed exactly this herdr-task's path, verb by verb,
# without touching the person's CLI settings: Claude Code in the --settings it gets at launch,
# Codex through a PermissionRequest hook given with -c (`herdr-task _allow` answers it, and hands
# anything else to the chat's card: ask_card).

# How long Codex waits on the permission hook: as the chat's card waits (ask-hook.sh).
ASK_TIMEOUT = 1800
OWN = ["ready", "reviewed", "status", "alert", "feedback", "show", "list", "where", "tell-assistant"]
# herdr-secret's agent commands (~/.config/herdr-app/bin/herdr-secret): asking for a secret and
# using one by name never ask either, as Shepherdr's secret commands. Written by its full path or
# its bare name. Reviewers get none (launch() skips own_argv for them; herdr-secret refuses them).
SECRET = ["ask", "cancel", "run", "env", "list"]
# herdr-artifact's verbs a worker uses for its proof (#866): Codex's sandbox can't write its store,
# so they run escalated and never ask either. Never --custom (a panel installs code in the window).
ARTIFACT = ["guide", "new", "publish", "update", "show", "list", "link", "preview", "where"]
# Committing as it goes (#866): Codex keeps every .git read-only in its sandbox, a worktree's
# (the main checkout's .git) too, so a Codex worker's `git add`/`git commit` run escalated. Only
# these, as one plain command with no git options before the verb (-c, -C, --git-dir...).
GIT = ["add", "commit"]


def secret_path():
    """herdr-secret on PATH (~/.local/bin, here or on another machine), else None."""
    return shutil.which("herdr-secret")


def own_path():
    """This herdr-task as agents write it: the one on PATH when that is this file, else this file."""
    me = ENTRY
    found = shutil.which("herdr-task")
    return found if found and os.path.realpath(found) == me else me


def own_rules(path):
    """Claude's allow rules for this exact path; a path a rule can't state literally gets none."""
    if not re.fullmatch(r"[\w@%+=:,./-]+", path):
        return []
    rules = [f"Bash({path} {verb}:*)" for verb in OWN]
    sp = secret_path()
    for p in [sp, "herdr-secret"] if sp and re.fullmatch(r"[\w@%+=:,./-]+", sp) else []:
        rules += [f"Bash({p} {verb}:*)" for verb in SECRET]
    # The task's browser (HERD-57): every herdr-browser command, as the brief writes it.
    bp = browser_path()
    for p in [bp, "herdr-browser"] if bp and re.fullmatch(r"[\w@%+=:,./-]+", bp) else []:
        rules += [f"Bash({p}:*)"]
    dp = desktop_path()  # its desktop, the same
    for p in [dp, "herdr-desktop"] if dp and re.fullmatch(r"[\w@%+=:,./-]+", dp) else []:
        rules += [f"Bash({p}:*)"]
    return rules


def ask_command(path):
    """Claude's PermissionRequest hook: allow its own commands, ask on the card for the rest."""
    return f"{shlex.quote(sys.executable)} {shlex.quote(ENTRY)} _allow --command {shlex.quote(path)}"


def codex_ask_command():
    """Keep the Codex declaration stable across upgrades and permission modes. Codex hashes
    this command and its timeout. The installed executable's shebang chooses the interpreter."""
    executable = shlex.quote(ENTRY)
    return f"{executable} _allow --command {executable} --sandboxed"


def codex_auto_review(argv):
    return any(a in ("--approve-for-me", "--not-so-yolo") for a in argv)


def artifact_path():
    """herdr-artifact on PATH, else None."""
    return shutil.which("herdr-artifact")


def own_argv(argv, folder=None):
    """An agent's argv with its own herdr-task commands allowed and its asks on the chat's card
    (Claude Code and Codex). SHEP-139: a Claude worker gets the card's hook in its --settings too,
    so a machine whose ~/.claude/settings.json lacks Shepherdr's hook (one that only runs tasks)
    still asks on the card; ask-hook.sh's own copy steps aside for it."""
    path, out = own_path(), list(argv)
    k = agent_key(out)
    if k == "claude":
        if dont_ask_default(out, folder):
            out = out[:1] + ["--permission-mode", "default"] + out[1:]
        rules = own_rules(path)
        hook = {"hooks": [{"type": "command", "command": ask_command(path), "timeout": ASK_TIMEOUT}]}
        cur, i = {}, None
        if "--settings" in out[:-1]:
            i = out.index("--settings")
            try:
                cur = json.loads(out[i + 1])
            except ValueError:
                try:
                    with open(os.path.expanduser(out[i + 1])) as f:
                        cur = json.load(f)
                except (OSError, ValueError):
                    cur = None
            if not isinstance(cur, dict):
                # a settings file it can't read: left as it is, and these go in a --settings of their own
                cur, i = {}, None
        merged = dict(cur)
        if rules:
            perms = dict(cur.get("permissions") or {})
            perms["allow"] = list(perms.get("allow") or []) + [r for r in rules if r not in (perms.get("allow") or [])]
            merged["permissions"] = perms
        hooks = dict(cur.get("hooks") or {}) if isinstance(cur.get("hooks"), dict) else {}
        asks = list(hooks.get("PermissionRequest") or [])
        if not any(" _allow --command " in str(h.get("command", "")) for e in asks if isinstance(e, dict)
                   for h in e.get("hooks") or [] if isinstance(h, dict)):
            asks.append(hook)
        hooks["PermissionRequest"] = asks
        merged["hooks"] = hooks
        # #1021: a Ready worker rests for hours; Claude Code's idle compaction would start a turn
        # nobody asked for about hourly, and each one flips the task back to Working.
        merged.setdefault("idleCompaction", False)
        if i is not None:
            out[i + 1] = json.dumps(merged)
            return out
        return out[:1] + ["--settings", json.dumps(merged)] + out[1:]
    if k == "codex":
        hook = codex_ask_command()
        # Codex gives the person the choice of trusting the folder and this hook.
        return out[:1] + ["-c", f"hooks.PermissionRequest=[{{hooks=[{{type=\"command\",command={json.dumps(hook)},timeout={ASK_TIMEOUT}}}]}}]"] + out[1:]
    return out


# One plain word: no expansion, redirect, separator or line break outside quotes, nor $ or ` inside.
WORD = re.compile(r"""(?:[\w@%+=:,./-]+|'[^']*'|"(?:[^"\\$`]|\\["\\])*")+""")
UNQUOTE = re.compile(r"""'([^']*)'|"((?:[^"\\]|\\.)*)\"""")


def own_command(path, text, sandboxed=False):
    """Whether a shell command is exactly one of this herdr-task's own verbs: one simple command,
    nothing that expands, redirects or chains (as Shepherdr's ownCommand). sandboxed (a Codex
    worker's): herdr-artifact's proof verbs and git add/commit too."""
    if not isinstance(text, str):
        return False
    task = os.environ.get("HERDR_BROWSER_TASK") or ""
    if sandboxed and re.fullmatch(r"[\w#.@-]+", task):
        # the reviewer's label as the brief writes it, its one variable: this worker's own task
        text = text.replace('"herdr.task=$HERDR_BROWSER_TASK"', f'"herdr.task={task}"')
    if sandboxed and "$" in text:
        # #1228: the reviewer's PATH as the brief writes it (its CLI's own folders, then $PATH), only exactly that;
        # #1131: a Claude reviewer's the worker's own CLAUDE_CONFIG_DIR too (CLAUDE_PROFILE)
        for who in REVIEWERS:
            pre = cli_env(who)
            for env in ((pre or "env ") + CLAUDE_PROFILE,) if who == "claude" else (pre,):
                if env and f"-- {env}{who} " in text:
                    text = text.replace(f"-- {env}{who} ", f"-- env PATH=@herdr-reviewer {who} ", 1)
    words, at, text = [], 0, text.strip()
    while at < len(text):
        if text[at] in " \t":
            at += 1
            continue
        m = WORD.match(text, at)
        if not m:
            return False
        words.append(UNQUOTE.sub(lambda g: g.group(1) if g.group(1) is not None else re.sub(r"\\(.)", r"\1", g.group(2)), m.group(0)))
        at = m.end()
    if words:
        # #1098: a tool written by its full path (or the bare name of the one on PATH) is the same tool
        words[0] = tool_name(words[0], path)
    if len(words) >= 2 and words[0] == "@herdr-task" and words[1] in OWN:
        return True
    if len(words) >= 2 and words[0] == "@herdr-browser" and browser_path():
        return True
    if len(words) >= 2 and words[0] == "@herdr-desktop" and desktop_path():
        return True
    if sandboxed and len(words) >= 2 and words[0] == "@herdr-artifact" and words[1] in ARTIFACT and "--custom" not in words:
        return True
    if sandboxed and len(words) >= 2 and words[0] == "git" and words[1] in GIT:
        return True
    if sandboxed and words and words[0] == "@hc" and helper_hc(words):
        return True
    return bool(secret_path()) and len(words) >= 2 and words[0] == "@herdr-secret" and words[1] in SECRET


def tool_name(word, path):
    """The tool a command's first word runs, as "@<name>" when it is one own_command knows: this herdr-task (its path, or the bare
    name when PATH's is this one), herdr-browser, herdr-desktop, herdr-artifact, herdr-secret or hc by their path on PATH or their
    bare name (#1098: a Codex worker's full-path `/…/hc read` asked and hung, the bare one didn't); else the word."""
    real = lambda p: os.path.realpath(os.path.expanduser(p)) if p else None  # noqa: E731
    if word == path or (word == "herdr-task" and real(shutil.which("herdr-task")) == real(path)):
        return "@herdr-task"
    if word in ("herdr-browser", "herdr-desktop", "herdr-artifact", "herdr-secret", "hc"):
        return "@" + word
    if os.sep not in word:
        return word
    for name, at in (("herdr-browser", browser_path()), ("herdr-desktop", desktop_path()), ("herdr-artifact", artifact_path()),
                     ("herdr-secret", secret_path()), ("hc", shutil.which("hc"))):
        if at and (word == at or real(word) == real(at)):
            return "@" + name
    return word


# A Codex worker's review (#866): its sandbox can't reach hc, so starting, waiting on, reading and
# ending its reviewer run escalated. Only a read-only reviewer as the brief's Reviewer line gives it,
# and only its own helpers (<task>-review, -helper) to wait on, read or end.
REVIEWERS = {"codex": (["codex", "--no-daemon", "--sandbox", "read-only", "--ask-for-approval", "never"],
                       {"--disable": re.compile(r"hooks"), "-m": re.compile(r"[\w.:-]+"),
                        "-c": re.compile(r'model_reasoning_effort="?\w+"?')}),
             "claude": (["claude", "--permission-mode", "dontAsk", "--tools=" + REVIEW_TOOLS, "--strict-mcp-config"],
                        {"--model": re.compile(r"[\w.:\[\]-]+"), "--effort": re.compile(r"\w+"),
                         # #1458: its templates folder, one word (a brief from before it has none)
                         "--add-dir=": re.compile(re.escape(TEMPLATES))})}
HELPER = re.compile(r"[\w.-]+-(?:review|helper)(?:-[\w.-]+)?")


def helper_hc(words):
    """Whether `hc ...` is a worker's own reviewer: run as the brief says, or waited on, read, looked up (#1136), ended.
    Never `hc keys` on it: its trust or sign-in screen is the person's to answer (AGENTS.md "Nothing that risks a ban")."""
    if len(words) >= 3 and words[1] in ("wait", "read", "kill", "get"):
        return bool(HELPER.fullmatch(words[2])) and all(w.startswith("--") or re.fullmatch(r"\d+", w) for w in words[3:])
    if len(words) < 4 or words[1] != "run" or "--" not in words:
        return False
    i = words.index("--")
    opts, cmd = words[2:i], words[i + 1:]
    if cmd[:2] == ["env", "PATH=@herdr-reviewer"]:
        cmd = cmd[2:]
    j = 0
    while j < len(opts):
        if opts[j] == "--bg":
            j += 1
        elif opts[j] == "--name" and j + 1 < len(opts) and HELPER.fullmatch(opts[j + 1]):
            j += 2
        elif opts[j] == "--label" and j + 1 < len(opts) and re.fullmatch(r"herdr\.(?:task=[\w#.@-]+|role=(?:reviewer|helper)|agent=(?:codex|claude))", opts[j + 1]):
            j += 2
        else:
            return False
    for base, flags in REVIEWERS.values():
        if cmd[:len(base)] != base:
            continue
        rest = cmd[len(base):]
        k = 0
        while k < len(rest) - 1:
            flag, _, value = rest[k].partition("=")
            if flag + "=" in flags and _:
                # --flag=value, one word
                if not flags[flag + "="].fullmatch(value):
                    return False
                k += 1
                continue
            if rest[k] not in flags or rest[k].endswith("="):
                break
            if not flags[rest[k]].fullmatch(rest[k + 1]):
                return False
            k += 2
        return len(rest) - k <= 1 and not (rest[k:] and rest[k].startswith("-"))
    return False


def ask_hook():
    """The chat's question-card hook: Shepherdr's own (<SHARE>/hooks/ask-hook.sh, beside this herdr-task's
    install; in a checkout the repo's), else the copy a sync left on a machine that only runs tasks (ASK_HOME);
    None when there's neither."""
    for p in (os.path.join(SHARE, "hooks", "ask-hook.sh"), os.path.join(os.path.expanduser("~"), ASK_HOME, "ask-hook.sh")):
        if os.path.isfile(p):
            return p
    return None


def ask_card(raw):
    """What the chat's card answers for a request (SHEP-91: a Codex worker's permission is answerable
    in its chat, on the web too), or "" (no decision: Codex asks in its terminal). Codex runs every
    hook it has and waits for all, so ask-hook.sh's own copy (~/.codex/hooks.json) steps aside for
    an agent with this hook, and this one runs it, marked HERDR_ASK_CHAINED."""
    hook = ask_hook()
    if not hook:
        return ""
    try:
        r = subprocess.run(["sh", hook], input=raw, capture_output=True, timeout=ASK_TIMEOUT - 10,
                           env={**os.environ, "HERDR_ASK_CHAINED": "1"})
    except (OSError, subprocess.SubprocessError):
        return ""
    out = r.stdout.decode("utf-8", "replace").strip()
    try:
        json.loads(out)
    except ValueError:
        return ""
    return out


def cmd_allow(args):
    """The PermissionRequest hook of a task worker (Claude Code and Codex, own_argv): allows this
    launch's own herdr-task commands; anything else goes to the chat's card (ask_card), and without
    one's answer the agent asks in its terminal. Approve for me is passed in the worker's
    environment, with the old --auto-review flag still accepted for workers already running."""
    raw = sys.stdin.buffer.read(1 << 20)
    try:
        data = json.loads(raw or b"{}")
    except ValueError:
        return
    if os.environ.get("HERDR_TASK_HOOK_LOG"):
        with open(os.environ["HERDR_TASK_HOOK_LOG"], "a") as f:
            f.write(json.dumps(data) + "\n")
    cmd = (data.get("tool_input") or {}).get("command") if isinstance(data.get("tool_input"), dict) else None
    if isinstance(cmd, list):
        # ["bash", "-lc", "<command>"] as some tools pass it.
        cmd = cmd[2] if len(cmd) == 3 and cmd[1] in ("-c", "-lc") else shlex.join(cmd)
    if own_command(args.command, cmd, getattr(args, "sandboxed", False)):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}))
        return
    if getattr(args, "auto_review", False) or (
            getattr(args, "sandboxed", False) and os.environ.get("HERDR_TASK_CODEX_AUTO_REVIEW") == "1"):
        # #1464: Codex's Approve for me. No decision: its automatic review answers (a safe step runs, a risky one is
        # refused and the worker is told to ask the person), never a card waiting on the person first.
        return
    out = ask_card(raw)
    if out:
        print(out)


# ---- starting agents ------------------------------------------------------------------------


def claude_mode(argv, folder=None):
    """The permission mode a new Claude Code session would start in (#1056): argv's own flag, else the defaultMode of
    its --settings, the folder's .claude/settings.local.json and .claude/settings.json, then the person's
    (CLAUDE_CONFIG_DIR or ~/.claude), as Claude Code ranks them; "default" when none says. A task worker never takes
    a settings default of dontAsk (#1110: refused every edit and command, its question card too, with nobody to
    answer): "default" instead, which asks on the chat's card."""
    for i, a in enumerate(argv):
        if a == "--dangerously-skip-permissions":
            return None
        if a == "--permission-mode" and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith("--permission-mode="):
            return a.split("=", 1)[1]
    mode = settings_mode(argv, folder)
    return "default" if mode == DONT_ASK else mode


DONT_ASK = "dontAsk"


def dont_ask_default(argv, folder=None):
    """Whether this Claude worker would start in don't-ask mode from the person's settings alone (#1110), argv saying
    no mode of its own: own_argv then starts it in the default mode, and its start says so."""
    if agent_key(argv) != "claude":
        return False
    if any(a in ("--dangerously-skip-permissions", "--permission-mode") or str(a).startswith("--permission-mode=") for a in argv):
        return False
    return settings_mode(argv, folder) == DONT_ASK


def settings_mode(argv, folder=None):
    """The defaultMode Claude Code takes from its settings (claude_mode's order), "default" when none says."""
    found = []
    for i, a in enumerate(argv[:-1]):
        if a == "--settings":
            found.append(argv[i + 1])
    home = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
    files = ([os.path.join(folder, ".claude", "settings.local.json"), os.path.join(folder, ".claude", "settings.json")] if folder else []) \
        + [os.path.join(home, "settings.json")]
    for src in found + files:
        try:
            if src.lstrip().startswith("{"):
                d = json.loads(src)
            else:
                with open(os.path.expanduser(src)) as f:
                    d = json.load(f)
        except (OSError, ValueError):
            continue
        mode = ((d.get("permissions") or {}) if isinstance(d, dict) else {}).get("defaultMode")
        if isinstance(mode, str) and mode:
            return mode
    return "default"


def resume_argv(argv, session, folder=None):
    """argv resuming `session`. Claude Code brings a resumed session back in the permission mode it ended in (#1056: a
    switch replacing a stuck agent came up in plan or ask mode, not the person's auto): the mode a new one would get
    is said, unless argv already says one."""
    k = agent_key(argv)
    if k == "claude":
        mode = claude_mode(argv, folder)
        has = mode is None or any(a == "--permission-mode" or a.startswith("--permission-mode=") for a in argv)
        return argv + ([] if has else ["--permission-mode", mode]) + ["--resume", session]
    if k == "codex":
        return [argv[0], "resume"] + argv[1:] + [session]
    return None


# ---- agents never inherit a parent Claude Code session (SHEP-86) ------------------------------
# herdr-core's holder keeps the environment of whatever started it, and every terminal gets it: a
# holder started from inside Claude Code hands each agent CLAUDECODE, CLAUDE_PID and
# CLAUDE_CODE_CHILD_SESSION, SESSION_ID, MESSAGING_*... Claude Code then saves no transcript (the
# web Chat can't find the conversation) and skips the folder-trust prompt. hc can only add
# variables, so the launch unsets them first: CLAUDECODE, CLAUDE_PID and CLAUDE_CODE_*, keeping the
# person's own Claude Code config (_USE_*, _SKIP_*, _DISABLE_*, _OAUTH_*..., CLAUDE_CONFIG_DIR).
# The same line is core/clean-env.js CLEAN_ENV and mods/coordinator/restart.sh's (test_repo keeps
# them equal).
CLEAN_ENV = ("for v in $(env | sed -nE 's/^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_[A-Za-z0-9_]+)=.*/\\1/p' | "
             "grep -vE '^CLAUDE_CODE_(USE|SKIP|DISABLE|ENABLE|MAX|OAUTH|CLIENT|API)_'); do unset \"$v\"; done;")


def clean_env(argv):
    """argv run without a parent Claude Code session's markers (CLEAN_ENV)."""
    return ["sh", "-c", CLEAN_ENV + ' exec "$@"', "herdr-clean", *argv]


def in_shell(argv):
    """Runs the agent in the person's interactive shell, as Herdr does: their functions and
    aliases apply (claude() adding flags), and the shell stays when the agent exits."""
    sh = os.environ.get("SHELL") or "/bin/sh"
    name = os.path.basename(sh)
    flag = "-lic" if sys.platform == "darwin" else "-ic"
    if name in ("bash", "zsh", "sh", "ksh", "dash"):
        return [sh, flag, '"$@"; exec "$0" -i', sh] + argv
    if name == "fish":
        return [sh, flag, " ".join(shlex.quote(a) for a in argv) + "; exec fish -i"]
    return argv


# ---- workers run at low priority (HERD-61) ---------------------------------------------------
# So agents never take the machine down: a task's worker and reviewer start below everything else
# (Settings > Machines "Workers run at low priority", on unless turned off): CPU nice 10, IO
# best-effort 7, and an OOM score of +500, so under memory pressure the kernel ends a worker
# first, never herdr-core's holder or an Assistant. Where systemd's user manager runs, each worker
# also gets its own scope (with the optional per-worker memory cap as MemoryHigh), so oomd, which
# ends whole cgroups, ends that worker rather than the holder that keeps every terminal. On a Mac:
# nice 10 alone. #1109: never the utility QoS clamp (taskpolicy -c utility): on a busy Mac it made a
# worker's lane echo keys 20 to 100 times slower for the person typing in it. Anything missing is
# skipped, never fatal.

LOW = ('{ echo 500 > /proc/self/oom_score_adj; } 2>/dev/null; '
       'command -v ionice >/dev/null 2>&1 && ionice -c2 -n7 -p $$ >/dev/null 2>&1; '
       'exec nice -n 10 "$@"')
_scope = {}


def scope_argv():
    """systemd-run's words for a scope of its own under the user manager, or None where there's
    none. systemd 254+ expands $ in the command unless told not to: checked once, by running."""
    if "argv" in _scope:
        return _scope["argv"]
    _scope["argv"] = None
    if sys.platform.startswith("linux") and shutil.which("systemd-run"):
        for extra in (["--expand-environment=no"], []):
            argv = ["systemd-run", "--user", "--scope", "--quiet", "--collect", *extra]
            try:
                r = subprocess.run(argv + ["--", "sh", "-c", 'echo "$0"', "herdr-ok"], stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, universal_newlines=True, timeout=10)
            except (OSError, subprocess.SubprocessError):
                break
            if r.returncode == 0 and r.stdout.strip() == "herdr-ok":
                _scope["argv"] = argv
                break
    return _scope["argv"]


def low_priority(argv, name):
    """argv started low (LOW), in a scope of its own where there is one; as is when the person
    turned it off."""
    from .settings import machine_option
    if machine_option("low_priority", True) is False or sys.platform.startswith("win"):
        return argv
    out = ["sh", "-c", LOW, "herdr-low", *argv]
    scope = scope_argv()
    if scope:
        cap = machine_option("worker_memory")
        unit = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"herdr-{name}-{secrets.token_hex(3)}")
        out = [*scope, f"--unit={unit}", *([f"--property=MemoryHigh={int(cap)}G"] if isinstance(cap, (int, float)) and cap > 0 else []),
               "--", *out]
    return out


def caller_labels():
    me = os.environ.get("HC_TERMINAL_ID")
    k = hc_json("get", me) if me else None
    return (k or {}).get("labels") or {}


def caller_space():
    """The caller's own space from its labels (a pane's, a coordinator's behind a chat, a task
    agent's), or None."""
    labels = caller_labels()
    return labels.get("herdr.space") or labels.get("herdr.coordinator.space") or labels.get("herdr.task.space") or None


def default_space():
    """The caller's space: its pane's, a coordinator's behind a chat, or a pane-less task agent's."""
    labels = caller_labels()
    sp = labels.get("herdr.space") or labels.get("herdr.coordinator.space") or labels.get("herdr.task.space")
    if sp:
        return sp
    raise Fail("Which space? Pass --space <space id>.")


def core_spaces():
    """This machine's spaces as Shepherdr keeps them: [{id, folder, ...}] from herdr-core's shared document in
    Shepherdr's own session (its docs.json, read as a file). 3.2 has no Herdr window to ask."""
    from .base import SESSION
    path = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state"),
                        "herdr-core", SESSION, "docs.json")
    try:
        with open(path) as f:
            spaces = ((json.load(f).get("herdr-app") or {}).get("value") or {}).get("spaces") or []
    except (OSError, ValueError, AttributeError):
        return []
    return [x for x in spaces if isinstance(x, dict) and x.get("id") and "/" not in str(x["id"]) and not x.get("machine") and x.get("folder")]


def _at_home(folder):
    return bool(folder) and os.path.realpath(os.path.expanduser(folder)) == os.path.realpath(HOME)


def everything_of(spaces):
    """Everything's id among this machine's spaces ([{id, folder}], as core/spaces.js everythingOf): of those in the home
    folder, id "home", else the smallest. None: none there."""
    there = sorted(str(x["id"]) for x in spaces if _at_home(x.get("folder")))
    return "home" if "home" in there else (there[0] if there else None)


def tilde_of(spaces):
    """This machine's own ~ space beside Everything in the home folder (3.2.8; core/spaces.js tildeOf), or None."""
    every = everything_of(spaces)
    there = sorted(str(x["id"]) for x in spaces if _at_home(x.get("folder")) and str(x["id"]) != every)
    return "tilde" if "tilde" in there else (there[0] if there else None)


def _inside(path, top):
    p, t = os.path.realpath(os.path.expanduser(path)), os.path.realpath(os.path.expanduser(top))
    return p == t or p.startswith(t.rstrip("/") + "/")


def space_for_folder(folder, caller=None):
    """The space a task in `folder` (its repo) belongs to when no --space says (GitHub #1209): the caller's when its
    folder is in that repo, else the one space on this machine whose folder is, so its news goes to that space's
    Assistant, not to the Assistant that happened to start it. None: no single space (core_spaces)."""
    if not folder:
        return None
    spaces = core_spaces()
    if caller and any(x["id"] == bare(caller) and _inside(x["folder"], folder) for x in spaces):
        return bare(caller)
    own = [x["id"] for x in spaces if _inside(x["folder"], folder)]
    return own[0] if len(own) == 1 else None


def tab_title(s, task):
    return " ".join(str(task.get("title") or "").split())


def name_tab(tab, title):
    """3.2: there is no Herdr window, so no tab to name here (an agent started by an older version may still
    carry a herdr.tab label): never named."""
    return False


def name_tabs(pairs):
    """Names tabs [(tab, name)]; returns the ones left for the machine with the window (a call
    through --on names them from there)."""
    return [{"tab": tab, "name": name} for tab, name in pairs if tab and not name_tab(tab, name)]


def task_tabs(s, task):
    """The tabs its live agents are in (hc ls leaves labels out: hc get has them)."""
    return sorted({(detail(k).get("labels") or {}).get("herdr.tab") for k in live_agents(s.key(task))} - {None})


def retag_tabs(s):
    """After the prefix changes: each running task's tab starts with its new id. A name someone
    gave the tab is kept, only its old id ("#4", "HAT-4") swapped; elsewhere the id goes in front."""
    names = {}  # 3.2: no window to ask for the tabs' names
    pairs = []
    for t in s.data["tasks"]:
        for tab in task_tabs(s, t):
            old = names.get(tab)
            if old is None or re.fullmatch(r"\d+", old):
                pairs.append((tab, tab_title(s, t)))
                continue
            rest = re.sub(r"^(#\d+|[A-Z]+\d*-\d+)\s*", "", old)
            pairs.append((tab, rest or tab_title(s, t)))
    return name_tabs(pairs)


def closing_line(s, task, parent=None, argv=None):
    """How the worker finishes: every task, worktree or in the folder, says ready with a summary.
    It names this herdr-task by its full path: only that form runs without asking (own_argv)."""
    done = "finished and committed" if task.get("mode") == "worktree" else "finished"
    ht = own_path()
    text = (f"When the work is {done}, run `{ht} ready {s.ref(task)} --folder {shlex.quote(s.loc['folder'])} "
            f"--summary \"<what the person now sees or can do, plain words, at most {SUMMARY_MAX} characters>\"` (optionally "
            f"`--details \"<a few short bullets in plain words, one per line: what changed for the person first, then how it was checked>\"`; with `--agents-md \"<one line>\"` when you learned something "
            f"about setting up or testing this repo that its AGENTS.md lacks). The person marks it as done from there; never mark it done yourself.")
    if task.get("mode") == "worktree":
        # SHEP-320: tasks run in parallel, also on the same files: catching up with its base is part of finishing
        base = task.get("base") or "main"
        text += (f" Other tasks run in parallel and may merge into {base} meanwhile: before ready, fetch and rebase your "
                 f"branch onto {base}'s newest (`git fetch`, then `git rebase {remote_of(s.loc['folder'])}/{base}`, or "
                 f"`git rebase {base}` without a remote) and resolve what collides; ready refuses a branch that conflicts "
                 f"with it. Your own branch may be force-pushed with lease, never {base}.")
    on, rounds = review_limits(s, task)
    if on:
        text += (f" Review is on: after each review round, record it on the commit it reviewed with `{ht} reviewed {s.ref(task)} "
                 f"--folder {shlex.quote(s.loc['folder'])} --report \"<its findings in a line>\"` (add `--commit <sha>` if you committed fixes since; at most {rounds} rounds, "
                 f"the number the person asked for: never more); ready refuses a final commit no round was recorded on while "
                 f"rounds are left. Once all {rounds} are used, fix the last round's must-fix findings and say ready without "
                 f"another round, writing in --details that the last fix wasn't reviewed again.")
    text += (f" At the start, at each natural step and at least every 5 minutes while you work, say how it's going: `{ht} status {s.ref(task)} --folder {shlex.quote(s.loc['folder'])} "
             f"\"<what you're doing now, at most {ROW_MAX} characters, a few plain words>\" --done <% of the whole task> --left <your best guess of how long is left, like 20m>`: "
             f"always give `--left`, from your very first status on, from the clock, not a feeling: `date +%s` once at the start, again "
             f"at each status, then minutes worked x (100 - done) / done, in your own working minutes and hours, never a person's "
             f"days; revise it honestly each time by as much as you were off; a rough guess beats none.")
    text += (f" Only for what truly can't wait, `{ht} alert \"<what, a few words>\" --body \"<why>\"` reaches the person at once "
             f"(a toast and a sound); a question waits in your chat instead.")
    from .feedback import feedback_on
    if feedback_on(task.get("space")):
        text += (f" A problem in Shepherdr itself, not this task's code: `{ht} feedback \"<one line>\" --details \"<goal, what was "
                 f"tried, what went wrong, expected, suggested fix>\"` returns at once and your Assistant offers the person to file "
                 f"it; carry on.")
    text += (f" Your herdr-task command is {ht}: write that full path each time (never the bare name), as one plain command; "
             f"then its {', '.join(OWN)} commands run without asking.")
    text += browser_line()
    if secret_path():
        text += (" Secrets (keys, tokens, passwords) are used by name, never seen: `herdr-secret ask NAME --why \"…\"` "
                 "(then end your turn), `herdr-secret cancel NAME` once you no longer need it, `herdr-secret run NAME -- <command>`, "
                 "`herdr-secret list`; these run without asking too.")
    if argv and agent_key(argv) == "codex":
        # #1136 #1142: run in the sandbox, hc can't open Herdr's core and the browser's socket folder is read-only
        text += (" Codex's sandbox can't reach Herdr nor write git's data, so give those commands, herdr-browser's (your task's "
                 "browser), herdr-desktop's (your desktop), herdr-artifact's (your proof), `git add`/`git commit` and your review's `hc run`/`hc wait`/`hc read`/"
                 "`hc get`/`hc kill` (its prompt in single quotes), `git fetch`/`git rebase` "
                 "sandbox_permissions \"require_escalated\" from the first try, each as one plain command (no && chains, no $(…), "
                 "no git options before the verb): then they run without asking.")
    # No "report to your coordinator": Herdr tells the Assistant itself (news_pass).
    return text


def where_line(task):
    if not task.get("worktree"):
        return ""
    base = f", from {task['base']}, which it merges into" if task.get("base") else ""
    line = f"You work in {task['worktree']} on branch {task['branch']}{base}."
    pr = task.get("pr") or {}
    if pr.get("taken"):
        # --pr (#1155): never a second pull request; its agent should know where its work goes.
        on = f" (branch {pr['branch']})" if pr.get("branch") else ""
        line += (f" This task took pull request #{pr['number']}{on}, {pr.get('url') or ''}: ready pushes your commits there "
                 "and its checks and review come to you; don't open another.")
    return line


def brief(s, task, parent=None, space=None, argv=None):
    instructions("reviewer")  # the file its review's reviewer gets (WORKER_MD)
    keep_review(s, task, space)
    start = notes_part("Before you start", notes(s, task, "start", space))
    if start and task.get("worktree"):
        start += f"\n(The main folder is {s.loc['folder']}.)"
    body = "Your task, " + s.name(task) + ":\n" + ((task.get("prompt") or "").strip() or task["title"])
    finish = notes_part("Before you say ready", notes(s, task, "finish", space))
    return "\n\n".join(x for x in [instructions("worker"), start, body, where_line(task), finish, closing_line(s, task, parent, argv),
                                    settings_block(s, task, space, argv, live=True)] if x)


def handoff(s, task, prev, parent=None, argv=None):
    lines = [f"You are taking over the task {s.name(task)} from another agent.", instructions("worker")]
    lines.append(where_line(task))
    lines.append("The task:\n" + ((task.get("prompt") or "").strip() or task["title"]))
    if prev and prev.get("log"):
        lines.append(f"The previous agent ({prev.get('agent') or 'agent'}) kept its session log at {prev['log']}: read the recent part to pick up where it left off.")
    elif prev:
        lines.append(f"The previous agent ({prev.get('agent') or 'agent'}) left no session log; check the folder's state (git status, git log) before you continue.")
    lines.append(notes_part("Before you continue, if it isn't done yet", notes(s, task, "start")))
    lines.append(notes_part("Before you say ready", notes(s, task, "finish")))
    lines.append(closing_line(s, task, parent, argv))
    lines.append(settings_block(s, task, None, argv, live=True))
    return "\n\n".join(x for x in lines if x)


DETACHED = ("{folder} is on a detached commit, so this task has no branch to start from and merge into. Check out a "
            "branch there, or give the task one with --base <branch>.")


def current_base(main):
    """The folder's base: the branch checked out in it (else its commit)."""
    ok, base, _ = git(main, "symbolic-ref", "--short", "HEAD")
    return base if ok else git(main, "rev-parse", "HEAD")[1]


def base_ref(main, base):
    """A task's own base branch (--base), ready to branch from: the local branch, else the remote's
    (fetched; a local branch is made to track it). Fails when neither has it."""
    if not re.fullmatch(r"[\w./@+-]+", base) or base.startswith("-"):
        raise Fail(f"{base!r} isn't a branch name.")
    if git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{base}")[0]:
        return base
    names = git(main, "remote")[1].split()
    remote = remote_of(main)
    if remote in names:
        git(main, "fetch", remote, base)
        if git(main, "show-ref", "--verify", "--quiet", f"refs/remotes/{remote}/{base}")[0]:
            ok, _, err = git(main, "branch", "--track", base, f"{remote}/{base}")
            if not ok:
                raise Fail(err or f"Couldn't make a local {base}.")
            return base
        raise Fail(f"There is no branch {base} here or on {remote}.")
    raise Fail(f"There is no branch {base} here.")


def git_quick(cwd, *args, timeout=15):
    """git that may reach the network (fetch, ls-remote): never asks for a password and gives up
    after `timeout` seconds, so an offline or slow remote costs a moment, not a hang."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": os.environ.get("GIT_SSH_COMMAND") or "ssh -o BatchMode=yes"}
    try:
        r = subprocess.run(["git", "-C", cwd, *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, env=env, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return False, "", "timed out"
    return r.returncode == 0, r.stdout.strip(), r.stderr.strip()


def fresh_start(main, base):
    """Where a new worktree on `base` starts (#574): the base fetched from the remote first, so a
    task branches from the latest even when others merge on GitHub. The remote's when it holds
    everything the local branch has (the local one is only behind); else the local branch (it has
    work of its own, or the fetch failed: offline, no remote, no such branch there). The folder's
    own checkout is never moved."""
    remote = remote_of(main)
    if remote not in git(main, "remote")[1].split() or not git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{base}")[0]:
        return base
    git_quick(main, "fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{base}:refs/remotes/{remote}/{base}")
    theirs = f"refs/remotes/{remote}/{base}"
    if git(main, "show-ref", "--verify", "--quiet", theirs)[0] and git(main, "merge-base", "--is-ancestor", f"refs/heads/{base}", theirs)[0]:
        return f"{remote}/{base}"
    return base


def branch_problem(main, name):
    """Why `name` can't be a branch (git check-ref-format's rules), or None."""
    if not name or name.startswith("-") or not git(main, "check-ref-format", "--branch", name)[0]:
        return f"{name!r} isn't a valid branch name."
    return None


def branch_taken(s, t, name):
    """Who has branch `name` already: another task here, this repo, or its remote (asked now when
    it answers within seconds, else as git last fetched it). None: it's free."""
    for o in s.data.get("tasks") or []:
        if o is not t and o.get("branch") == name:
            return f"the task {s.name(o)} already uses it"
    main = s.loc["folder"]
    if git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{name}")[0]:
        return "a branch by that name is already here"
    remote = remote_of(main)
    if remote in git(main, "remote")[1].split():
        ok, out, _ = git_quick(main, "ls-remote", "--heads", remote, f"refs/heads/{name}", timeout=10)
        if (ok and out) or (not ok and git(main, "show-ref", "--verify", "--quiet", f"refs/remotes/{remote}/{name}")[0]):
            return f"{remote} already has a branch by that name"
    return None


def set_branch(s, t, name):
    """--branch: the task's exact branch name (#570), e.g. a ticket's ABC-2137, instead of its
    folder's pattern. Checked as git does, and refused when that branch exists already (here, on
    the remote, or another task's): never a silent suffix. "" goes back to the pattern. #1443: once the task has
    started, an existing branch its work is on is adopted (adopt_branch)."""
    if name is None:
        return
    name = name.strip()
    if name and t.get("state") not in ("todo", "scheduled", "queued", None):
        return adopt_branch(s, t, name)
    if t.get("worktree"):
        if name == t.get("branch"):
            return
        raise Fail(f"{s.name(t)} already has its worktree on {t.get('branch')}; its branch can't change now.")
    if not name:
        t.pop("branch", None)
        return
    if t.get("mode") != "worktree":
        raise Fail("--branch is for tasks in a worktree; this one works in the folder itself.")
    if name == t.get("branch"):
        return
    problem = branch_problem(s.loc["folder"], name)
    if problem:
        raise Fail(problem)
    taken = branch_taken(s, t, name)
    if taken:
        raise Fail(f"Branch {name}: {taken}. Pick another name.")
    t["branch"] = name


def branch_for(s, task):
    """A task's branch: its own (--branch), else its folder's pattern (Shepherdr settings > Tasks > Branch names:
    {slug} its title's words, {n} its number, {key} its key), else task/{slug}. SHEP-322: no number in it unless a
    pattern asks for one; a name without {n} or {key} that is taken (here, on the remote, by another task) gets -2,
    -3, ..., and is kept on the task from then on, so it never lands on another task's branch."""
    if task.get("branch"):
        return task["branch"]
    words = re.sub(r"[^a-z0-9]+", "-", task["title"].lower()).strip("-")[:40].strip("-") or "task"
    pattern = str(settings_for(s, task.get("space"))["tasks"].get("branch") or "").strip()
    if not pattern or branch_pattern_problem(pattern):
        pattern = BRANCH_PATTERN
    name = pattern.replace("{n}", str(task["id"])).replace("{key}", s.ref(task)).replace("{slug}", words)
    if branch_problem(s.loc["folder"], name):
        pattern = BRANCH_PATTERN
        name = BRANCH_PATTERN.replace("{slug}", words)
    if "{n}" in pattern or "{key}" in pattern:
        return name
    base, n = name, 1
    while branch_taken(s, task, name) and n < 100:
        n += 1
        name = f"{base}-{n}"
    task["branch"] = name
    return name


def folder_for(s, task):
    if task.get("mode") != "worktree":
        return s.loc["folder"]
    if task.get("worktree") and os.path.isdir(task["worktree"]):
        return task["worktree"]
    if s.loc["kind"] != "repo":
        raise Fail("Worktrees need a git repo. Use --here.")
    main = s.loc["folder"]
    branch = branch_for(s, task)
    # New worktrees under Shepherdr's data (Settings > Tasks > Worktree folder: another root, a bigger disk);
    # a task that has one keeps it wherever it is (git keeps its absolute path).
    root = os.path.expanduser(str(settings_for(s, task.get("space"))["tasks"].get("worktree_root") or "").strip()) or WORKTREES
    path = os.path.join(root, os.path.basename(main), re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-"))
    # #1108: branches such as feature/a and feature-a make the same folder name: one another task has is never taken
    # over (#1023's reuse is for this task's own), this one gets its own beside it.
    if any(o is not task and o.get("worktree") and os.path.realpath(o["worktree"]) == os.path.realpath(path)
           for o in s.data.get("tasks") or []):
        path = f"{path}-{task['id']}"
    fence_node(root)
    # Its own base (--base) branches from that branch; else from what the folder has checked out.
    own = task.get("base") if task.get("base_set") else None
    base = base_ref(main, own) if own else current_base(main)
    have = registered_worktree(main, path)
    if have:
        # #1023: its worktree is still there, registered with this repo, though the task no longer
        # names it (its agent may have switched it to another branch): it goes on there, on the branch
        # checked out now, never a failed "already exists".
        br = have.get("branch") or branch
        base = task.get("base") or base
        start = task.get("start") or git(main, "merge-base", base, have.get("head") or br)[1] or have.get("head")
        task.update(worktree=path, branch=br, base=base, start=start)
        return path
    if not own and not task.get("base") and not (task.get("pr") or {}).get("taken") \
            and not git(main, "symbolic-ref", "--quiet", "HEAD")[0]:
        raise Fail(DETACHED.format(folder=main))  # #1533: no branch to merge into
    exists = git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}")[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    taken = (task.get("pr") or {}).get("branch") if (task.get("pr") or {}).get("taken") else None
    if exists:
        add = ["worktree", "add", path, branch]
    elif taken:
        # --pr (#1155): a pull request already open: its worktree starts from that pull request's branch.
        remote = remote_of(main)
        ok, _, err = git(main, "fetch", "--quiet", "--no-tags", remote, f"+refs/heads/{taken}:refs/remotes/{remote}/{taken}")
        if not ok:
            raise Fail(f"Couldn't fetch {taken}, pull request #{task['pr']['number']}'s branch: {err}")
        ref = f"refs/remotes/{remote}/{taken}"
        task["pr"]["lease"] = git(main, "rev-parse", ref)[1]
        add = ["worktree", "add", "--no-track", "-b", branch, path, ref]
    else:
        # From the base's latest (fetched first); a detached folder (base is a commit) from HEAD.
        branchy = git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{base}")[0]
        add = ["worktree", "add", "--no-track", "-b", branch, path, fresh_start(main, base) if branchy else (own or "HEAD")]
    ok, _, err = git(main, *add)
    if not ok:
        raise Fail(err or "git worktree add failed")
    # Where the branch starts: work past it that turns up in the base branch means merged.
    start = git(path, "rev-parse", "HEAD")[1] if not exists else task.get("start")
    if taken and not exists:
        # Its pull request's commits are its own work (ready, Accept): it starts where they leave its base.
        start = git(main, "merge-base", fresh_start(main, base), start)[1] or start
    task.update(worktree=path, branch=branch, base=task.get("base") or base, start=start)
    return path


NODE_FENCE = b'{"private": true, "description": "Shepherdr: keeps task worktrees off the package.json of a folder above"}\n'


def fence_node(root):
    """GitHub #1132: Node takes a script's module type (and a hook's require()) from the nearest package.json above
    it, and Shepherdr's own (type: module) sits above its default worktrees folder: a repo with none of its own
    would run as ESM in a worktree. A plain one at the worktrees root stops that search there. Only written when a
    package.json above the root would otherwise be found; a person's own file there stays as it is."""
    here = os.path.join(root, "package.json")
    if os.path.lexists(here):
        return
    up = os.path.dirname(os.path.abspath(root))
    while True:
        if os.path.isfile(os.path.join(up, "package.json")):
            break
        nxt = os.path.dirname(up)
        if nxt == up:
            return
        up = nxt
    try:
        os.makedirs(root, exist_ok=True)
        with open(here, "xb") as f:
            f.write(NODE_FENCE)
    except OSError:
        pass


def worktree_list(main):
    """Every worktree git has registered for the repo at main, the main checkout first: [{path, head, branch}]
    (branch None when detached); prunable ones (their folder gone) left out."""
    ok, out, _ = git(main, "worktree", "list", "--porcelain")
    trees = []
    for block in out.split("\n\n") if ok else []:
        rows = dict((ln.split(" ", 1) + [""])[:2] for ln in block.splitlines() if ln.strip())
        if rows.get("worktree") and "prunable" not in rows and "bare" not in rows:
            ref = rows.get("branch") or ""
            trees.append({"path": rows["worktree"], "head": rows.get("HEAD"),
                          "branch": ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else None})
    return trees


def registered_worktree(main, path):
    """The worktree git has registered at path for the repo at main ({path, head, branch}: branch
    None when detached), when its folder is there; else None."""
    if not os.path.isdir(path):
        return None
    want = os.path.realpath(path)
    for w in worktree_list(main):
        if os.path.realpath(w["path"]) == want:
            return {**w, "path": path}
    return None


def checked_out(main, branch):
    """#1443: the worktree (main checkout included) where branch is checked out, else None."""
    return next((w for w in worktree_list(main) if branch and w["branch"] == branch), None)


def default_branch(main):
    """The repo's main line: its remote's HEAD (origin/HEAD), else a local main or master; None when unknown."""
    remote = remote_of(main)
    ok, ref, _ = git(main, "symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD")
    if ok and ref.startswith(remote + "/"):
        return ref[len(remote) + 1:]
    for b in ("main", "master"):
        if git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{b}")[0]:
            return b
    return None


def adopt_branch(s, t, name):
    """#1443: a started task pointed at an existing branch, the one its work is really on (a worker that made its own
    worktree and branch, its task added to work in a shared folder on another branch). It becomes a worktree task on
    that branch: in the worktree the branch is checked out in, else a new one; reviewed and ready then check that
    branch, and ready pushes it and opens its pull request. Its earlier worktree, if any, is left as it is."""
    if t["state"] in ("ready", "done"):
        raise Fail(f"{s.name(t)} is {'in Ready' if t['state'] == 'ready' else 'done'}: its branch can change only while "
                   "it is worked on.")
    if s.loc["kind"] != "repo":
        raise Fail("Worktrees need a git repo.")
    main = s.loc["folder"]
    if t.get("mode") == "worktree" and name == t.get("branch") and t.get("worktree") and os.path.isdir(t["worktree"]):
        return
    problem = branch_problem(main, name)
    if problem:
        raise Fail(problem)
    for o in s.data.get("tasks") or []:
        if o is not t and o.get("branch") == name and o.get("state") != "done":
            raise Fail(f"Branch {name}: the task {s.name(o)} already uses it.")
    if not git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{name}")[0]:
        try:
            base_ref(main, name)  # only on the remote: fetched, with a local branch made to track it
        except Fail:
            raise Fail(f"{s.name(t)} has started, so --branch takes the existing branch its work is on, and there is no "
                       f"branch {name} here or on {remote_of(main)}. Check its name with git branch -a.")
    tree = checked_out(main, name)
    if tree and os.path.realpath(tree["path"]) == os.path.realpath(main):
        raise Fail(f"{name} is checked out in {main} itself, the folder the task list belongs to: a task can't own that "
                   f"checkout. Switch the folder to another branch (or make a worktree for {name}), then try again.")
    base = t.get("base") or default_branch(main) or current_base(main)
    t.update(mode="worktree", branch=name, base=base)
    t.pop("folder_start", None)
    if tree:
        t["worktree"] = tree["path"]
    else:
        t.pop("worktree", None)
        folder_for(s, t)  # its branch exists: a worktree on it
    t["start"] = git(main, "merge-base", base, name)[1] or t.get("start") or git(main, "rev-parse", name)[1]
    s.dirty = True


# ---- Before the agent starts (#1197, SHEP-272) -------------------------------------------------
# Settings > Tasks > "Before the agent starts" (tasks.setup, Everywhere's or a space's): a shell command run in
# each new worktree before its agent, e.g. linking or installing dependencies an agent loads at startup. It runs
# in the agent's own terminal, ahead of the agent (never under the task list's lock: an install can take
# minutes), its output shown there and kept in a log. It fails: the agent doesn't start, and _setup-failed holds
# the task with why (Needs you); starting it again runs the setup again.

SETUP_SH = (
    'setup=$1 log=$2 ht=$3 ref=$4 folder=$5; shift 5; '
    'mkdir -p "${log%/*}" 2>/dev/null; rcf="$log.rc"; rm -f "$rcf"; '
    'printf \'%s\\n%s\\n\\n\' "Before the agent starts, this space runs:" "  $setup"; '
    '{ sh -c "$setup" </dev/null; echo $? > "$rcf"; } 2>&1 | tee "$log"; '
    'rc=$(cat "$rcf" 2>/dev/null); rm -f "$rcf"; [ -n "$rc" ] || rc=1; '
    'if [ "$rc" = 0 ]; then printf \'\\n%s\\n\\n\' "Setup done. Starting the agent."; exec "$@"; fi; '
    'printf \'\\n%s\\n%s\\n\' "Setup failed (exit $rc), so the agent was not started." "Its output: $log"; '
    '"$ht" _setup-failed "$ref" --folder "$folder" --code "$rc" --log "$log" >/dev/null 2>&1; '
    'exit "$rc"')


def setup_log(s, task):
    """Where a task's setup output is kept: beside the task lists, one file per task."""
    from .base import STORE
    return os.path.join(STORE, ".setup", f"{s.slug}-{task['id']}.log")


def setup_for(s, task, space, had):
    """The setup command to run before this start's agent, or None: only in a worktree, when the space sets
    one, and the worktree is new (had: it was there before this start) or its last setup failed."""
    if task.get("mode") != "worktree" or not task.get("worktree"):
        return None
    cmd = str(settings_for(s, space)["tasks"].get("setup") or "").strip()
    failed = task.pop("setup_failed", None)
    if not cmd or (had and not failed):
        return None
    return cmd


def setup_argv(s, task, setup, cmd):
    """cmd run after the setup command, only when it succeeds (SETUP_SH)."""
    return ["sh", "-c", SETUP_SH, "herdr-setup", setup, setup_log(s, task), own_path(), s.ref(task), s.loc["folder"], *cmd]


def launch(s, task, argv, space, message=None, parent=None, resume=None, role=None, setup=None):
    """Starts one agent for the task with no tab or pane of its own (a space can hold thousands
    of tasks): an hc child of `parent`, which parent_for() makes the space's coordinator, reached
    through the Tasks panel. Labels: herdr.task (its task), herdr.task.space (its space; never
    herdr.space, which Herdr gives a pane), herdr.agent, herdr.coordinator (its coordinator's tab,
    which keeps it under a restarted coordinator) and herdr.role=reviewer for a reviewer, kept
    apart from the task's agents. Returns its record."""
    key = s.key(task)
    cmd = list(resume or argv)
    auto_review = agent_key(argv) == "codex" and codex_auto_review(cmd)
    if agent_key(argv) == "codex" and "--no-daemon" in cmd:
        # #1190: an old Codex exits 2 on --no-daemon in a shell nobody watches: say so here instead
        old = codex_too_old()
        if old:
            raise Fail(codex_update_words(old))
    if not role:
        cmd = own_argv(cmd, folder_for(s, task))
    if message:
        cmd = cmd + [message]
    if setup and not role:
        cmd = setup_argv(s, task, setup, cmd)
    labels = ["--label", f"herdr.task={key}", "--label", f"herdr.task.space={bare(space)}",
              "--label", f"herdr.agent={agent_key(argv)}"]
    ctab = coordinator_tab(parent)
    if ctab:
        labels += ["--label", f"herdr.coordinator={ctab}"]
    if role:
        labels += ["--label", f"herdr.role={role}"]
    rel = ["--parent", parent, "--outlive-parent"] if parent else ["--no-parent"]
    name = agent_name(s, task, "review" if role else None)
    # HERDR_BROWSER_TASK and HERDR_BROWSER_SPACE: whose tab herdr-browser drives in which space's browser, and whose
    # desktop herdr-desktop uses (3.2; HERD-57), for it and its children. guard_argv: nothing it runs can take down
    # the live session it runs in (SHEP-323).
    env = [*browser_env(key, bare(space)), f"HERDR_TASK_CODEX_AUTO_REVIEW={int(auto_review)}"]
    r = run(["hc", "run", "--bg", "--json", "--keep", "--cwd", folder_for(s, task), "--name", name,
             *labels, *rel, "--", *low_priority(clean_env(["env", *env, *in_shell(guard_argv(cmd))]), name)])
    try:
        out = json.loads(r.stdout)
    except ValueError:
        out = {}
    if r.returncode != 0 or not out.get("address"):
        raise Fail((r.stderr or r.stdout).strip() or "hc run failed")
    a = {"address": out["address"], "agent": agent_key(argv), "argv": argv, "at": now()}
    if parent:
        a["parent"] = parent
    s.dirty = True
    if role:
        task.setdefault("reviewers", []).append(a)
        return a
    task["agents"].append(a)
    # A tab from before tasks had none stays with its old agent, not the task.
    task["space"] = bare(space)
    task.pop("tab", None)
    track(s, task, out["address"])
    return a


def is_coordinator(k):
    return (k.get("labels") or {}).get("herdr.role") == "coordinator" or k.get("template") in ASSISTANT_TEMPLATES


def coordinator_tab(addr):
    """The tab a coordinator lives in (a pane's herdr.tab, or behind a chat herdr.coordinator.tab),
    or None when addr isn't a coordinator."""
    k = hc_json("get", addr) if addr else None
    if not k or not is_coordinator(k):
        return None
    labels = k.get("labels") or {}
    return labels.get("herdr.tab") or labels.get("herdr.coordinator.tab")


def coordinators():
    """The live coordinators' addresses on this machine (without labels: hc get each)."""
    # Only coordinators get an hc get (labels): there can be thousands of terminals.
    found = [k for k in (hc_json("ls") or {}).get("terminals", []) if k.get("template") in ASSISTANT_TEMPLATES]
    found += (hc_json("ls", "--label", "herdr.role=coordinator") or {}).get("terminals", [])
    return list(dict.fromkeys(k["address"] for k in found if k.get("state") == "live" and "/" not in k["address"]))


def coordinator_in(space):
    """The space's live coordinator on this machine, or None."""
    if not space:
        return None
    for addr in coordinators():
        k = hc_json("get", addr) or {}
        labels = k.get("labels") or {}
        if k.get("state") == "live" and bare(space) in (labels.get("herdr.space"), labels.get("herdr.coordinator.space")):
            return addr
    return None


def parent_for(parent, space):
    """A task agent's parent: `parent` while it's live, else the space's coordinator."""
    return live_parent(parent) or coordinator_in(space)


def agent_name(s, task, suffix=None):
    """The agent's hc name: its id and title as hc allows names (hat-4-fix-login, at most 32),
    with -2, -3 while another live terminal has it (an agent taking over beside the old one)."""
    base = re.sub(r"[^a-z0-9]+", "-", f"{s.ref(task)} {task['title']}".lower()).strip("-")[:32 - (len(suffix) + 1 if suffix else 0)].rstrip("-")
    if suffix:
        base += f"-{suffix}"
    for n in range(1, 20):
        name = base if n == 1 else f"{base[:32 - len(str(n)) - 1].rstrip('-')}-{n}"
        k = hc_json("get", name)
        if not k or k.get("state") != "live":
            return name
    return f"{base[:24].rstrip('-')}-{secrets.token_hex(3)}"


def track(s, task, address):
    """Watches the agent in the background and records its session as it changes, so a stopped
    task can be resumed later."""
    me = ENTRY
    subprocess.Popen([sys.executable, me, "_track", str(task["id"]), address, "--folder", s.loc["folder"]],
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def live_parent(addr):
    """A coordinator to report to, if it's still there (one that restarted has a new address)."""
    k = hc_json("get", addr) if addr else None
    return addr if k and k.get("state") == "live" else None
