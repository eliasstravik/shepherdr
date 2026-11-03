"""Diffs a scratch Shepherdr install (./install.sh --root DIR) against this machine's live Herdr home, file by
file: python3 scripts/parity.py DIR. Read only. Leaves out art-* artifact mods (state)."""
import hashlib, json, os, sys
R, LIVE_HOME = sys.argv[1], os.path.expanduser("~")
def files(top, rel=""):
    out = {}
    for d, dirs, fs in os.walk(os.path.join(top, rel)):
        dirs[:] = [x for x in dirs if x != "__pycache__"]
        for f in fs:
            p = os.path.join(d, f); out[os.path.relpath(p, top)] = p
    return out
def sha(p):
    try: return hashlib.sha256(open(p, "rb").read()).hexdigest()
    except OSError: return None
APP = ".config/herdr-app"
rows = {"same": [], "differs": [], "only-live": [], "only-install": []}
for area in ["mods", "lib", "bin", "layouts"]:
    a = files(os.path.join(R, APP), area); b = files(os.path.join(LIVE_HOME, APP), area)
    for k in sorted(set(a) | set(b)):
        if area == "mods" and k.split("/")[1].startswith("art-"): continue
        if k not in b: rows["only-install"].append(k)
        elif k not in a: rows["only-live"].append(k)
        elif sha(a[k]) == sha(b[k]): rows["same"].append(k)
        else: rows["differs"].append(k)
for t in ["assistant.md", "worker.md", "reviewer.md"]:
    k = f".config/herdr-core/templates/{t}"
    rows["same" if sha(os.path.join(R, k)) == sha(os.path.join(LIVE_HOME, k)) else "differs"].append(k)
for n in ["herdr-task", "herdr-artifact", "herdr-secret", "herdr-browser", "shepherdr", "herdr-app"]:
    a, b = os.path.join(R, ".local/bin", n), os.path.join(LIVE_HOME, ".local/bin", n)
    ra = os.path.relpath(os.path.realpath(a), R) if os.path.lexists(a) else None
    rb = os.path.relpath(os.path.realpath(b), LIVE_HOME) if os.path.lexists(b) else None
    k = f".local/bin/{n}"
    if ra is None: rows["only-live"].append(k)
    elif rb is None: rows["only-install"].append(k)
    elif ra == rb or sha(a) == sha(b): rows["same"].append(k)
    else: rows["differs"].append(f"{k} ({ra} vs {rb})")
ka = json.load(open(os.path.join(R, APP, "keys.json"))); kb = json.load(open(os.path.join(LIVE_HOME, APP, "keys.json")))
keys = [(c, k, ka.get(c, {}).get(k), kb.get(c, {}).get(k)) for c in sorted(set(ka) | set(kb)) for k in sorted(set(ka.get(c, {})) | set(kb.get(c, {}))) if ka.get(c, {}).get(k) != kb.get(c, {}).get(k)]
print(json.dumps({k: len(v) for k, v in rows.items()}))
for k in ["differs", "only-live", "only-install"]:
    for x in rows[k]: print(f"{k:13} {x}")
for c, k, a, b in keys: print(f"key          {c} {k}: install={a!r} live={b!r}")
