"""Starting agents: their argv, labels, brief, tab and coordinator.

The launch allow-list ("an agent's own herdr-task commands never ask": OWN, own_rules, own_argv,
cmd_allow) is the one place an agent's launch is given commands it may run without asking; allow
another command (herdr-secret's, say) there."""

import hashlib
import json
import os
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import time

from .base import ENTRY, Fail, git, hc_json, now, run, WORKTREES
from .settings import agent_key, ASSISTANT_TEMPLATES, bare, notes, notes_part, review_limits, settings_block
from . import kinds as K
from .templates import instructions
from .agents import detail, LINE_MAX, live_agents, SUMMARY_MAX
from .github import finish, remote_of
from .browsers import browser_line, browser_path


# ---- an agent's own herdr-task commands never ask -------------------------------------------
# As Shepherdr: at each launch the agent is allowed exactly this herdr-task's path, verb by verb,
# without touching the person's CLI settings: Claude Code in the --settings it gets at launch,
# Codex through a PermissionRequest hook given with -c (`herdr-task _allow` answers it).

OWN = ["ready", "reviewed", "status", "alert", "show", "list", "where"]
# herdr-secret's agent commands (~/.config/herdr-app/bin/herdr-secret): asking for a secret and
# using one by name never ask either, as Shepherdr's secret commands. Written by its full path or
# its bare name. Reviewers get none (launch() skips own_argv for them; herdr-secret refuses them).
SECRET = ["ask", "run", "env", "list"]


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
    return rules


def own_argv(argv):
    """An agent's argv with its own herdr-task commands allowed (Claude Code's --settings allow rules,
    Codex's PermissionRequest hook). The other kinds have no such hook: they run as given, and their
    brief asks them to run those commands."""
    path, out = own_path(), list(argv)
    k = agent_key(out)
    if k == "claude":
        rules = own_rules(path)
        if not rules:
            return out
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
            if isinstance(cur, dict):
                perms = dict(cur.get("permissions") or {})
                perms["allow"] = list(perms.get("allow") or []) + rules
                out[i + 1] = json.dumps({**cur, "permissions": perms})
                return out
        return out[:1] + ["--settings", json.dumps({"permissions": {"allow": rules}})] + out[1:]
    if k == "codex":
        hook = f"{shlex.quote(sys.executable)} {shlex.quote(ENTRY)} _allow --command {shlex.quote(path)}"
        # Codex runs a new hook only once trusted. This one hook's trust comes with it, for this
        # launch only: Codex's own key and hash for a -c hook (codex-rs/hooks discovery.rs
        # hook_hash, config fingerprint.rs version_for_toml), so no other hook is trusted by it.
        ident = {"event_name": "permission_request", "hooks": [{"async": False, "command": hook, "timeout": 10, "type": "command"}]}
        digest = hashlib.sha256(json.dumps(ident, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        key = "/<session-flags>/config.toml:permission_request:0:0"
        return out[:1] + ["-c", f"hooks.PermissionRequest=[{{hooks=[{{type=\"command\",command={json.dumps(hook)},timeout=10}}]}}]",
                          "-c", f"hooks.state={{{json.dumps(key)}={{trusted_hash=\"sha256:{digest}\"}}}}"] + out[1:]
    return out


# One plain word: no expansion, redirect, separator or line break outside quotes, nor $ or ` inside.
WORD = re.compile(r"""(?:[\w@%+=:,./-]+|'[^']*'|"(?:[^"\\$`]|\\["\\])*")+""")
UNQUOTE = re.compile(r"""'([^']*)'|"((?:[^"\\]|\\.)*)\"""")


def own_command(path, text):
    """Whether a shell command is exactly one of this herdr-task's own verbs: one simple command,
    nothing that expands, redirects or chains (as Shepherdr's ownCommand)."""
    if not isinstance(text, str):
        return False
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
    if len(words) >= 2 and words[0] == path and words[1] in OWN:
        return True
    bp = browser_path()
    if bp and len(words) >= 2 and words[0] in (bp, "herdr-browser"):
        return True
    sp = secret_path()
    return bool(sp) and len(words) >= 2 and words[0] in (sp, "herdr-secret") and words[1] in SECRET


def cmd_allow(args):
    """Codex's PermissionRequest hook: allows this launch's own herdr-task commands; anything else
    gets no answer, so Codex asks the person as usual."""
    try:
        data = json.loads(sys.stdin.read(1 << 20) or "{}")
    except ValueError:
        return
    if os.environ.get("HERDR_TASK_HOOK_LOG"):
        with open(os.environ["HERDR_TASK_HOOK_LOG"], "a") as f:
            f.write(json.dumps(data) + "\n")
    cmd = (data.get("tool_input") or {}).get("command") if isinstance(data.get("tool_input"), dict) else None
    if isinstance(cmd, list):
        # ["bash", "-lc", "<command>"] as some tools pass it.
        cmd = cmd[2] if len(cmd) == 3 and cmd[1] in ("-c", "-lc") else shlex.join(cmd)
    if own_command(args.command, cmd):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}))


