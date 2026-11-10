"""Agents come back after a crash, a power loss or a reboot (SHEP-30).

herdr-core keeps a kept terminal (hc run --keep) through a lost program, but never runs it again:
the terminal comes back with its labels and a plain shell (its argv becomes that shell, its
template goes). So while an Assistant or a task's agent runs, each tick here records on its
terminal (label herdr.resume) how to start it again on its own session: the agent's flags, the
exact session id and log (session_of(), as the chat finds them), its folder, and the terminal's
own process. A terminal whose process changed since (the core gave it a new shell) and where no
agent runs now gets its agent typed back into that shell: the same terminal, labels, chat and
task, resuming that very session. Its session gone (no log, or the CLI says "No conversation
found"): a new one starts there with a short handover (as the chat's lostSession), which its
chat shows as a New session. Each machine's tick does its own terminals only, under the tick's
lock, so one agent never comes back twice."""

import json
import os
import re
import shlex

from .base import HOME, hc_json, now, run, SHELLS
from .agents import agent_running, status_word
from .sessions import session_of
from .settings import ASSISTANT_TEMPLATES
from .launch import CLEAN_ENV

LABEL = "herdr.resume"
# Claude Code: "No conversation found with session ID: …". Codex: "ERROR: No saved session found with ID …"
# (core/chat-view.js LOST).
LOST = re.compile(r"\bno (?:saved )?(?:conversation|session|rollout)\b.*\bfound\b|\b(?:conversation|session)\b.*\bnot found\b", re.I)
# What a new agent hears when its earlier session is gone (core/chat-view.js FRESH and lostMessage).
FRESH = ("Your earlier session is gone, so this is a new one that remembers none of it. Check what is already here "
         "and preserve existing work.")
# What a resumed agent hears when the restart cut its turn short.
CUT = ("Herdr restarted (a crash, power loss or reboot) while you were working, and your session is resumed. "
       "Carry on where you left off.")
# A resume that fails within this long is looked at once more (its screen says why).
LOOK_MS = 10 * 60000

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


def lost_message(ref=None, template=None):
    """A new agent's first message once its session is gone (core/chat-view.js lostMessage)."""
    msg = f"<restart>{FRESH}</restart>"
    if ref:
        msg += f"\n\nYou work on task {ref}: read its brief with `herdr-task show {ref}` and carry on from what is already done."
    body = "---".join(re.split(r"^---[ \t]*$", template or "", flags=re.M)[2:]).strip()
    if body:
        msg += f"\n\n{body}"
    return msg


def without_caller():
    """The environment for hc send into a shell: no HC_TERMINAL_ID, so hc names no caller. A caller that is an
    agent makes hc wrap the text in <hc from=…> when the shell reports its status too (herdr-core's tagged()),
    and bash or zsh then fails to run the line (SHEP-202, GitHub #925). The line is the person's, not an agent's."""
    return {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}


def shell_line(shell, cwd, env, argv, direct=False):
    """The line typed into the recovered shell: into the agent's folder, then the agent. POSIX shells
    and fish (3.1+) take `&&` and VAR=value before a command; others get the agent alone. `direct`:
    it started without the person's shell, so their aliases and functions (a claude() adding flags)
    stay out now too (`command`)."""
    words = " ".join(shlex.quote(str(a)) for a in argv)
    if os.path.basename(shell or "") not in ("bash", "zsh", "sh", "dash", "ksh", "fish"):
        return words
    if direct:
        words = f"command {words}"
    pre = " ".join(f"{k}={shlex.quote(str(v))}" for k, v in sorted((env or {}).items()))
    cmd = f"{pre} {words}" if pre else words
    line = f"cd {shlex.quote(cwd)} && {cmd}" if cwd else cmd
    # The recovered shell has the holder's environment: clear a parent Claude Code session's markers
    # first (SHEP-86, launch.CLEAN_ENV; POSIX shells: fish has no for-in-do).
    return line if os.path.basename(shell or "") == "fish" else f"{CLEAN_ENV} {line}"


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


def task_ref(k):
    """A task agent's task id (herdr-task names its agents shep-30-fix-login)."""
    m = re.match(r"^([a-z][a-z0-9]*)-(\d+)(?:-|$)", k.get("name") or "")
    return f"{m.group(1).upper()}-{m.group(2)}" if m and (k.get("labels") or {}).get("herdr.task") else None


def env_of(k):
    """What the agent's launch set besides its argv: a task's browser (launch.launch)."""
    key = (k.get("labels") or {}).get("herdr.task")
    return {"HERDR_BROWSER_TASK": key} if key else {}


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


def task_of(k):
    """A task agent's task (read only), or None (gone, archived)."""
    from .store import read_list
    from .base import STORE
    key = (k.get("labels") or {}).get("herdr.task") or ""
    slug, _, n = key.rpartition("#")
    d = read_list(os.path.join(STORE, slug + ".json")) if slug and n.isdigit() else None
    return next((t for t in (d or {}).get("tasks") or [] if t.get("id") == int(n)), None)


