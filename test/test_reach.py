"""#967: the reach map contacts only machines the person added. The scheduler's map is built from herdr-core's own
links (`hc machine ls` on each machine, hops over those links): no ssh, no Tailscale, nothing else. With the Other
machines add-on off it follows no link at all. Trying the ssh config's hosts and the online Tailscale peers happens
only when the person asks (`herdr-task machines find`): once, rate-limited, after saying what it will contact.

Fake ssh, tailscale and hc on PATH log every call; the probe runs for real, hops included (the fake hc runs a hop's
command here)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import base, machines  # noqa: E402

FAKE_HC = r"""#!/bin/sh
echo "hc $*" >> "$FAKE_LOG"
case "$1 $2" in
  "server status") echo '{"core": {"id": "c-here", "name": "here"}}'; exit 0 ;;
  "machine ls") echo '{"machines": [{"name": "vm1", "id": "c-vm1", "target": "me@vm1", "state": "connected"}]}'; exit 0 ;;
esac
case "$1" in
  ls) echo '{"terminals": []}'; exit 0 ;;
  exec) while [ "$1" != "--" ]; do shift; done; shift; exec "$@" ;;
esac
exit 1
"""
FAKE_SSH = '#!/bin/sh\necho "ssh $*" >> "$FAKE_LOG"\necho "ssh: connect to host: Connection timed out" >&2\nexit 255\n'
FAKE_TS = r"""#!/bin/sh
echo "tailscale $*" >> "$FAKE_LOG"
echo '{"Peer": {"a": {"DNSName": "peer1.tail.ts.net.", "HostName": "peer1", "OS": "linux", "Online": true},
                "b": {"DNSName": "phone.tail.ts.net.", "HostName": "phone", "OS": "iOS", "Online": true}}}'
"""


class Reach(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        fake = os.path.join(self.tmp, "bin")
        os.makedirs(fake)
        for name, body in (("hc", FAKE_HC), ("ssh", FAKE_SSH), ("tailscale", FAKE_TS)):
            with open(os.path.join(fake, name), "w") as f:
                f.write(body)
            os.chmod(os.path.join(fake, name), 0o755)
        home = os.path.join(self.tmp, "home")
        os.makedirs(os.path.join(home, ".ssh"))
        with open(os.path.join(home, ".ssh", "config"), "w") as f:
            f.write("Host work-server\n  HostName 10.0.0.5\nHost personal *.example\nHost *\n  ServerAliveInterval 30\n")
        self.log = os.path.join(self.tmp, "calls.log")
        open(self.log, "w").close()
        store = os.path.join(self.tmp, "store")
        os.makedirs(store)
        python = os.path.dirname(sys.executable)
        env = {"HOME": home, "PATH": f"{fake}:{python}:/usr/bin:/bin", "FAKE_LOG": self.log}
        for p in (mock.patch.dict(os.environ, env), mock.patch.object(machines, "STORE", store),
                  mock.patch.object(machines, "REACH", os.path.join(store, ".reach.json")),
                  mock.patch.object(machines, "FOUND", os.path.join(store, ".found.json"), create=True)):
            p.start()
            self.addCleanup(p.stop)
        self.off = []
        p = mock.patch.object(machines, "addon_off", lambda n: n in self.off)
        p.start()
        self.addCleanup(p.stop)

    def calls(self, prog):
        with open(self.log) as f:
            return [line.split(" ", 1)[1].strip() for line in f if line.split(" ", 1)[0] == prog]

    def test_the_background_map_contacts_only_added_machines(self):
        d = machines.probe(depth=machines.REACH_DEPTH, timeout=20)
        self.assertEqual(self.calls("ssh"), [], "the map tried ssh to hosts nobody added")
        self.assertEqual(self.calls("tailscale"), [], "the map read the tailnet")
        hops = [c for c in self.calls("hc") if c.startswith("exec")]
        self.assertTrue(hops and all(c.startswith("exec --on vm1 ") for c in hops), hops)
        # the herdr-core link and its hop are still in the map
        links = d["graph"]["links"]
        self.assertEqual([(l["how"], l["to"], l["ok"]) for l in links], [("herdr-core", "vm1", True)])
        self.assertIn("links", links[0]["next"])

    def test_add_on_off_follows_no_link(self):
        """The scheduler still refreshes this machine's own part (its spaces for #-mentions): nothing leaves it."""
        self.off = ["machines"]
        machines.probe(depth=machines.REACH_DEPTH, timeout=20)
        self.assertEqual(self.calls("ssh"), [])
        self.assertEqual(self.calls("tailscale"), [])
        self.assertEqual([c for c in self.calls("hc") if c.startswith("exec")], [], "add-on off: a hop went to another machine")

    def test_find_says_what_it_will_contact_first(self):
        r = machines.find(go=False)
        self.assertEqual(self.calls("ssh"), [], "the list alone contacted a host")
        self.assertEqual([(h["to"], h["over"]) for h in r["hosts"]], [("work-server", "ssh config"), ("personal", "ssh config"),
                                                                     ("peer1.tail.ts.net", "tailscale")])

    def test_find_runs_once_then_waits(self):
        r = machines.find(go=True)
        tried = sorted(c.split(" LogLevel=ERROR ")[1].split()[0] for c in self.calls("ssh"))
        self.assertEqual(tried, ["peer1.tail.ts.net", "personal", "work-server"], "each host once, and no others")
        self.assertTrue(all(not h["ok"] for h in r["hosts"]))
        self.assertTrue(os.path.exists(machines.FOUND))
        with self.assertRaisesRegex(base.Fail, "again in"):
            machines.find(go=True)
        self.assertEqual(len(self.calls("ssh")), 3, "a second Find right after contacted hosts again")
        # its answer stays out of the map: the scheduler's next refresh still contacts nobody new
        machines.probe(depth=machines.REACH_DEPTH, timeout=20)
        self.assertEqual(len(self.calls("ssh")), 3)

    def test_find_refused_with_the_add_on_off(self):
        self.off = ["machines"]
        with self.assertRaisesRegex(base.Fail, "Other machines"):
            machines.find(go=True)
        self.assertEqual(self.calls("ssh"), [])


if __name__ == "__main__":
    unittest.main()
