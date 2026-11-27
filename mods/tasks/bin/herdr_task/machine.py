"""Machine health and plan limits, run on each machine through herdr-core.
Also imported by herdr-task to hold queued work when the machine is busy."""

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time

HOME = os.path.expanduser("~")
MAC = sys.platform == "darwin"

# New tasks wait while the 1-minute load is over this many times the cores, or memory or the
# fullest disk (home, /tmp) is over this share (%): Shepherdr's start limits, and its disk alert.
HOLD = {"start_load": 1.0, "start_memory": 80, "start_disk": 90}
# Past these the sidebar's meter turns red (Shepherdr's alert limits).
ALERT = {"load": 1.5, "memory": 90, "disk": 90}


# ---- health -------------------------------------------------------------------------------------

def _run(argv, timeout=10):
    try:
        return subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True,
                              timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _memory():
    """(total, in use) in bytes: in use is what isn't available."""
    if not MAC:
        with open("/proc/meminfo") as f:
            text = f.read()

        def kb(name):
            m = re.search(r"^%s:\s+(\d+)" % name, text, re.M)
            return int(m.group(1)) * 1024 if m else 0
        total = kb("MemTotal")
        return total, max(0, total - (kb("MemAvailable") or kb("MemFree")))
    total = int(_run(["sysctl", "-n", "hw.memsize"]).strip() or 0)
    # macOS's own free share (kern.memorystatus_level: the figure memory_pressure prints) counts the
    # cache it can take back as free, which a sum of vm_stat's pages doesn't (SHEP-199, #922).
    level = _run(["sysctl", "-n", "kern.memorystatus_level"]).strip()
    if total and level.isdigit():
        return total, total * (100 - min(100, int(level))) // 100
    vm = _run(["vm_stat"])
    page = int((re.search(r"page size of (\d+)", vm) or [0, 4096])[1])

    def pages(name):
        m = re.search(r"^%s:\s+(\d+)" % re.escape(name), vm, re.M)
        return int(m.group(1)) * page if m else 0
    free = pages("Pages free") + pages("Pages inactive") + pages("Pages speculative") + pages("Pages purgeable")
    return total, max(0, total - free) if total else 0


def _disks():
    """Home and /tmp, once each when they're one disk: % full as df counts it (used over what an
    ordinary user could have)."""
    out, seen = [], set()
    for path in (HOME, "/tmp"):
        try:
            st, dev = os.statvfs(path), os.stat(path).st_dev
        except OSError:
            continue
        if dev in seen:
            continue
        seen.add(dev)
        used = (st.f_blocks - st.f_bfree) * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        if used + avail <= 0:
            continue
        out.append({"path": "home" if path == HOME else path, "pct": round(used * 100 / (used + avail)),
                    "free_gb": round(avail / 2 ** 30)})
    return out


def sample():
    """{at, cores, load, cpu, mem_total, mem_used, memory, disk, disks}: cpu is the 1-minute load
    over the cores (%), memory in use (%), disk the fullest (%)."""
    cores = os.cpu_count() or 1
    load = os.getloadavg()[0]
    total, used = _memory()
    disks = _disks()
    return {"at": int(time.time() * 1000), "cores": cores, "load": round(load, 2), "cpu": round(load * 100 / cores),
            "mem_total": total, "mem_used": used, "memory": round(used * 100 / total) if total else 0,
            "disk": max([d["pct"] for d in disks] or [0]), "disks": disks}


