"""Agents' browsers (3.2; HERD-57 before it): each SPACE has one headless Chrome on one profile, so a site signed in
to once is signed in for every agent of the space, and each task (and the space's chat's own agent) has its own page in
it, driven through herdr-browser (~/.local/bin) on the machine where it runs. Their files are in
~/.local/state/shepherdr/browser: the profile folders spaces/<space> (sign-ins), spaces/<space>.cdp (its Chrome runs),
spaces/<space>.used (its last use), and per agent <name>.task (its herdr.task key, or chat:<space>), <name>.space,
<name>.used (the agent's last command), <name>.you (the person drives it). A tick (browser_pass) closes:
- a Done or removed task's page, once its agent has stopped using it (GitHub #1138: an auto-merged task's agent still
  checking its proof got a blank page between two commands), and stops its own desktop (herdr-desktop). The space's
  browser and its sign-ins stay: they are the space's, not the task's;
- a space's browser idle longer than the machine's browser_idle_close minutes (Settings > Machines; 10 when not
  set; 0 or "off": never), sign-ins kept. An agent's next command starts it again.
A closed browser leaves <name>.closed saying why: herdr-browser tells the agent once that its page and viewport start
fresh, instead of a silent about:blank (#1147)."""

import hashlib
import json
import os
import shutil
import subprocess
import time

from .base import addon_off, HOME, STORE, WHERE

ROOT = WHERE.path("browser")
IDLE_MIN = 10
YOU_FRESH_S = 11 * 60  # as herdr-browser: a take-over nobody refreshed that long has ended (the service hands back at 10)


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


def desktop_path():
    """herdr-desktop on PATH, else None (also while the browser add-on is off)."""
    return None if addon_off("browser") else shutil.which("herdr-desktop")


def browser_line():
    """The worker's brief: its browser's and desktop's exact commands, or "" where there's none."""
    bp = browser_path()
    if not bp:
        return ""
    text = (f" You have your own tab in your space's browser (agent-browser; sign-ins are shared with the space's other agents, and "
            f"the person can watch it and take over in Shepherdr): run `{bp} <agent-browser command>`, e.g. `{bp} open "
            f"http://localhost:3000`, `{bp} snapshot -i`, `{bp} screenshot`; never pass --session or --profile, and its commands "
            f"run without asking. A step only a person can do there (a sign-in code, a captcha, a payment): `{bp} hands \"<what, in a "
            f"few words>\"`, then stop and wait for their message.")
    dp = desktop_path()
    if dp:
        text += (f" For what a page can't do (a desktop app, a file dialog) you have a desktop too: `{dp} <agent-desktop command>`, "
                 f"e.g. `{dp} snapshot`, `{dp} click @e3`; `{dp} hands \"<what>\"` asks for the person there.")
    return text


def browser_env(key, space):
    """What a worker's shell carries so herdr-browser and herdr-desktop know whose they are without asking Herdr:
    its task and its space (bare: "sp12", not "vm/sp12")."""
    env = [f"HERDR_BROWSER_TASK={key}"]
    if space:
        env.append(f"HERDR_BROWSER_SPACE={space}")
    return env


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


def _read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def _own(argv):
    try:
        subprocess.run(argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    except (OSError, subprocess.SubprocessError):
        pass


def _forget(bp, key, space):
    """A Done task's page closed and its files gone; its own desktop stopped. The space's browser stays."""
    whose = ["--own", "--task", key] + (["--space", space] if space else [])
    _own([bp] + whose + ["--forget"])
    dp = desktop_path()
    if dp:
        _own([dp] + whose + ["--down"])


def _close_space(bp, space, why):
    """The space's browser stopped (every agent's page with it), sign-ins kept; each agent is told why once."""
    _own([bp, "--own", "--chat", "--space", space, "--close-space", why])


def browser_pass(report):
    """Closes Done/removed tasks' pages, and the browsers of spaces nobody used for a while (sign-ins kept)."""
    bp = browser_path()
    if not bp:
        return
    try:
        names = sorted(f[:-5] for f in os.listdir(ROOT) if f.endswith(".task") and not f.startswith("."))
    except OSError:
        return
    idle = idle_ms()
    driven = set()  # spaces where the person drives an agent's page now: never closed under them
    for name in names:
        key = _read(os.path.join(ROOT, name + ".task"))
        space = _read(os.path.join(ROOT, name + ".space"))
        you = _age_ms(os.path.join(ROOT, name + ".you"))
        if you is not None and you < YOU_FRESH_S * 1000:
            driven.add(space)
        if not key or key.startswith("chat:"):
            continue  # a space's chat's own: it lives as long as its space
        found, t = _task(key)
        if not found or not (t is None or t.get("state") == "done"):
            continue
        used = _age_ms(os.path.join(ROOT, name + ".used"))
        if used is not None and used < (idle or IDLE_MIN * 60000):
            continue  # its agent is still at work in it (checking a proof after merge): later
        _forget(bp, key, space)
        report.setdefault("browsers_forgotten", []).append(key)
    if idle is None:
        return
    try:
        spaces = sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, "spaces")) if f.endswith(".cdp"))
    except OSError:
        return
    for space in spaces:
        if space in driven or os.path.exists(os.path.join(ROOT, "spaces", space + ".desk")):
            continue
        used = _age_ms(os.path.join(ROOT, "spaces", space + ".used"))
        if used is None:
            used = _age_ms(os.path.join(ROOT, "spaces", space + ".cdp"))
        if used is None or used >= idle:
            _close_space(bp, space, "it was closed after %g minutes unused (Settings > Machines: browser idle close)" % (idle / 60000))
            report.setdefault("browsers_closed", []).append(space)
