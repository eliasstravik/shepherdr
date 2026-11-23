"""SHEP-346: herdr-desktop finds a usable agent-desktop (1.3.1 up to 1.3.x) or installs Shepherdr's own: the release's
archive for this machine, checked against the pin's checksum, from a local folder standing in for GitHub. Its --status
says what is missing and the one fix; on a Mac also agent-desktop's permissions and Screen Sharing; doctor says it,
install and update put it in place, machines sync carries it, the Assistant's template offers a desktop only when ok.
No Mac here: the Mac checks run with the shared driver and a fake agent-desktop answering as its docs say."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import base64
import hashlib
import io
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from importlib.machinery import SourceFileLoader
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HD = os.path.join(ROOT, "bin", "herdr-desktop")
SHEPHERDR = os.path.join(ROOT, "bin", "shepherdr")
TASK_BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, TASK_BIN)
sys.dont_write_bytecode = True
from herdr_task import machines  # noqa: E402

DARWIN = platform.system() == "Darwin"
HELPER = "agent-desktop-macos-helper" if DARWIN else "agent-desktop-linux-clipboard-owner"
TARGET = {"x86_64": "x86_64", "amd64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}[platform.machine().lower()] + \
    ("-apple-darwin" if DARWIN else "-unknown-linux-gnu")

# A fake agent-desktop: its version, `permissions` as agent-desktop answers it (FAKE_AD_PERMS: the three states), and
# every other command echoed.
FAKE = r'''#!/bin/sh
case "$1" in
  --version|version) echo "agent-desktop VER" ;;
  permissions)
    set -- ${FAKE_AD_PERMS:-granted granted not_required}
    printf '{"version":"2.6","ok":true,"command":"permissions","data":{"accessibility":{"state":"%s"},"screen_recording":{"state":"%s"},"automation":{"state":"%s"}}}\n' "$1" "$2" "$3" ;;
  *) echo "WHO $*" ;;
esac
'''


def fake(version, who):
    return FAKE.replace("VER", version).replace("WHO", who)


def archive(path, entries):
    with tarfile.open(path, "w:gz") as t:
        for name, text in entries.items():
            data = text.encode()
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o755
            t.addfile(info, io.BytesIO(data))
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class Rfb:
    """A screen server on 127.0.0.1 that says hello as RFB 3.8 and offers these security types (Screen Sharing:
    30 and 35 only when "VNC viewers may control screen with password" is off, 2 too when it's on)."""

    def __init__(self, types):
        self.s = socket.socket()
        self.s.bind(("127.0.0.1", 0))
        self.s.listen(5)
        self.port = self.s.getsockname()[1]
        self.types = bytes(types)
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                c, _ = self.s.accept()
            except OSError:
                return
            try:
                c.sendall(b"RFB 003.889\n")
                c.recv(12)
                c.sendall(bytes([len(self.types)]) + self.types)
            except OSError:
                pass
            finally:
                c.close()

    def close(self):
        self.s.close()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class HerdrDesktop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shepherdr-ad-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home")
        self.rel = os.path.join(self.tmp, "release")
        os.makedirs(self.home)
        os.makedirs(self.rel)
        self.sha = archive(os.path.join(self.rel, f"agent-desktop-v1.3.1-{TARGET}.tar.gz"),
                           {"agent-desktop": fake("1.3.1", "mine"), HELPER: "#!/bin/sh\n"})
        self.mine = os.path.join(self.home, ".local/share/shepherdr/agent-desktop/1.3.1/agent-desktop")
        self.empty = os.path.join(self.tmp, "nothing")
        os.makedirs(self.empty)

    def on_path(self, version):
        d = os.path.join(self.tmp, f"path-{version}")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "agent-desktop"), "w") as f:
            f.write(fake(version, "path"))
        os.chmod(os.path.join(d, "agent-desktop"), 0o755)
        return d

    def hd(self, *args, path=None, url=None, sha=None, **extra):
        env = {"HOME": self.home, "PATH": f"{path or self.empty}:/usr/bin:/bin", "HERDR_DESKTOP_URL": url or "file://" + self.rel,
               "HERDR_DESKTOP_SHA256": sha or self.sha, "HERDR_DESKTOP_DRIVER": "shared", "HERDR_DESKTOP_WAIT": "0",
               "HERDR_DESKTOP_PORT": str(free_port()), **extra}
        return subprocess.run(["sh", HD, *args], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL, timeout=60)

    def status(self, **kw):
        p = self.hd("--status", **kw)
        return json.loads(p.stdout)

    def test_missing_says_so_and_the_fix(self):
        st = self.status(HERDR_DESKTOP_DRIVER="own")
        self.assertFalse(st["ok"])
        self.assertEqual((st["bin"], st["from"], st["pin"]), ("", "", "1.3.1"))
        self.assertIn("agent-desktop isn't installed here. Fix it: ", st["problem"])
        self.assertTrue(st["fix"].endswith("--install"), st["fix"])
        self.assertFalse(os.path.exists(self.mine), "--status installs nothing")
        self.assertIn("isn't here yet", self.hd("--help").stdout)
        self.assertEqual(self.hd("--bin").returncode, 1)

    def test_missing_installs_its_own_on_first_use(self):
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("installing agent-desktop 1.3.1", p.stderr)
        self.assertIn("mine list-apps", p.stdout)
        self.assertTrue(os.access(self.mine, os.X_OK))
        self.assertTrue(os.path.isfile(os.path.join(os.path.dirname(self.mine), HELPER)), "its helper beside it")
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps")
        self.assertNotIn("installing", p.stderr)
        self.assertEqual(self.hd("--bin").stdout.strip(), self.mine)

    def test_herdrs_own_views_never_install(self):
        p = self.hd("--own", "--task", "a#1", "--space", "s1", "list-apps")
        self.assertEqual(p.returncode, 127)
        self.assertIn("agent-desktop isn't installed here", p.stderr)
        self.assertFalse(os.path.exists(self.mine))

    def test_install_failing_says_why_and_the_fix(self):
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps", url="file://" + os.path.join(self.tmp, "nowhere"))
        self.assertEqual(p.returncode, 127)
        self.assertIn("couldn't install it: couldn't download it", p.stderr)
        self.assertIn("Fix it: ", p.stderr)
        # not tried again for a while
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps")
        self.assertEqual(p.returncode, 127)
        self.assertNotIn("installing", p.stderr)
        self.assertIn("couldn't download it", self.status()["failed"])
        # an archive that isn't the pinned release is never kept
        p = self.hd("--install", sha="0" * 64)
        self.assertEqual(p.returncode, 1)
        self.assertIn("its checksum differs", p.stderr)
        self.assertFalse(os.path.exists(self.mine))
        # nor one holding other files than agent-desktop and its helper
        odd = os.path.join(self.tmp, "odd")
        os.makedirs(odd)
        sha = archive(os.path.join(odd, f"agent-desktop-v1.3.1-{TARGET}.tar.gz"), {"agent-desktop": fake("1.3.1", "x"), HELPER: "", "extra": ""})
        p = self.hd("--install", url="file://" + odd, sha=sha)
        self.assertEqual(p.returncode, 1)
        self.assertIn("it holds other files", p.stderr)
        self.assertFalse(os.path.exists(self.mine))
        # --install tries again whenever asked, and clears the failure
        p = self.hd("--install")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("agent-desktop 1.3.1 is ready", p.stdout)
        self.assertEqual(self.status()["failed"], "")

    def test_compatible_one_on_the_path_is_used_as_it_is(self):
        for v, ok in (("1.3.1", True), ("1.3.2", True), ("1.3.12", True), ("1.3.0", False), ("1.4.0", False), ("2.3.1", False), ("1.3", False)):
            st = self.status(path=self.on_path(v), HERDR_DESKTOP_DRIVER="own")
            self.assertEqual(st["problem"].startswith("herdr-desktop: Shepherdr runs agent-desktop 1.3.1"), not ok, (v, st))
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps", path=self.on_path("1.3.2"))
        self.assertIn("path list-apps", p.stdout)
        self.assertFalse(os.path.exists(self.mine))
        # too old: replaced by its own
        p = self.hd("--task", "a#1", "--space", "s1", "list-apps", path=self.on_path("1.2.9"))
        self.assertIn("mine list-apps", p.stdout)

    def test_a_new_pin_replaces_the_old_copy(self):
        old = os.path.join(self.home, ".local/share/shepherdr/agent-desktop/1.2.0")
        os.makedirs(old)
        self.assertEqual(self.hd("--install").returncode, 0)
        self.assertTrue(os.path.exists(self.mine))
        self.assertFalse(os.path.exists(old))

    def test_a_mac_says_what_only_the_person_can_switch_on(self):
        self.assertEqual(self.hd("--install").returncode, 0)
        # agent-desktop's own report: Accessibility and Screen Recording denied (as on the person's Mac), Screen Sharing off
        st = self.status(FAKE_AD_PERMS="denied denied not_required")
        self.assertFalse(st["ok"])
        self.assertEqual(st["permissions"], {"accessibility": "denied", "screen_recording": "denied", "automation": "not_required"})
        self.assertEqual(st["screen_sharing"], "off")
        self.assertEqual(len(st["needs"]), 3, st["needs"])
        self.assertIn("System Settings › Privacy & Security › Accessibility", st["needs"][0])
        self.assertIn("System Settings › Privacy & Security › Screen Recording", st["needs"][1])
        self.assertIn("System Settings › General › Sharing › Screen Sharing", st["needs"][2])
        self.assertIn("Accessibility is off", st["problem"])
        self.assertEqual(st["fix"], "herdr-desktop permissions --guide")
        # Screen Sharing on, but no VNC password sign-in: says where to switch it on
        srv = Rfb([30, 35])
        self.addCleanup(srv.close)
        st = self.status(HERDR_DESKTOP_PORT=str(srv.port))
        self.assertTrue(st["ok"], st)
        self.assertEqual(st["screen_sharing"], "nopw")
        self.assertEqual(len(st["needs"]), 1)
        self.assertIn('the i button beside Screen Sharing, switch on "VNC viewers may control screen with password"', st["needs"][0])
        # all on: nothing to do
        srv2 = Rfb([30, 2])
        self.addCleanup(srv2.close)
        st = self.status(HERDR_DESKTOP_PORT=str(srv2.port))
        self.assertEqual((st["ok"], st["screen_sharing"], st["needs"], st["problem"]), (True, "on", [], ""))
        # permissions --guide is agent-desktop's own, at the Mac: it runs as it is
        self.assertIn('"command":"permissions"', self.hd("--task", "a#1", "--space", "s1", "permissions", "--guide").stdout)
        # an answer it can't read: said, not taken as granted
        with open(self.mine, "w") as f:
            f.write(fake("1.3.1", "mine").replace("permissions)", "permissions) echo nonsense; exit 0 ;;\n  never)"))
        st = self.status(HERDR_DESKTOP_PORT=str(srv2.port))
        self.assertFalse(st["ok"])
        self.assertIn("could not say which Mac permissions", st["problem"])

    def test_linux_without_a_virtual_display_says_what_to_install(self):
        self.assertEqual(self.hd("--install").returncode, 0)
        # the system's programs without any display server
        nox = os.path.join(self.tmp, "nox")
        os.makedirs(nox)
        for d in ("/usr/bin", "/bin"):
            for n in os.listdir(d):
                if n not in ("Xvnc", "Xvfb", "x11vnc") and not os.path.lexists(os.path.join(nox, n)):
                    os.symlink(os.path.join(d, n), os.path.join(nox, n))
        st = self.status(HERDR_DESKTOP_DRIVER="own", PATH=nox)
        self.assertFalse(st["ok"])
        self.assertIn("agent-desktop is here, but this machine still needs a virtual display with a screen server: Xvnc", st["problem"])

    def test_linux_needs_no_mac_permissions(self):
        self.assertEqual(self.hd("--install").returncode, 0)
        st = self.status(HERDR_DESKTOP_DRIVER="own", FAKE_AD_PERMS="denied denied denied")
        self.assertEqual((st["permissions"], st["needs"], st["screen_sharing"]), (None, [], ""))


