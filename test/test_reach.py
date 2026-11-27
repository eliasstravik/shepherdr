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
  "server status")
    if [ "$FAKE_VM" = remote ]; then
      echo '{"core": {"id": "c-vm1", "name": "vm1"}}'; exit 0
    fi
    echo '{"core": {"id": "c-here", "name": "here"}}'; exit 0 ;;
  "machine ls") echo '{"machines": [{"name": "vm1", "id": "c-vm1", "target": "me@vm1", "state": "connected"}]}'; exit 0 ;;
esac
case "$1" in
  ls)
    if [ "$FAKE_ASSISTANTS" = yes ]; then
      echo '{"terminals": [{"address": "t1", "state": "live"}, {"address": "t2", "state": "live"}]}'
    else
      echo '{"terminals": []}'
    fi
    exit 0 ;;
  get)
    if [ "$FAKE_VM" = remote ]; then space=foreign; elif [ "$2" = t1 ]; then space=home; else space=work; fi
    echo '{"state": "live", "labels": {"herdr.role": "coordinator", "herdr.space": "'"$space"'"}}'
    exit 0 ;;
  exec)
    if [ "$FAKE_VM" = yes ]; then export FAKE_VM=remote XDG_STATE_HOME="$HOME/vm-state"; fi
    while [ "$1" != "--" ]; do shift; done; shift; exec "$@" ;;
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
        env = {"HOME": home, "PATH": f"{fake}:{python}:/usr/bin:/bin", "FAKE_LOG": self.log, "XDG_STATE_HOME": os.path.join(home, ".local/state")}
        for p in (mock.patch.dict(os.environ, env), mock.patch.object(machines, "STORE", store),
                  mock.patch.object(machines, "REACH", os.path.join(store, ".reach.json")),
                  mock.patch.object(machines, "FOUND", os.path.join(store, ".found.json"), create=True)):
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

    def test_everything_uses_the_current_spaces_even_without_a_tilde_space(self):
        self.write_spaces()
        with mock.patch.dict(os.environ, {"FAKE_ASSISTANTS": "yes"}):
            graph = machines.probe(depth=0)["graph"]
        self.assertEqual([(s["id"], s["name"]) for s in graph["spaces"]],
                         [("home", "Everything"), ("work", "Named project")])
        root, project = graph["assistants"]
        self.assertEqual((root["space_name"], root["role"]), ("Everything", "everything"))
        self.assertEqual(project["space_name"], "Named project")
        remote = {**root, "route": "mini", "target": "mini/t1"}
        for name in ("Everything", "eVeRyThInG", "Everywhere", "#Everything", "[#Everything](space:mini/home)"):
            with self.subTest(name=name):
                self.assertEqual(machines._find([remote], name), [remote])
        local = {**root, "route": None, "target": "t1"}
        other_home = {**remote, "role": "home"}
        self.assertEqual(machines._find([local, other_home], "[#Everything](space:home)"), [local])

    def test_the_serving_machine_names_reached_remote_spaces(self):
        self.write_spaces()
        with mock.patch.dict(os.environ, {"FAKE_VM": "yes", "FAKE_ASSISTANTS": "yes"}):
            graph = machines.probe(depth=1)["graph"]
        remote = graph["links"][0]["next"]
        self.assertEqual([(s["id"], s["name"]) for s in remote["spaces"]],
                         [("foreign", "Other machine")])
        self.assertEqual(remote["assistants"][0]["space_name"], "Other machine")
        self.assertNotIn("everything", remote)
        self.assertNotIn("_remote_spaces", graph)

    def test_everything_without_an_assistant_says_how_to_start_it(self):
        self.write_spaces()
        result = machines.probe(depth=0)
        with mock.patch.object(machines, "directory", return_value=(result, [])):
            with self.assertRaisesRegex(base.Fail, "Open Everything and send a message"):
                machines.tell("Everything", "hello")

    def write_spaces(self):
        home = os.environ["HOME"]
        path = os.path.join(home, ".local/state/herdr-core", os.environ.get("HC_SESSION") or "shepherdr")
        os.makedirs(path)
        with open(os.path.join(path, "docs.json"), "w") as f:
            json.dump({
                "shepherdr": {"value": {"spaces": [
                    {"id": "home", "name": "Home", "folder": home},
                    {"id": "work", "name": "Named project", "folder": home + "/repo"},
                    {"id": "foreign", "name": "Other machine", "machine": "vm1", "folder": home},
                ]}},
                "herdr-app": {"value": {"spaces": [{"id": "home"}]}},
            }, f)

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

    def test_find_reads_the_wait_again_once_it_holds_the_lock(self):
        """#1108: two Finds at once: the second read the wait before the first saved its run, and took the lock after
        the first let go. It reads the wait again under the lock: refused, nobody contacted twice."""
        machines._save_found({"at": machines.now(), "hosts": []})   # the first one's run, just saved
        real, reads = machines._found, []

        def found():   # its first read, before the lock, missed that run
            reads.append(1)
            return None if len(reads) == 1 else real()
        with mock.patch.object(machines, "_found", found):
            with self.assertRaisesRegex(base.Fail, "again in"):
                machines.find(go=True)
        self.assertEqual(self.calls("ssh"), [])