def biggest(path, n=3, timeout=120):
    """What fills `path`'s disk under it: its n biggest folders, biggest first, each [folder, bytes,
    its biggest folder or None when none holds most of it]. du on that disk only (-x), two levels
    deep; None when du fails or takes longer than timeout seconds (a slow disk: no detail)."""
    try:
        r = subprocess.run(["du", "-x", "-k", "-d", "2", path], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    root = os.path.normpath(path)
    sizes = {}
    for ln in r.stdout.splitlines():
        size, _, p = ln.partition("\t")
        if size.strip().isdigit() and p:
            sizes[os.path.normpath(p)] = int(size) * 1024
    if not sizes:
        return None
    top = sorted((p for p in sizes if os.path.dirname(p) == root), key=lambda p: -sizes[p])[:n]
    top = [p for p in top if sizes[p] * 20 >= sizes[top[0]]]  # a folder far smaller than the biggest says nothing
    out = []
    for p in top:
        kids = sorted((k for k in sizes if os.path.dirname(k) == p), key=lambda k: -sizes[k])
        out.append([p, sizes[p], kids[0] if kids and sizes[kids[0]] * 2 > sizes[p] else None])
    return out


def size_words(n):
    return f"{n / 2 ** 30:.0f} GB" if n >= 10 * 2 ** 30 else f"{n / 2 ** 30:.1f} GB" if n >= 2 ** 30 else f"{n // 2 ** 20} MB"


def biggest_words(top):
    """[[folder, bytes, child]] in a few words: "~/dev 120 GB (mostly ~/dev/app), ~/.cache 20 GB"."""
    home = lambda p: "~" + p[len(HOME):] if p == HOME or p.startswith(HOME + os.sep) else p
    return ", ".join(f"{home(p)} {size_words(n)}" + (f" (mostly {home(k)})" if k else "") for p, n, k in top or [])


def hold_limits(given=None):
    """The start limits, from `given` (Settings' for this machine) over Shepherdr's defaults. A
    limit set to None is off."""
    out = dict(HOLD)
    for k, v in (given or {}).items():
        if k in out:
            out[k] = v
    return out


def hold_reason(h, limits=None):
    """Why new tasks wait on this machine, in plain words ("memory is 92% full"), or None when
    there's room."""
    lim = hold_limits(limits)
    if lim["start_memory"] is not None and h["memory"] > lim["start_memory"]:
        return "memory is %d%% full" % h["memory"]
    if lim["start_load"] is not None and h["load"] > lim["start_load"] * h["cores"]:
        return "CPU is %d%% busy" % h["cpu"]
    if lim["start_disk"] is not None and h["disk"] > lim["start_disk"]:
        return "disk is %d%% full" % h["disk"]
    return None


# ---- plan limits --------------------------------------------------------------------------------
# A read is {"state": "ok", "windows": [{name, used, resets_at?, resets?}], "plan"?, "account"?},
# {"state": "signed-out" | "no-plan"} or {"state": "unknown", "why"}. A CLI not here is left out.

PATHS = [os.path.join(HOME, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin",
         os.path.join(HOME, ".npm-global", "bin"), os.path.join(HOME, ".bun", "bin"),
         os.path.join(HOME, ".claude", "local")]


def which(name):
    return shutil.which(name, path=os.pathsep.join([os.environ.get("PATH", ""), *PATHS]))


CLAUDE_USAGE = "Plan usage is unavailable here. Open Claude Code and run /usage."


def _window_name(minutes):
    if minutes == 300:
        return "5-hour"
    if minutes == 10080:
        return "Weekly"
    if not isinstance(minutes, (int, float)) or minutes <= 0:
        return "Limit"
    if minutes % 1440 == 0:
        return "%d-day" % (minutes // 1440)
    if minutes % 60 == 0:
        return "%d-hour" % (minutes // 60)
    return "%d-minute" % minutes


def parse_codex(result):
    """account/rateLimits/read's answer. A limit of its own (one model's) says so before its name."""
    result = result or {}
    snaps = list((result.get("rateLimitsByLimitId") or {}).values())
    if not snaps and result.get("rateLimits"):
        snaps = [result["rateLimits"]]
    snaps.sort(key=lambda s: s.get("limitId") != "codex")
    windows = []
    for s in snaps:
        for w in (s.get("primary"), s.get("secondary")):
            if not isinstance((w or {}).get("usedPercent"), (int, float)):
                continue
            named = s.get("limitName") if s.get("limitId") != "codex" and isinstance(s.get("limitName"), str) else ""
            x = {"name": (named[:40] + " · " if named else "") + _window_name(w.get("windowDurationMins")), "used": w["usedPercent"]}
            if isinstance(w.get("resetsAt"), (int, float)):
                x["resets_at"] = int(w["resetsAt"] * 1000)
            windows.append(x)
    plan = next((s.get("planType") for s in snaps if isinstance(s.get("planType"), str) and s.get("planType") != "unknown"), None)
    if not windows:
        return {"state": "unknown", "why": "Codex reported no limits"}
    return dict({"state": "ok", "windows": windows}, **({"plan": plan[:30]} if plan else {}))


def codex_request(method, params=None, subscription=False, binary=None, env=None):
    """Use the documented Codex App Server protocol with auth owned by Codex.
    https://developers.openai.com/codex/app-server
    Make no model turns, logins or forced token refreshes."""
    binary = binary or which("codex")
    if not binary:
        return "missing", None
    try:
        p = subprocess.Popen([binary, "app-server", "--disable", "plugins"], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd="/", env=env)
    except OSError:
        return "unknown", None
    timer = threading.Timer(8, p.kill)
    timer.start()

    def call(message_id, name, args=None):
        message = {"id": message_id, "method": name}
        if args is not None:
            message["params"] = args
        p.stdin.write(json.dumps(message) + "\n")
        p.stdin.flush()
        for line in p.stdout:
            try:
                reply = json.loads(line)
            except ValueError:
                continue
            if isinstance(reply, dict) and reply.get("id") == message_id:
                return reply.get("result")
        return None

    try:
        if call(1, "initialize", {"clientInfo": {"name": "shepherdr", "title": "Shepherdr", "version": "1"}}) is None:
            return "unknown", None
        p.stdin.write('{"method":"initialized"}\n')
        if subscription:
            account = call(2, "account/read", {"refreshToken": False})
            if not isinstance(account, dict) or "account" not in account:
                return "unknown", None
            if account["account"] is None:
                return "signed-out", None
            if account["account"].get("type") not in ("chatgpt", "chatgptDeviceCode"):
                return "no-plan", None
        result = call(3, method, params)
        return ("ok", result) if isinstance(result, dict) else ("unknown", None)
    except (OSError, ValueError, AttributeError):
        return "unknown", None
    finally:
        timer.cancel()
        p.kill()
        try:
            p.stdin.close()
        except OSError:
            pass
        p.stdout.close()
        p.wait()


def limits():
    at = int(time.time() * 1000)
    out = {}
    if which("claude"):
        out["claude"] = {"state": "no-access", "why": CLAUDE_USAGE, "at": at}
    state, result = codex_request("account/rateLimits/read", subscription=True)
    if state != "missing":
        codex = parse_codex(result) if state == "ok" else {"state": state}
        if state == "unknown":
            codex["why"] = "Codex could not report its limits. Open Codex and run /status."
        out["codex"] = dict(codex, at=at)
    return out


def main(argv):
    if "--codex-models" in argv:
        _, result = codex_request("model/list", {"includeHidden": False})
        print(json.dumps(result or {}))
        return 0
    out = {"health": sample()}
    if "--limits" in argv:
        out["limits"] = limits()
    sys.stdout.write(json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
