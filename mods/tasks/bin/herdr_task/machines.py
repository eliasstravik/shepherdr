"""Machines: the same task tools on every machine (sync), what each machine reaches (the reach
map, hop by hop), the Assistants there (the directory) and messages between them.

Reach is only what the real links allow, seen from where each link starts: a machine's own
herdr-core links (`hc machine ls` there), the ssh hosts it can log into with what it already has
(its ~/.ssh/config and its online Tailscale peers, tried in batch mode, never trusting a new host
key) and its Tailscale peers (network only). Through a machine it reaches, the map shows what that
one reaches, and so on: each hop's links are checked on that hop, by that hop. Nothing here makes
keys, trust, tunnels or listeners, and nothing narrows what the links allow. One-way links are
normal: a machine reachable from here may not reach back.
"""

import base64
import fcntl
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time

from .base import addon_off, sync_held, bundle, ENTRY, Fail, guard, HOME, hc_json, now, PACKAGE, run, STORE
from .news import news_send, send_or_hold, typing


# ---- sync: the same task tools on every machine ---------------------------------------------
# What a machine needs to run tasks: herdr-task (one zipapp), herdr-artifact (with its guide and
# markup), herdr-secret (a remote copy: it asks the main machine), herdr-browser once it exists,
# and the role templates. Each goes to the same place under that machine's home as here
# (~/.local/bin/..., ~/.config/herdr-core/templates/...). A stamp there (~/.herdr/tools.json)
# records what was installed (each file's sha256 and its source's time), so a machine that is
# current is skipped, an older copy never replaces a newer one, and a template someone changed
# there is kept (--force replaces it). Nothing else there is touched.

ROLES = ("assistant", "worker", "reviewer")
ARTIFACT_HOME = ".local/share/herdr/artifacts"
STAMP = ".herdr/tools.json"
MACHINES = os.path.join(STORE, ".machines.json")
SYNC_DEBOUNCE_MS = 30000        # files changed here: wait until they stay put this long
SYNC_RETRY_MS = 10 * 60000      # a machine whose sync failed: tried again after this
REACH_EVERY_MS = 5 * 60000      # the scheduler refreshes the reach map this often
REACH_DEPTH = 3                 # hops the map follows past this machine


def _read(path):
    with open(path, "rb") as f:
        return f.read()


def _real(rel):
    """This machine's own copy of a helper on PATH (~/<rel>), followed to its file, or None."""
    p = os.path.realpath(os.path.join(HOME, rel))
    return p if os.path.isfile(p) else None


def _local_stamp():
    try:
        with open(os.path.join(HOME, STAMP)) as f:
            return json.load(f).get("files") or {}
    except (OSError, ValueError):
        return {}


def _core_dir():
    return os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local", "state"), "herdr-core",
                        os.environ.get("HC_SESSION") or "default")


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
    docs, core = js(os.path.join(_core_dir(), "docs.json")) or {}, js(os.path.join(_core_dir(), "core.json")) or {}
    rec = ((docs.get("shepherdr.secrets") if isinstance(docs, dict) else None) or {}).get("value")
    if isinstance(rec, dict) and rec.get("id"):
        return isinstance(core, dict) and rec["id"] == core.get("id")
    return os.path.isfile(os.path.join(HOME, ".herdr", "vault.json")) and not os.path.exists(os.path.join(HOME, ".herdr", "secret-remote"))


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
    browser = _real(".local/bin/herdr-browser")
    if browser:
        add(".local/bin/herdr-browser", _read(browser), 0o755, [browser])
    for role in ROLES:
        rel = f".config/herdr-core/templates/{role}.md"
        p = os.path.join(HOME, rel)
        if os.path.isfile(p):
            add(rel, _read(p), 0o644, [p], protect=True)
    h = hashlib.sha256()
    for f in sorted(files, key=lambda f: f["path"]):
        h.update(f"{f['path']} {f['sha']} {f['mode']}\n".encode())
    for link in links:
        h.update(f"{link['path']} -> {link['target']}\n".encode())
    return {"version": h.hexdigest()[:12], "files": files, "links": links, "touch": touch}