def task_record(k, t):
    """A task agent with no record of its own: the session its task recorded (sessions.refresh_sessions)."""
    from .launch import own_argv
    a = next((a for a in (t.get("agents") or []) + (t.get("reviewers") or []) if a.get("address") == k["address"]), None)
    kind, argv = base_argv((a or {}).get("argv"))
    if not kind:
        return None
    if (k.get("labels") or {}).get("herdr.role") != "reviewer":
        argv = own_argv(argv, k.get("cwd"))
    return {"kind": kind, "session": a.get("session"), "log": a.get("log"), "argv": argv, "cwd": k.get("cwd"),
            "pid": None, "working": t.get("state") == "running", "shell": True}


def template_of(name="assistant"):
    """(command, text) of a herdr-core template on this machine."""
    try:
        with open(os.path.join(HOME, ".config", "herdr-core", "templates", f"{name}.md")) as f:
            text = f.read()
    except OSError:
        return None, None
    head = re.match(r"^---\n([\s\S]*?)\n---", text)
    m = re.search(r"^command:[ \t]*(.+)$", head.group(1), re.M) if head else None
    cmd = re.sub(r"^exec\s+", "", m.group(1).strip()) if m else None
    return cmd, text


def restarted(k):
    """A terminal the core gave a new process (a plain shell) since its agent ran there, and where
    no agent runs now."""
    fg = os.path.basename((k.get("foreground") or {}).get("name") or (k.get("argv") or [""])[0])
    return k.get("state") == "live" and fg in SHELLS and not agent_running(k)


def bare_shell(k):
    argv = k.get("argv") or []
    return len(argv) == 1 and os.path.basename(argv[0]) in SHELLS


def plan(k, rec, running):
    """What to type into `k` now: (how, argv, direct) or None (direct: shell_line's). `running`: the
    sessions agents run here now."""
    labels = k.get("labels") or {}
    assistant = labels.get("herdr.role") == "coordinator" or k.get("template") in ASSISTANT_TEMPLATES
    # A task's agent only while its task is at work (Working, or Ready for follow-ups): a finished
    # task's stays a shell, as its end would leave it.
    task = task_of(k) if labels.get("herdr.task") else None
    if labels.get("herdr.task") and (task or {}).get("state") not in ("running", "ready"):
        return None
    if rec and rec.get("pid") == k.get("pid"):
        # Typed here already: once more only when the resume said its session is gone.
        if rec.get("how") != "resume" or now() - (rec.get("sent") or 0) > LOOK_MS:
            return None
        screen = run(["hc", "read", k["address"], "--lines", "40"]).stdout
        if not LOST.search("\n".join(screen.split("\n")[-30:])):
            return None
        rec = dict(rec, session=None)
    if not rec:
        # From before records (or lost before the first one): only a terminal the core plainly gave a shell.
        if not bare_shell(k):
            return None
        rec = task_record(k, task) if task else None
    if rec and rec.get("session") and rec["session"] in running:
        return ("running", None, False)
    if rec and rec.get("session") and rec.get("log") and os.path.isfile(rec["log"]):
        return ("resume", resume_argv(rec["kind"], rec["argv"], rec["session"], CUT if rec.get("working") else None), not rec.get("shell"))
    # Its session is gone: a new one, with the handover (and an Assistant's role, its template's words).
    command, template = template_of() if assistant else (None, None)
    argv = (rec or {}).get("argv") or (shlex.split(command) if command else None)
    if not argv:
        return None
    # Without a record, an Assistant starts as its template does: without the person's shell.
    return ("fresh", [*argv, lost_message(task_ref(k), template)], not (rec or {}).get("shell"))


def revive_pass(report):
    """Records each running Assistant's and task agent's session here, and brings back the ones the
    core gave a plain shell."""
    d = hc_json("ls") or {}
    mine = [k for k in d.get("terminals") or [] if "/" not in k.get("address", "") and k.get("state") == "live"]
    terms = [x for x in (hc_json("get", k["address"]) for k in mine) if x and watched(x)]
    running, back = set(), []
    for k in terms:
        rec = read_record(k)
        if agent_running(k):
            new = record_of(k)
            if new:
                running.add(new["session"])
                if {x: v for x, v in (rec or {}).items() if x not in ("how", "sent")} != new:
                    write_record(k, new)
        elif restarted(k):
            back.append((k, rec))
    for k, rec in back:
        step = plan(k, rec, running)
        if not step:
            continue
        how, argv, direct = step
        rec = dict(rec or {}, pid=k.get("pid"), how=how, sent=now())
        if argv:
            shell = (k.get("argv") or [""])[0]
            r = run(["hc", "send", k["address"], shell_line(shell, rec.get("cwd") or k.get("cwd"), env_of(k), argv, direct)],
                    env=without_caller())
            if r.returncode != 0:
                report.setdefault("revive_failed", []).append({"terminal": k["address"], "why": (r.stderr or r.stdout).strip()})
                continue
        # Marked as handled before anything else looks: the next tick types nothing here again.
        write_record(k, rec)
        report.setdefault("revived", []).append({"terminal": k["address"], "how": how, "session": rec.get("session")})
