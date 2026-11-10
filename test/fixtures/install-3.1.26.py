# herdr-task 3.1.26's sync script, as an older main machine sends it to another machine (machines.py INSTALL),
# kept here for test/test_layout.py's mixed-version tests. Never edited: it is what older copies really run.

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
