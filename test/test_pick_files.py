"""The chat's file picker (mods/chat/pick-files.py) without PyGObject (GitHub #1225): it talks to the portal's
FileChooser over the session bus itself. Against a fake portal on a private dbus-daemon (its own config: no service
activation, so no real portal starts, and the real session bus is never used); skipped where dbus-daemon is missing."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICK = os.path.join(ROOT, "mods", "chat", "pick-files.py")
sys.dont_write_bytecode = True
loader = importlib.machinery.SourceFileLoader("pick_files_under_test", PICK)
spec = importlib.util.spec_from_loader(loader.name, loader)
P = importlib.util.module_from_spec(spec)
loader.exec_module(P)

CONF = """<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:path=%s</listen><auth>EXTERNAL</auth>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>"""


def fake_portal(sock, uris, ready, seen, code=0):
    """Owns org.freedesktop.portal.Desktop on the private bus; answers one OpenFile with its request's path, then
    says Response (code, the uris)."""
    bus = P.Bus(sock)
    bus.call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName", "su", (P.PORTAL, 4))
    ready.set()
    while True:
        kind, f, body = bus.read()
        if kind == P.CALL and f.get(P.F_MEMBER) == "OpenFile":
            seen.append(body)
            sender = f[P.F_SENDER]
            path = "/org/freedesktop/portal/desktop/request/%s/%s" % (sender[1:].replace(".", "_"), body[2]["handle_token"])
            bus.serial += 1
            bus.s.sendall(P.message(P.RETURN, bus.serial, {P.F_REPLY: bus.last, P.F_DEST: sender}, "o", (path,)))
            bus.serial += 1
            bus.s.sendall(P.message(P.SIGNAL, bus.serial, {P.F_PATH: path, P.F_INTERFACE: "org.freedesktop.portal.Request",
                                                          P.F_MEMBER: "Response", P.F_DEST: sender},
                                    "ua{sv}", (code, {"uris": ("as", uris)})))
            bus.s.close()
            return


class PickFiles(unittest.TestCase):
    def setUp(self):
        if not shutil.which("dbus-daemon"):
            self.skipTest("no dbus-daemon here")
        self.tmp = tempfile.mkdtemp(prefix="shep-pick-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.sock = os.path.join(self.tmp, "bus")
        conf = os.path.join(self.tmp, "bus.conf")
        with open(conf, "w") as f:
            f.write(CONF % self.sock)
        self.daemon = subprocess.Popen(["dbus-daemon", "--config-file", conf, "--nofork", "--print-address"],
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.addCleanup(self.daemon.stdout.close)
        self.addCleanup(self.daemon.wait)
        self.addCleanup(self.daemon.kill)
        self.daemon.stdout.readline()  # listening

    def pick(self, **env):
        e = {"PATH": "/usr/bin:/bin", "HOME": self.tmp, "HERDR_PICK_NO_GI": "1",
             "DBUS_SESSION_BUS_ADDRESS": "unix:path=" + self.sock, **env}
        return subprocess.run([sys.executable, "-I", PICK, "Attach files"], env=e, capture_output=True, text=True, timeout=30)

    def test_the_chosen_files_come_back_without_pygobject(self):
        ready, seen = threading.Event(), []
        t = threading.Thread(target=fake_portal, args=(self.sock, ["file:///tmp/a%20b.png", "file:///home/x/notes.txt"], ready, seen), daemon=True)
        t.start()
        self.assertTrue(ready.wait(10))
        r = self.pick()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.splitlines(), ["/tmp/a b.png", "/home/x/notes.txt"])
        parent, title, opts = seen[0]
        self.assertEqual((parent, title, opts["multiple"], opts["accept_label"]), ("", "Attach files", True, "Attach"))

    def test_cancelled_is_nothing(self):
        ready, seen = threading.Event(), []
        threading.Thread(target=fake_portal, args=(self.sock, [], ready, seen, 1), daemon=True).start()
        self.assertTrue(ready.wait(10))
        r = self.pick()
        self.assertEqual((r.returncode, r.stdout.strip()), (0, ""))

    def test_no_portal_says_why(self):
        r = self.pick()
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), "xdg-desktop-portal isn't running")

    def test_no_session_bus_says_why(self):
        r = self.pick(DBUS_SESSION_BUS_ADDRESS="", XDG_RUNTIME_DIR=self.tmp + "/none")
        self.assertEqual(r.returncode, 1)
        self.assertIn("no session bus", r.stderr)


if __name__ == "__main__":
    unittest.main()
