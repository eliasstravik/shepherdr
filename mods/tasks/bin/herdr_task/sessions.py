"""Agent sessions: the Claude Code or Codex session a task's agent runs, so it can resume."""

import json
import os
import re
import shutil

from .base import HOME, now, run
from .agents import agent_running, detail


# ---- agent sessions -------------------------------------------------------------------------

def kids(pid):
    r = run(["pgrep", "-P", str(pid)])
    out = []
    for p in r.stdout.split():
        out.append(p)
        out.extend(kids(p))
    return out


def session_of(pid):
    """(session id, log path) of the agent process pid (or a child), as mods/chat/log.js finds it:
    Claude Code names its session in ~/.claude/sessions/<pid>.json; Codex holds its rollout open."""
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
        sid, log = session_of(pid)
        if sid and (a.get("session"), a.get("log")) != (sid, log):
            a["session"], a["log"] = sid, log
            s.dirty = True


# ---- a lost agent's log (SHEP-26) -----------------------------------------------------------
# An agent that ended before a pass saw its session (a short run, or one that exited on its own)
# has no log on its task, so its chat would look as if it never started. Its log is still on this
# machine: found once by its session id, else as the Claude Code session or Codex rollout that
# started in its folder from its launch on and whose first message names its task.

LOOK_BACK_MS = 60000       # a log that starts this long before its agent's launch (clocks, a slow start) still counts


def _ms(stamp):
    """An ISO timestamp ("2026-11-05T08:30:43.116Z") in ms, or None."""
    import datetime
    try:
        return int(datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def _words(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(x.get("text") or "") for x in content if isinstance(x, dict))
    return ""


def _start(path):
    """(when, first message) a log starts with: Claude Code's first user entry, Codex's session_meta
    and first user message. (None, "") if it has none in its first lines."""
    at, said = None, ""
    try:
        with open(path, errors="replace") as f:
            for i, line in enumerate(f):
                if i > 80:
                    break
                try:
                    o = json.loads(line)
                except ValueError:
                    continue
                p = o.get("payload") or {}
                if o.get("type") == "session_meta":
                    at = at or _ms(p.get("timestamp") or o.get("timestamp"))
                elif o.get("type") == "user" and not o.get("isMeta"):
                    at = at or _ms(o.get("timestamp"))
                    said = _words((o.get("message") or {}).get("content"))
                elif o.get("type") == "response_item" and p.get("role") == "user":
                    w = _words(p.get("content"))
                    if not w.lstrip().startswith("<"):  # not Codex's own <environment_context> or instructions
                        at, said = at or _ms(o.get("timestamp")), w
                if said:
                    break
    except OSError:
        pass
    return at, said


def project_dir(folder):
    """Claude Code's projects folder for a cwd: every character but a letter or digit becomes "-"."""
    return os.path.join(HOME, ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", folder))


def log_by_session(kind, sid):
    import glob
    if kind == "codex":
        found = glob.glob(os.path.join(HOME, ".codex", "sessions", "*", "*", "*", f"rollout-*{sid}.jsonl"))
    else:
        found = glob.glob(os.path.join(HOME, ".claude", "projects", "*", sid + ".jsonl"))
    return found[0] if found else None


def find_log(a, ref, folders, taken=()):
    """The log of agent `a` (a task's agents[] row) of task `ref` (SHEP-26), run in one of `folders`,
    or None: by its session when it has one, else the earliest log of its kind that started from
    its launch on (until it ended) and whose first message names its task."""
    import glob
    kind = "codex" if a.get("agent") == "codex" else "claude"
    if a.get("session"):
        return log_by_session(kind, a["session"])
    at = a.get("at")
    if not at:
        return None
    end = a.get("ended") or at + 86400000
    if kind == "codex":
        import datetime
        days = {datetime.date.fromtimestamp((at + d) / 1000) for d in (-86400000, 0, 86400000)}
        files = [f for day in days for f in glob.glob(os.path.join(HOME, ".codex", "sessions", f"{day:%Y}", f"{day:%m}", f"{day:%d}", "rollout-*.jsonl"))]
    else:
        files = [f for d in dict.fromkeys(x for x in folders if x) for f in glob.glob(os.path.join(project_dir(d), "*.jsonl"))]
    named = re.compile(rf"(?<![\w-]){re.escape(ref)}(?![\w-])")
    best = None
    for f in files:
        if f in taken:
            continue
        try:
            if os.path.getmtime(f) * 1000 < at - LOOK_BACK_MS:
                continue  # last written before it started
        except OSError:
            continue
        start, said = _start(f)
        if start is None or not (at - LOOK_BACK_MS <= start <= end) or not named.search(said):
            continue
        if not best or start < best[0]:
            best = (start, f)
    return best[1] if best else None


def find_lost_logs(s, task):
    """Records the log of each of the task's ended agents that has none (looked for once each)."""
    folders = [task.get("worktree"), s.loc.get("folder")]
    taken = {a.get("log") for a in task.get("agents") or [] if a.get("log")}
    for a in task.get("agents") or []:
        if a.get("log") or a.get("log_looked"):
            continue
        log = find_log(a, s.ref(task), folders + [a.get("cwd")], taken)
        a["log_looked"] = now()
        if log:
            a["log"] = log
            taken.add(log)
        s.dirty = True
