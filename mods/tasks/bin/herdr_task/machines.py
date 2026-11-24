"""Machines: the same task tools on every machine (sync), what each machine reaches (the reach
map, hop by hop), the Assistants there (the directory) and messages between them.

Reach is only what the person's own herdr-core links allow, seen from where each link starts: a
machine's links (`hc machine ls` there), and through each, what that one links to, hop by hop over
those same links. The map opens no new connection to anything (#967): no ssh, no Tailscale peers,
nothing the person didn't add. With the Other machines add-on off it follows no link at all.
Trying the ssh config's hosts and the online Tailscale peers (Find) runs only when the person asks,
on this machine only, once per FIND_EVERY_MS, and says first what it will contact; what it finds
is reported, never added to the map. Nothing here makes keys, trust, tunnels or listeners. One-way
links are normal: a machine reachable from here may not reach back.
"""

import base64
import fcntl
import hashlib
import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time

from .base import QUEUED, ASK_HOME, OLD_SESSION, SESSION, SHARE, sync_held, bundle, ENTRY, Fail, guard, HOME, hc_json, layout, now, PACKAGE, run, STORE, WHERE
from .news import NO_AGENT, news_send, send_or_hold, typing
from .agents import front
from .revive import restart_assistant
from .settings import TEMPLATES


# ---- sync: the same task tools on every machine ---------------------------------------------
# What a machine needs to run tasks: herdr-task (one zipapp), herdr-artifact (with its guide and
# markup), herdr-secret (a remote copy: it asks the main machine), herdr-browser and herdr-desktop once they exist,
# and the role templates. Each goes to the same place under that machine's home as here
# (~/.local/bin/..., ~/.config/herdr-core/templates/...). A stamp there (tools.json in Shepherdr's data;
# STAMP names its old place, which SHEP turns into wherever it is on that machine)
# records what was installed (each file's sha256 and its source's time), so a machine that is
# current is skipped, an older copy never replaces a newer one, and a template someone changed
# there is kept (--force replaces it). Nothing else there is touched.

ROLES = ("assistant", "worker", "reviewer")
ARTIFACT_HOME = ".local/share/herdr/artifacts"
# The installed web app's artifact viewer in one file (bin/shepherdr installs web/dist there), synced beside herdr-artifact
VIEWER_BUILT = os.path.join(".local", "share", "shepherdr", "web", "dist", "artifact-viewer.html")
STAMP = ".herdr/tools.json"
MACHINES = os.path.join(STORE, ".machines.json")
SYNC_DEBOUNCE_MS = 30000        # files changed here: wait until they stay put this long
SYNC_RETRY_MS = 10 * 60000      # a machine whose sync failed: tried again after this
REACH_EVERY_MS = 5 * 60000      # the scheduler refreshes the reach map this often
REACH_DEPTH = 3                 # hops the map follows past this machine, over herdr-core links only
RELINK_S = 10                   # a refresh's forced retry of one unreachable link waits this long at most (#1104)
NET_AGAIN_MS = 30000            # after the network changes, links still unreachable get one more try this much later
FIND_EVERY_MS = 10 * 60000      # Find machines: at most once in this long
FIND_AT_ONCE = 4                # Find machines: hosts tried at the same time


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _real(rel):
    """This machine's own copy of a helper on PATH (~/<rel>), followed to its file, or None."""
    p = os.path.realpath(os.path.join(HOME, rel))
    return p if os.path.isfile(p) else None


def _local_stamp():
    try:
        with open(WHERE.path("tools")) as f:
            return json.load(f).get("files") or {}
    except (OSError, ValueError):
        return {}


def _core_dir():
    return os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local", "state"), "herdr-core", SESSION)


def secrets_main_here():
    """Whether this machine keeps the secrets (bin/herdr-secret remote()): herdr-core's document
    "shepherdr.secrets" names it, or, none named yet, it has a vault and no remote mark. Only then
    does a copy of herdr-secret it installs elsewhere get marked as asking another machine: a hub
    that doesn't keep them (the Mac mini) once marked the main machine remote (SHEP-11)."""
    def js(path):
        try:
            with open(path) as f:
                return json.load(f)
        except (OSError, ValueError):
            return None
    # Shepherdr's own session first (3.2), then the default one, where herdr-secret kept the record before: each
    # session is a core of its own, with its own id, so the record is compared with the id of the session it is in.
    for d in dict.fromkeys((_core_dir(), os.path.join(os.path.dirname(_core_dir()), OLD_SESSION))):
        docs, core = js(os.path.join(d, "docs.json")) or {}, js(os.path.join(d, "core.json")) or {}
        rec = ((docs.get("shepherdr.secrets") if isinstance(docs, dict) else None) or {}).get("value")
        if isinstance(rec, dict) and rec.get("id"):
            return isinstance(core, dict) and rec["id"] == core.get("id")
    return os.path.isfile(WHERE.path("vault")) and not os.path.exists(WHERE.path("secret-remote"))


def manifest():
    """What sync installs, from this machine's own copies: {version, files, links, touch}. A file
    is {path (under home), data, sha, mode, at (its source's time, ms), protect, test}."""
    stamp = _local_stamp()
    files = []

    def add(rel, data, mode, sources, protect=False, test=None):
        sha = hashlib.sha256(data).hexdigest()
        rec = stamp.get(rel) or {}
        # Installed here by a sync (this machine is someone's remote): its source's time is the
        # stamp's, not when it landed here.
        at = rec["at"] if rec.get("sha") == sha and rec.get("at") else max(int(os.path.getmtime(s) * 1000) for s in sources)
        files.append({"path": rel, "data": data, "sha": sha, "mode": mode, "at": at, "protect": protect, "test": test})

    sources = [ENTRY] + ([os.path.join(PACKAGE, n) for n in os.listdir(PACKAGE) if n.endswith(".py")] if os.path.isdir(PACKAGE) else [])
    add(".local/bin/herdr-task", bundle(), 0o755, sources, test=["--version"])
    links, touch = [], []
    art = _real(".local/bin/herdr-artifact")
    if art:
        root = os.path.dirname(os.path.dirname(art))
        add(f"{ARTIFACT_HOME}/bin/herdr-artifact", _read(art), 0o755, [art], test=["--version"])
        for extra in ("ARTIFACTS.md", "markup.js"):
            p = os.path.join(root, extra)
            if os.path.isfile(p):
                add(f"{ARTIFACT_HOME}/{extra}", _read(p), 0o644, [p])
        # The web app's artifact viewer in one file (SHEP-149: herdr-artifact preview shows a machine's own
        # artifacts there as the person sees them): the copy a sync left beside it, else the installed web app's.
        viewer = next((p for p in (os.path.join(root, "viewer.html"), os.path.join(HOME, VIEWER_BUILT)) if os.path.isfile(p)), None)
        if viewer:
            add(f"{ARTIFACT_HOME}/viewer.html", _read(viewer), 0o644, [viewer])
        # As here: ~/.local/bin/herdr-artifact leads to its folder, where its guide sits beside it.
        links.append({"path": ".local/bin/herdr-artifact", "target": f"{ARTIFACT_HOME}/bin/herdr-artifact"})
    secret = _real(".local/bin/herdr-secret")
    if secret:
        add(".local/bin/herdr-secret", _read(secret), 0o755, [secret], test=["--help"])
        # As `herdr-secret install --on`: a copy there asks this machine, the main one, unless it keeps
        # a vault itself or the record there names it the main one. A machine that isn't the main one
        # marks nothing.
        if secrets_main_here():
            touch.append({"path": ".herdr/secret-remote", "unless": ".herdr/vault.json", "unless_main": True})
    ensure = []
    for helper in ("herdr-browser", "herdr-desktop"):
        p = _real(f".local/bin/{helper}")
        if p:
            add(f".local/bin/{helper}", _read(p), 0o755, [p])
    # SHEP-346: agent-desktop where herdr-desktop goes (herdr-desktop --install there: its pinned release, checked)
    if _real(".local/bin/herdr-desktop"):
        ensure.append(".local/bin/herdr-desktop")
    # The chat's question-card hook (SHEP-139): a task worker's own hook (herdr-task _allow) runs it,
    # so a machine that only runs tasks asks on the card too. From Shepherdr's own install (<SHARE>/hooks),
    # else the copy a sync left here (this machine passes it on).
    for name, mode in (("ask-hook.sh", 0o755), ("ask-end.py", 0o644)):
        p = next((x for x in (os.path.join(SHARE, "hooks", name), os.path.join(HOME, ASK_HOME, name)) if os.path.isfile(x)), None)
        if p:
            add(f"{ASK_HOME}/{name}", _read(p), mode, [p])
    for role in ROLES:
        rel = f".config/herdr-core/templates/{role}.md"   # its place there: INSTALL's P follows XDG_CONFIG_HOME (#1182)
        p = os.path.join(TEMPLATES, f"{role}.md")
        if os.path.isfile(p):
            add(rel, _read(p), 0o644, [p], protect=True)
    h = hashlib.sha256()
    for f in sorted(files, key=lambda f: f["path"]):
        h.update(f"{f['path']} {f['sha']} {f['mode']}\n".encode())
    for link in links:
        h.update(f"{link['path']} -> {link['target']}\n".encode())
    return {"version": h.hexdigest()[:12], "files": files, "links": links, "touch": touch, "ensure": ensure}


