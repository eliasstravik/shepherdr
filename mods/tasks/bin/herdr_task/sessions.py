"""Agent sessions: the Claude Code or Codex session a task's agent runs, so it can resume."""

import json
import os
import re
import shutil

from .base import HOME, run
from .agents import agent_running, detail
from . import kinds as K


# ---- agent sessions -------------------------------------------------------------------------

def kids(pid):
    r = run(["pgrep", "-P", str(pid)])
    out = []
    for p in r.stdout.split():
        out.append(p)
        out.extend(kids(p))
    return out


def session_of(pid, kind=None, cwd=None, since=None):
    """(session id, log path) of the agent process pid (or a child), as mods/chat/log.js finds it:
    Claude Code names its session in ~/.claude/sessions/<pid>.json; Codex holds its rollout open.
    Pi (kinds.json sessions.byCwd) writes one log per session in a folder named after its working
    directory: the newest one written since the agent started (`since`, epoch seconds) is its."""
    if kind and (K.kind(kind) or {}).get("sessions", {}) and (K.kind(kind)["sessions"] or {}).get("byCwd"):
        d = K.session_dir(kind, cwd)
        logs = []
        for n in os.listdir(d) if d and os.path.isdir(d) else []:
            f = os.path.join(d, n)
            if K.session_id(kind, f) and (since is None or os.path.getmtime(f) >= since - 5):
                logs.append(f)
        if logs:
            log = max(logs, key=os.path.getmtime)
            return K.session_id(kind, log), log
        return None, None
    for p in [str(pid)] + kids(pid):
        j = os.path.join(HOME, ".claude", "sessions", p + ".json")
        if os.path.isfile(j):
            try:
                with open(j) as f:
                    sid = json.load(f).get("sessionId")
            except (OSError, ValueError):
                sid = None
            if sid:
                log = None
                base = os.path.join(HOME, ".claude", "projects")
                for d in os.listdir(base) if os.path.isdir(base) else []:
                    f = os.path.join(base, d, sid + ".jsonl")
                    if os.path.isfile(f):
                        log = f
                        break
                return sid, log
        files = []
        fd = f"/proc/{p}/fd"
        if os.path.isdir(fd):
            for n in os.listdir(fd):
                try:
                    files.append(os.readlink(os.path.join(fd, n)))
                except OSError:
                    pass
        elif shutil.which("lsof"):
            files = [l[1:] for l in run(["lsof", "-p", p, "-Fn"]).stdout.split("\n") if l.startswith("n")]
        for f in files:
            m = re.search(r"/rollout-.*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$", f)
            if m:
                return m.group(1), f
    return None, None


def refresh_sessions(s, task, live):
    """Records each live agent's current session (it changes on /clear)."""
    for k in live:
        k = detail(k)
        pid = (k.get("foreground") or {}).get("pid")
        a = next((a for a in task["agents"] if a["address"] == k["address"]), None)
        if not pid or not a or not agent_running(k):
            continue
        sid, log = session_of(pid, a.get("agent"), (k.get("foreground") or {}).get("cwd") or k.get("cwd"),
                              a["at"] / 1000 if isinstance(a.get("at"), (int, float)) and a["at"] > 1e11 else a.get("at"))
        if sid and (a.get("session"), a.get("log")) != (sid, log):
            a["session"], a["log"] = sid, log
            s.dirty = True