# Runs on the other machine (python3, 3.8+), its input on stdin: checks or installs, then prints
# what it found. Each file: written beside its place, tried (its --version), the old one kept as
# <file>.bak, then swapped in one step (os.replace).
INSTALL = r'''
import base64, hashlib, json, os, shutil, subprocess, sys, time
x = json.loads(sys.stdin.read())
H = os.path.expanduser("~")
P = lambda r: os.path.join(H, r)
def sha(p):
    try:
        with open(p, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None
try:
    with open(P(x["stamp"])) as f:
        stamp = json.load(f)
except Exception:
    stamp = {}
rec = stamp.get("files") or {}
# The machine that holds herdr-task's source (Herdr's own folder, with its links into it) is
# where copies come from: never written to.
source = os.path.isdir(P(".config/herdr-app/mods/tasks/bin/herdr_task"))
out = {"source": source, "files": {}, "links": {}, "stamp": {k: stamp.get(k) for k in ("version", "from", "at")},
       "python": sys.version.split()[0], "os": os.uname().sysname, "home": H}
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
        tmp = p + ".herdr-new"
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(tmp, "wb") as w:
                w.write(base64.b64decode(f["data"]))
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
def main_here():
    # the record naming the machine that keeps the secrets ("shepherdr.secrets"), and this one's id
    core = os.path.join(os.environ.get("XDG_STATE_HOME") or P(".local/state"), "herdr-core", "default")
    try:
        with open(os.path.join(core, "docs.json")) as f:
            rec = (json.load(f).get("shepherdr.secrets") or {}).get("value") or {}
        with open(os.path.join(core, "core.json")) as f:
            me = json.load(f).get("id")
    except Exception:
        return False
    return bool(rec.get("id")) and rec.get("id") == me
if x["op"] == "install" and not source:
    for t in x["touch"]:
        if t.get("unless_main") and main_here():
            continue
        if not os.path.exists(P(t["path"])) and not os.path.exists(P(t["unless"])):
            os.makedirs(os.path.dirname(P(t["path"])), exist_ok=True)
            open(P(t["path"]), "a").close()
    ok = all(v in ("current", "installed", "own copy") for v in list(out["files"].values()) + list(out["links"].values()))
    stamp = {"version": x["version"] if ok else stamp.get("version"), "from": x["from"], "at": int(time.time() * 1000), "files": rec}
    os.makedirs(os.path.dirname(P(x["stamp"])), exist_ok=True)
    tmp = P(x["stamp"]) + ".tmp"
    with open(tmp, "w") as w:
        json.dump(stamp, w, indent=1)
    os.replace(tmp, P(x["stamp"]))
    out["stamp"] = {k: stamp.get(k) for k in ("version", "from", "at")}
print(json.dumps(out))
'''


def core_name():
    """This machine's herdr-core name (what other machines' cores call it by default)."""
    d = hc_json("server", "status") or {}
    return (d.get("core") or {}).get("name") or os.uname().nodename


def connected_machines():
    """This machine's own herdr-core links: [{name, state, ...}] (not --temp ones)."""
    return [m for m in (hc_json("machine", "ls") or {}).get("machines") or [] if not m.get("temporary")]


def _remote_python(machine, script, payload, timeout=120):
    guard(["hc"])
    try:
        r = subprocess.run(["hc", "exec", "--on", machine, "--stdin", "--timeout", str(timeout), "--", "python3", "-c", script],
                           input=json.dumps(payload), stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                           timeout=timeout + 30)
    except subprocess.TimeoutExpired:
        raise Fail("timed out")
    if r.returncode != 0:
        raise Fail((r.stderr or r.stdout).strip()[-300:] or f"hc exec failed ({r.returncode})")
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Fail(f"unreadable answer: {r.stdout.strip()[-200:]}")


