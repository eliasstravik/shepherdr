"""Whether Codex's sandbox can start on this machine (SHEP-227, GitHub #998, #1024).

On Linux, Codex runs every command in a bubblewrap (bwrap) sandbox. Ubuntu 24.04's AppArmor
(kernel.apparmor_restrict_unprivileged_userns=1) lets bwrap make its user namespace but then
takes its capabilities, so it can't bring up loopback ("bwrap: loopback: Failed RTM_NEWADDR:
Operation not permitted") and every command fails: a read-only Codex reviewer sees no file, and a
Codex worker waits on a permission card for each command. This finds that once per machine (a
real `codex sandbox -- true`, the same bwrap Codex uses) and says what's wrong and the fix for
this host, as herdr-browser does for Chrome. It never loosens the sandbox: the person applies the
fix. The answer is kept until Codex, bwrap, the AppArmor switch or its profiles change.
"""

import json
import os
import shutil
import subprocess
import time

from .base import WHERE

CACHE = os.environ.get("HERDR_TASK_SANDBOX_CACHE") or os.path.join(WHERE.roots["state"], "codex-sandbox.json")
USERNS_SYSCTL = os.environ.get("HERDR_TASK_USERNS_SYSCTL") or "/proc/sys/kernel/apparmor_restrict_unprivileged_userns"
APPARMOR_D = os.environ.get("HERDR_TASK_APPARMOR_D") or "/etc/apparmor.d"
PROFILE = "herdr-codex-bwrap"
# the kernel's own switches for user namespaces: a change asks again
LIMITS = ("/proc/sys/user/max_user_namespaces", "/proc/sys/kernel/unprivileged_userns_clone")
PROBE_TIMEOUT = 20
KEEP = 7 * 86400  # an answer older than this is asked again


def sandboxed(argv):
    """Whether this agent command runs Codex inside its sandbox (not --dangerously-bypass…)."""
    argv = [str(a) for a in argv or []]
    if not any(os.path.basename(a) == "codex" for a in argv[:3]):
        return False
    if "--dangerously-bypass-approvals-and-sandbox" in argv:
        return False
    return not any(argv[i] in ("-s", "--sandbox") and argv[i + 1:i + 2] == ["danger-full-access"] for i in range(len(argv)))


def _read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def _stamp(path):
    try:
        st = os.stat(path)
        return f"{st.st_size}:{int(st.st_mtime)}"
    except OSError:
        return None


def bwrap_path(codex):
    """The bwrap Codex runs: the system's when there is one (Codex prefers it), else its own,
    which runs from the codex program itself."""
    return shutil.which("bwrap") or os.path.realpath(codex)


def _key(codex):
    """What the answer depends on: a change to any of these asks again."""
    real = os.path.realpath(codex)
    bw = bwrap_path(codex)
    return {"codex": real, "codex_at": _stamp(real), "bwrap": bw, "bwrap_at": _stamp(os.path.realpath(bw)),
            "userns": _read(USERNS_SYSCTL), "profile": _stamp(os.path.join(APPARMOR_D, PROFILE)),
            "limits": [_read(p) for p in LIMITS]}


def probe(codex):
    """(ok, the error's first bwrap line or '') from a real `codex sandbox -- true`."""
    try:
        r = subprocess.run([codex, "sandbox", "--", "true"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, timeout=PROBE_TIMEOUT, cwd=os.path.expanduser("~"))
    except subprocess.TimeoutExpired:
        return True, ""   # slow, not refused: no word
    except OSError:
        return True, ""
    if r.returncode == 0:
        return True, ""
    lines = [x.strip() for x in (r.stderr or "").splitlines() if x.strip()]
    said = next((x for x in lines if "bwrap" in x or "namespace" in x.lower() or "RTM_NEWADDR" in x), None)
    # Only the sandbox refusing counts: an older codex without `sandbox`, or another failure, says nothing.
    return (False, said[:300]) if said else (True, "")


def check(fresh=False):
    """None when Codex's sandbox starts here (or isn't used here: not Linux, no codex), else
    {"error": what bwrap said, "bwrap": its path, "userns": whether AppArmor's switch is on, "at"}.
    Asked once and kept (CACHE) until what it depends on changes."""
    if os.uname().sysname != "Linux":
        return None
    codex = shutil.which("codex")
    if not codex:
        return None
    key = _key(codex)
    try:
        with open(CACHE) as f:
            kept = json.load(f)
    except (OSError, ValueError):
        kept = None
    if not fresh and isinstance(kept, dict) and kept.get("key") == key and time.time() - kept.get("at", 0) < KEEP:
        return kept.get("broken")
    ok, said = probe(codex)
    broken = None if ok else {"error": said, "bwrap": key["bwrap"], "userns": key["userns"] == "1", "at": int(time.time())}
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        tmp = CACHE + ".tmp"
        with open(tmp, "w") as f:
            json.dump({"key": key, "at": time.time(), "broken": broken}, f)
        os.replace(tmp, CACHE)
    except OSError:
        pass
    return broken


def fix_lines(b):
    """The fix for this host, as commands the person runs with sudo (never run here)."""
    bw = b.get("bwrap") or "/usr/bin/bwrap"
    if b.get("userns"):
        return [
            "AppArmor blocks it (Ubuntu's kernel.apparmor_restrict_unprivileged_userns). To let only Codex's bwrap make "
            "its sandbox, run these two with sudo:",
            "",
            f"  printf '%s\\n' 'abi <abi/4.0>,' 'include <tunables/global>' '' 'profile {PROFILE} \"{bw}\" flags=(unconfined) {{' "
            f"'  userns,' '}}' | sudo tee {APPARMOR_D}/{PROFILE} >/dev/null",
            f"  sudo apparmor_parser -r {APPARMOR_D}/{PROFILE}",
            "",
            "The wider way, for every program on this machine until the next reboot: "
            "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
        ] + ([] if shutil.which("bwrap") else [
            "", "This profile names Codex's own program, whose path changes when Codex updates: the two lines are "
            "needed again then (or install the system's bubblewrap, which Codex uses instead)."])
    return ["This machine doesn't let bwrap make its user namespace (a container or a kernel setting such as "
            "user.max_user_namespaces=0 or kernel.unprivileged_userns_clone=0). Allow unprivileged user namespaces "
            "for this user, or run Codex on another machine."]


def notice(b, short=False):
    """The person's words: what's wrong, what it means, the fix. short: one line for a Settings block."""
    head = f"Codex's sandbox can't start on this machine ({b.get('error') or 'bwrap refused'})"
    if short:
        return (head + ": every Codex command fails or waits on a permission card, and a Codex review can't read "
                "the files, so it is no review. Don't loosen the sandbox yourself: tell the person, who fixes the "
                "machine (`herdr-task sandbox` says how).")
    return "\n".join([head + ".",
                      "Every command a Codex worker runs fails or waits on a permission card, and a Codex reviewer can't "
                      "read the files. The sandbox stays on and nothing was changed.", ""] + fix_lines(b) +
                     ["", "Then run `herdr-task sandbox --check` to see it work."])


def cmd_sandbox(args):
    from .output import say
    b = check(fresh=bool(args.check))
    if not b:
        say(args, {"ok": True}, "Codex's sandbox starts on this machine." if shutil.which("codex") and os.uname().sysname == "Linux"
            else "Nothing to check: no Codex sandbox on this machine.")
        return 0
    say(args, {"ok": False, **b, "notice": notice(b)}, notice(b))
    return 1