# Runs on the other machine (python3, 3.8+), its input on stdin: checks or installs, then prints
# what it found. Each file: written beside its place, tried (its --version), the old one kept as
# <file>.bak, then swapped in one step (os.replace): a herdr-task running there keeps its old file (SHEP-259).
INSTALL = r'''
import base64, hashlib, json, os, platform, shutil, subprocess, sys, time
x = json.loads(sys.stdin.read())
H = os.path.expanduser("~")
# #1203: native Windows can't run the helpers (no fcntl): say so in one line, never a traceback.
if platform.system() == "Windows":
    print(json.dumps({"unsupported": "native Windows isn't supported: run Herdr in WSL there", "os": "Windows",
                      "python": sys.version.split()[0], "files": {}, "links": {}}))
    sys.exit(0)
X = os.environ.get("XDG_CONFIG_HOME") or ""
def P(r):
    # herdr-core's own config there (the role templates) where herdr-core reads it: $XDG_CONFIG_HOME's when set (#1182)
    if r.startswith(".config/herdr-core/") and X.startswith("/"):
        return os.path.join(X, r[len(".config/"):])
    return os.path.join(H, r)
''' + layout.PY + r'''
# Shepherdr's own files (the stamp, the secrets' marks) where they are on that machine: its own
# folders once its data moved there, else ~/.herdr (SHEP: herdr_task/layout.py).
def sha(p):
    try:
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None
try:
    with open(SHEP(x["stamp"])) as f:
        stamp = json.load(f)
except Exception:
    stamp = {}
rec = stamp.get("files") or {}
# The machine that holds herdr-task's source (Shepherdr's own install, with its links into it; before 3.2
# Herdr's app folder) is where copies come from: never written to.
source = any(os.path.isdir(P(d + "/mods/tasks/bin/herdr_task")) for d in (".local/share/shepherdr", ".config/herdr-app"))
out = {"source": source, "files": {}, "links": {}, "stamp": {k: stamp.get(k) for k in ("version", "from", "at")},
       "python": sys.version.split()[0], "os": platform.system(), "home": H}
for f in x["files"]:
    p, r = P(f["path"]), rec.get(f["path"]) or {}
    cur = sha(p)
    if source:
        st = "source here"
    elif os.path.islink(p):
        st = "own copy"
    elif cur == f["sha"]:
        st = "current"
        if r.get("sha") != cur:
            rec[f["path"]] = {"sha": cur, "at": f["at"]}
    elif cur is None:
        st = "missing"
    elif f.get("protect") and cur != r.get("sha") and not x.get("force"):
        st = "changed there"
    elif r.get("sha") == cur and (r.get("at") or 0) > f["at"] and not x.get("force"):
        st = "newer there"
    else:
        st = "behind"
    if x["op"] == "install" and st in ("missing", "behind") and "data" in f:
        tmp = p + ".herdr-new." + str(os.getpid())
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(tmp, "wb") as w:
                w.write(base64.b64decode(f["data"]))
                w.flush()
                os.fsync(w.fileno())
            os.chmod(tmp, f["mode"])
            if f.get("test"):
                t = subprocess.run([sys.executable, tmp] + f["test"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                if t.returncode != 0:
                    raise RuntimeError("its test failed: " + (t.stderr or t.stdout).decode(errors="replace").strip()[-300:])
            if os.path.isfile(p):
                shutil.copy2(p, p + ".bak")
            os.replace(tmp, p)
            rec[f["path"]] = {"sha": f["sha"], "at": f["at"]}
            st = "installed"
        except Exception as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            st = "failed: " + str(e)
    out["files"][f["path"]] = st
for l in x["links"]:
    p, t = P(l["path"]), P(l["target"])
    st = "current" if os.path.islink(p) and os.readlink(p) == t else "missing" if not os.path.lexists(p) else "behind"
    if source:
        st = "source here"
    elif st == "behind" and os.path.islink(p) and not os.readlink(p).startswith(P(".local/share/herdr")):
        st = "own copy"
    if x["op"] == "install" and st != "current" and os.path.isfile(t):
        try:
            if os.path.lexists(p) and not os.path.islink(p):
                os.replace(p, p + ".bak")
            tmp = p + ".herdr-new"
            if os.path.lexists(tmp):
                os.remove(tmp)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            os.symlink(t, tmp)
            os.replace(tmp, p)
            st = "installed"
        except Exception as e:
            st = "failed: " + str(e)
    out["links"][l["path"]] = st
# What a helper there installs itself (SHEP-346: herdr-desktop's agent-desktop): "ready", "missing" (a check),
# "installed" or "failed: <why>" (an install round). Never on the machine with the source: its own install does it.
out["ensure"] = {}
for e in ([] if source else x.get("ensure") or []):
    p = P(e)
    if not os.path.isfile(p):
        continue
    def helper(arg, t):
        try:
            r = subprocess.run(["sh", p, arg], stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, timeout=t)
            return r.returncode, (r.stdout + b"\n" + r.stderr).decode(errors="replace")
        except Exception as ex:
            return 1, str(ex)
    rc, said = helper("--bin", 30)
    if rc == 0:
        st = "ready"
    elif x["op"] == "install":
        rc, said = helper("--install", 480)   # within the sync's one hc exec (EXEC_MAX), files and all
        lines = [l for l in said.splitlines() if l.strip()]
        st = "installed" if rc == 0 else "failed: " + (lines[-1] if lines else "it didn't say why").replace(os.path.basename(p) + ": ", "", 1)
    else:
        st = "missing"
    out["ensure"][e] = st
def main_here():
    # the record naming the machine that keeps the secrets ("shepherdr.secrets"), and this one's id
    # in Shepherdr's own session there (3.2), else the default one, where herdr-secret kept it before
    for name in dict.fromkeys((x.get("session") or "shepherdr", "default")):
        core = os.path.join(os.environ.get("XDG_STATE_HOME") or P(".local/state"), "herdr-core", name)
        try:
            with open(os.path.join(core, "docs.json")) as f:
                rec = (json.load(f).get("shepherdr.secrets") or {}).get("value") or {}
            with open(os.path.join(core, "core.json")) as f:
                me = json.load(f).get("id")
        except Exception:
            continue
        if rec.get("id"):
            return rec.get("id") == me
    return False
if x["op"] == "install" and not source:
    for t in x["touch"]:
        if t.get("unless_main") and main_here():
            continue
        if not os.path.exists(SHEP(t["path"])) and not os.path.exists(SHEP(t["unless"])):
            os.makedirs(os.path.dirname(SHEP(t["path"])), exist_ok=True)
            open(SHEP(t["path"]), "a").close()
    ok = all(v in ("current", "installed", "own copy") for v in list(out["files"].values()) + list(out["links"].values()))
    stamp = {"version": x["version"] if ok else stamp.get("version"), "from": x["from"], "at": int(time.time() * 1000), "files": rec}
    os.makedirs(os.path.dirname(SHEP(x["stamp"])), exist_ok=True)
    tmp = SHEP(x["stamp"]) + ".tmp"
    with open(tmp, "w") as w:
        json.dump(stamp, w, indent=1)
    os.replace(tmp, SHEP(x["stamp"]))
    out["stamp"] = {k: stamp.get(k) for k in ("version", "from", "at")}
print(json.dumps(out))
'''


def core_name():
    """This machine's herdr-core name (what other machines' cores call it by default)."""
    d = hc_json("server", "status") or {}
    return (d.get("core") or {}).get("name") or socket.gethostname()


def connected_machines():
    """This machine's own herdr-core links: [{name, state, ...}] (not --temp ones)."""
    return [m for m in (hc_json("machine", "ls") or {}).get("machines") or [] if not m.get("temporary")]


EXEC_MAX = 600   # herdr-core's longest `hc exec --timeout` (it refuses more: "at most 600 s")
REACH_KINDS = ("unavailable", "machine_unknown")   # hc's errors that are about the link, not the call


class Refused(Fail):
    """hc refused or failed the call for a reason that isn't reach (bad parameters, an error there)."""


def _hc_error(r):
    """hc's own error {kind, message} from a failed call's output, or None."""
    for text in (r.stderr, r.stdout):
        try:
            err = json.loads((text or "").strip().splitlines()[-1]).get("error")
        except (ValueError, AttributeError, IndexError):
            continue
        if isinstance(err, dict) and err.get("kind"):
            return err
    return None


