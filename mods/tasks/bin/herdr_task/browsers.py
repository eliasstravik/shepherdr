"""Tasks' browsers (HERD-57): each task has one agent-browser session, driven through herdr-browser
(~/.config/herdr-app/bin), on the machine where the task runs. Its files are in ~/.local/state/shepherdr/browser:
the profile folder <name> (sign-ins), <name>.task (its herdr.task key), <name>.used (the agent's or
the person's last use), <name>.you (the person drives it), <name>.view (the panel's live viewer,
bin/herdr-browser-view, is wanted: it ends by itself once this goes stale). A tick (browser_pass) closes:
- a Done or removed task's browser, and forgets its sign-ins (the profile goes);
- one idle longer than the machine's browser_idle_close minutes (Settings > Machines; 10 when not
  set; 0 or "off": never), sign-ins kept. The agent's next command opens it again."""

import hashlib
import json
import os
import shutil
import subprocess
import time

from .base import addon_off, HOME, STORE, WHERE

ROOT = WHERE.path("browser")
IDLE_MIN = 10
YOU_FRESH_S = 120  # as herdr-browser: a take-over the panel stopped refreshing has ended


def session_of(key, name):
    """agent-browser's session for a task (as bin/herdr-browser): herdr-<name>, or for a name over 32 characters its
    last 20 and 8 hex of the key's sha256 (SHEP-178: a long one overflows agent-browser's socket path)."""
    if len(name) <= 32:
        return "herdr-" + name
    return "herdr-%s-%s" % (name[-20:].lstrip("-"), hashlib.sha256(key.encode()).hexdigest()[:8])


def browser_path():
    """herdr-browser on PATH (~/.local/bin), else None: then workers aren't told about a browser
    (also while the browser add-on is off)."""
    return None if addon_off("browser") else shutil.which("herdr-browser")


def browser_line():
    """The worker's brief: its browser's exact command, or "" where there's none."""
    bp = browser_path()
    if not bp:
        return ""
    return (f" Your task has its own browser (agent-browser, kept for this task with its sign-ins; the person can watch it "
            f"in Herdr): run `{bp} <agent-browser command>`, e.g. `{bp} open http://localhost:3000`, `{bp} snapshot -i`, "
            f"`{bp} screenshot`; never pass --session or --profile, and its commands run without asking.")


def idle_ms():
    from .settings import machine_option
    v = machine_option("browser_idle_close", IDLE_MIN)
    try:
        m = float(v)
    except (TypeError, ValueError):
        return None
    return m * 60000 if m > 0 else None


def _task(key):
    """(found, task): found is False when its list can't be read here (leave it alone)."""
    slug, _, tid = key.partition("#")
    try:
        with open(os.path.join(STORE, slug + ".json")) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return False, None
    for t in d.get("tasks") or []:
        if str(t.get("id")) == tid:
            return True, t
    return True, None


def _age_ms(path):
    try:
        return (time.time() - os.path.getmtime(path)) * 1000
    except OSError:
        return None


def _close(bp, key):
    try:
        subprocess.run([bp, "--own", "--task", key, "close"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    except (OSError, subprocess.SubprocessError):
        pass


def _agent_browser(bp):
    """The agent-browser herdr-browser runs (Shepherdr's own copy, or the PATH's), else the PATH's."""
    try:
        r = subprocess.run([bp, "--bin"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True, timeout=20)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return shutil.which("agent-browser")


def _live_sessions(bp):
    ab = _agent_browser(bp)
    if not ab:
        return set()
    try:
        r = subprocess.run([ab, "session", "list", "--json"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           universal_newlines=True, timeout=20)
        return set((json.loads(r.stdout).get("data") or {}).get("sessions") or [])
    except (OSError, ValueError, subprocess.SubprocessError, AttributeError):
        return set()


def browser_pass(report):
    """Closes Done/removed tasks' browsers (forgetting sign-ins) and idle ones (keeping them)."""
    try:
        names = sorted(f[:-5] for f in os.listdir(ROOT) if f.endswith(".task") and not f.startswith("."))
    except OSError:
        return
    bp = browser_path()
    if not names or not bp:
        return
    live, idle = None, idle_ms()
    for name in names:
        try:
            with open(os.path.join(ROOT, name + ".task")) as f:
                key = f.read().strip()
        except OSError:
            continue
        found, t = _task(key)
        if not found:
            continue
        if t is None or t.get("state") == "done":
            _close(bp, key)
            shutil.rmtree(os.path.join(ROOT, name), ignore_errors=True)
            for ext in (".used", ".you", ".view", ".new", ".session", ".task"):
                try:
                    os.remove(os.path.join(ROOT, name + ext))
                except OSError:
                    pass
            report.setdefault("browsers_forgotten", []).append(key)
            continue
        if idle is None:
            continue
        if live is None:
            live = _live_sessions(bp)
        if session_of(key, name) not in live:
            continue
        you = _age_ms(os.path.join(ROOT, name + ".you"))
        if you is not None and you < YOU_FRESH_S * 1000:
            continue
        used = _age_ms(os.path.join(ROOT, name + ".used"))
        if used is None or used >= idle:
            _close(bp, key)
            report.setdefault("browsers_closed", []).append(key)