# ---- starting agents ------------------------------------------------------------------------


def resume_argv(argv, session):
    """argv continuing `session`, as kinds.json spells it for that CLI (claude --resume <id>, codex
    resume <id>, pi --session <log>, amp threads continue <id>); None when it can't."""
    return K.resume_argv(argv, session)


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
# nice 10 and the utility QoS clamp (taskpolicy). Anything missing is skipped, never fatal.

LOW = ('echo 500 > /proc/self/oom_score_adj 2>/dev/null; '
       'command -v ionice >/dev/null 2>&1 && ionice -c2 -n7 -p $$ >/dev/null 2>&1; '
       'command -v taskpolicy >/dev/null 2>&1 && exec nice -n 10 taskpolicy -c utility "$@"; '
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
    if shutil.which("herdr-app"):
        r = run(["herdr-app", "status"])
        try:
            sp = json.loads(r.stdout).get("space")
        except ValueError:
            sp = None
        if sp and "/" not in sp:
            return sp
    raise Fail("Which space? Pass --space <space id>.")


def tab_title(s, task):
    return f"{s.ref(task)} {task['title']}"


def name_tab(tab, title):
    """Names a tab once Herdr has seen it (it appears when the agent's labels are read)."""
    if not shutil.which("herdr-app"):
        return False
    for _ in range(60):
        if run(["herdr-app", "do", "tab.rename", "--id", tab, "--name", title]).returncode == 0:
            return True
        time.sleep(0.1)
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
    names = {}
    if shutil.which("herdr-app"):
        try:
            for sp in json.loads(run(["herdr-app", "ls"]).stdout).get("spaces", []):
                for tb in sp.get("tabs", []):
                    names[bare(tb["id"])] = tb.get("name") or ""
        except ValueError:
            pass
    pairs = []
    for t in s.data["tasks"]:
        for tab in task_tabs(s, t):
            old = names.get(tab)
            if old is None or re.fullmatch(r"\d+", old):
                pairs.append((tab, tab_title(s, t)))
                continue
            rest = re.sub(r"^(#\d+|[A-Z]+\d*-\d+)\s*", "", old)
            pairs.append((tab, f"{s.ref(t)} {rest}".strip()))
    return name_tabs(pairs)


def closing_line(s, task, parent=None, argv=None):
    """How the worker finishes: every task, worktree or in the folder, says ready with a summary.
    It names this herdr-task by its full path: only that form runs without asking (own_argv)."""
    done = "finished and committed" if task.get("mode") == "worktree" else "finished"
    ht = own_path()
    text = (f"When the work is {done}, run `{ht} ready {s.ref(task)} --folder {shlex.quote(s.loc['folder'])} "
            f"--summary \"<what the person now sees or can do, plain words, at most {SUMMARY_MAX} characters>\"` (optionally "
            f"`--details \"<a few short bullets in plain words, one per line: what changed for the person first, then how it was checked>\"`; with `--agents-md \"<one line>\"` when you learned something "
            f"about setting up or testing this repo that its AGENTS.md lacks). The person accepts it from there; never mark it done yourself.")
    on, rounds = review_limits(s, task)
    if on:
        text += (f" Review is on: after each review round, record it on the commit it reviewed with `{ht} reviewed {s.ref(task)} "
                 f"--folder {shlex.quote(s.loc['folder'])} --report \"<its findings in a line>\"` (at most {rounds} rounds); "
                 f"ready refuses a final commit no round was recorded on.")
    text += (f" At the start and at each natural step, say how it's going: `{ht} status {s.ref(task)} --folder {shlex.quote(s.loc['folder'])} "
             f"\"<what you're doing now, at most {LINE_MAX} characters>\" --done <% of the whole task> --left <your best guess of how long is left, like 20m>`: "
             f"always give `--left`, from your very first status on, and update it at every step; a rough guess beats none.")
    text += (f" Only for what truly can't wait, `{ht} alert \"<what, a few words>\" --body \"<why>\"` reaches the person at once "
             f"(a toast and a sound); a question waits in your chat instead.")
    text += (f" Your herdr-task command is {ht}: write that full path each time (never the bare name), as one plain command; "
             f"then its {', '.join(OWN)} commands run without asking.")
    text += browser_line()
    if secret_path():
        text += (" Secrets (keys, tokens, passwords) are used by name, never seen: `herdr-secret ask NAME --why \"…\"` "
                 "(then end your turn), `herdr-secret run NAME -- <command>`, `herdr-secret list`; these run without asking too.")
    if argv and agent_key(argv) == "codex":
        text += " Codex's sandbox can't reach Herdr, so give those commands sandbox_permissions \"require_escalated\" from the first try."
    # No "report to your coordinator": Herdr tells the Assistant itself (news_pass).
    return text


def where_line(task):
    if not task.get("worktree"):
        return ""
    base = f", from {task['base']}, which it merges into" if task.get("base") else ""
    return f"You work in {task['worktree']} on branch {task['branch']}{base}."


def brief(s, task, parent=None, space=None, argv=None):
    instructions("reviewer")  # the file its review's reviewer gets (WORKER_MD)
    start = notes_part("Before you start", notes(s, task, "start", space))
    if start and task.get("worktree"):
        start += f"\n(The main folder is {s.loc['folder']}.)"
    body = "Your task, " + s.ref(task) + ":\n" + ((task.get("prompt") or "").strip() or task["title"])
    finish = notes_part("Before you say ready", notes(s, task, "finish", space))
    return "\n\n".join(x for x in [instructions("worker"), start, body, where_line(task), finish, closing_line(s, task, parent, argv),
                                    settings_block(s, task, space, argv)] if x)


def handoff(s, task, prev, parent=None, argv=None):
    lines = [f"You are taking over task {s.ref(task)} \"{task['title']}\" from another agent.", instructions("worker")]
    lines.append(where_line(task))
    lines.append("The task:\n" + ((task.get("prompt") or "").strip() or task["title"]))
    if prev and prev.get("log"):
        lines.append(f"The previous agent ({prev.get('agent') or 'agent'}) kept its session log at {prev['log']}: read the recent part to pick up where it left off.")
    elif prev:
        lines.append(f"The previous agent ({prev.get('agent') or 'agent'}) left no session log; check the folder's state (git status, git log) before you continue.")
    lines.append(notes_part("Before you continue, if it isn't done yet", notes(s, task, "start")))
    lines.append(notes_part("Before you say ready", notes(s, task, "finish")))
    lines.append(closing_line(s, task, parent, argv))
    lines.append(settings_block(s, task, None, argv))
    return "\n\n".join(x for x in lines if x)


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


def folder_for(s, task):
    if task.get("mode") != "worktree":
        return s.loc["folder"]
    if task.get("worktree") and os.path.isdir(task["worktree"]):
        return task["worktree"]
    if s.loc["kind"] != "repo":
        raise Fail("Worktrees need a git repo. Use --here.")
    main = s.loc["folder"]
    words = re.sub(r"[^a-z0-9]+", "-", task["title"].lower()).strip("-")[:40].strip("-") or "task"
    branch = task.get("branch") or f"task/{task['id']}-{words}"
    path = os.path.join(WORKTREES, os.path.basename(main), re.sub(r"[^A-Za-z0-9._-]+", "-", branch).strip("-"))
    # Its own base (--base) branches from that branch; else from what the folder has checked out.
    own = task.get("base") if task.get("base_set") else None
    base = base_ref(main, own) if own else current_base(main)
    exists = git(main, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}")[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    add = ["worktree", "add", path, branch] if exists else ["worktree", "add", "-b", branch, path, own or "HEAD"]
    ok, _, err = git(main, *add)
    if not ok:
        raise Fail(err or "git worktree add failed")
    # Where the branch starts: work past it that turns up in the base branch means merged.
    start = git(path, "rev-parse", "HEAD")[1] if not exists else task.get("start")
    task.update(worktree=path, branch=branch, base=task.get("base") or base, start=start)
    return path


def launch(s, task, argv, space, message=None, parent=None, resume=None, role=None):
    """Starts one agent for the task with no tab or pane of its own (a space can hold thousands
    of tasks): an hc child of `parent`, which parent_for() makes the space's coordinator, reached
    through the Tasks panel. Labels: herdr.task (its task), herdr.task.space (its space; never
    herdr.space, which Herdr gives a pane), herdr.agent, herdr.coordinator (its coordinator's tab,
    which keeps it under a restarted coordinator) and herdr.role=reviewer for a reviewer, kept
    apart from the task's agents. Returns its record."""
    key = s.key(task)
    cmd = list(resume or argv)
    if not role:
        cmd = own_argv(cmd)
    if message:
        cmd = cmd + [message]
    labels = ["--label", f"herdr.task={key}", "--label", f"herdr.task.space={bare(space)}",
              "--label", f"herdr.agent={agent_key(argv)}"]
    ctab = coordinator_tab(parent)
    if ctab:
        labels += ["--label", f"herdr.coordinator={ctab}"]
    if role:
        labels += ["--label", f"herdr.role={role}"]
    rel = ["--parent", parent, "--outlive-parent"] if parent else ["--no-parent"]
    name = agent_name(s, task, "review" if role else None)
    # HERDR_BROWSER_TASK: which task's browser herdr-browser drives (HERD-57), for it and its children.
    r = run(["hc", "run", "--bg", "--json", "--keep", "--cwd", folder_for(s, task), "--name", name,
             *labels, *rel, "--", *low_priority(["env", f"HERDR_BROWSER_TASK={key}", *in_shell(cmd)], name)])
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


def coordinator_in(space):
    """The space's live coordinator on this machine, or None."""
    if not space:
        return None
    # Only coordinators get an hc get (labels): there can be thousands of terminals.
    found = [k for k in (hc_json("ls") or {}).get("terminals", []) if k.get("template") in ASSISTANT_TEMPLATES]
    found += (hc_json("ls", "--label", "herdr.role=coordinator") or {}).get("terminals", [])
    for addr in dict.fromkeys(k["address"] for k in found if k.get("state") == "live" and "/" not in k["address"]):
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
