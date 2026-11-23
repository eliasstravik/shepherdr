"""The person's settings (~/.config/shepherdr/settings.json and per-folder), the agent each task runs, and
the Settings block a task's brief ends with."""

import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import time

from .base import Fail, git, HOME, WHERE
from . import flags as FLAGS


# What each agent key starts by default. Unknown keys run as themselves; --argv overrides.
AGENTS = {"claude": ["claude"], "codex": ["codex", "--no-daemon"]}


# ---- the person's settings ------------------------------------------------------------------

SETTINGS = os.environ.get("HERDR_TASK_SETTINGS") or WHERE.path("settings")
# The role instructions are herdr-core templates (`hc templates` lists them): assistant.md (the
# coordinator's), worker.md and reviewer.md. Workers and reviewers used ~/.herdr/instructions.
# Where herdr-core reads the role templates: $XDG_CONFIG_HOME's when set (absolute), else ~/.config's (#1182).
TEMPLATES = os.environ.get("HERDR_TASK_TEMPLATES") or os.path.join(
    os.environ["XDG_CONFIG_HOME"] if os.environ.get("XDG_CONFIG_HOME", "").startswith("/") else os.path.join(HOME, ".config"),
    "herdr-core", "templates")
OLD_INSTRUCTIONS = os.path.join(HOME, ".herdr", "instructions")
ASSISTANT_TEMPLATES = ("assistant", "coordinator")  # "coordinator": Assistants started before the rename
DEFAULTS = {"tasks": {"merge": "ask", "review_rounds": 0, "must_fix": "major", "worktrees": True,
                      "start_notes": "", "finish_notes": "", "archive_after": 7, "proof": True, "base": "", "branch": "",
                      "worktree_root": "", "setup": "", "accept_command": "", "claude_flags": [], "codex_flags": []},
            "automations": {"enabled": True}, "worker": {}, "reviewer": {}, "coordinator": {},
            "agents": {"reactions": True, "suggestions": True, "feedback": True, "feedback_repo": "eliasstravik/shepherdr"}}
LEVELS = ["blocker", "major", "minor"]


# The machine layer's key for the computer whose Herdr window wrote the file. A copy the window
# pushes to another machine says which machine that is in "here" (and holds that machine's
# spaces by their bare ids), so the same lookup works there.
LOCAL_MACHINE = "local"


