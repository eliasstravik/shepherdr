"""Shared ground: paths, Fail, the clock, this herdr-task's own files, and running programs
(hc, herdr-app, git) only in the real environment."""

import io
import json
import os
import pwd
import re
import subprocess
import time
import zipfile


from . import layout

VERSION = "1"
HOME = os.path.expanduser("~")
# GitHub #1117: a herdr-core started by launchd or systemd hands what it runs (hc exec --on from another machine) a bare
# PATH (/usr/bin:/bin), so hc, gh and the agents' CLIs wouldn't be found. When hc isn't on it, their usual folders go
# at the end: the person's own order still wins.
if not __import__("shutil").which("hc"):
    os.environ["PATH"] = os.pathsep.join([p for p in os.environ.get("PATH", "").split(os.pathsep) if p] + [
        d for d in (os.path.join(HOME, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin")
        if d not in os.environ.get("PATH", "").split(os.pathsep)])
# Shepherdr's own folders (layout.py): ~/.local/share/shepherdr/tasks once this machine's data moved
# there, else the old ~/.herdr/tasks (the entry moves it first, so a run sees one or the other).
WHERE = layout.Where()
# HERDR_TASK_STORE: another task list (a test's own), as HERDR_TASK_SETTINGS for settings.
STORE = os.environ.get("HERDR_TASK_STORE") or WHERE.path("tasks")
# Where new task worktrees go (a task keeps the one it has; Settings > Tasks > Worktree folder picks another).
WORKTREES = WHERE.worktrees()


def beside_store(kind, name):
    """A herdr-task file kept beside the task lists: its own place in Shepherdr's folders, or beside a
    test's own HERDR_TASK_STORE."""
    if os.environ.get("HERDR_TASK_STORE"):
        return os.path.join(os.path.dirname(STORE.rstrip("/")), name)
    return WHERE.path(kind)
LEGACY = os.path.join(HOME, ".config", "herdr-app", "data", "tasks")
SHELLS = {"bash", "zsh", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "pwsh", "powershell", "elvish"}
RANK = {"blocked": 4, "done": 3, "working": 2, "idle": 1}
# Claude Code's sign that a message waits in its own queue (core/send.js QUEUED): its Ctrl+Enter then sends it now
QUEUED = re.compile(r"ctrl\+enter to send now|press up to edit queued messages|^\s*⎿\s+Queued\b", re.I | re.M)
GH = os.environ.get("HERDR_TASK_GH") or "gh"
# How often tick asks GitHub about a pull request (ms).
PR_EVERY = 60000


class Fail(Exception):
    pass


# Shepherdr's installer (bin/shepherdr) puts this file here while it replaces helpers or templates,
# and removes it once `shepherdr doctor` finds the install whole. Until then nothing copies a helper
# to another machine: not the sync, not a command's self-copy (cli.remote, herdr-artifact's,
# herdr-secret's install --on), so a half-done or wrong copy never reaches every machine.
# It is in Shepherdr's state folder; an older installer's is at ~/.herdr/sync-hold: either holds.
SYNC_HOLD = os.path.join(WHERE.roots["state"], "sync-hold")
SYNC_HOLDS = (SYNC_HOLD, os.path.join(HOME, ".herdr", "sync-hold"))


def sync_held():
    """Why copies to other machines wait now (the hold's first line), or None."""
    for p in SYNC_HOLDS:
        try:
            with open(p) as f:
                return f.readline().strip() or "held by Shepherdr's installer"
        except OSError:
            continue
    return None


# The web app's optional plugins (Settings › Plugins; service/next.ts PLUGINS): one switched off is in Everywhere's
# "plugins_off" in the settings file (or HERDR_TASK_SETTINGS). herdr-task obeys the two that are its own work:
# "schedules" off, the scheduler starts no schedule's run; "screens" off, a worker gets no browser.
PLUGINS = ("terminal", "screens", "voice", "schedules", "reactions")
# 3.1's add-on names still asked for by callers, as the plugin that took their place.
_PLUGIN_OF = {"browser": "screens"}


def plugin_off(name):
    path = os.environ.get("HERDR_TASK_SETTINGS") or WHERE.path("settings")
    try:
        with open(path) as f:
            off = (json.load(f).get("everywhere") or {}).get("plugins_off")
    except (OSError, ValueError, AttributeError):
        return False
    return isinstance(off, list) and _PLUGIN_OF.get(name, name) in off


addon_off = plugin_off


def now():
    return int(time.time() * 1000)


# ---- the stop log (SHEP-189) ----------------------------------------------------------------------
# Every time an agent goes (Shepherdr ends it, or its terminal is gone while its task is running),
# one line here: when, what, which terminal, and what Herdr knew then. Kept small: the last
# STOP_LOG_LINES lines. Never raises: logging must not stop the work it records.
STOP_LOG = os.path.join(STORE, ".stops.jsonl")
STOP_LOG_LINES = 500


def stop_note(kind, **fields):
    """Appends {at, kind, ...fields} to the stop log (a JSON line)."""
    try:
        os.makedirs(os.path.dirname(STOP_LOG), exist_ok=True)
        try:
            with open(STOP_LOG) as f:
                lines = f.readlines()
        except OSError:
            lines = []
        lines = lines[-(STOP_LOG_LINES - 1):] + [json.dumps({"at": now(), "kind": kind, **fields}, ensure_ascii=False) + "\n"]
        tmp = f"{STOP_LOG}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            f.writelines(lines)
        os.replace(tmp, STOP_LOG)
    except Exception:  # noqa: BLE001 - a log line never stops the agent work it records
        pass


# ---- Shepherdr's own herdr-core session (3.2) --------------------------------------------------
# Shepherdr's agents, tasks, scheduler and terminals live in a herdr-core named session of their own
# (hc's HC_SESSION), never in the default one the Herdr app shows. So every hc this process runs, and
# every program it starts (an agent's own herdr-task and hc calls, the scheduler, hc --on to another
# machine) is in SESSION: the environment says so from here on. A terminal started in a session gets
# HC_SESSION from its core, so an agent calling herdr-task or hc from inside lands in the same one.
# SHEPHERDR_SESSION: another name (a test's throwaway core).
SESSION = os.environ.get("SHEPHERDR_SESSION") or "shepherdr"
# The session Shepherdr lived in until 3.2 (the default one, the Herdr app's): only read, and only by what carries
# its data over (carry_over.py, machines.adopt). SHEPHERDR_FROM_SESSION: another name (a test's throwaway core).
OLD_SESSION = os.environ.get("SHEPHERDR_FROM_SESSION") or "default"
# As herdr-task was called: None, "", "default" (a shell, the Herdr app's terminal) and SESSION are
# taken into Shepherdr's session; any other is someone else's (a test's), and hc is refused (guard).
CALLER_SESSION = os.environ.get("HC_SESSION")
FOREIGN_SESSION = CALLER_SESSION not in (None, "", "default", SESSION)
# Called from a terminal of another session (the default one): that terminal is nobody in Shepherdr's.
FOREIGN_TERMINAL = False


def session_socket(name):
    return os.path.basename(name or "") == f"{SESSION}.sock"


if not FOREIGN_SESSION:
    os.environ["HC_SESSION"] = SESSION
    if os.environ.get("HC_TERMINAL_SOCKET") and not session_socket(os.environ["HC_TERMINAL_SOCKET"]):
        FOREIGN_TERMINAL = True
        for _k in ("HC_TERMINAL_ID", "HC_TERMINAL_SOCKET"):
            os.environ.pop(_k, None)


# ---- the real environment -------------------------------------------------------------------
# With a changed HOME, HERDR_APP_HOME or another herdr-core session than Shepherdr's (a test's),
# herdr-app and hc could still reach the person's real core and overwrite every machine's spaces.
# So herdr-task then refuses to run them at all, with why (HERD-55).
GUARDED = {"hc", "herdr-core", "herdr-app"}


def real_home():
    try:
        return pwd.getpwuid(os.getuid()).pw_dir
    except KeyError:
        return os.path.expanduser("~")


def not_real():
    """Why this environment isn't the account's own, or None when it is."""
    env, home = os.environ, real_home()
    same = lambda a, b: os.path.realpath(a) == os.path.realpath(b)
    if env.get("HOME") and not same(env["HOME"], home):
        return f"HOME is {env['HOME']}, not {home}"
    app = env.get("HERDR_APP_HOME")
    if app and not same(app, os.path.join(home, ".config", "herdr-app")):
        return f"HERDR_APP_HOME is {app}"
    if env.get("HC_SESSION") != SESSION:
        return f"HC_SESSION is {env.get('HC_SESSION') or 'not set'}, not Shepherdr's own ({SESSION})"
    sock = env.get("HC_SOCKET")
    if sock and not session_socket(sock) and not (env.get("HC_TERMINAL_SOCKET") and same(sock, env["HC_TERMINAL_SOCKET"])):
        return f"HC_SOCKET is {sock}"
    return None


def guard(args):
    """Refuses herdr-app and hc outside the real environment (see not_real)."""
    name = os.path.basename(args[0])
    why = not_real() if name in GUARDED else None
    if why:
        raise Fail(f"refusing to run {name}: {why}. Run herdr-task with the real HOME, HERDR_APP_HOME, "
                   f"and HC_SESSION unset or {SESSION} (SHEPHERDR_SESSION names another): changed ones can reach "
                   "the real core and wipe its spaces.")


def run(args, cwd=None, check=False, env=None, stdin=None):
    guard(args)
    r = subprocess.run(args, cwd=cwd, env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    if check and r.returncode != 0:
        raise Fail((r.stderr or r.stdout).strip() or f"{args[0]} failed")
    return r


# git never asks anyone for a password (#1260): a fetch or push to an HTTPS remote with no
# credential helper fails at once instead of waiting for a username nobody will type, which held
# every herdr-task call for that folder.
GIT_QUIET = {"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
NO_SIGN_IN = ("terminal prompts disabled", "could not read username", "could not read password")


def git(cwd, *args):
    r = run(["git", "-C", cwd, *args], env={**os.environ, **GIT_QUIET}, stdin=subprocess.DEVNULL)
    err = r.stderr.strip()
    if r.returncode != 0 and any(s in err.lower() for s in NO_SIGN_IN):
        err = f"git can't sign in to the remote: set up a credential helper or SSH key for it. ({err})"
    return r.returncode == 0, r.stdout.strip(), err


# Claude Code keeps reporting "working" after its turn ended while background work of its own still runs, its message
# only that work ("1 shell still running", "2 shells still running"). That is no turn: its task is at rest, a message
# goes straight in. The same rule is Shepherdr's core/send.js BG_ONLY.
BG_ONLY = re.compile(r"^\d+ [a-z][a-z-]*(?:(?:, | and )\d+ [a-z][a-z-]*)* still running\.?$", re.I)


def at_rest(st):
    """An hc status (hc get's object) as it really is: "working" that is only background work becomes "done", what
    still runs kept as "bg" and no longer as its message. Any other status unchanged."""
    if not isinstance(st, dict) or st.get("state") != "working" or not BG_ONLY.match(str(st.get("msg") or "").strip()):
        return st
    out = {k: v for k, v in st.items() if k != "msg"}
    out.update(state="done", bg=str(st.get("msg")).strip())
    return out


def rest_record(k):
    """An hc record with its status as it really is (at_rest)."""
    return dict(k, status=at_rest(k["status"])) if isinstance(k, dict) and isinstance(k.get("status"), dict) else k


def _rest_list(d):
    """hc ls's terminals with their status as it really is: hc ls says only "working", so a working Claude Code is
    read in full (hc get) for its message; at rest, its row says "done"."""
    for i, k in enumerate((d or {}).get("terminals") or [] if isinstance(d, dict) else []):
        st = k.get("status")
        if (st.get("state") if isinstance(st, dict) else st) != "working" or "claude" not in str(k.get("agent") or "claude"):
            continue
        if isinstance(st, dict) and st.get("msg") is not None:
            d["terminals"][i] = rest_record(k)
            continue
        full = rest_record(_hc_raw("get", k["address"]) or {})
        now = full.get("status")
        if isinstance(now, dict) and now.get("state") == "done" and now.get("bg"):
            d["terminals"][i] = dict(k, status="done" if isinstance(st, str) else now)
    return d


def _hc_raw(*args):
    r = run(["hc", *args, "--json"])
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except ValueError:
        return None


def hc_json(*args):
    """hc's answer as JSON, None when it fails. A terminal's status as it really is (at_rest): background work alone
    is no turn."""
    d = _hc_raw(*args)
    if args[:1] == ("get",):
        return rest_record(d)
    if args[:1] == ("ls",):
        return _rest_list(d)
    return d
APP_HOME = os.path.join(HOME, ".config", "herdr-app")
# Where a machine that only runs tasks keeps the chat's question-card hook (hooks/ask-hook.sh
# and ask-end.py), synced there beside herdr-task (machines.manifest; launch.ask_hook runs it).
ASK_HOME = os.path.join(".local", "share", "herdr", "ask")
# ---- this herdr-task ------------------------------------------------------------------------
# herdr-task is a thin entry beside this package; on another machine it is one zipapp holding
# both (remote installs it as ~/.local/bin/herdr-task). ENTRY is what runs it again (agents' own
# commands, _track, the scheduler); bundle() is all of it as that one file.
PACKAGE = os.path.dirname(os.path.realpath(__file__))
_OUTER = os.path.dirname(PACKAGE)
ENTRY = _OUTER if os.path.isfile(_OUTER) else os.path.join(_OUTER, "herdr-task")


def _share():
    """Shepherdr's own install folder (bin/shepherdr's SHARE: service/, hooks/, templates/, installed.json), found
    from where this herdr-task lives: <SHARE>/mods/tasks/bin/herdr_task, so in a checkout it is the repo. A lone
    copy (the zipapp a sync left in ~/.local/bin) has none beside it: ~/.local/share/shepherdr, should one be there.
    SHEPHERDR_SHARE: another folder (a test's own)."""
    if os.environ.get("SHEPHERDR_SHARE"):
        return os.environ["SHEPHERDR_SHARE"]
    parts = _OUTER.split(os.sep)
    if os.path.isdir(_OUTER) and parts[-3:] == ["mods", "tasks", "bin"]:
        return os.sep.join(parts[:-3]) or os.sep
    return os.path.join(HOME, ".local", "share", "shepherdr")


SHARE = _share()


def bundle():
    """This herdr-task as one runnable file (a zipapp), the same bytes for the same code."""
    if zipfile.is_zipfile(ENTRY):
        with open(ENTRY, "rb") as f:
            return f.read()
    with open(ENTRY, "rb") as f:
        entry = f.read()
    buf = io.BytesIO()
    buf.write(b"#!/usr/bin/env python3\n")
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo("__main__.py", (1980, 1, 1, 0, 0, 0)), entry, zipfile.ZIP_DEFLATED)
        for name in sorted(os.listdir(PACKAGE)):
            if name.endswith(".py"):
                with open(os.path.join(PACKAGE, name), "rb") as f:
                    z.writestr(zipfile.ZipInfo(f"herdr_task/{name}", (1980, 1, 1, 0, 0, 0)), f.read(), zipfile.ZIP_DEFLATED)
    return buf.getvalue()
