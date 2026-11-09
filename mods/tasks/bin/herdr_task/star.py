"""The one-time "Enjoying Shepherdr?" card (SHEP-79): an Assistant may ask the person, once ever, to
star Shepherdr on GitHub, at a good moment it judges by its instructions (assistant.md).

What's kept is Everywhere's `star_prompt` in the settings file (~/.config/shepherdr/settings.json), so it
travels to every machine as the other settings do (the window's push, the web host's sync):
  {"off": true}                      Settings › Agents › Ask for a star switched off: never asked
  {"asked": <ms>, "answer": "..."}   asked (and how the person answered): never asked again
The ask is recorded before the card is published, so a restart or another machine never asks
twice, whatever the answer. The card is a plain link to the repo: nothing here stars anything or
calls GitHub on the person's behalf.
"""

import fcntl
import json
import os
import subprocess
import tempfile
from contextlib import contextmanager

from .base import Fail, now
from .output import say
from . import settings as conf
from .store import read_list, store_files

REPO_URL = "https://github.com/eliasstravik/shepherdr"
# Done tasks on this machine before an ask is possible: never in someone's first session.
MIN_DONE = 3
TITLE = "Enjoying Shepherdr?"
ANSWERS = {"github": "Opened Shepherdr on GitHub", "no": "No thanks"}


def card():
    """The card's recipe: two lines, then the link (the one to press) and No thanks."""
    return {"recipe": 1, "blocks": [
        {"type": "text", "md": "If Shepherdr has been useful, a star on GitHub helps other people find it "
                               "and lets you follow what's new. This is the only time it will ask."},
        {"type": "buttons", "items": [
            {"label": "Open Shepherdr on GitHub", "href": REPO_URL, "reply": f"{TITLE} {ANSWERS['github']}"},
            {"label": "No thanks", "reply": f"{TITLE} {ANSWERS['no']}", "quiet": True},
        ]},
    ]}


def state(d=None):
    """Everywhere's star_prompt as it is ({} when never asked)."""
    d = conf.read_settings() if d is None else d
    s = (d.get("everywhere") or {}).get("star_prompt")
    return s if isinstance(s, dict) else {}


def done_count():
    """Done tasks in every task list on this machine."""
    n = 0
    for p in store_files():
        n += sum(1 for t in (read_list(p) or {}).get("tasks") or [] if isinstance(t, dict) and t.get("state") == "done")
    return n


def why_not(d):
    """Why the card can't show now, in words (None: it can)."""
    s = state(d)
    if s.get("off"):
        return "The person switched it off in Settings: never ask."
    if s.get("asked"):
        return "Already asked once: never ask again."
    if d.get("pushed_from"):
        # a copy the window's machine pushes here: a flag written here would be put back, so only that machine asks
        return "This machine's settings are a copy from another machine: only that machine's Assistants ask."
    if done_count() < MIN_DONE:
        return f"Too early: fewer than {MIN_DONE} tasks are done here."
    return None


@contextmanager
def locked():
    """One ask at a time on this machine (two Assistants deciding at once)."""
    os.makedirs(os.path.dirname(conf.SETTINGS), exist_ok=True)
    with open(f"{conf.SETTINGS}.star-lock", "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def write(d):
    d["version"] = 1
    tmp = f"{conf.SETTINGS}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f, indent=2)
        f.write("\n")
    os.replace(tmp, conf.SETTINGS)


def set_state(d, value):
    d.setdefault("everywhere", {})["star_prompt"] = value
    write(d)


def publish(folder):
    """Publishes the card as this agent's artifact; its id (None when it couldn't)."""
    with tempfile.TemporaryDirectory(prefix="star-card-") as tmp:
        with open(os.path.join(tmp, "recipe.json"), "w") as f:
            json.dump(card(), f, indent=2)
        argv = ["herdr-artifact", "publish", tmp, "--title", TITLE, "--json"] + (["--folder", folder] if folder else [])
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired):
            return None
    try:
        return json.loads(r.stdout).get("id") if r.returncode == 0 else None
    except ValueError:
        return None


def cmd_star(args):
    if args.star == "check":
        d = conf.read_settings()
        why = why_not(d)
        return say(args, {"can": why is None, "why": why, **state(d)}, why or "You may ask, once, at a good moment.")
    if args.star == "answer":
        with locked():
            d = conf.read_settings()
            s = state(d)
            if not s.get("asked"):
                raise Fail("Nothing was asked yet.")
            set_state(d, {**s, "answer": args.answer, "answered": now()})
        return say(args, {"answer": args.answer}, "Kept. Never ask again.")
    # ask: record first, then show; a card that failed to show still counts as asked (never a second try)
    with locked():
        d = conf.read_settings()
        why = why_not(d)
        if why:
            raise Fail(why)
        set_state(d, {"asked": now()})
    art = publish(getattr(args, "folder", None))
    if not art:
        return say(args, {"asked": True, "artifact": None}, "Recorded as asked, but the card couldn't be published: leave it.")
    with locked():
        d = conf.read_settings()
        s = state(d)
        if s.get("asked") and not s.get("artifact"):
            set_state(d, {**s, "artifact": art})
    return say(args, {"asked": True, "artifact": art},
               f"The card is in your chat ({art}). Say nothing more about it; its answer comes back to you as a message.")