OK = ("current", "installed", "own copy")


def _verdict(res):
    if res.get("source"):
        return "source", ["holds herdr-task's source: copies come from there, it's never written to"]
    bad = {p: s for p, s in {**res["files"], **res["links"]}.items() if s not in OK}
    if not bad:
        return "current", []
    return ("failed" if any(s.startswith("failed") for s in bad.values()) else "drift"), [f"{os.path.basename(p)}{' (link)' if p in res['links'] else ''}: {s}" for p, s in sorted(bad.items())]


def sync_machine(machine, m, op="install", force=False):
    """Checks or installs the tools on one machine: {machine, state, details, ...}; state is
    current, drift (some file isn't: details say which and why), failed or unreachable."""
    me = {"from": core_name(), "version": m["version"], "stamp": STAMP, "force": force, "links": m["links"], "touch": m["touch"]}
    bare = lambda f: {k: v for k, v in f.items() if k != "data"}
    try:
        res = _remote_python(machine, INSTALL, {**me, "op": "check", "files": [bare(f) for f in m["files"]]}, timeout=60)
        state, details = _verdict(res)
        if op == "install" and state not in ("current", "source"):
            need = {p for p, s in res["files"].items() if s in ("missing", "behind")}
            send = [{**bare(f), "data": base64.b64encode(f["data"]).decode()} if f["path"] in need else bare(f) for f in m["files"]]
            res = _remote_python(machine, INSTALL, {**me, "op": "install", "files": send}, timeout=180)
            state, details = _verdict(res)
            for f in m["files"]:
                mark = {".local/bin/herdr-task": STORE, f"{ARTIFACT_HOME}/bin/herdr-artifact": os.path.join(HOME, ".herdr", "artifacts")}.get(f["path"])
                if mark and res["files"].get(f["path"]) in ("current", "installed"):
                    _mark(os.path.join(mark, ".remote", machine), hashlib.sha1(f["data"]).hexdigest())
    except Fail as e:
        return {"machine": machine, "state": "unreachable", "details": [str(e)], "version": m["version"]}
    return {"machine": machine, "state": state, "details": details, "version": m["version"], "installed": (res.get("stamp") or {}).get("version"),
            "os": res.get("os"), "python": res.get("python"),
            "changed": sorted(p for p, s in {**res["files"], **res["links"]}.items() if s == "installed")}


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
            {"machine": name, "state": "unreachable", "details": [f"herdr-core link {links[name].get('state')}"], "version": m["version"]}
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
            if r["state"] in ("current", "source"):
                e["synced"] = m["version"]
            elif e.get("synced") == m["version"]:
                e.pop("synced")
    _save_state(record)
    return {"version": m["version"], "machines": rows}


