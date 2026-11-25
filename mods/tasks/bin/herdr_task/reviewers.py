"""A worker's reviewer that never started, froze or failed (#1439, #1450): its worker hears why and what to do next,
at once, instead of waiting on it for many minutes, and never counts it as a review round."""

import json
import os
import platform
import re
import shutil

from .base import hc_json, now, run, STORE
from .agents import error_words, parent_of, status_word
from .settings import reviewer_command

STATE = os.path.join(STORE, ".reviewers.json")
# Nothing at all on its screen this long after it began: it never started (a macOS permission prompt for codex after an
# OS update holds even `codex --version`, out of sight).
BLANK_MS = 90 * 1000
# Its screen the same, timers and spinners aside, this long while still on its first turn: it froze (Codex "Working"
# at 0% context for 30 minutes, #1439). A reviewer at work reads files, so its screen moves.
FROZEN_MS = 5 * 60 * 1000


def screen_text(address):
    """Its screen and a little history as plain text; None when it can't be read."""
    r = run(["hc", "read", address, "--lines", "40", "--json"])
    if r.returncode != 0:
        return None
    try:
        return str(json.loads(r.stdout).get("text") or "")
    except (ValueError, AttributeError):
        return None


def still(text):
    """What of a screen counts as change: its words, without numbers (timers, token counts) or symbols (spinners)."""
    return " ".join(re.sub(r"[^A-Za-z]+", " ", text).split())


def last_line(text):
    lines = [" ".join(x.split()) for x in text.splitlines() if re.search(r"[A-Za-z]", x)]
    return lines[-1][:120] if lines else ""


def _load():
    try:
        with open(STATE) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(d):
    os.makedirs(STORE, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, STATE)


def verdict(k, seen, at, text):
    """Why reviewer k (its hc get) failed, or None while it looks fine. seen: what this pass kept of it ({since,
    screen}), updated in place. at: now (ms). text: its screen (None: unreadable)."""
    if status_word(k) == "error":
        return "error", error_words([k])
    if (k.get("turn") or 0) > 0 or text is None:
        return None
    born = k.get("created_ms") or seen.setdefault("born", at)
    if not text.strip():
        return ("blank", None) if at - born >= BLANK_MS else None
    words = still(text)
    if seen.get("screen") != words:
        seen["screen"], seen["since"] = words, at
        return None
    return ("frozen", last_line(text)) if at - seen.get("since", at) >= FROZEN_MS else None


def other_cli(k):
    """The other reviewer CLI's command, as a brief's Reviewer line gives it, when that CLI is here; else None."""
    who = (k.get("labels") or {}).get("herdr.agent") or ("codex" if "codex" in str(k.get("agent") or "") else "claude")
    other = "claude" if who == "codex" else "codex"
    if not shutil.which(other):
        return None, who
    return reviewer_command(other, folder=k.get("cwd")), who


def message(k, why, words, ended):
    """What its worker hears: why, that it is no round, and what to do next."""
    name = k.get("name") or k["address"]
    if why == "error":
        head = f'Herdr: your reviewer {name} ended in an error before its findings ("{words}").'
    elif why == "blank":
        head = f"Herdr: your reviewer {name} never started: nothing showed on its screen {BLANK_MS // 1000} s after it began."
    else:
        head = (f"Herdr: your reviewer {name} froze before its first answer: its screen hasn't changed in "
                f"{FROZEN_MS // 60000} minutes" + (f' (its last line: "{words}").' if words else "."))
    cmd, who = other_cli(k)
    parts = [head, "It is no review round: don't record it with reviewed."]
    parts.append("I ended it." if ended else f"Read what it said (`hc read {name}`), then end it (`hc kill {name}`).")
    if why == "error":
        parts.append("Start it once more with a smaller prompt (only the diff and what it needs)")
    else:
        parts.append("Start it once more")
    parts[-1] += (f"; if it fails again, review with the other CLI instead, its command `{cmd}`." if cmd else ".")
    if why != "error" and who == "codex" and platform.system() == "Darwin":
        parts.append("On a Mac this is often a system permission prompt for codex after a macOS update, out of sight "
                     "(even `codex --version` hangs): ask the person to look for it on the Mac's screen and allow it.")
    parts.append("If no reviewer can run, ask the person with your question tool, saying what failed.")
    return " ".join(parts)


def reviewer_pass(report, read=screen_text):
    """Every live reviewer here, each tick: one that ended in an error, showed nothing or froze on its first turn
    is ended (unless it already stopped) and its worker is told once, with why and what next."""
    d = hc_json("ls", "--label", "herdr.role=reviewer") or {}
    live = [k for k in d.get("terminals") or [] if k.get("state") == "live" and "/" not in str(k.get("address"))]
    state = _load()
    if not live and not state:
        return
    keep, at = {}, now()
    for row in live:
        k = hc_json("get", row["address"]) or row
        seen = keep[row["address"]] = dict(state.get(row["address"]) or {})
        if seen.get("told"):
            continue
        v = verdict(k, seen, at, read(row["address"]))
        if not v:
            continue
        why, words = v
        ended = False
        if why != "error":
            from .tick import quiet_hc
            ended = quiet_hc("kill", k).returncode == 0
        parent = parent_of(k)
        if parent:
            from .news import send_or_hold
            send_or_hold(parent, message(k, why, words, ended))
        seen["told"] = why
        report.setdefault("reviewers", []).append({"reviewer": k.get("name") or row["address"], "why": why,
                                                   "task": (k.get("labels") or {}).get("herdr.task"), "ended": ended})
    if keep != state:
        _save(keep)