# #1104: vm1's link sits unreachable on a stale DNS failure; `hc machine login` brings it back, but only with a
# terminal (as the real hc: "logging in needs a terminal" otherwise). vm2 needs a typed login and is left alone.
RELINK_HC = r"""#!/bin/sh
echo "hc $*" >> "$FAKE_LOG"
case "$1 $2" in
  "server status") echo '{"core": {"id": "c-here", "name": "here"}}'; exit 0 ;;
  "machine ls")
    s=unreachable; [ -f "$FAKE_LOG.up" ] && s=connected
    echo "{\"machines\": [{\"name\": \"vm1\", \"id\": \"c-vm1\", \"state\": \"$s\"}, {\"name\": \"vm2\", \"id\": \"c-vm2\", \"state\": \"needs_login\"}]}"; exit 0 ;;
  "machine login")
    [ -t 0 ] || { echo '{"error": {"message": "logging in needs a terminal"}}'; exit 2; }
    [ "$3" = vm1 ] && touch "$FAKE_LOG.up"; echo "logged in to $3: connected"; exit 0 ;;
esac
case "$1" in
  ls) echo '{"terminals": []}'; exit 0 ;;
  exec) while [ "$1" != "--" ]; do shift; done; shift; exec "$@" ;;
esac
exit 1
"""


class Relink(unittest.TestCase):
    calls = Reach.calls  # Reach's set-up, not its tests

    def setUp(self):
        Reach.setUp(self)
        with open(os.path.join(self.tmp, "bin", "hc"), "w") as f:
            f.write(RELINK_HC)

    def links(self, d):
        return [(l["to"], l["state"], l["ok"]) for l in d["graph"]["links"]]

    def test_refresh_makes_an_unreachable_link_try_again(self):
        d = machines.reach(refresh=True)
        self.assertEqual(self.links(d), [("vm1", "connected", True), ("vm2", "needs_login", False)])
        logins = [c for c in self.calls("hc") if c.startswith("machine login")]
        self.assertEqual(logins, ["machine login vm1"], "only the unreachable link is retried; needs_login waits for a person")
        self.assertTrue(any(c.startswith("exec --on vm1 ") for c in self.calls("hc")), "the map follows the link it brought back")
        self.assertEqual(self.calls("ssh"), [])

    def test_the_cached_map_retries_nothing(self):
        machines.probe(depth=machines.REACH_DEPTH, timeout=20)
        self.assertEqual([c for c in self.calls("hc") if c.startswith("machine login")], [])
        self.assertEqual(self.links(machines._reach_cache())[0], ("vm1", "unreachable", False))


class NetworkBack(unittest.TestCase):
    """The scheduler's round: a network change while a link is unreachable starts a refresh (which retries it), and
    once more NET_AGAIN_MS later; no change or nothing unreachable: nothing extra."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.state, self.net, self.links, self.t, self.spawned = "unreachable", ["100.64.0.1", "10.0.0.2"], None, 10**12, []
        for p in (mock.patch.object(machines, "STORE", self.tmp), mock.patch.object(machines, "MACHINES", os.path.join(self.tmp, ".machines.json")),
                  mock.patch.object(machines, "REACH", os.path.join(self.tmp, ".reach.json")),
                  mock.patch.object(machines, "connected_machines", lambda: [{"name": "vm1", "state": self.state}]),
                  mock.patch.object(machines, "manifest", lambda: {"version": "v1"}),
                  mock.patch.object(machines, "now", lambda: self.t),
                  mock.patch.object(machines, "_net", lambda: list(self.net), create=True),
                  mock.patch.object(machines, "sync_held", lambda: True),
                  mock.patch.object(machines, "_spawn", lambda argv, log: self.spawned.append(argv))):
            p.start()
            self.addCleanup(p.stop)
        with open(machines.REACH, "w") as f:
            json.dump({"at": self.t, "graph": {}}, f)  # the 5-minute map is fresh: only the network retry can spawn

    def round(self, after_ms=15000):
        self.t += after_ms
        n = len(self.spawned)
        machines.machines_pass({})
        return self.spawned[n:]

    def test_network_change_retries_the_unreachable_link(self):
        self.round()  # the first round only learns the network
        self.spawned.clear()
        self.assertEqual(self.round(), [], "no change: no extra refresh")
        self.net = ["100.89.1.2", "10.0.0.2"]  # Tailscale back on
        self.assertEqual(self.round(), [["machines", "reach", "--refresh", "--quiet"]])
        self.assertEqual(self.round(), [], "one refresh per change")
        self.assertEqual(self.round(machines.NET_AGAIN_MS), [["machines", "reach", "--refresh", "--quiet"]], "once more a little later")
        self.assertEqual(self.round(machines.NET_AGAIN_MS), [], "then the 5-minute map takes over")

    def test_no_unreachable_link_no_refresh(self):
        self.state = "connected"
        self.round()
        self.net = ["10.1.1.1", "10.1.1.1"]
        self.assertEqual(self.round(), [])
        self.state = "unreachable"
        self.assertEqual(self.round(), [], "the network was already seen: hc's own retries and the 5-minute map cover it")



class Net(unittest.TestCase):
    def test_net_contacts_nobody(self):
        """A UDP connect only picks the route: nothing is sent, nobody is asked."""
        with mock.patch.object(machines.socket.socket, "send", side_effect=AssertionError("sent")), \
             mock.patch.object(machines.socket.socket, "sendto", side_effect=AssertionError("sent")):
            got = machines._net()
        self.assertEqual(len(got), 2)
        self.assertEqual(got, machines._net(), "the same network reads the same")

if __name__ == "__main__":
    unittest.main()