def cmd_machines(args):
    from .output import say
    if args.machines == "reach":
        return cmd_reach(args)
    if args.machines == "sync":
        r = sync(args.machine or None, "check" if args.check else "install", args.force)
        if args.json:
            say(args, r, None)
        else:
            print(f"Tools here: version {r['version']}." if r["machines"] else "No other machines connected here.")
            for x in r["machines"]:
                word = {"current": "current", "source": "holds the source (left alone)", "drift": "out of date", "failed": "failed", "unreachable": "can't reach", "held": "held"}.get(x["state"], x["state"])
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
    the machines add-on is off or an install holds them (base.SYNC_HOLD)."""
    ms = connected_machines()
    version = manifest()["version"]
    t = now()
    due = []
    held = addon_off("machines") or sync_held()

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
    if t - (_reach_cache() or {}).get("at", 0) >= REACH_EVERY_MS and not _busy(".reach.lock"):
        _spawn(["machines", "reach", "--refresh", "--quiet"], ".reach.log")


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
# answers what that machine is and reaches: its herdr-core links, the ssh hosts it can log into,
# its Tailscale peers, its Assistants and spaces. Then, while hops are left, it runs itself on
# each machine it reaches that nobody on the way has looked at yet, through that very link
# (`hc exec --on`, or ssh), and puts the answer under the link as "next".

PROBE = r'''
import json, os, re, shlex, shutil, socket, subprocess, sys, threading
o = json.loads(sys.argv[1])
H = os.path.expanduser("~")
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", "-o", "StrictHostKeyChecking=yes", "-o", "LogLevel=ERROR"]
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
me = {"host": socket.gethostname(), "user": os.environ.get("USER") or os.path.basename(H), "os": os.uname().sysname, "hc": bool(hc), "links": []}
core = (js(sh([hc, "server", "status", "--json"])[1]) or {}).get("core") if hc else None
me["core"] = core
try:
    with open(os.path.join(H, ".herdr/tools.json")) as f:
        me["tools"] = json.load(f).get("version")
except Exception:
    me["tools"] = None
if hc:
    for m in (js(sh([hc, "machine", "ls", "--json"])[1]) or {}).get("machines") or []:
        if not m.get("temporary"):
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
    docs = os.path.join(os.environ.get("XDG_STATE_HOME") or os.path.join(H, ".local/state"), "herdr-core", "default", "docs.json")
    try:
        with open(docs) as f:
            spaces = ((json.load(f).get("herdr-app") or {}).get("value") or {}).get("spaces") or []
    except Exception:
        spaces = []
    me["spaces"] = [{"id": s.get("id"), "name": s.get("name"), "folder": s.get("folder"), "machine": s.get("machine"), "icon": s.get("icon")} for s in spaces]
    names = {s["id"]: s for s in me["spaces"]}
    me["assistants"] = []
    for a in seen:
        k = js(sh([hc, "get", a, "--json"])[1]) or {}
        lb = k.get("labels") or {}
        sp = lb.get("herdr.space") or lb.get("herdr.coordinator.space")
        if k.get("state") != "live" or not (lb.get("herdr.role") == "coordinator" or k.get("template") in ("assistant", "coordinator")):
            continue
        s = names.get(sp) or {}
        me["assistants"].append({"address": a, "space": sp, "space_name": s.get("name") or (os.path.basename(k.get("cwd") or "") or None),
                                 "folder": s.get("folder") or k.get("cwd"), "template": k.get("template"), "name": k.get("name")})
# ssh: the hosts its own config names, and its online Tailscale peers; batch mode, no new host keys.
hosts = {}
try:
    with open(os.path.join(H, ".ssh/config")) as f:
        for line in f:
            w = line.split()
            if len(w) > 1 and w[0].lower() == "host":
                for h in w[1:]:
                    if not re.search(r"[*?!]", h):
                        hosts[h] = {"how": "ssh", "to": h, "over": "ssh config"}
except Exception:
    pass
ts = shutil.which("tailscale")
if ts:
    st = js(sh([ts, "status", "--json"], timeout=8)[1]) or {}
    for p in (st.get("Peer") or {}).values():
        dns = (p.get("DNSName") or "").rstrip(".")
        if not dns:
            continue
        me["links"].append({"how": "tailscale", "to": dns.split(".")[0], "name": p.get("HostName"), "target": dns, "os": p.get("OS"), "ok": bool(p.get("Online")),
                            "state": "online" if p.get("Online") else "offline"})
        if p.get("Online") and p.get("OS") not in ("iOS", "android") and dns not in hosts:
            hosts[dns] = {"how": "ssh", "to": dns, "over": "tailscale"}
def try_ssh(l):
    code, out, err = sh(SSH + [l["to"], 'PATH="$HOME/.local/bin:/usr/local/bin:$PATH"; hc server status --json 2>/dev/null || echo "{}"'], timeout=10)
    l["ok"] = code == 0
    why = (err.strip().splitlines() or ["no answer"])[-1][:120]
    l["state"] = "ok" if code == 0 else "host key not trusted here" if "Host key verification failed" in why else why
    if code == 0:
        c = (js(out.strip().splitlines()[-1] if out.strip() else "{}") or {}).get("core")
        if c:
            l["id"], l["core"] = c.get("id"), c.get("name")
ths = [threading.Thread(target=try_ssh, args=(l,)) for l in hosts.values()]
for t in ths:
    t.start()
for t in ths:
    t.join()
for l in hosts.values():
    if not (core and l.get("id") == core.get("id")):
        me["links"].append(l)
# Next hops: through each link that works, to a machine with herdr-core nobody on the way looks at.
if o["depth"] > 0 and core:
    look = [l for l in me["links"] if l.get("ok") and l.get("id") and l["how"] in ("herdr-core", "ssh") and l["id"] not in o["seen"]]
    chosen = {}
    for l in sorted(look, key=lambda l: l["how"] != "herdr-core"):
        chosen.setdefault(l["id"], l)
    seen2 = sorted(set(o["seen"]) | {core["id"]} | set(chosen))
    sub = json.dumps({"depth": o["depth"] - 1, "seen": seen2, "timeout": max(15, o["timeout"] - 15)})
    boot = "import sys; S = sys.stdin.read(); exec(S)"
    def hop(l):
        if l["how"] == "herdr-core":
            argv = [hc, "exec", "--on", l["to"], "--stdin", "--timeout", str(o["timeout"]), "--", "python3", "-c", boot, sub]
        else:
            argv = SSH + [l["to"], "python3 -c " + shlex.quote(boot) + " " + shlex.quote(sub)]
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


def probe(depth=REACH_DEPTH, timeout=90):
    """The reach map from this machine, hops and all, checked now."""
    boot = "import sys; S = sys.stdin.read(); exec(S)"
    r = subprocess.run([sys.executable, "-c", boot, json.dumps({"depth": depth, "seen": [], "timeout": timeout})], input=PROBE,
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
            d = d2 if d2 and d2.get("at", 0) > (d or {}).get("at", 0) and not refresh else probe()
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
        print(f"{a['target']:<28} {a.get('space_name') or '?':<20} {a.get('folder') or ''}")


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
                                         universal_newlines=True, timeout=90)
    # Not into words the person is writing to it (HERD-71): a minute for them to finish.
    for i in range(12):
        if not typing(address, there=there):
            break
        if i == 11:
            raise Fail("not sent: the person is writing to that Assistant right now; try again in a few minutes")
        time.sleep(5)
    if there(["hc", "send", address, text]).returncode != 0:
        return False
    for i in range(3):
        time.sleep(0.4)
        if "ctrl+enter to send now" in there(["hc", "read", address, "--lines", "40"]).stdout.lower():
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
             "machine": here.get("name"), "space": (mine or {}).get("space_name") or (mine or {}).get("space") or "", "can-reply": "yes" if back is not None and me else "no"}
    esc = lambda s: str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    msg = "<herdr-assistant " + " ".join(f'{k}="{esc(v)}"' for k, v in attrs.items()) + ">" + text.replace("</herdr-assistant", "&lt;/herdr-assistant") + "</herdr-assistant>"
    held = False
    if not to["route"]:
        # While the person writes to it, it waits for them (news.py's held_pass).
        got = send_or_hold(to["address"], msg, "news")
        ok, held = bool(got), got == "held"
    else:
        ok = _deliver(to["route"].split(">"), to["how"], to["address"], msg)
    if not ok:
        raise Fail(f"couldn't deliver to {to['target']}")
    return {"to": to["target"], "space": to.get("space_name"), "can_reply": attrs["can-reply"] == "yes", "from": attrs["from"], "held": held}


def cmd_tell(args):
    from .output import say
    r = tell(args.target, args.text)
    say(args, r, ("Held for" if r.get("held") else "Sent to") + f" {r['to']}" + (f" ({r['space']})" if r.get("space") else "") +
        (": the person is writing to it; it goes once they've sent or cleared that" if r.get("held") else "") +
        ("." if r["can_reply"] else ". It can't reach this machine back, so it can't reply."))