def _remote_python(machine, script, payload, timeout=120):
    guard(["hc"])
    timeout = max(1, min(int(timeout), EXEC_MAX))
    try:
        r = subprocess.run(["hc", "exec", "--on", machine, "--stdin", "--timeout", str(timeout), "--", "python3", "-c", script],
                           input=json.dumps(payload), stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                           timeout=timeout + 30)
    except subprocess.TimeoutExpired:
        raise Fail("timed out")
    if r.returncode != 0:
        err = _hc_error(r)
        if err and err["kind"] not in REACH_KINDS:
            raise Refused(f"hc refused the call ({err['kind']}): {err.get('message') or 'no reason given'}")
        raise Fail((r.stderr or r.stdout).strip()[-300:] or f"hc exec failed ({r.returncode})")
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Fail(f"unreadable answer: {r.stdout.strip()[-200:]}")


OK = ("current", "installed", "own copy")


def _verdict(res):
    if res.get("unsupported"):
        return "unsupported", [res["unsupported"]]
    if res.get("source"):
        return "source", ["holds herdr-task's source: copies come from there, it's never written to"]
    bad = {p: s for p, s in {**res["files"], **res["links"]}.items() if s not in OK}
    if not bad:
        return "current", []
    return ("failed" if any(s.startswith("failed") for s in bad.values()) else "drift"), [f"{os.path.basename(p)}{' (link)' if p in res['links'] else ''}: {s}" for p, s in sorted(bad.items())]


def sync_machine(machine, m, op="install", force=False):
    """Checks or installs the tools on one machine: {machine, state, details, ...}; state is
    current, drift (some file isn't: details say which and why), failed or unreachable."""
    me = {"from": core_name(), "version": m["version"], "stamp": STAMP, "force": force, "links": m["links"], "touch": m["touch"],
          "session": SESSION, "ensure": m.get("ensure") or []}
    bare = lambda f: {k: v for k, v in f.items() if k != "data"}
    try:
        res = _remote_python(machine, INSTALL, {**me, "op": "check", "files": [bare(f) for f in m["files"]]}, timeout=60)
        state, details = _verdict(res)
        missing = [p for p, s in (res.get("ensure") or {}).items() if s == "missing"]
        if op == "install" and (state not in ("current", "source") or (missing and state == "current")):
            need = {p for p, s in res["files"].items() if s in ("missing", "behind")}
            send = [{**bare(f), "data": base64.b64encode(f["data"]).decode()} if f["path"] in need else bare(f) for f in m["files"]]
            res = _remote_python(machine, INSTALL, {**me, "op": "install", "files": send}, timeout=EXEC_MAX if missing else 180)
            state, details = _verdict(res)
            for f in m["files"]:
                mark = {".local/bin/herdr-task": STORE, f"{ARTIFACT_HOME}/bin/herdr-artifact": WHERE.path("artifacts")}.get(f["path"])
                if mark and res["files"].get(f["path"]) in ("current", "installed"):
                    _mark(os.path.join(mark, ".remote", machine), hashlib.sha1(f["data"]).hexdigest())
    except Refused as e:   # reached, but the call itself failed: said as it is, never "can't reach"
        return {"machine": machine, "state": "failed", "details": [str(e)], "version": m["version"]}
    except Fail as e:
        return {"machine": machine, "state": "unreachable", "details": [str(e)], "version": m["version"]}
    # what a helper installs itself: said, never the machine's state (an offline machine stays current, and says why)
    ens = res.get("ensure") or {}
    details = details + [f"{_ENSURED.get(p, os.path.basename(p))}: {s}" for p, s in sorted(ens.items()) if s not in ("ready", "installed")]
    return {"machine": machine, "state": state, "details": details, "version": m["version"], "installed": (res.get("stamp") or {}).get("version"),
            "os": res.get("os"), "python": res.get("python"),
            "changed": sorted([p for p, s in {**res["files"], **res["links"]}.items() if s == "installed"] +
                              [_ENSURED.get(p, p) for p, s in ens.items() if s == "installed"])}


_ENSURED = {".local/bin/herdr-desktop": "agent-desktop"}