def read_settings():
    """The settings file as it is ({} when there is none or it can't be read)."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def reactions_on(space=None, d=None):
    """Settings › Agents › Reactions in a space, for every agent there (reactions.py): the space's
    own, else Everywhere's, else on. A layer's agents.reactions, else what SHEP-42 kept as
    assistant.reactions (when only the Assistant reacted): the window and the web app move it.
    Off everywhere while the Reactions plugin is off (Settings › Plugins: Everywhere's plugins_off)."""
    d = read_settings() if d is None else d
    off = (d.get("everywhere") or {}).get("plugins_off") if isinstance(d.get("everywhere"), dict) else None
    if isinstance(off, list) and "reactions" in off:
        return False
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    for layer in (own, d.get("everywhere")):
        for key in ("agents", "assistant"):
            a = layer.get(key) if isinstance(layer, dict) else None
            v = a.get("reactions") if isinstance(a, dict) else None
            if isinstance(v, bool):
                return v
    return DEFAULTS["agents"]["reactions"]


def settings_layers(s, space=None):
    """(Everywhere's, this machine's, this folder's) raw settings, least specific first: the
    folder's are those of the space working in it (--space's when several do)."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    spaces = d.get("spaces") or {}
    mine = [v for k, v in spaces.items() if (v or {}).get("folder") == s.loc["folder"]]
    pick = (spaces.get(bare(space)) if space and (spaces.get(bare(space)) or {}).get("folder") == s.loc["folder"] else None) or (mine[0] if mine else None)
    machine = (d.get("machines") or {}).get(d.get("here") or LOCAL_MACHINE)
    return d.get("everywhere") or {}, machine or {}, pick or {}


# ---- Instructions (gone, SHEP-319) --------------------------------------------------------------
# Settings › Instructions (settings.json "everywhere"/"spaces" -> <id> -> "instructions") was the person's own words for
# every agent. Agents are instructed natively now: the repo's or folder's AGENTS.md / CLAUDE.md and their own global
# file. A file that still holds the key is fine: nothing here reads it (the update keeps the words in a plain file).


def settings_for(s, space=None):
    """The settings for this folder's tasks: Shepherdr settings' Everywhere, then this machine's,
    then the override of the space working in this folder (--space's when several do): the most
    specific wins. The window no longer writes agent or task values for a machine (only its
    machine-only rows, read by machine_limits/machine_option); ones set before still apply here. Written by the settings window (~/.config/shepherdr/settings.json); herdr-task only
    reads them."""
    everywhere, machine, pick = settings_layers(s, space)
    out = {k: dict(v) for k, v in DEFAULTS.items()}

    def merge(part):
        for k, v in (part or {}).items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k].update({kk: vv for kk, vv in v.items() if vv is not None})
            elif k in out and v is not None:
                out[k] = v
    merge(everywhere)
    merge(machine)
    merge(pick)
    return out


def notes(s, task, which, space=None):
    """A task's "When a task starts" / "finishes" notes (which: "start" or "finish"): its own
    (--start-notes / --finish-notes), else its folder's from Shepherdr settings. Herdr runs
    nothing itself: the notes go into the agents' starting prompts."""
    own = (task.get(f"{which}_notes") or "").strip()
    return own or (settings_for(s, space or task.get("space"))["tasks"].get(f"{which}_notes") or "").strip()


def notes_part(head, text):
    """ "Before you start: ..." on one line, or the head over the notes when they have several."""
    return f"{head}:\n{text}" if "\n" in text else f"{head}: {text}" if text else ""


def worktrees_on(s, space=None):
    """Tasks here get a git worktree each: in a git repo, unless the person's Shepherdr settings
    turn worktrees off for it (then it works in the folder itself, as a folder without git)."""
    return s.loc["kind"] == "repo" and settings_for(s, space)["tasks"].get("worktrees") is not False


def argv_for(pick):
    """How to start an agent from a role's settings {agent, model, effort, fast, perm} (or its own
    argv), as the chat's agent picker builds it (mods/chat/agent.js argvFor). None: no setting."""
    if not pick:
        return None
    extra = [str(x) for x in pick.get("flags") or []]
    if pick.get("argv"):
        a = [str(x) for x in pick["argv"]]
        return a[:1] + extra + a[1:]
    agent = pick.get("agent")
    if agent == "claude":
        # #1222: the extra flags first, each one word (flags.py), so what Shepherdr adds after them ends them
        a = ["claude", *extra]
        if pick.get("model"):
            a += ["--model", pick["model"]]
        if pick.get("effort"):
            a += ["--effort", pick["effort"]]
        a += ["--settings", json.dumps({"fastMode": bool(pick.get("fast"))})]
        perm = PERM_ACROSS["claude"].get(pick.get("perm"), pick.get("perm"))
        if perm == "bypassPermissions":
            a.append("--dangerously-skip-permissions")
        elif perm:
            a += ["--permission-mode", "default" if perm == "manual" else perm]
        return a
    if agent == "codex":
        a = ["codex", "--no-daemon", *extra]
        if pick.get("model"):
            a += ["-m", pick["model"]]
        if pick.get("effort"):
            a += ["-c", f'model_reasoning_effort="{pick["effort"]}"']
        # always said, so Fast off wins over a service_tier in config.toml (default: the standard tier)
        # Ultrafast: Codex's fastest tier (SHEP-258), on models whose catalog offers it
        a += ["-c", 'service_tier="%s"' % ("ultrafast" if pick.get("fast") == "ultrafast" else "fast" if pick.get("fast") else "default")]
        perm = PERM_ACROSS["codex"].get(pick.get("perm"), pick.get("perm"))
        if perm == "full":
            a.append("--dangerously-bypass-approvals-and-sandbox")
        elif perm == "read-only":
            a += ["-s", "read-only", "-a", "on-request"]
        elif perm:
            a += ["-s", "workspace-write", "-a", "on-request"]
        return a
    return [agent] if agent else None


# Permission modes as each CLI has them, and a mode carried to the other CLI when a task's agent
# changes: its nearest mode there, else that CLI's default (core/agents.js PERM_ACROSS, #758, #1219).
PERMS = {"claude": ("manual", "auto", "acceptEdits", "plan", "bypassPermissions"), "codex": ("read-only", "auto", "full")}
PERM_ACROSS = {"claude": {"read-only": "plan", "auto": "auto", "full": "bypassPermissions"},
               "codex": {"plan": "read-only", "auto": "auto", "acceptEdits": "auto", "bypassPermissions": "full"}}
PERM_DEFAULT = {"codex": "auto"}


def perm_across(perm, agent):
    """A permission mode in `agent`'s words: its match, the same mode when that CLI has it, else its
    default (None: the CLI's own)."""
    if perm in PERM_ACROSS.get(agent, {}):
        return PERM_ACROSS[agent][perm]
    if perm in PERMS.get(agent, ()):
        return perm
    return PERM_DEFAULT.get(agent)


def argv_perm(argv):
    """The permission mode an agent's argv starts with, as argv_for writes it; None when it says none."""
    argv = [str(a) for a in argv or []]
    if "--dangerously-skip-permissions" in argv:
        return "bypassPermissions"
    if "--dangerously-bypass-approvals-and-sandbox" in argv or "--yolo" in argv:
        return "full"
    for i, a in enumerate(argv[:-1]):
        nxt = argv[i + 1]
        if a == "--permission-mode":
            return "manual" if nxt == "default" else nxt
        if a in ("-s", "--sandbox"):
            return {"read-only": "read-only", "workspace-write": "auto", "danger-full-access": "full"}.get(nxt)
    return None


def worker_pick(s, task, space=None, agent=None):
    """What a task's agent runs on, {agent, model, effort, fast, perm}: Settings' worker, then the
    task's own --agent / --model / --effort, then `agent` (start --agent). Another CLI than
    Settings' starts from its own defaults (models and permissions differ per CLI)."""
    pick = dict(settings_for(s, space)["worker"] or {})
    for key in (task.get("agent"), agent):
        if key and key != pick.get("agent"):
            # #1219: the space's permission goes along, in the new CLI's words (full access stays full)
            perm = perm_across(pick.get("perm") or argv_perm(pick.get("argv")), key)
            pick = {"agent": key, **({"perm": perm} if perm else {})}
    if not pick.get("agent") and not pick.get("argv"):
        pick["agent"] = "claude"
    for k in ("model", "effort"):
        if task.get(k):
            pick[k] = task[k]
    # 3.2: its own speed and permission mode (start or edit --speed / --permission), in its CLI's words
    if task.get("speed") in SPEEDS:
        pick["fast"] = SPEEDS[task["speed"]]
    if task.get("perm"):
        perm = perm_across(task["perm"], pick.get("agent") or agent_key(pick.get("argv") or ["claude"]))
        if perm:
            pick["perm"] = perm
    # #1222: its CLI's extra flags, the task's own else its space's (Settings › Tasks), those that still pass
    kind = pick.get("agent") or agent_key(pick.get("argv") or ["claude"])
    own = (task.get("flags") or {}).get(kind) if isinstance(task.get("flags"), dict) else None
    extra = FLAGS.clean(kind, own if own is not None else settings_for(s, space)["tasks"].get(f"{kind}_flags") or [])
    if extra:
        pick["flags"] = extra
    return pick


def worker_argv(s, task, space=None, agent=None):
    """A task's agent when nobody gave an argv: worker_pick's."""
    pick = worker_pick(s, task, space, agent)
    if pick.get("argv") and not any(task.get(k) for k in ("model", "effort", "speed", "perm")):
        return argv_for(pick)
    pick.pop("argv", None)
    pick.setdefault("agent", "claude")
    return argv_for(pick) or agent_argv(pick["agent"])


def argv_model(argv):
    """(model, effort) an agent's argv asks for, as argv_for writes them; None where it doesn't."""
    model = effort = None
    for i, a in enumerate(argv[:-1]):
        nxt = argv[i + 1]
        if a in ("--model", "-m"):
            model = nxt
        elif a == "--effort":
            effort = nxt
        elif a in ("-c", "--config") and nxt.startswith("model_reasoning_effort="):
            effort = nxt.split("=", 1)[1].strip("\"'")
    return model, effort


# ---- the Settings block: the settings that shape a task's work, as words in its brief ---------
# As in Shepherdr: settings only change what goes into an agent's starting prompt. Every brief
# ends with this block, one line per setting; a line that differs from Herdr's default says who
# changed it. The coordinator changes one task's with `add --set key=value` (and --model, --effort,
# --reviewer...). The brief's own words win over the block.

SETTINGS_HEAD = "Settings: (from herdr-task show; where the brief above says otherwise, it wins)"
SET_BY = {"task": "set by the assistant for this task", "folder": "this folder's setting", "machine": "this machine's setting",
          "all": "your setting everywhere"}
MERGE_WORDS = {"ask": "ask the person first: they mark it as done on its card, which merges it",
               "checks": "after checks: once you say ready, Herdr merges it when its checks pass",
               "auto": "on its own: once you say ready, Herdr merges it"}
MUST_WORDS = {"blocker": "blocker", "major": "major and up (blocker, major)", "minor": "everything (blocker, major, minor)"}
# --set's keys (Shepherdr's spellings too) and the task fields they set.
SET_KEYS = {"review": "review", "brief.review": "review", "merge": "merge", "brief.merge": "merge",
            "rounds": "review_rounds", "review.rounds": "review_rounds", "review-rounds": "review_rounds", "review_rounds": "review_rounds",
            "mustfix": "must_fix", "must-fix": "must_fix", "must_fix": "must_fix", "review.mustfix": "must_fix",
            "agent": "agent", "task.agent": "agent", "model": "model", "task.model": "model", "effort": "effort", "task.effort": "effort",
            "reviewer": "reviewer", "reviewer.agent": "reviewer", "reviewer.model": "reviewer_model", "reviewer.effort": "reviewer_effort",
            "reviewer_model": "reviewer_model", "reviewer-model": "reviewer_model",
            "reviewer_effort": "reviewer_effort", "reviewer-effort": "reviewer_effort",
            "proof": "proof", "brief.proof": "proof",
            "speed": "speed", "task.speed": "speed", "fast": "speed", "permission": "perm", "permissions": "perm", "perm": "perm",
            "task.permission": "perm",
            "flags": "flags", "task.flags": "flags", "extra-flags": "flags", "extra_flags": "flags"}
# The Proof line (as Shepherdr's skill asks of its task agents), on and off.
PROOF_WORDS = {"on": "show verifiable proof in one artifact: each proof with a one-line caption, real and from this work now, "
                     "plus a \"Not proven\" list; then say ready with --proof <its id>",
               "off": "not needed for this task: no proof artifact; say in your summary how you checked it"}
MERGE_VALUES = {"ask": "ask", "ask me first": "ask", "ask first": "ask", "ask the person first": "ask", "wait": "ask",
                "checks": "checks", "after checks": "checks", "after github checks": "checks", "after checks pass": "checks",
                "auto": "auto", "on its own": "auto", "merge it": "auto", "at once": "auto"}
MUST_VALUES = {"blocker": "blocker", "blockers": "blocker", "critical": "blocker", "major": "major",
               "minor": "minor", "trivial": "minor", "everything": "minor"}
# A task's speed (the model's service tier) as argv_for's "fast", and every permission mode a CLI has.
SPEEDS = {"regular": False, "fast": True, "ultrafast": "ultrafast"}
SPEED_VALUES = {"regular": "regular", "standard": "regular", "normal": "regular", "off": "regular", "fast": "fast", "on": "fast",
                "ultrafast": "ultrafast", "ultra-fast": "ultrafast", "ultra fast": "ultrafast"}
PERM_VALUES = {"default": "manual", "ask": "manual", "accept edits": "acceptEdits", "accept-edits": "acceptEdits", "bypass": "bypassPermissions",
               "full access": "full", "read only": "read-only", "readonly": "read-only"}
EFFORTS = {"none", "minimal", "lowest", "low", "medium", "high", "xhigh", "max", "ultra"}
ONOFF = {"on": "on", "yes": "on", "true": "on", "1": "on", "off": "off", "no": "off", "false": "off", "0": "off"}


def set_task(t, key, value, agent=None):
    """One --set key=value (or flag) on task t; an empty value or "default" goes back to Settings'. agent: the CLI
    the task's agent runs, whose extra flags `flags` sets (#1222; default: the task's own --agent, else claude)."""
    field = SET_KEYS.get(key.strip().lower())
    if not field:
        raise Fail(f"--set takes review, review.rounds, review.mustFix, merge, proof, agent, model, effort, speed, permission, flags or reviewer settings, not {key!r}.")
    if field == "flags":
        set_flags(t, agent or t.get("agent") or "claude", value)
        return
    v = value.strip().strip("\"'").strip()
    sets = t.setdefault("set", {})
    if field == "perm" and v:
        # every mode by its own name ("default" is Claude Code's asking mode, not "Settings' again": "" is)
        known = {m.lower(): m for ms in PERMS.values() for m in ms}
        mode = PERM_VALUES.get(v.lower()) or known.get(v.lower())
        if not mode:
            raise Fail(f"permission is one of {', '.join(sorted(set(known.values()) | {'default'}))} (\"\": Settings' again).")
        t["perm"] = mode
        if not sets:
            t.pop("set", None)
        return
    if not v or v.lower() == "default":
        sets.pop(field, None)
        t.pop(field, None)
        if not sets:
            t.pop("set", None)
        return
    low = v.lower()
    if field in ("review", "proof"):
        if low not in ONOFF:
            raise Fail(f"{field} is on or off.")
        sets[field] = ONOFF[low]
    elif field == "review_rounds":
        m = re.fullmatch(r"(\d+)\s*(rounds?)?", low)
        if not m or not 0 <= int(m.group(1)) <= 10:
            raise Fail("review.rounds is 1 to 10 (0: no review).")
        sets[field] = int(m.group(1))
    elif field == "must_fix":
        if low not in MUST_VALUES:
            raise Fail("review.mustFix is blocker, major or minor.")
        sets[field] = MUST_VALUES[low]
    elif field == "merge":
        if low not in MERGE_VALUES:
            raise Fail('merge is "on its own", "after checks" or "ask me first".')
        sets[field] = MERGE_VALUES[low]
    elif field == "speed":
        if low not in SPEED_VALUES:
            raise Fail("speed is regular, fast or ultrafast.")
        t["speed"] = SPEED_VALUES[low]
    else:
        # Agents, models and efforts are the task's own fields (worker_pick reads them).
        if field in ("effort", "reviewer_effort") and low not in EFFORTS:
            raise Fail(f"{field.replace('_', ' ')} is one of {', '.join(sorted(EFFORTS))} (or default).")
        sets.pop(field, None)
        t[field] = v
    if not sets:
        t.pop("set", None)


def set_flags(t, agent, value):
    """A task's own extra flags for agent's CLI (#1222), kept per CLI: a task switched to the other CLI gets that one's
    (its own, else its space's). "" or "default": its space's again; "none": none, whatever its space says."""
    v = (value if isinstance(value, str) else FLAGS.words(value)).strip()
    own = dict(t.get("flags") or {}) if isinstance(t.get("flags"), dict) else {}
    if not v or v.lower() == "default":
        own.pop(agent, None)
    else:
        own[agent] = [] if v.lower() in ("none", "off") else FLAGS.parse(agent, v)
    if own:
        t["flags"] = own
    else:
        t.pop("flags", None)


def set_opts(t, args, s=None, space=None):
    """add/edit's --set pairs and --agent, --model, --effort, --flags, --reviewer, --reviewer-model,
    --reviewer-effort, in that order (a --set pair wins over its flag). s: the task's store, so its flags are
    checked against the CLI it will run (its own --agent, else its space's Task agent)."""
    def cli():
        return (worker_pick(s, t, space or t.get("space")).get("agent") if s else None) or t.get("agent") or "claude"
    for flag in ("agent", "model", "effort", "speed", "permission", "flags", "reviewer", "reviewer_model", "reviewer_effort"):
        v = getattr(args, flag, None)
        if v is not None:
            set_task(t, flag, v, cli() if flag == "flags" else None)
    for pair in getattr(args, "set", None) or []:
        if "=" not in pair:
            raise Fail(f"--set takes key=value, not {pair!r}.")
        k, v = pair.split("=", 1)
        set_task(t, k, v, cli() if SET_KEYS.get(k.strip().lower()) == "flags" else None)
    if getattr(args, "reviewer_model", None) or getattr(args, "reviewer", None) or any(
            SET_KEYS.get(p.split("=", 1)[0].strip().lower()) in ("reviewer", "reviewer_model") for p in getattr(args, "set", None) or []):
        check_reviewer_model(t)


def by_layer(s, space, section, key, value, default):
    """Who set a setting that differs from Herdr's default: "folder", "machine", "all", or None."""
    if value == default:
        return None
    everywhere, machine, mine = settings_layers(s, space)
    for by, layer in (("folder", mine), ("machine", machine), ("all", everywhere)):
        if key in ((layer.get(section) or {}) if key else {}) or (not key and layer.get(section)):
            return by
    return None


def cli_here(kind):
    """The last sign-in check's word on a CLI here (takeover.py's cli-check, which the scheduler
    keeps every 15 minutes): "ready", "signed-out", "missing" or None (unknown). Only read, never run."""
    from .takeover import read_checks
    return (((read_checks().get("machines") or {}).get("") or {}).get(kind))


CLI_NAMES = {"claude": "Claude Code", "codex": "Codex"}
LOGIN = {"claude": "claude auth login", "codex": "codex login"}


def codex_models():
    """The model ids Codex offers here: its models_cache.json, which Codex fetches for the account it is signed in
    with (a ChatGPT account gets fewer than an API key, #948); None when there is none to read."""
    home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    try:
        with open(os.path.join(home, "models_cache.json")) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    ids = [m.get("slug") for m in (d.get("models") or [] if isinstance(d, dict) else []) if isinstance(m, dict) and m.get("slug")]
    return ids or None


def codex_lacks(model):
    """The models Codex offers here when `model` isn't one of them (it would refuse to start on it), else None."""
    ids = codex_models()
    return ids if model and ids and model not in ids else None


# ---- finding a CLI as the person's shell does (#1228, #1190) -------------------------------------
# hc run starts a program with the core's PATH and gives it a bare one, so an agent CLI the person's shell
# finds (nvm, mise, npm's prefix, ~/.local/bin) can't start as a helper: "cannot start codex", or with its full
# path "env: node: No such file or directory". The shell agents start in says where it is.
BARE_DIRS = ("/usr/bin", "/bin", "/usr/sbin", "/sbin")
_cli = {}


def shell_which(name):
    """Where the person's interactive shell (as a task's agent starts in, launch.in_shell) finds `name`, or None."""
    sh = os.environ.get("SHELL") or "/bin/sh"
    flag = "-lic" if platform.system() == "Darwin" else "-ic"
    try:
        r = subprocess.run([sh, flag, 'printf "\n@herdr@%s@herdr@\n" "$(command -v ' + name + ')"'], stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"@herdr@(/[^\n@]*)@herdr@", r.stdout or "")
    return m.group(1) if m and os.access(m.group(1), os.X_OK) else None


def cli_path(name):
    """A CLI's full path: on this PATH, else the person's shell's (that one kept a few minutes: a long-running
    scheduler sees an update or an nvm switch)."""
    found = shutil.which(name)
    if found or not re.fullmatch(r"[\w.-]+", name):
        return found
    key = (name, os.environ.get("PATH"), os.environ.get("SHELL"))
    if key not in _cli or time.time() - _cli[key][1] > 300:
        _cli[key] = (shell_which(name), time.time())
    return _cli[key][0]


def cli_dirs(name):
    """The folders a CLI needs on PATH to start: its own, and node's for an npm script (#!/usr/bin/env node)."""
    p = cli_path(name)
    if not p:
        return []
    dirs = [os.path.dirname(p)]
    try:
        with open(os.path.realpath(p), "rb") as f:
            head = f.readline(200)
    except OSError:
        head = b""
    if head.startswith(b"#!") and b"node" in head:
        node = os.path.join(dirs[0], "node")
        node = node if os.access(node, os.X_OK) else cli_path("node")
        if node:
            dirs.append(os.path.dirname(node))
    return list(dict.fromkeys(dirs))


def cli_env(name):
    """'env "PATH=<its folders>:$PATH" ' before a helper's command so hc run finds the CLI and what it needs, the rest
    of the worker's PATH kept; "" when it is in the system's own folders or can't be found."""
    dirs = [d for d in cli_dirs(name) if d not in BARE_DIRS]
    if not dirs or any(re.search(r'["$`\\:]', d) for d in dirs):
        return ""
    return 'env "PATH=' + ":".join(dirs) + ':$PATH" '


# --no-daemon is what every Codex Shepherdr starts gets (#745); a Codex without it exits 2 on it (#1190).
UPDATE_CODEX = "npm install -g @openai/codex@latest, or brew upgrade codex"
_codex_old = {}


def codex_too_old():
    """'codex-cli 0.144.5 at <path>' when the Codex here has no --no-daemon (too old for Shepherdr), else None
    (new enough, or unknown: never blocks on a check that couldn't run)."""
    p = cli_path("codex")
    if not p:
        return None
    try:
        key = (p, os.stat(p).st_mtime)
    except OSError:
        return None
    if key not in _codex_old:
        env = {**os.environ, "PATH": ":".join(cli_dirs("codex") + [os.environ.get("PATH") or "/usr/bin:/bin"])}
        try:
            h = subprocess.run([p, "--help"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, env=env)
            v = subprocess.run([p, "--version"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15, env=env)
        except (OSError, subprocess.SubprocessError):
            return None
        old = h.returncode == 0 and "Usage" in (h.stdout or "") and "--no-daemon" not in h.stdout
        _codex_old[key] = f"{(v.stdout or '').strip() or 'codex'} at {p}" if old else None
    return _codex_old[key]


def codex_update_words(old):
    return (f"Codex here is too old for Shepherdr ({old} has no --no-daemon). Update it ({UPDATE_CODEX}), "
            "then start again.")


CLAUDE_MODEL = re.compile(r"^(claude-|opus|sonnet|haiku|fable)", re.I)


def check_reviewer_model(t):
    """add/edit: a reviewer model Codex here can't use is refused when it is set (#948), not found at review time."""
    m = t.get("reviewer_model")
    if not m or t.get("reviewer") == "claude" or (not t.get("reviewer") and CLAUDE_MODEL.match(m)):
        return
    ids = codex_lacks(m)
    if ids:
        raise Fail(f"Codex here doesn't offer {m} for the account it is signed in with: pick one of {', '.join(ids)} "
                   "(or leave the reviewer model unset for Codex's own default).")


def codex_login_now():
    """Codex's own word on its sign-in here, asked now (#947): (True, "") signed in, (False, what it said) when not
    (an unreadable auth file says an error, and Codex then opens its sign-in screen), (None, "") when unknown."""
    if not shutil.which("codex"):
        return None, ""
    try:
        r = subprocess.run(["codex", "login", "status"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None, ""
    out = f"{r.stdout}\n{r.stderr}"
    if re.search(r"^\s*logged in", out, re.I | re.M):
        return True, ""
    said = next((ln.strip() for ln in out.splitlines() if ln.strip()), "")
    return False, said[:160]


def trust_roots(folder):
    """The folders Codex asks to trust for an agent started in folder: the folder itself and its git
    repository's root, which for a worktree is the main checkout's (Codex: "Trusting will apply to
    the repository root")."""
    if not folder:
        return []
    out = [folder]
    ok, common, _ = git(folder, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if ok and common:
        root = os.path.dirname(common) if os.path.basename(common) == ".git" else \
            git(folder, "rev-parse", "--show-toplevel")[1]
        if root and root not in out:
            out.append(root)
    return out


def reviewer_command(who, model=None, effort=None, folder=None):
    """The command a worker starts its reviewer with (the brief's Reviewer line): read-only, and for
    Codex on its own app server (--no-daemon, as task agents run: a shared one can keep a sign-in
    since replaced, and every turn then fails, #745). Codex would first stop on its own screens,
    nobody at the keys (#798, #753): "Trust this folder?" in a folder it hasn't seen (the task's
    folder and its repository's root are trusted for this run only, as a table: a dotted
    projects."<path>" key breaks on a dot in the path, as in ~/.local) and "Hooks need review"
    when a hook is new or changed (hooks off: a read-only reviewer needs none, and they would run
    outside its sandbox)."""
    if who == "codex":
        a = ["codex", "--no-daemon", "--sandbox", "read-only", "--ask-for-approval", "never", "--disable", "hooks"]
        roots = trust_roots(folder)
        if roots:
            a += ["-c", "projects={" + ",".join(f'{json.dumps(r)}={{trust_level="trusted"}}' for r in roots) + "}"]
        a += ["-m", model] if model else []
        a += ["-c", f'model_reasoning_effort="{effort}"'] if effort else []
    elif who == "claude":
        # #1181: never plan mode (it wrote its report into a plan to approve): don't-ask mode with only the reading tools,
        # so a write or a command that isn't read-only is refused, never asked. --tools=… as one word: its list would
        # take the prompt after it as a tool.
        a = ["claude", "--permission-mode", "dontAsk", "--tools=" + REVIEW_TOOLS]
        a += ["--model", model] if model else []
        a += ["--effort", effort] if effort else []
        # #1131: hc run gives it hc's environment, not the worker's: the worker's own Claude profile, when it has one
        return (cli_env(who) or "env ") + CLAUDE_PROFILE + shlex.join(a)
    else:
        return None
    # #1228: hc run starts it with a bare PATH; its folders (nvm's, with node) go first, the worker's PATH after
    return cli_env(who) + shlex.join(a)


REVIEW_TOOLS = "Read,Grep,Glob,Bash"
# The worker's shell expands it: CLAUDE_CONFIG_DIR=<its folder> when the worker has one, nothing when it hasn't (an empty
# one would not be ~/.claude).
CLAUDE_PROFILE = '${CLAUDE_CONFIG_DIR:+"CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"} '


def task_settings(s, t, space=None, argv=None, live=False):
    """The settings that shape this task's work, each {label, text, value, by}. live: for a brief, so its Reviewer
    line is checked against what Codex says now (sign-in and models), not only the last periodic check."""
    space = space or t.get("space")
    cfg = settings_for(s, space)
    k, sets = cfg["tasks"], t.get("set") or {}
    lines = []

    def add(label, text, value, by):
        lines.append({"label": label, "text": text, "value": value, "by": by})

    rounds_cfg = int(k.get("review_rounds") or 0)
    # The Review its brief gave (keep_review): a setting changed while it runs is for tasks added
    # later, as the change's notice says (#750); the Assistant's own --set for it still wins.
    kept = t.get("brief_review") if "review" not in sets and "review_rounds" not in sets else None
    if "review" in sets:
        on, rev_by = sets["review"] == "on", "task"
    elif "review_rounds" in sets:
        on, rev_by = sets["review_rounds"] > 0, "task"
    elif kept:
        on, rev_by = bool(kept.get("on")), kept.get("by")
    else:
        on, rev_by = rounds_cfg > 0, by_layer(s, space, "tasks", "review_rounds", rounds_cfg > 0, False)
    here = t.get("mode") != "worktree"
    add("Review", "off" if not on else "on", on, rev_by)
    # What it runs on: the given argv, else its last agent's, else what it would start with.
    argv = argv or (t["agents"][-1].get("argv") if t.get("agents") else None) or worker_argv(s, t, space)
    agent = agent_key(argv)
    if on:
        rv = dict(cfg.get("reviewer") or {})
        if t.get("reviewer") and t["reviewer"] != rv.get("agent"):
            rv = {"agent": t["reviewer"]}
        rv_by = "task" if any(t.get(f) for f in ("reviewer", "reviewer_model", "reviewer_effort")) else \
            by_layer(s, space, "reviewer", None, bool(cfg.get("reviewer")), False)
        for f in ("model", "effort"):
            if t.get(f"reviewer_{f}"):
                rv[f] = t[f"reviewer_{f}"]
        other = {"claude": "codex", "codex": "claude"}.get(agent)
        want = rv.get("agent") or (other if other and shutil.which(other) else agent)
        who, said = want, ""
        if want != agent and cli_here(want) == "signed-out":
            # Signed out here, it would sit at its sign-in screen and never review (#745): the task's own CLI does.
            who, rv = agent, {}
        elif want == "codex" and want != agent and live:
            # #947: the periodic check can't read every answer (an unreadable auth file says an error, not "Not logged
            # in"), so a brief asks Codex now; anything but signed in would leave the reviewer on its sign-in screen
            ok, said = codex_login_now()
            if ok is False:
                who, rv = agent, {}
        # #1190: a Codex without --no-daemon exits at once: the worker's own CLI reviews, and the line says to update
        old = codex_too_old() if who == "codex" and agent != "codex" else None
        if old:
            who, rv = agent, {}
        # #948: a model Codex here doesn't offer this account stops it at once: its own default instead, said
        lacks = codex_lacks(rv.get("model")) if who == "codex" else None
        dropped = rv.get("model")
        if lacks:
            rv = {k: v for k, v in rv.items() if k != "model"}
        text = who + (f", model {rv['model']}" if rv.get("model") else "") + (f", effort {rv['effort']}" if rv.get("effort") else "")
        if lacks:
            text += (f" (Codex's own default model: Codex here doesn't offer {dropped} "
                     "for the account it is signed in with)")
        if old:
            text += (f" (your own CLI: Codex here is too old for Shepherdr, {old} has no --no-daemon; the person updates "
                     f"it ({UPDATE_CODEX}), then asks for the review again)")
        elif who != want:
            text += (f" (your own CLI: {CLI_NAMES.get(want, want)} isn't signed in here"
                     + (f", `{LOGIN.get(want, want + ' login')} status` says \"{said}\"" if said and not re.match(r"not logged in", said, re.I) else "")
                     + f"; the person runs `{LOGIN.get(want, want + ' login')}` on this machine, then asks for the review again)")
        elif not rv.get("agent"):
            text += " (the other CLI)" if who != agent else " (your own CLI: no other is installed)"
        folder = t.get("worktree") or getattr(s, "loc", {}).get("folder")
        cmd = reviewer_command(who, rv.get("model"), rv.get("effort"), folder)
        if cmd:
            text += f"; start it as `{cmd}`"
        add("Reviewer", text, {"agent": who, "model": rv.get("model"), "effort": rv.get("effort"), "command": cmd}, rv_by)
        must = sets.get("must_fix") or (k.get("must_fix") if k.get("must_fix") in LEVELS else "major")
        add("Must fix", MUST_WORDS[must], must, "task" if "must_fix" in sets else by_layer(s, space, "tasks", "must_fix", must, "major"))
        rounds = sets.get("review_rounds") or (kept or {}).get("rounds") or (rounds_cfg if rounds_cfg > 0 else 3)
        more = int(t.get("review_rounds_added") or 0)
        add("Review rounds", f"at most {rounds + more}" + (f" ({more} added by the assistant)" if more else ""), rounds + more,
            "task" if "review_rounds" in sets else (kept or {}).get("rounds_by") if kept else
            by_layer(s, space, "tasks", "review_rounds", rounds, 3))
    policy = sets.get("merge") or (k.get("merge") if k.get("merge") in MERGE_WORDS else "ask")
    m_by = "task" if "merge" in sets else by_layer(s, space, "tasks", "merge", policy, "ask")
    if here:
        add("Merge", "nothing to merge: you work in the folder itself, and the person marks it as done", policy, m_by)
    else:
        add("Merge", MERGE_WORDS[policy], policy, m_by)
        if t.get("base_set"):
            add("Base", f"{t['base']}: your branch starts from it and merges into it", t["base"],
                "folder" if t.get("base_by") == "space" else "task")
    proof = sets["proof"] == "on" if "proof" in sets else k.get("proof") is not False
    add("Proof", PROOF_WORDS["on" if proof else "off"], proof,
        "task" if "proof" in sets else by_layer(s, space, "tasks", "proof", proof, True))
    model, effort = argv_model(argv)
    extra = FLAGS.extra(agent, argv)
    text = agent + (f", model {model}" if model else "") + (f", effort {effort}" if effort else "") + \
        (f", extra flags {FLAGS.words(extra)}" if extra else "")
    own_flags = agent in (t.get("flags") or {}) if isinstance(t.get("flags"), dict) else False
    a_by = "task" if any(t.get(f) for f in ("agent", "model", "effort")) or own_flags else \
        by_layer(s, space, "worker", None, bool(cfg.get("worker")), False) or \
        (by_layer(s, space, "tasks", f"{agent}_flags", extra, []) if extra else None)
    add("Agent", text, {"agent": agent, "model": model, "effort": effort, "flags": extra}, a_by)
    # Suggested next message (SHEP-186): the reply ends with the words the person would likely send next (templates/worker.md)
    sug = (cfg.get("agents") or {}).get("suggestions") is not False
    add("Suggested next message", "on (your reply ends with the message you'd likely send next, shown greyed out in the box)" if sug
        else "off (no suggested next message)", sug, by_layer(s, space, "agents", "suggestions", sug, True))
    return lines


def settings_block(s, t, space=None, argv=None, live=False):
    lines = task_settings(s, t, space, argv, live)
    rows = [f"- {x['label']}: {x['text']}" + (f" ({SET_BY[x['by']]})" if x["by"] else "") for x in lines]
    # Codex's sandbox can't start here (SHEP-227, #998): the worker hears it in its brief and tells the person.
    word = sandbox_word(lines, argv or (t["agents"][-1].get("argv") if t.get("agents") else None) or worker_argv(s, t, space))
    if word:
        rows.append(f"- Sandbox: {word}")
    return "\n".join([SETTINGS_HEAD, *rows])


def sandbox_word(lines, argv):
    """The Settings block's Sandbox line when this task's worker or reviewer runs Codex in its
    sandbox and that sandbox can't start on this machine (sandbox.check), else None."""
    from . import sandbox
    rv = next((x["value"] for x in lines if x["label"] == "Reviewer"), None) or {}
    if not (sandbox.sandboxed(argv) or rv.get("agent") == "codex"):
        return None
    broken = sandbox.check()
    return sandbox.notice(broken, short=True) if broken else None


def keep_review(s, t, space=None):
    """A fresh brief gives today's Review: kept on the task (brief_review), so its Settings block,
    ready and reviewed keep agreeing with that brief while it runs (#750)."""
    t.pop("brief_review", None)
    rows = {x["label"]: x for x in task_settings(s, t, space)}
    rev, rounds = rows["Review"], rows.get("Review rounds")
    t["brief_review"] = {"on": bool(rev["value"]), "by": rev["by"]}
    if rounds:
        t["brief_review"].update(rounds=rounds["value"] - int(t.get("review_rounds_added") or 0), rounds_by=rounds["by"])


def review_limits(s, t):
    """(review on, rounds allowed now): the Settings block's Review and Review rounds lines, with
    the rounds the assistant added (review-more)."""
    on, rounds = False, 0
    for x in task_settings(s, t):
        if x["label"] == "Review":
            on = x["value"]
        elif x["label"] == "Review rounds":
            rounds = x["value"]
    return on, rounds


def space_base(s, space=None):
    """The branch a space's new tasks branch from and merge into (Shepherdr settings > Tasks >
    Base branch, per space); "" when unset: the folder's current branch."""
    return str(settings_for(s, space)["tasks"].get("base") or "").strip()


# Shepherdr settings > Tasks > Branch names (tasks.branch, #570): a folder's new task branches.
# {n}: the task's number, {key}: its id (SHEP-4), {slug}: its title's words. Unset: this.
BRANCH_PATTERN = "task/{n}-{slug}"


def branch_pattern_problem(pattern):
    """Why a Branch names pattern can't be used, or None (core/settings.js branchPattern says the same)."""
    p = str(pattern or "").strip()
    if not p:
        return None
    if "{n}" not in p and "{key}" not in p:
        return "Put {n} or {key} in it, so each task's branch is its own."
    if re.search(r"\{(?!(?:n|key|slug)\})[^}]*\}", p):
        return "Only {n}, {key} and {slug} can be filled in."
    sample = p.replace("{n}", "4").replace("{key}", "ABC-4").replace("{slug}", "fix-login")
    if (sample.startswith("-") or sample.startswith("/") or sample.endswith("/") or sample.endswith(".") or sample.endswith(".lock")
            or re.search(r"[\s~^:?*\[\\]|\.\.|@\{|//|/\.", sample)):
        return "That isn't a name git allows for a branch."
    return None


def merge_policy(s, t):
    """How a ready task merges: its own --set merge, else Settings' (auto, checks or ask)."""
    p = (t.get("set") or {}).get("merge") or settings_for(s, t.get("space"))["tasks"].get("merge")
    return p if p in MERGE_WORDS else "ask"

def agent_argv(key, argv_json=None):
    if argv_json:
        argv = json.loads(argv_json)
        if not isinstance(argv, list) or not argv:
            raise Fail("--argv must be a JSON list")
        argv = [str(x) for x in argv]
    else:
        argv = list(AGENTS.get(key, [key]))
    # Codex runs its commands outside hc without --no-daemon.
    if agent_key(argv) == "codex" and "--no-daemon" not in argv:
        argv.append("--no-daemon")
    return argv


def agent_key(argv):
    return os.path.basename(argv[0])


def bare(i):
    """Ids as labels use them: "vm/sp12" -> "sp12"."""
    return i.split("/")[-1] if i else i


def machine_limits(machine=None):
    """A machine's start limits (Settings > Machines; HERD-40): Everywhere's ("everywhere" ->
    "machine"), then that machine's own ("machines" -> its key -> "machine"; "local" is this
    computer, and a file Herdr pushed to another machine names it in "here"). Each is a number,
    or null for off; one not set is Shepherdr's default (machine.HOLD)."""
    from .machine import hold_limits
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    key = machine or d.get("here") or "local"
    out = dict((d.get("everywhere") or {}).get("machine") or {})
    out.update(((d.get("machines") or {}).get(key) or {}).get("machine") or {})
    return hold_limits(out)


def machine_option(name, default=None, machine=None):
    """One of a machine's own settings (Settings > Machines; HERD-61: low_priority, worker_memory):
    Everywhere's "machine" layer, then the machine's own; set in neither: default."""
    try:
        with open(SETTINGS) as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    if not isinstance(d, dict):
        return default
    key = machine or d.get("here") or "local"
    out = default
    for layer in ((d.get("everywhere") or {}).get("machine") or {}, ((d.get("machines") or {}).get(key) or {}).get("machine") or {}):
        if name in layer:
            out = layer[name]
    return out


def machine_name():
    """This machine's name as Herdr's window knows it (a pushed settings file's "here"), else None."""
    try:
        with open(SETTINGS) as f:
            return json.load(f).get("here") or None
    except (OSError, ValueError, AttributeError):
        return None
