"""The agent kinds (coding CLIs) herdr-task can start: kinds.json beside this file, the copy of
lib/kinds.json that bin/sync-shared keeps (the mods, service and web app read the same table as core/kinds.js)."""

import json
import os
import re

from .base import HOME

_TABLE = None


def kinds():
    """{key: kind} from kinds.json, read once. Keys starting with "_" are the file's notes."""
    global _TABLE
    if _TABLE is None:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kinds.json")) as f:
            _TABLE = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    return _TABLE


def kind(key):
    """The kind for an agent key, or None when it isn't one (an unknown key runs as itself)."""
    return kinds().get(key)


def key_of(argv):
    """The kind whose program argv[0] is ("cursor-agent" -> "cursor"), else argv[0]'s base name."""
    prog = os.path.basename(argv[0]) if argv else ""
    for k, v in kinds().items():
        if v["run"][0] == prog:
            return k
    return prog


def levels(key):
    """The reasoning levels a kind takes, [] when it has none."""
    k = kind(key)
    return list(((k or {}).get("effort") or {}).get("levels") or [])


def start_argv(key, pick):
    """How to start kind `key` from a role's {model, effort, fast, perm}: run, then the model,
    effort and permission flags as that CLI spells them. None when `key` is no kind."""
    k = kind(key)
    if not k:
        return None
    a = list(k["run"])
    model, effort = pick.get("model"), pick.get("effort")
    eff = k.get("effort") or {}
    if effort and eff.get("levels") and effort not in eff["levels"]:
        raise ValueError(f"{k['name']} has no {effort!r} reasoning level: one of {', '.join(eff['levels'])}.")
    if model and k.get("model"):
        if eff.get("style") == "bracket" and effort:
            model = re.sub(r"\[effort=[^\]]*\]$", "", model) + f"[effort={effort}]"
        a += [k["model"], model]
    if effort and eff.get("style") == "flag" and eff.get("flag"):
        a += [eff["flag"], effort]
    elif effort and eff.get("style") == "config":
        a += ["-c", f'{eff["flag"]}="{effort}"']
    if pick.get("perm") == "full" and k.get("full"):
        a += list(k["full"])
    elif pick.get("perm") == "plan" and key == "cursor":
        a += ["--mode", "plan"]
    return a


def resume_argv(argv, session):
    """argv again, continuing `session` (its id or, for Pi, its log's path). None: that CLI
    can't, or argv is no kind."""
    k = kind(key_of(argv))
    if not k or not k.get("resume"):
        return None
    r = k["resume"]
    if r["style"] == "flag":
        return argv + [r["flag"], session]
    if r["style"] == "sub":
        return [argv[0], r["sub"]] + argv[1:] + [session]
    if r["style"] == "thread":
        return [argv[0]] + list(r["sub"]) + [session] + argv[1:]
    return None


def session_dir(key, cwd=None):
    """Where kind `key` writes its session logs; for one that keeps a folder per working
    directory (Pi), that folder for `cwd`. None when unknown."""
    k = kind(key)
    s = (k or {}).get("sessions")
    if not s or not s.get("dir"):
        return None
    d = os.path.expanduser(s["dir"].replace("~", HOME, 1))
    if s.get("byCwd"):
        if not cwd:
            return None
        # Pi's folder name: the path with / : \ turned into -, then "--" put around it
        # ("/a/b" -> "--a-b--", as pi-coding-agent's getDefaultSessionDirPath).
        d = os.path.join(d, "--" + re.sub(r"[/:\\]", "-", cwd).strip("-") + "--")
    return d


def session_id(key, path):
    """The session id in a log's file name, or None."""
    k = kind(key)
    pat = ((k or {}).get("sessions") or {}).get("id")
    m = re.search(pat, path or "") if pat else None
    return m.group(1) if m else None