def _mark(path, digest):
    """herdr-task's and herdr-artifact's own --on keep these: with the right one they don't
    install themselves again."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(digest)


def _load_state():
    try:
        with open(MACHINES) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_state(update):
    """Merges into .machines.json under its lock (sync runs and the scheduler both write it)."""
    os.makedirs(STORE, exist_ok=True)
    with open(MACHINES + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        d = _load_state()
        update(d)
        tmp = f"{MACHINES}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, MACHINES)
        return d


def sync(names=None, op="install", force=False):
    """Every connected machine (or those named), all at once: {version, machines: [...]}. While
    an install holds copies (base.sync_held), an install round sends nothing: each is "held"."""
    held = sync_held() if op != "check" else None
    m = manifest()
    links = {x["name"]: x for x in connected_machines()}
    if names:
        unknown = [n for n in names if n not in links]
        if unknown:
            raise Fail(f"no machine named {', '.join(unknown)} here (hc machine ls)")
    targets = list(dict.fromkeys(names or links))
    out = {}

    def one(name):
        if held:
            out[name] = {"machine": name, "state": "held", "details": [f"{held} (shepherdr doctor lets it go)"], "version": m["version"]}
            return
        out[name] = sync_machine(name, m, op, force) if links[name].get("state") == "connected" else \
            {"machine": name, "state": "unreachable", "version": m["version"], "details": [f"herdr-core link {links[name].get('state')}" + (
                f": {STALE_WORDS} (`herdr-task carry-over` links it again)" if stale_why(links[name].get("why")) else "")]}
    threads = [threading.Thread(target=one, args=(n,)) for n in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    rows = [out[n] for n in targets]

    def record(d):
        for r in rows:
            e = d.setdefault("machines", {}).setdefault(r["machine"], {})
            e.update({"state": r["state"], "checked": now(), "details": r["details"]})
            if r["state"] in ("current", "source", "unsupported"):
                e["synced"] = m["version"]
            elif e.get("synced") == m["version"]:
                e.pop("synced")
    _save_state(record)
    return {"version": m["version"], "machines": rows}


def adopt(dry=False):
    """3.2: Shepherdr lives in its own herdr-core session, and each session keeps its own list of machines. The
    machines the default session (the Herdr app's) links to are added to Shepherdr's session, each leading to
    Shepherdr's own session on that machine (hc machine add --session), so `--on <machine>` and every hc call
    through the link land there. The default session's list is only read, as a file: nothing in it changes.
    A machine Shepherdr's session has already is left alone (one that leads to another session there is said).
    Returns [{name, state: added | here | wrong-session | failed | would-add, ...}]."""
    path = os.path.join(os.path.dirname(_core_dir()), OLD_SESSION, "machines.json")
    try:
        with open(path) as f:
            theirs = json.load(f)
    except (OSError, ValueError):
        theirs = []
    mine = {m.get("name"): m for m in (hc_json("machine", "ls") or {}).get("machines") or []}
    out = []
    for m in theirs if isinstance(theirs, list) else []:
        name, target = (m or {}).get("name"), (m or {}).get("target")
        if not name or not target or m.get("temporary"):
            continue
        if name in mine:
            there = mine[name].get("session") or "default"
            out.append({"name": name, "state": "here" if there == SESSION else "wrong-session", **({} if there == SESSION else {"session": there})})
            continue
        if dry:
            out.append({"name": name, "state": "would-add"})
            continue
        how = ["--via", target] if m.get("via") else [target]
        r = run(["hc", "machine", "add", *how, "--name", name, "--session", SESSION, "--json"])
        out.append({"name": name, "state": "added"} if r.returncode == 0 else
                   {"name": name, "state": "failed", "error": (r.stderr or r.stdout).strip()[-300:]})
    return out


# ---- a link that holds another core's id (SHEP-310) ---------------------------------------
# herdr-core keeps, with each link, the id of the core that answered when it was added, and refuses a core with any
# other id there ("unreachable: a different core answers there (\"<id>\")"): the far side's core for that session was
# made anew (its core.json), or the link was added while the far side answered from another session (its default one:
# an hc there that didn't know sessions yet). The link then stays down for good, though the machine is up.
# stale_links finds them; relink_stale links each again where that is safe: the same target, name and session, and the
# far side answers there from the same (Shepherdr's, never the default) session and host, with the very id herdr-core saw. Nothing else is
# contacted: only the address the link already holds.

DIFFERENT_CORE = re.compile(r'a different core answers there \("?([0-9A-Za-z_-]+)"?\)')
# In plain words, for the person (home's health, doctor, sync's report; the web app says its own, web/shared/view.ts)
STALE_WORDS = "a different herdr-core answers there now (it was set up again since it was linked), so nothing gets through"
RELINK_S = 90


def stale_why(why):
    """The id that answers instead, when a link's why says another core answers there; else None."""
    mt = DIFFERENT_CORE.search(str(why or ""))
    return mt.group(1) if mt else None


def stale_links(ms=None):
    """This session's links whose far side answers with another core than the one they hold (module note above):
    [{name, id (held), answers, target, via, session, host}]."""
    out = []
    for m in connected_machines() if ms is None else ms:
        answers = stale_why(m.get("why"))
        if not m.get("name") or m.get("temporary") or m.get("state") == "connected" or not answers:
            continue
        out.append({"name": m["name"], "id": m.get("id"), "answers": answers, "target": m.get("target"), "via": bool(m.get("via")),
                    "session": m.get("session") or "default", "host": m.get("host")})
    return out


def relink_commands(x):
    """What the person runs to link it again by hand, exactly (in Shepherdr's session), then the records put right."""
    pre = f"HC_SESSION={SESSION} " if SESSION != "default" else ""
    how = f"--via {shlex.quote(x['target'])}" if x.get("via") else shlex.quote(str(x.get("target") or "<its address>"))
    sess = f" --session {shlex.quote(x['session'])}" if x.get("session") and x["session"] != "default" else ""
    return [f"{pre}hc machine rm {shlex.quote(x['name'])}", f"{pre}hc machine add {how} --name {shlex.quote(x['name'])}{sess}",
            "herdr-task carry-over"]


def _hc_quiet(args, timeout=RELINK_S):
    """hc in Shepherdr's session with no terminal to ask on (no install offered, no password typed): (code, json, error)."""
    guard(["hc"])
    try:
        r = subprocess.run(["hc", *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=timeout, start_new_session=True)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 255, None, str(e)
    try:
        got = json.loads(r.stdout) if r.stdout.strip() else None
    except ValueError:
        got = None
    return r.returncode, got, (r.stderr or r.stdout or "").strip()[-300:]


def relink_one(x):
    """Links x (a stale_links row) again: added anew under a spare name, checked, then put in the old one's place.
    {state: relinked | refused | failed, to?, why?}."""
    if x["session"] == "default" and SESSION != "default":
        return {"state": "refused", "why": f"it leads to herdr-core's default session there, not Shepherdr's ({SESSION})"}
    if not x.get("target"):
        return {"state": "refused", "why": "herdr-core doesn't say its address"}
    spare = f"{x['name'][:24]}-relink"
    how = ["--via", x["target"]] if x["via"] else [x["target"]]
    code, got, err = _hc_quiet(["machine", "add", *how, "--name", spare, "--session", x["session"], "--json"])
    if code != 0 or not isinstance(got, dict):
        return {"state": "failed", "why": f"adding it again didn't work: {err or 'no answer'}"}
    unsafe = ("it answers from another session there" if (got.get("session") or "default") != x["session"] else
              f"another host answers there ({got.get('host')}, not {x['host']})" if x.get("host") and got.get("host") != x["host"] else
              "the core that answers there changed again" if got.get("id") != x["answers"] else None)
    if unsafe:
        _hc_quiet(["machine", "rm", spare])
        return {"state": "refused", "why": f"not linked again: {unsafe}"}
    code, _, err = _hc_quiet(["machine", "rm", x["name"]])
    if code != 0:
        _hc_quiet(["machine", "rm", spare])
        return {"state": "failed", "why": f"the old link couldn't be removed: {err}"}
    code, _, err = _hc_quiet(["machine", "rename", spare, x["name"]])
    if code != 0:
        return {"state": "failed", "why": f"linked again as {spare}, but it couldn't take its name back ({err}): "
                                         f"HC_SESSION={SESSION} hc machine rename {spare} {x['name']}"}
    return {"state": "relinked", "to": got.get("id")}


def relink_stale(dry=False):
    """Each stale link (stale_links), linked again (relink_one) or, dry, only found. [{name, id, answers, state:
    relinked | would-relink | refused | failed, to?, why?, fix: [commands]}]."""
    rows = []
    for x in stale_links():
        row = {"name": x["name"], "id": x["id"], "answers": x["answers"], "fix": relink_commands(x)}
        rows.append({**row, "state": "would-relink"} if dry else {**row, **relink_one(x)})
    return rows


def cmd_machines(args):
    from .output import say
    if args.machines == "adopt":
        rows = adopt(getattr(args, "dry_run", False))
        words = {"added": "added", "here": "already here", "would-add": "would be added", "failed": "couldn't be added",
                 "wrong-session": f"is here, but leads to another session there: remove and add it again with --session {SESSION}"}
        say(args, {"session": SESSION, "machines": rows},
            "\n".join(f"{x['name']}: {words[x['state']]}" + (f" ({x['error']})" if x.get("error") else "") for x in rows)
            or "The default session links to no machines.")
        if any(x["state"] == "failed" for x in rows):
            raise SystemExit(1)
        return
    if args.machines == "reach":
        return cmd_reach(args)
    if args.machines == "find":
        return cmd_find(args)
    if args.machines == "sync":
        r = sync(args.machine or None, "check" if args.check else "install", args.force)
        if args.json:
            say(args, r, None)
        else:
            print(f"Tools here: version {r['version']}." if r["machines"] else "No other machines connected here.")
            for x in r["machines"]:
                word = {"current": "current", "source": "holds the source (left alone)", "drift": "out of date", "failed": "failed", "unreachable": "can't reach", "held": "held", "unsupported": "not supported"}.get(x["state"], x["state"])
                more = f" (updated {len(x['changed'])} file(s))" if x.get("changed") else ""
                print(f"  {x['machine']}: {word}{more}" + "".join(f"\n      {d}" for d in x["details"]))
        if args.check and any(x["state"] not in ("current", "source") for x in r["machines"]):
            raise SystemExit(1)


# ---- the scheduler's part -------------------------------------------------------------------

def _spawn(argv, log):
    """A detached herdr-task run, so the scheduler's round never waits on another machine."""
    os.makedirs(STORE, exist_ok=True)
    with open(os.path.join(STORE, log), "a") as out:
        subprocess.Popen([sys.executable, ENTRY, *argv], stdin=subprocess.DEVNULL, stdout=out, stderr=out, start_new_session=True,
                         cwd=HOME)


def _busy(name):
    """True while another run holds this lock (a sync or a reach refresh in progress)."""
    try:
        f = open(os.path.join(STORE, name), "a")
    except OSError:
        return True
    try:
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return True
    fcntl.flock(f, fcntl.LOCK_UN)
    f.close()
    return False


def machines_pass(report):
    """Each round: after the tools here change (once they've stayed put SYNC_DEBOUNCE_MS), and
    when a machine connects, syncs the machines that need it; refreshes the reach map every
    REACH_EVERY_MS. Both run detached: the round never waits on another machine. No syncs while
    the machines add-on is off or an install holds them (base.SYNC_HOLD). The map's refresh only
    asks herdr-core: this machine's links, and with the add-on on, the linked machines' over them."""
    ms = connected_machines()
    version = manifest()["version"]
    t = now()
    due = []
    held = sync_held()

    def look(d):
        if d.get("seen") != version:
            d["seen"], d["seen_at"] = version, t
        stable = t - d.get("seen_at", 0) >= SYNC_DEBOUNCE_MS
        known = d.setdefault("machines", {})
        for m in ms:
            e = known.setdefault(m["name"], {})
            was = e.get("link")
            e["link"] = m.get("state")
            if m.get("state") != "connected" or not stable or held:
                continue
            if e.get("synced") != version and (was != "connected" or e.get("synced_try") != version or t - e.get("at", 0) >= SYNC_RETRY_MS):
                due.append(m["name"])
                e["synced_try"], e["at"] = version, t
    _save_state(look)
    if due and not _busy(".machines-sync.lock"):
        _spawn(["machines", "sync", "--auto", *due], ".machines-sync.log")
        report.setdefault("synced", []).extend(due)
    # #1104: when the network changes (Tailscale back on, another Wi-Fi) while a link is unreachable, a refresh now,
    # which makes those links try again, and once more NET_AGAIN_MS later (DNS can lag the network by a moment).
    down = any(m.get("state") == "unreachable" for m in ms)
    net, st = _net(), _load_state()
    changed = net != st.get("net")
    retry = down and (changed or t >= (st.get("net_again") or float("inf")))
    if retry and _busy(".reach.lock"):
        pass  # a refresh is under way: the next round looks again (the new network stays unrecorded till then)
    elif retry:
        _spawn(["machines", "reach", "--refresh", "--quiet"], ".reach.log")
        _save_state(lambda d: d.update(net=net, net_again=t + NET_AGAIN_MS if changed else None))
        return
    elif changed or (st.get("net_again") and not down):
        _save_state(lambda d: d.update(net=net, net_again=None))
    if t - (_reach_cache() or {}).get("at", 0) >= REACH_EVERY_MS and not _busy(".reach.lock"):
        _spawn(["machines", "reach", "--refresh", "--quiet"], ".reach.log")


def _net():
    """This machine's network as a cheap fingerprint, contacting nobody: the address it would send from to Tailscale's
    own 100.100.100.100 and to the internet (a UDP connect only picks a route; nothing is sent). Tailscale going on or
    off, or another network, changes it."""
    out = []
    for ip in ("100.100.100.100", "192.0.2.1"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((ip, 9))
                out.append(s.getsockname()[0])
        except OSError:
            out.append(None)
    return out


def cmd_sync_auto(names):
    """The scheduler's detached sync: one at a time (its lock), only the machines it was given."""
    lock = open(os.path.join(STORE, ".machines-sync.lock"), "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return
    r = sync(names)
    for x in r["machines"]:
        print(f"{time.strftime('%H:%M:%S')} sync {x['machine']}: {x['state']} {'; '.join(x['details'])}".rstrip(), flush=True)


# ---- the reach map --------------------------------------------------------------------------
# PROBE runs on a machine (python3 -c, its own source on stdin as S, its options as argv[1]) and
# answers what that machine is and reaches: its herdr-core links, its Assistants and spaces. Then,
# while hops are left, it runs itself on each linked machine nobody on the way has looked at yet,
# through that very link (`hc exec --on`), and puts the answer under the link as "next". It never
# opens a connection of its own: no ssh, no Tailscale, only herdr-core's links (#967).

PROBE = r'''
import json, os, platform, shutil, socket, subprocess, sys, threading
o = json.loads(sys.argv[1])
H = os.path.expanduser("~")
# Shepherdr's own herdr-core session on this machine (3.2): the one hc is in here, when it isn't the default one
SESSION_THERE = os.environ.get("HC_SESSION") if os.environ.get("HC_SESSION") not in (None, "", "default") else "shepherdr"
''' + layout.PY + r'''
def sh(argv, inp=None, timeout=20):
    try:
        r = subprocess.run(argv, input=inp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except Exception as e:
        return 255, "", str(e)
def js(text):
    try:
        return json.loads(text)
    except Exception:
        return None
hc = shutil.which("hc") or (os.path.join(H, ".local/bin/hc") if os.path.isfile(os.path.join(H, ".local/bin/hc")) else None)
me = {"host": socket.gethostname(), "user": os.environ.get("USER") or os.path.basename(H), "os": platform.system(), "hc": bool(hc), "links": []}
me["home"] = H  # where Herdr names a space "Home" (a space with no name of its own)
core = (js(sh([hc, "server", "status", "--json"])[1]) or {}).get("core") if hc else None
me["core"] = core
try:
    with open(SHEP(".herdr/tools.json")) as f:
        me["tools"] = json.load(f).get("version")
except Exception:
    me["tools"] = None
def relink(name):
    # #1104: an unreachable link can sit on its last failure (a DNS error from before Tailscale came back) while
    # herdr-core backs off. `hc machine login` makes it try now, but only with a terminal: a pseudo-terminal it gets,
    # in a session of its own (no controlling terminal, so ssh can't sit on a password prompt); never typed into.
    try:
        import pty
        mfd, sfd = pty.openpty()
    except Exception:
        return
    try:
        subprocess.run([hc, "machine", "login", name], stdin=sfd, stdout=sfd, stderr=sfd, timeout=o["relink"], start_new_session=True)
    except Exception:
        pass
    finally:
        os.close(sfd)
        os.close(mfd)
def links():
    return [m for m in (js(sh([hc, "machine", "ls", "--json"])[1]) or {}).get("machines") or [] if not m.get("temporary")]
if hc:
    ms = links()
    # A refresh (o["relink"]): every link herdr-core holds as unreachable tries again now, then the map reads it anew.
    # needs_login is left alone: that one waits for a person to type.
    down = [m.get("name") for m in ms if m.get("state") == "unreachable" and m.get("name")] if o.get("relink") else []
    if down:
        ths = [threading.Thread(target=relink, args=(n,)) for n in down]
        for t in ths:
            t.start()
        for t in ths:
            t.join()
        ms = links()
    for m in ms:
        me["links"].append({"how": "herdr-core", "to": m.get("name"), "id": m.get("id"), "target": m.get("target"),
                            "state": m.get("state"), "ok": m.get("state") == "connected"})
    # Assistants: live terminals labelled herdr.role=coordinator, or started from the assistant template.
    seen = {}
    for args in (["--label", "herdr.role=coordinator"], []):
        for t in (js(sh([hc, "ls", "--json"] + args)[1]) or {}).get("terminals") or []:
            if "/" in t.get("address", "") or t.get("state") != "live":
                continue
            if args or t.get("template") in ("assistant", "coordinator"):
                seen[t["address"]] = t
    # The spaces: herdr-core's shared document (docs.json) in Shepherdr's own session there (3.2: no window is asked).
    spaces = []
    docs = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(H, ".local/state"), "herdr-core", SESSION_THERE, "docs.json")
    try:
        with open(docs) as f:
            spaces = [s for s in ((json.load(f).get("herdr-app") or {}).get("value") or {}).get("spaces") or []
                      if isinstance(s, dict) and s.get("id") and not s.get("machine")]
    except Exception:
        spaces = []
    me["spaces"] = [{"id": s.get("id"), "name": s.get("name"), "folder": s.get("folder"), "machine": s.get("machine"), "icon": s.get("icon")} for s in spaces]
    names = {s["id"]: s for s in me["spaces"]}
    # Everything (it answers for every machine) and, beside it in the home folder, the main machine's own ~ space (3.2.8),
    # as core/spaces.js everythingOf and tildeOf
    at_home = sorted(str(s["id"]) for s in me["spaces"] if s.get("folder") and os.path.realpath(s["folder"]) == os.path.realpath(H))
    every = "home" if "home" in at_home else (at_home[0] if at_home else None)
    rest = [x for x in at_home if x != every]
    tilde = "tilde" if "tilde" in rest else (rest[0] if rest else None)
    me["assistants"] = []
    for a in seen:
        k = js(sh([hc, "get", a, "--json"])[1]) or {}
        lb = k.get("labels") or {}
        sp = lb.get("herdr.space") or lb.get("herdr.coordinator.space")
        if k.get("state") != "live" or not (lb.get("herdr.role") == "coordinator" or k.get("template") in ("assistant", "coordinator")):
            continue
        s = names.get(sp) or {}
        # marked only where both work (the main machine): another machine's lone home space is no Everything
        role = {} if not tilde else {"role": "everything"} if sp == every else {"role": "home"} if sp == tilde else {}
        me["assistants"].append({"address": a, "space": sp, "space_name": s.get("name") or ("~" if role else os.path.basename(k.get("cwd") or "") or None),
                                 "folder": s.get("folder") or k.get("cwd"), "template": k.get("template"), "name": k.get("name"), **role})
# Next hops: through each herdr-core link that works, to a machine nobody on the way looks at.
if o["depth"] > 0 and core:
    look = [l for l in me["links"] if l.get("ok") and l.get("id") and l["how"] == "herdr-core" and l["id"] not in o["seen"]]
    chosen = {}
    for l in look:
        chosen.setdefault(l["id"], l)
    seen2 = sorted(set(o["seen"]) | {core["id"]} | set(chosen))
    sub = json.dumps({"depth": o["depth"] - 1, "seen": seen2, "timeout": max(15, o["timeout"] - 15), "relink": o.get("relink")})
    boot = "import sys; S = sys.stdin.read(); exec(S)"
    def hop(l):
        argv = [hc, "exec", "--on", l["to"], "--stdin", "--timeout", str(o["timeout"]), "--", "python3", "-c", boot, sub]
        code, out, err = sh(argv, inp=S, timeout=o["timeout"] + 10)
        res = js(out.strip().splitlines()[-1]) if out.strip() else None
        l["next"] = res if isinstance(res, dict) else {"error": (err.strip() or out.strip() or "no answer")[-200:]}
    ths = [threading.Thread(target=hop, args=(l,)) for l in chosen.values()]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
print(json.dumps(me))
'''

REACH = os.path.join(STORE, ".reach.json")


def _reach_cache():
    try:
        with open(REACH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def probe(depth=REACH_DEPTH, timeout=90, relink=False):
    """The reach map from this machine, hops and all, checked now. relink: every machine on the way first makes
    its unreachable links try again now (#1104), each for at most RELINK_S."""
    boot = "import sys; S = sys.stdin.read(); exec(S)"
    r = subprocess.run([sys.executable, "-c", boot, json.dumps({"depth": depth, "seen": [], "timeout": timeout, "relink": RELINK_S if relink else None})], input=PROBE,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=timeout + 60)
    try:
        graph = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Fail(f"the reach check failed: {(r.stderr or r.stdout).strip()[-300:]}")
    d = {"at": now(), "graph": graph}
    os.makedirs(STORE, exist_ok=True)
    tmp = f"{REACH}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, REACH)
    return d


def reach(refresh=False, max_age=REACH_EVERY_MS * 2):
    d = _reach_cache()
    if refresh or not d or now() - d.get("at", 0) > max_age:
        lock = open(os.path.join(STORE, ".reach.lock"), "a")
        fcntl.flock(lock, fcntl.LOCK_EX)  # one check at a time; a second waits and reads the first's
        try:
            d2 = _reach_cache()
            d = d2 if d2 and d2.get("at", 0) > (d or {}).get("at", 0) and not refresh else probe(relink=refresh)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
    return d


def nodes(graph):
    """Every machine in the map once (by its herdr-core id), with the route that reaches it from
    here: [{node, route: [{how, to}], name}]. Shorter routes first, herdr-core links before ssh."""
    out, seen, level = [], set(), [(graph, [])]
    while level:
        nxt = []
        for node, route in level:
            key = (node.get("core") or {}).get("id") or f"host:{node.get('host')}"
            if key in seen:
                continue
            seen.add(key)
            out.append({"node": node, "route": route, "name": route[-1]["to"] if route else "here"})
            for l in sorted(node.get("links") or [], key=lambda l: l["how"] != "herdr-core"):
                if isinstance(l.get("next"), dict) and l["next"].get("links") is not None:
                    nxt.append((l["next"], route + [{"how": l["how"], "to": l["to"]}]))
        level = nxt
    return out


def route_text(route):
    """How a route is written: laptop, or laptop>vm-x for a hop (each name as the machine
    before it calls the next)."""
    return ">".join(r["to"] for r in route)


def edges(graph):
    """Every link in the map, as seen from where it starts: [{from, to, how, ok, state, over}]."""
    rows = []
    for n in nodes(graph):
        frm = n["node"].get("core", {}) or {}
        for l in n["node"].get("links") or []:
            rows.append({"from": frm.get("name") or n["node"].get("host"), "from_route": route_text(n["route"]), "to": l["to"],
                         "how": l["how"], "ok": bool(l.get("ok")), "state": l.get("state"), "over": l.get("over"), "target": l.get("target"),
                         "core": l.get("core") or ((l.get("next") or {}).get("core") or {}).get("name")})
    return rows


def cmd_reach(args):
    d = reach(refresh=args.refresh)
    if getattr(args, "quiet", False):
        print(f"{time.strftime('%H:%M:%S')} reach: {len(nodes(d['graph']))} machine(s)", flush=True)
        return
    if args.json:
        print(json.dumps({"at": d["at"], "from": (d["graph"].get("core") or {}).get("name"), "machines": [
            {"route": route_text(n["route"]) or None, "core": n["node"].get("core"), "host": n["node"].get("host"), "os": n["node"].get("os"),
             "tools": n["node"].get("tools"), "links": [{k: v for k, v in l.items() if k != "next"} for l in n["node"].get("links") or []]}
            for n in nodes(d["graph"])], "graph": d["graph"]}))
        return
    age = (now() - d["at"]) // 60000
    print(f"Reach map from here, checked {'just now' if age < 1 else f'{age} min ago'} (each machine's links as it sees them):")
    for n in nodes(d["graph"]):
        node = n["node"]
        who = route_text(n["route"]) or f"here ({(node.get('core') or {}).get('name') or node.get('host')})"
        print(f"\n{who}{'' if node.get('hc') else ' (no herdr-core)'}")
        for how in ("herdr-core", "ssh", "tailscale"):
            ls = [l for l in node.get("links") or [] if l["how"] == how]
            if ls:
                ok = [l["to"] + (f" (={l['core']})" if l.get("core") and l["core"] != l["to"] else "") for l in ls if l.get("ok")]
                no = [l["to"] for l in ls if not l.get("ok")]
                print(f"  {how}: " + (", ".join(ok) or "none") + (f"; can't: {', '.join(no)}" if no else ""))


# ---- Find machines: only when the person asks (#967) ----------------------------------------
# The hosts this machine's ~/.ssh/config names (no patterns) and its online Tailscale peers (not
# phones), minus the machines it already links to. `machines find` lists them and contacts none;
# `machines find --go` tries each once (batch mode, no new host keys, a few at a time), at most once
# per FIND_EVERY_MS, and says which have herdr-core and aren't linked yet. What it finds goes in
# FOUND for the person to read, never into the reach map: a machine is used once they link it.

FOUND = os.path.join(STORE, ".found.json")
FIND_SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "-o", "LogLevel=ERROR"]


def _found():
    try:
        with open(FOUND) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _save_found(d):
    os.makedirs(os.path.dirname(FOUND), exist_ok=True)
    tmp = f"{FOUND}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, FOUND)


def _linked():
    """This machine's herdr-core links (`hc machine ls`, local): their names, targets' hosts and core ids."""
    names, ids = set(), set()
    hc = shutil.which("hc")
    if not hc:
        return names, ids
    try:
        r = subprocess.run([hc, "machine", "ls", "--json"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True, timeout=20)
        ms = (json.loads(r.stdout or "{}") or {}).get("machines") or []
    except (OSError, ValueError, subprocess.SubprocessError):
        ms = []
    for m in ms:
        for v in (m.get("name"), (m.get("target") or "").split("@")[-1]):
            if v:
                names.add(v)
        if m.get("id"):
            ids.add(m["id"])
    return names, ids


def find_hosts(linked=None):
    """What Find would contact, read from local files and the local Tailscale daemon only:
    [{to, over}]."""
    names = (linked or _linked())[0]
    hosts = {}
    try:
        with open(os.path.join(os.path.expanduser("~"), ".ssh", "config")) as f:
            for line in f:
                w = line.split()
                if len(w) > 1 and w[0].lower() == "host":
                    for h in w[1:]:
                        if not re.search(r"[*?!]", h) and h not in names:
                            hosts.setdefault(h, {"to": h, "over": "ssh config"})
    except OSError:
        pass
    ts = shutil.which("tailscale")
    if ts:
        try:
            st = json.loads(subprocess.run([ts, "status", "--json"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                           universal_newlines=True, timeout=8).stdout or "{}")
        except (OSError, ValueError, subprocess.SubprocessError):
            st = {}
        for p in (st.get("Peer") or {}).values():
            dns = (p.get("DNSName") or "").rstrip(".")
            if dns and p.get("Online") and p.get("OS") not in ("iOS", "android") and dns.split(".")[0] not in names and dns not in names:
                hosts.setdefault(dns, {"to": dns, "over": "tailscale"})
    return list(hosts.values())


def _try_host(h, ids):
    try:
        r = subprocess.run(FIND_SSH + [h["to"], 'PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; hc server status --json 2>/dev/null || echo "{}"'],
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=15)
        code, out, err = r.returncode, r.stdout, r.stderr
    except (OSError, subprocess.SubprocessError) as e:
        code, out, err = 255, "", str(e)
    h = dict(h, ok=code == 0)
    why = (err.strip().splitlines() or ["no answer"])[-1][:120]
    h["state"] = "logged in" if code == 0 else "host key not trusted here" if "Host key verification failed" in why else why
    if code == 0:
        try:
            c = (json.loads(out.strip().splitlines()[-1]) if out.strip() else {}).get("core")
        except (ValueError, AttributeError):
            c = None
        if c:
            h["core"], h["linked"] = c.get("name"), c.get("id") in ids
    return h


def find(go=False):
    """Find machines: without go, what it would contact (and the last run's answer); with go, try
    each once now. Refused within FIND_EVERY_MS of the last."""
    linked = _linked()
    hosts = find_hosts(linked)
    last = _found()
    wait = max(0, FIND_EVERY_MS - (now() - (last or {}).get("at", 0)))
    if not go:
        return {"hosts": hosts, "last": last, "wait_ms": wait}
    if wait:
        raise Fail(f"Find machines ran {(FIND_EVERY_MS - wait) // 60000} min ago; try again in {-(-wait // 60000)} min")
    os.makedirs(STORE, exist_ok=True)
    lock = open(os.path.join(STORE, ".find.lock"), "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close()
        raise Fail("Find machines is already running")
    try:
        # #1108: another Find may have run and let go of the lock since the wait was read: read it again, held
        wait = max(0, FIND_EVERY_MS - (now() - (_found() or {}).get("at", 0)))
        if wait:
            raise Fail(f"Find machines ran {(FIND_EVERY_MS - wait) // 60000} min ago; try again in {-(-wait // 60000)} min")
        _save_found({"at": now(), "hosts": [], "running": True})  # counts for the wait even if this run dies
        out, todo = [None] * len(hosts), list(enumerate(hosts))
        mu = threading.Lock()

        def worker():
            while True:
                with mu:
                    if not todo:
                        return
                    i, h = todo.pop(0)
                out[i] = _try_host(h, linked[1])
        ths = [threading.Thread(target=worker) for _ in range(min(FIND_AT_ONCE, len(hosts)))]
        for t in ths:
            t.start()
        for t in ths:
            t.join()
        d = {"at": now(), "hosts": out}
        _save_found(d)
        return {"hosts": out, "last": d, "wait_ms": FIND_EVERY_MS}
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def cmd_find(args):
    r = find(go=args.go)
    if args.json:
        print(json.dumps(r))
        return
    if not args.go:
        if not r["hosts"]:
            print("Nothing to try: no hosts in ~/.ssh/config and no online Tailscale peers that aren't linked already.")
        else:
            print(f"Find machines would try to log in once (ssh, batch mode) to these {len(r['hosts'])} host(s):")
            for h in r["hosts"]:
                print(f"  {h['to']}  (from {h['over']})")
            print("Run `herdr-task machines find --go` to try them now." if not r["wait_ms"] else
                  f"It ran recently; it can run again in {-(-r['wait_ms'] // 60000)} min.")
        if r.get("last") and r["last"].get("hosts"):
            print("\nLast run:")
    rows = r["hosts"] if args.go else ((r.get("last") or {}).get("hosts") or [])
    for h in rows:
        if not h:
            continue
        what = (f"herdr-core {h['core']!r}, " + ("linked already" if h.get("linked") else "not linked: add it with Add machine")) if h.get("core") else \
            "logged in, no herdr-core there" if h.get("ok") else f"can't log in ({h.get('state')})"
        print(f"  {h['to']}: {what}")


# ---- the Assistant directory and messages ---------------------------------------------------

def directory(refresh=False, max_age=30000):
    """Every live Assistant on every machine reachable from here: [{target, machine, route,
    address, space, space_name, folder}]. target is how to address it (vm-demo/t3, laptop>vm-x/t3,
    t3 here)."""
    d = reach(refresh=refresh, max_age=max_age)
    rows = []
    for n in nodes(d["graph"]):
        r = route_text(n["route"])
        for a in n["node"].get("assistants") or []:
            rows.append({"target": f"{r}/{a['address']}" if r else a["address"], "machine": (n["node"].get("core") or {}).get("name"),
                         "route": r or None, "how": [x["how"] for x in n["route"]], **a})
    return d, rows


def cmd_assistants(args):
    _, rows = directory(refresh=args.refresh)
    if args.json:
        print(json.dumps(rows))
        return
    if not rows:
        print("No live Assistants on any machine reachable from here.")
    for a in rows:
        role = {"everything": "  (Everything: answers for every machine)", "home": "  (its own ~ space, beside Everything)"}.get(a.get("role"), "")
        print(f"{a['target']:<28} {a.get('space_name') or '?':<20} {a.get('folder') or ''}{role}")


def _find(rows, target):
    t = target.strip()
    # A chat's #-mention, whole or its target: [#shop](space:vm-demo/sp1), space:vm-demo/sp1, #shop.
    m = re.fullmatch(r"\[#[^\]]*\]\(space:([^)\s]+)\)", t)
    t = m.group(1) if m else re.sub(r"^space:", "", t).lstrip("#")
    hits = [a for a in rows if t in (a["target"], a.get("space"), f"{a['route']}/{a.get('space')}" if a["route"] else a.get("space"))]
    if not hits:
        hits = [a for a in rows if t == a.get("space_name") or (a["route"] and t == f"{a['route']}/{a.get('space_name')}")]
    return hits


def _path_back(graph, start_id, goal_id):
    """The route (as written from the start machine) along links the map knows, or None."""
    by = {}
    for n in nodes(graph):
        cid = (n["node"].get("core") or {}).get("id")
        if cid:
            by[cid] = n["node"]
    level, seen = [(start_id, [])], {start_id}
    while level:
        nxt = []
        for cid, route in level:
            if cid == goal_id:
                return route
            for l in (by.get(cid) or {}).get("links") or []:
                if l.get("ok") and l.get("id") and l["how"] in ("herdr-core", "ssh") and l["id"] not in seen:
                    seen.add(l["id"])
                    nxt.append((l["id"], route + [l["to"]]))
        level = nxt
    return None


def _hops(route_names, hows, inner):
    """argv that runs inner on the last machine of the route, through each hop as it allows."""
    argv = inner
    for to, how in reversed(list(zip(route_names, hows))):
        argv = ["hc", "exec", "--on", to, "--", *argv] if how == "herdr-core" else \
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", to, shlex.join(argv)]
    return argv


def _deliver(names, hows, address, text):
    """hc send on the receiver's own machine, reached through the route: there it's a plain
    send, as news is (no <hc from> of this machine's). Mid-turn, Claude Code's "send now"."""
    guard(["hc"])
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    there = lambda inner: subprocess.run(_hops(names, hows, inner), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         universal_newlines=True, timeout=20)
    # Not into words the person is writing to it (HERD-71): half a minute for them to finish (all of it within TELL_WAIT).
    for i in range(6):
        if not typing(address, there=there):
            break
        if i == 5:
            raise Fail("not sent: the person is writing to that Assistant right now; try again in a few minutes")
        time.sleep(5)
    # SHEP-324: never into a terminal whose agent isn't in front (a plain shell would run it), checked last thing
    try:
        k = json.loads(there(["hc", "get", address, "--json"]).stdout or "null")
    except ValueError:
        k = None
    f = front(k)
    if f == "shell":
        raise Fail("its agent isn't running there (its terminal is a plain shell now), so nothing was typed into it. "
                   "Restart that Assistant from its chat, then send again")
    if f == "other":
        raise Fail("another program than its agent is in front of its terminal, so nothing was typed into it; try again "
                   "in a few minutes")
    if f != "agent":
        return False
    if there(["hc", "send", address, text]).returncode != 0:
        return False
    for i in range(6):
        time.sleep(0.4)
        if not QUEUED.search(there(["hc", "read", address, "--lines", "40"]).stdout):
            continue
        # only while it works: on a dialog of its own Ctrl+Enter would answer it
        try:
            working = (json.loads(there(["hc", "get", address, "--json"]).stdout or "{}").get("status") or {}).get("state") == "working"
        except ValueError:
            working = False
        if working:
            there(["hc", "keys", address, "ctrl+enter"])
        break
    return True


def tell(target, text, sender=None):
    d, rows = directory()
    hits = _find(rows, target)
    if not hits:
        d, rows = directory(refresh=True)
        hits = _find(rows, target)
    if not hits:
        left = _leave(d["graph"], rows, target, text, sender)
        if left:
            return left
        raise Fail(f"no live Assistant {target!r} reachable from here (herdr-task assistants lists them)")
    if len(hits) > 1:
        raise Fail(f"{target!r} is more than one Assistant: " + ", ".join(a["target"] for a in hits))
    to = hits[0]
    me = sender or os.environ.get("HC_TERMINAL_ID")
    graph = d["graph"]
    here = graph.get("core") or {}
    mine = next((a for a in graph.get("assistants") or [] if a["address"] == me), None)
    receiver = next((n["node"] for n in nodes(graph) if route_text(n["route"]) == (to["route"] or "")), {})
    back = _path_back(graph, (receiver.get("core") or {}).get("id"), here.get("id")) if to["route"] else []
    attrs = {"from": f"{'>'.join(back)}/{me}" if back else (me if back == [] else f"{here.get('name')}/{me}"),
             "machine": here.get("name"), "space": (mine or {}).get("space_name") or (mine or {}).get("space") or "", "can-reply": "yes" if me else "no"}
    esc = lambda s: str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    msg = "<herdr-assistant " + " ".join(f'{k}="{esc(v)}"' for k, v in attrs.items()) + ">" + text.replace("</herdr-assistant", "&lt;/herdr-assistant") + "</herdr-assistant>"
    held, restarted = False, None
    if not to["route"]:
        # While the person writes to it, it waits for them (news.py's held_pass).
        got = send_or_hold(to["address"], msg, "news")
        if got == NO_AGENT:
            # SHEP-324: its agent exited (a plain shell is in front): never typed there; it starts again with this
            restarted = restart_assistant(hc_json("get", to["address"]), msg)
            if not restarted:
                raise Fail("its agent isn't running (its terminal is a plain shell now), so nothing was typed into it, "
                           "and it couldn't be started again. Restart that Assistant from its chat, then send again")
        ok, held = bool(got), got == "held"
    else:
        ok = _deliver(to["route"].split(">"), to["how"], to["address"], msg)
    if not ok:
        raise Fail(f"couldn't deliver to {to['target']}")
    if back is None and me:
        # it can't reach this machine: its answer waits there, and this machine fetches it (replies_pass)
        _await(to["route"], to["how"], (receiver.get("core") or {}).get("name") or to["route"].split(">")[-1], here.get("name"))
    return {"to": to["target"], "space": to.get("space_name"), "can_reply": attrs["can-reply"] == "yes", "from": attrs["from"], "held": held,
            **({"restarted": restarted} if restarted else {})}


# ---- replies that can't go: left for the asker to fetch ------------------------------------
# The Mac reaches a VM, never the other way. A VM's Assistant answering the Mac's (tell-assistant mac/t13 "…") leaves
# its answer in OUTBOX on the VM; the Mac, which asked, remembers that machine in AWAITING for a while and fetches what
# waits for it there over its own link (replies_pass, each tick), then gives it to that Assistant as a message like any
# other <herdr-assistant>.
OUTBOX = os.path.join(STORE, "outbox")
AWAITING = os.path.join(STORE, ".awaiting.json")
AWAIT_MS = 12 * 3600000         # a machine asked from here: its answers fetched for this long after the last ask
FETCH_EVERY_MS = 20000          # at most this often per machine
OUTBOX_KEEP_MS = 24 * 3600000   # an answer nobody fetched: dropped after this
ADDRESS = re.compile(r"t\d[0-9a-z]*")


def _leave(graph, rows, target, text, sender=None):
    """target is an Assistant on a machine this one can't reach (mac/t13, from a message it got): leaves the message
    for that machine to fetch. None when target isn't machine/address, or that machine is reachable from here."""
    m = re.fullmatch(r"([\w.-]+)/(t\d[0-9a-z]*)", target.strip())
    me = sender or os.environ.get("HC_TERMINAL_ID")
    if not m or not me:
        return None
    machine, address = m.groups()
    here = graph.get("core") or {}
    known = {route_text(n["route"]) for n in nodes(graph)} | {(n["node"].get("core") or {}).get("name") for n in nodes(graph)}
    if machine in known or machine == here.get("name"):
        return None
    mine = next((a for a in graph.get("assistants") or [] if a["address"] == me), None)
    os.makedirs(OUTBOX, exist_ok=True)
    _prune_outbox()
    item = {"for": machine, "to": address, "from": me, "machine": here.get("name") or "", "at": now(), "text": text,
            "space": (mine or {}).get("space_name") or (mine or {}).get("space") or ""}
    name = f"{now()}-{secrets_token()}.json"
    tmp = os.path.join(OUTBOX, "." + name)
    with open(tmp, "w") as f:
        json.dump(item, f)
    os.replace(tmp, os.path.join(OUTBOX, name))
    return {"to": target, "left": True, "machine": machine, "can_reply": True, "from": me, "held": False}


def secrets_token():
    return base64.b32encode(os.urandom(5)).decode().lower()


def _prune_outbox():
    for n in os.listdir(OUTBOX) if os.path.isdir(OUTBOX) else []:
        p = os.path.join(OUTBOX, n)
        try:
            if now() - os.path.getmtime(p) * 1000 > OUTBOX_KEEP_MS:
                os.remove(p)
        except OSError:
            pass


def take_outbox(machine):
    """The answers left here for machine, oldest first, each taken out of the outbox."""
    out = []
    _prune_outbox()
    for n in sorted(os.listdir(OUTBOX)) if os.path.isdir(OUTBOX) else []:
        if n.startswith(".") or not n.endswith(".json"):
            continue
        p = os.path.join(OUTBOX, n)
        try:
            with open(p) as f:
                item = json.load(f)
        except (OSError, ValueError):
            continue
        if item.get("for") != machine:
            continue
        try:
            os.remove(p)
        except OSError:
            continue  # another fetch took it
        out.append(item)
    return out


def cmd_outbox(args):
    print(json.dumps(take_outbox(args.for_)))


def _awaiting(update=None):
    os.makedirs(STORE, exist_ok=True)
    with open(AWAITING + ".lock", "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            with open(AWAITING) as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        d = {k: v for k, v in d.items() if isinstance(v, dict) and now() < (v.get("until") or 0)}
        if update:
            update(d)
            tmp = AWAITING + ".tmp"
            with open(tmp, "w") as f:
                json.dump(d, f)
            os.replace(tmp, AWAITING)
        return d


def _await(route, how, name, me):
    if not me:
        return

    def up(d):
        d[route] = {**d.get(route, {}), "how": how, "name": name, "me": me, "until": now() + AWAIT_MS}
    _awaiting(up)


FETCH = 'p=$(command -v herdr-task || echo "$HOME/.local/bin/herdr-task"); exec "$p" _outbox --for "$1"'


def replies_pass(report):
    """Fetches the answers left for this machine on machines it asked that can't reach it, and gives each to the
    Assistant it's for. Nothing to do (no hc call) unless this machine asked one lately."""
    if not os.path.exists(AWAITING):
        return
    due = [(r, v) for r, v in _awaiting().items() if now() - (v.get("fetched") or 0) >= FETCH_EVERY_MS]
    if not due:
        return
    guard(["hc"])
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    for route, v in due:
        _awaiting(lambda d: route in d and d[route].update(fetched=now()))
        try:
            r = subprocess.run(_hops(route.split(">"), v.get("how") or ["herdr-core"] * len(route.split(">")), ["sh", "-c", FETCH, "sh", v["me"]]),
                               env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=30)
            items = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 and r.stdout.strip() else []
        except (OSError, subprocess.SubprocessError, ValueError, IndexError):
            continue
        for x in items if isinstance(items, list) else []:
            to = str(x.get("to") or "")
            if not ADDRESS.fullmatch(to) or not x.get("from"):
                continue
            esc = lambda s: str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
            attrs = {"from": f"{route}/{x['from']}", "machine": x.get("machine") or v.get("name") or "", "space": x.get("space") or "", "can-reply": "yes"}
            msg = "<herdr-assistant " + " ".join(f'{k}="{esc(val)}"' for k, val in attrs.items()) + ">" + \
                str(x.get("text") or "").replace("</herdr-assistant", "&lt;/herdr-assistant") + "</herdr-assistant>"
            got = send_or_hold(to, msg, "news")
            report.setdefault("replies", []).append({"from": attrs["from"], "to": to, "got": got if isinstance(got, str) else bool(got)})


# #1079 #1141: tell-assistant never returned, and nobody knew whether it went. It now ends within TELL_WAIT seconds and
# always says delivered or not, and why (from Codex's sandbox, Herdr can't be reached at all).
TELL_WAIT = 60
SANDBOX_WORDS = re.compile(r"Read-only file system|Operation not permitted|os error (?:30|1)\b|Permission denied")


def sandbox_blocks_hc():
    """Why hc can't reach Herdr from here (a sandbox, Codex's: no socket, a read-only state folder), or None."""
    try:
        r = subprocess.run(["hc", "ls", "--json"], stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    out = f"{r.stdout}\n{r.stderr}"
    if r.returncode != 0 and SANDBOX_WORDS.search(out):
        return "a sandbox keeps this command from reaching Herdr; run it again outside the sandbox (Codex: with escalated permissions)"
    return None


def _timed(fn, seconds):
    """fn() in a thread; Fail when it hasn't ended in `seconds` (its hc calls may still finish after)."""
    box = {}

    def go():
        try:
            box["r"] = fn()
        except BaseException as e:  # noqa: BLE001 - carried to the caller
            box["e"] = e
    t = threading.Thread(target=go, daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        raise Fail(f"no answer from Herdr in {seconds} s, so it may not have arrived; check that Assistant before sending again")
    if "e" in box:
        raise box["e"]
    return box["r"]


def cmd_tell(args):
    from .output import say
    why = sandbox_blocks_hc()
    if why:
        raise Fail(f"Not delivered to {args.target}: {why}.")
    try:
        wait = int(os.environ.get("HERDR_TASK_TELL_WAIT") or TELL_WAIT)
    except ValueError:
        wait = TELL_WAIT
    try:
        r = _timed(lambda: tell(args.target, args.text), wait)
    except Fail as e:
        raise Fail(f"Not delivered to {args.target}: {e}") from None
    if r.get("left"):
        say(args, r, f"Not delivered yet, left for {r['to']} to fetch: {r['machine']} can't be reached from here, so it picks "
                     "this up itself the next time it checks (within a minute while it waits on an answer).")
        return
    say(args, r, ("Not delivered yet, held for" if r.get("held") else "Delivered to") + f" {r['to']}" + (f" ({r['space']})" if r.get("space") else "") +
        (f": its agent had stopped, so it started again ({r['restarted']}) with this as its first message" if r.get("restarted") else "") +
        (": the person is writing to it; it goes once they've sent or cleared that" if r.get("held") else "") +
        ("." if r["can_reply"] else ". It can't reach this machine back, so it can't reply."))