class InstallAndDoctor(unittest.TestCase):
    """The installer makes sure of it (only on the real home, or when asked for a scratch root); doctor says how it
    stands, with the fix; uninstall takes it away."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shepherdr-ad-i-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.rel = os.path.join(self.tmp, "release")
        os.makedirs(self.rel)
        self.sha = archive(os.path.join(self.rel, f"agent-desktop-v1.3.1-{TARGET}.tar.gz"),
                           {"agent-desktop": fake("1.3.1", "mine"), HELPER: "#!/bin/sh\n"})
        self.root = os.path.join(self.tmp, "root")
        os.makedirs(os.path.join(self.root, ".config/herdr-app"))
        # a virtual display here (GitHub's runner has none): a stand-in Xvnc first on the PATH
        xbin = os.path.join(self.tmp, "xbin")
        os.makedirs(xbin)
        with open(os.path.join(xbin, "Xvnc"), "w") as f:
            f.write("#!/bin/sh\n")
        os.chmod(os.path.join(xbin, "Xvnc"), 0o755)
        path = ":".join([xbin] + [d for d in os.environ["PATH"].split(":") if not os.path.exists(os.path.join(d, "agent-desktop"))])
        self.env = {**os.environ, "PATH": path, "HERDR_DESKTOP_URL": "file://" + self.rel, "HERDR_DESKTOP_SHA256": self.sha,
                    "HERDR_DESKTOP_DRIVER": "own"}
        for k in ("SHEPHERDR_AGENT_DESKTOP", "SHEPHERDR_AGENT_BROWSER", "HERDR_DESKTOP_BIN"):
            self.env.pop(k, None)

    def sh(self, *a, **e):
        return subprocess.run([sys.executable, SHEPHERDR, *a], capture_output=True, text=True, stdin=subprocess.DEVNULL,
                              env={**self.env, **e}, timeout=600)

    def test_install_doctor_uninstall(self):
        p = self.sh("install", "--root", self.root, "--yes", "--no-build")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        mine = os.path.join(self.root, ".local/share/shepherdr/agent-desktop/1.3.1/agent-desktop")
        self.assertFalse(os.path.exists(mine), "a scratch root downloads nothing unless asked")
        self.assertIn("the agents' desktop: agent-desktop isn't installed here. Fix it: ", self.sh("doctor", "--root", self.root).stdout)
        p = self.sh("update", "--root", self.root, "--yes", "--no-build", SHEPHERDR_AGENT_DESKTOP="1")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("agent-desktop 1.3.1 is ready", p.stdout)
        self.assertTrue(os.path.exists(mine))
        self.assertIn("agent-desktop 1.3.1 for the agents' desktop (Shepherdr's own copy)", self.sh("doctor", "--root", self.root).stdout)
        self.assertEqual(self.sh("uninstall", "--root", self.root).returncode, 0)
        self.assertFalse(os.path.exists(os.path.dirname(mine)), "uninstall takes Shepherdr's agent-desktop away")

    def test_doctor_on_a_mac_names_each_thing_and_the_password_secret(self):
        mod = SourceFileLoader("shepherdr_ad", SHEPHERDR).load_module()
        share = os.path.join(self.root, mod.SHARE, "bin")
        os.makedirs(share)
        shutil.copy(HD, os.path.join(share, "herdr-desktop"))
        bin_ = os.path.join(self.root, ".local/bin")
        os.makedirs(bin_)
        names = os.path.join(self.tmp, "names.json")
        with open(os.path.join(bin_, "herdr-secret"), "w") as f:
            f.write(f"import sys\nprint(open({names!r}).read())\n")
        with open(names, "w") as f:
            json.dump([{"name": "OPENAI_API_KEY"}], f)
        env = {**self.env, "HERDR_DESKTOP_DRIVER": "shared", "HERDR_DESKTOP_PORT": str(free_port()), "FAKE_AD_PERMS": "denied unknown not_required"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(subprocess.run(["sh", HD, "--install"], env={**env, "HOME": self.root}, capture_output=True).returncode, 0)
            lines = mod.agent_desktop_state(self.root, True)
        text = "\n".join(lines)
        self.assertIn("the agents' desktop: Accessibility is off for agent-desktop", lines[0])
        self.assertIn("Screen Recording is off", text)
        self.assertIn("Screen Sharing is off", text)
        self.assertIn("as the secret SCREEN_SHARING_PASSWORD", text)
        self.assertEqual(text.count("Accessibility is off"), 1, "the problem isn't said twice")
        # with the secret kept and everything on: one line, agent-desktop's
        with open(names, "w") as f:
            json.dump([{"name": "SCREEN_SHARING_PASSWORD"}], f)
        srv = Rfb([30, 2])
        self.addCleanup(srv.close)
        with mock.patch.dict(os.environ, {**env, "HERDR_DESKTOP_PORT": str(srv.port), "FAKE_AD_PERMS": ""}, clear=True):
            lines = mod.agent_desktop_state(self.root, True)
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("agent-desktop 1.3.1 for the agents' desktop (Shepherdr's own copy)", lines[0])


class MachinesSync(unittest.TestCase):
    """herdr-task machines sync carries herdr-desktop, and runs its --install there when agent-desktop is missing."""

    def run_install(self, home, op, helper):
        rel = ".local/bin/herdr-desktop"
        data = helper.encode()
        payload = {"op": op, "stamp": ".herdr/tools.json", "version": "t", "from": "test", "links": [], "touch": [],
                   "ensure": [rel], "files": [{"path": rel, "data": base64.b64encode(data).decode(),
                                               "sha": hashlib.sha256(data).hexdigest(), "mode": 0o755, "at": 1}]}
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(payload), capture_output=True, text=True,
                           env={"HOME": home, "PATH": "/usr/bin:/bin"}, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout.splitlines()[-1])

    def test_check_says_missing_and_install_installs_it(self):
        home = tempfile.mkdtemp(prefix="shepherdr-ad-sync-")
        self.addCleanup(shutil.rmtree, home, True)
        # a stand-in herdr-desktop: --bin fails until --install made its mark
        helper = ('#!/bin/sh\nm="$HOME/ad-installed"\ncase "$1" in\n  --bin) [ -f "$m" ] ;;\n'
                  '  --install) [ -f "$HOME/offline" ] && { echo "herdr-desktop: agent-desktop isn\'t installed here, and Shepherdr '
                  'couldn\'t install it: offline. Fix it: herdr-desktop --install" >&2; exit 1; }; touch "$m"; echo ready ;;\nesac\n')
        res = self.run_install(home, "check", helper)
        self.assertEqual(res["ensure"], {})   # not there yet: nothing to ask
        open(os.path.join(home, "offline"), "w").close()
        res = self.run_install(home, "install", helper)
        self.assertEqual(res["files"][".local/bin/herdr-desktop"], "installed")
        self.assertTrue(res["ensure"][".local/bin/herdr-desktop"].startswith("failed: agent-desktop isn't installed here"), res)
        res = self.run_install(home, "check", helper)
        self.assertEqual(res["ensure"], {".local/bin/herdr-desktop": "missing"})
        os.remove(os.path.join(home, "offline"))
        res = self.run_install(home, "install", helper)
        self.assertEqual(res["ensure"], {".local/bin/herdr-desktop": "installed"})
        self.assertEqual(self.run_install(home, "check", helper)["ensure"], {".local/bin/herdr-desktop": "ready"})

    def test_sync_machine_installs_when_only_agent_desktop_is_missing(self):
        calls = []
        answers = [{"files": {"x": "current"}, "links": {}, "ensure": {".local/bin/herdr-desktop": "missing"}},
                   {"files": {"x": "current"}, "links": {}, "ensure": {".local/bin/herdr-desktop": "installed"}}]

        def remote(machine, script, payload, timeout=120):
            calls.append((payload["op"], payload["ensure"], timeout))
            return answers[len(calls) - 1]
        m = {"version": "v", "files": [{"path": "x", "data": b"", "sha": "", "mode": 0o644, "at": 1}], "links": [], "touch": [],
             "ensure": [".local/bin/herdr-desktop"]}
        with mock.patch.object(machines, "_remote_python", remote), mock.patch.object(machines, "core_name", lambda: "here"):
            r = machines.sync_machine("vm", m)
        self.assertEqual([c[0] for c in calls], ["check", "install"])
        self.assertEqual(calls[1][1], [".local/bin/herdr-desktop"])
        self.assertEqual((r["state"], r["changed"], r["details"]), ("current", ["agent-desktop"], []))
        # it couldn't: said, the machine still current
        calls.clear()
        answers[1] = {"files": {"x": "current"}, "links": {}, "ensure": {".local/bin/herdr-desktop": "failed: offline"}}
        with mock.patch.object(machines, "_remote_python", remote), mock.patch.object(machines, "core_name", lambda: "here"):
            r = machines.sync_machine("vm", m)
        self.assertEqual((r["state"], r["details"]), ("current", ["agent-desktop: failed: offline"]))

    def test_every_sync_call_stays_within_hc_exec_limit(self):
        # hc exec refuses --timeout above 600 s ("at most 600 s, not 900"): a sync that installs agent-desktop
        # must ask for no more, and the helper's own install must end before the call does.
        seen = []

        def run(argv, **kw):
            seen.append(int(argv[argv.index("--timeout") + 1]))
            out = {"files": {"x": "current"}, "links": {}, "ensure": {".local/bin/herdr-desktop": "missing" if len(seen) == 1 else "installed"}}
            return subprocess.CompletedProcess(argv, 0, json.dumps(out) + "\n", "")
        m = {"version": "v", "files": [{"path": "x", "data": b"", "sha": "", "mode": 0o644, "at": 1}], "links": [], "touch": [],
             "ensure": [".local/bin/herdr-desktop"]}
        with mock.patch.object(machines.subprocess, "run", run), mock.patch.object(machines, "guard", lambda a: None), \
                mock.patch.object(machines, "core_name", lambda: "here"):
            r = machines.sync_machine("vm", m)
        self.assertEqual(r["state"], "current")
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(0 < t <= 600 for t in seen), seen)
        self.assertEqual(machines.EXEC_MAX, 600)
        # every literal timeout in the code given to hc exec or _remote_python is one hc accepts
        src = open(machines.__file__).read()
        asked = [int(t) for t in re.findall(r"_remote_python\([^\n]*timeout=(\d+)", src)]
        asked += [int(t) for t in re.findall(r"timeout=(\d+) if missing", src)]
        self.assertTrue(asked and all(t <= 600 for t in asked), asked)
        self.assertNotIn("timeout=900", src)
        inner = [int(t) for t in re.findall(r'helper\("--install", (\d+)\)', machines.INSTALL)]
        self.assertTrue(inner and all(t < machines.EXEC_MAX - 60 for t in inner), inner)
        # and an asked-for longer one is cut to hc's limit, never sent as is
        seen.clear()
        with mock.patch.object(machines.subprocess, "run", run), mock.patch.object(machines, "guard", lambda a: None):
            machines._remote_python("vm", "", {}, timeout=900)
        self.assertEqual(seen, [600])

    def test_refused_call_says_why_not_cant_reach(self):
        m = {"version": "v", "files": [{"path": "x", "data": b"", "sha": "", "mode": 0o644, "at": 1}], "links": [], "touch": [], "ensure": []}

        def answer(rc, err):
            return lambda argv, **kw: subprocess.CompletedProcess(argv, rc, "", json.dumps({"error": err}) + "\n")
        with mock.patch.object(machines, "guard", lambda a: None), mock.patch.object(machines, "core_name", lambda: "here"):
            with mock.patch.object(machines.subprocess, "run", answer(6, {"kind": "invalid_params", "message": "timeout must be more than 0 and at most 600 s, not 900"})):
                r = machines.sync_machine("vm", m)
            self.assertEqual(r["state"], "failed")
            self.assertIn("timeout must be more than 0 and at most 600 s", r["details"][0])
            self.assertIn("refused", r["details"][0])
            # a real reach problem still reads as one
            with mock.patch.object(machines.subprocess, "run", answer(5, {"kind": "unavailable", "message": "the machine is offline"})):
                r = machines.sync_machine("vm", m)
            self.assertEqual(r["state"], "unreachable")
            with mock.patch.object(machines.subprocess, "run", answer(4, {"kind": "machine_unknown", "message": "unknown machine"})):
                r = machines.sync_machine("vm", m)
            self.assertEqual(r["state"], "unreachable")

    def test_manifest_asks_for_it_where_herdr_desktop_goes(self):
        here = tempfile.mkdtemp(prefix="shepherdr-ad-m-")
        self.addCleanup(shutil.rmtree, here, True)
        with open(os.path.join(here, "herdr-desktop"), "w") as f:
            f.write("#!/bin/sh\n")
        real = lambda rel: os.path.join(here, "herdr-desktop") if rel.endswith("/herdr-desktop") else None  # noqa: E731
        with mock.patch.object(machines, "_real", real):
            self.assertEqual(machines.manifest()["ensure"], [".local/bin/herdr-desktop"])
        with mock.patch.object(machines, "_real", lambda rel: None):
            self.assertEqual(machines.manifest()["ensure"], [])


class Template(unittest.TestCase):
    def test_assistant_offers_a_desktop_only_when_status_is_ok(self):
        with open(os.path.join(ROOT, "templates", "assistant.md")) as f:
            text = f.read()
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        line = next(l for l in text.splitlines() if "herdr-desktop <agent-desktop command>" in l)
        self.assertIn('`herdr-desktop --status` says `"ok": true`', line)
        self.assertIn("don't offer the desktop", line)
        self.assertIn("A brief that needs the desktop says", line)
        self.assertIn("herdr-desktop --install", line)
        self.assertNotIn("and a desktop: `herdr-desktop", text, "no unconditional desktop any more")
        self.assertIn("`herdr-desktop --status` says what is missing", worker)


if __name__ == "__main__":
    unittest.main()
