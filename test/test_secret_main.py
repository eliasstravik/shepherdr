"""Which machine keeps the secrets (SHEP-11): herdr-core's record "shepherdr.secrets" names it, the remote mark counts
only while none is named, a copy installed elsewhere is never marked remote on the machine that keeps them, and
another machine's set/rm/names go there over hc with the value on stdin and the scopes in that machine's words.
Everything runs on throwaway folders; hc is a recorder."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import machines  # noqa: E402


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


secret = load("herdr_secret_main_under_test", os.path.join(ROOT, "bin", "herdr-secret"))

M3, MINI, VM = "id-m3", "id-mini", "id-vm"


class Machine(unittest.TestCase):
    """A throwaway machine: its ~/.herdr and herdr-core state folder."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shep-secret-main-")
        self.herdr = os.path.join(self.dir, "home", ".herdr")
        self.core = os.path.join(self.dir, "state", "herdr-core", "default")
        os.makedirs(self.herdr)
        os.makedirs(self.core)
        self.patches = [mock.patch.object(secret, "HERDR", self.herdr), mock.patch.object(secret, "CORE", self.core),
                        mock.patch.object(secret, "VAULT", os.path.join(self.herdr, "vault.json")),
                        mock.patch.object(secret, "REMOTE_MARK", os.path.join(self.herdr, "secret-remote")),
                        mock.patch.object(secret, "DROP", os.path.join(self.herdr, "secret-drop")),
                        mock.patch.object(machines, "HOME", os.path.join(self.dir, "home")),
                        mock.patch.dict(os.environ, {"XDG_STATE_HOME": os.path.join(self.dir, "state")})]
        os.environ.pop("HC_SESSION", None)
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def be(self, me, record=None, mark=False, vault=None, host=None):
        with open(os.path.join(self.core, "core.json"), "w") as f:
            json.dump({"id": me, "name": me[3:]}, f)
        docs = {"shepherdr.secrets": {"value": record, "version": 1}} if record else {}
        if host:
            docs["shepherdr.host"] = {"value": {"id": host, "at": 1}, "version": 1}
        with open(os.path.join(self.core, "docs.json"), "w") as f:
            json.dump(docs, f)
        mk = os.path.join(self.herdr, "secret-remote")
        if mark:
            open(mk, "a").close()
        elif os.path.exists(mk):
            os.unlink(mk)
        if vault is not None:
            with open(os.path.join(self.herdr, "vault.json"), "w") as f:
                json.dump({"version": 1, "secrets": vault}, f)


class Record(Machine):
    def test_the_record_wins_over_the_mark(self):
        # m3 named as the main one keeps them, a stray mark or not (it once made `herdr-secret set` refuse there)
        self.be(M3, {"id": M3, "at": 1}, mark=True)
        self.assertFalse(secret.remote())
        self.be(M3, {"id": MINI, "at": 2}, mark=False, vault=[])
        self.assertTrue(secret.remote(), "another machine named: this one asks it, its own vault or not")

    def test_no_record_the_mark_as_before(self):
        self.be(VM, None, mark=True)
        self.assertTrue(secret.remote())
        self.be(M3, None, mark=False)
        self.assertFalse(secret.remote())

    def test_where(self):
        self.be(M3, {"id": MINI, "at": 2})
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": "mac-mini", "id": MINI}, {"name": "vm", "id": VM}]}):
            self.assertEqual(secret.main_machine(), {"here": False, "set": True, "auto": False, "serve": "", "id": MINI, "name": "mac-mini"})
        self.be(MINI, {"id": MINI, "at": 2}, mark=True)
        self.assertEqual(secret.main_machine(), {"here": True, "set": True, "auto": False, "serve": "", "id": MINI, "name": None})

    def test_where_following_serve_from(self):
        # SHEP-33: nobody picked one: kept where they were (m3) and following the machine serving the web app
        self.be(VM, {"id": M3, "at": 2, "auto": True}, mark=True, host=MINI)
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": "mac-mini", "id": MINI}, {"name": "m3", "id": M3}]}):
            self.assertEqual(secret.main_machine(), {"here": False, "set": True, "auto": True, "serve": "mac-mini", "id": M3, "name": "m3"})
            self.assertTrue(secret.remote())
        # moved there: same as Serve from, seen from that machine
        self.be(MINI, {"id": MINI, "at": 3, "auto": True}, host=MINI)
        self.assertEqual(secret.main_machine(), {"here": True, "set": True, "auto": True, "serve": None, "id": MINI, "name": None})


class Mark(Machine):
    def test_install_never_marks_the_main_machine(self):
        # the record names it: no mark, and a stray one goes
        self.be(M3, {"id": M3, "at": 1}, mark=True)
        secret.mark_remote()
        self.assertFalse(os.path.exists(secret.REMOTE_MARK))
        # another one named: the record rules, nothing written
        self.be(VM, {"id": M3, "at": 1})
        secret.mark_remote()
        self.assertFalse(os.path.exists(secret.REMOTE_MARK))
        # none named: a machine with a vault isn't marked; one without is
        self.be(M3, None, vault=[])
        secret.mark_remote()
        self.assertFalse(os.path.exists(secret.REMOTE_MARK))
        os.unlink(secret.VAULT)
        secret.mark_remote()
        self.assertTrue(os.path.exists(secret.REMOTE_MARK))

    def test_install_on_runs_mark_remote_there(self):
        calls = []
        with mock.patch.object(secret.subprocess, "run", lambda a, **k: calls.append(list(a)) or types.SimpleNamespace(returncode=0, stdout="", stderr="")), \
                mock.patch.object(secret, "sync_held", lambda: None), mock.patch("sys.stdout"):
            secret.cmd_install("m3")
        script = calls[-1][-1]
        self.assertIn("herdr-secret\" mark-remote", script)
        self.assertNotIn("secret-remote", script, "no blind mark there")

    def test_sync_marks_only_from_the_machine_that_keeps_them(self):
        # the Mac mini (a hub without the vault, marked remote) syncing m3: the bug that marked m3
        self.be(MINI, None, mark=True)
        self.assertFalse(machines.secrets_main_here())
        self.be(M3, None, mark=False, vault=[])
        self.assertTrue(machines.secrets_main_here())
        self.be(M3, {"id": MINI, "at": 2}, vault=[])
        self.assertFalse(machines.secrets_main_here(), "named elsewhere: m3's own vault doesn't make it the main one")
        self.be(MINI, {"id": MINI, "at": 2}, mark=True)
        self.assertTrue(machines.secrets_main_here())

    def test_manifest_touch(self):
        os.makedirs(os.path.join(self.dir, "home", ".local", "bin"))
        tool = os.path.join(self.dir, "home", ".local", "bin", "herdr-secret")
        shutil.copy(os.path.join(ROOT, "bin", "herdr-secret"), tool)
        with mock.patch.object(machines, "_real", lambda rel: tool if rel.endswith("herdr-secret") else None), \
                mock.patch.object(machines, "bundle", lambda: b"x"), mock.patch.object(machines, "ROLES", []):
            self.be(MINI, None, mark=True)
            self.assertEqual(machines.manifest()["touch"], [])
            self.be(M3, {"id": M3, "at": 1})
            self.assertEqual(machines.manifest()["touch"], [{"path": ".herdr/secret-remote", "unless": ".herdr/vault.json", "unless_main": True}])

    def test_the_sync_there_skips_the_machine_its_record_names(self):
        # INSTALL runs there (python3, its own home): touch only where the record doesn't name that machine
        home = os.path.join(self.dir, "home")
        payload = {"op": "install", "stamp": ".herdr/tasks/.sync-stamp.json", "files": [], "links": [], "version": "v", "from": "m3",
                   "touch": [{"path": ".herdr/secret-remote", "unless": ".herdr/vault.json", "unless_main": True}]}
        env = {"PATH": os.environ.get("PATH", ""), "HOME": home, "XDG_STATE_HOME": os.path.join(self.dir, "state")}
        mark = os.path.join(home, ".herdr", "secret-remote")
        for me, rec, marked in ((MINI, {"id": MINI, "at": 2}, False), (VM, {"id": MINI, "at": 2}, True), (VM, None, True)):
            self.be(me, rec)
            r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(payload), env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(os.path.exists(mark), marked, f"{me} with record {rec}")


class Forward(Machine):
    """m3 isn't the main one: its set/rm/names go to the Mac mini with m3's id and names."""

    def setUp(self):
        super().setUp()
        self.be(M3, {"id": MINI, "at": 2}, vault=[{"name": "OLD", "scope": "everywhere", "value": "stale"}])
        self.links = {"mac-mini": MINI, "vm": VM}
        self.calls = []

    def hc(self, answer=b'', code=0):
        def run(argv, **k):
            self.calls.append((list(argv), k.get("input")))
            return types.SimpleNamespace(returncode=code, stdout=answer, stderr=b"herdr-secret: refused there" if code == 1 else b"offline")
        return run

    def args(self, *a):
        return secret.main.__globals__["argparse"].Namespace(**{"machine": None, "space": None, "caller": None, "value_file": None, **dict(a)})

    def test_set_goes_there_on_stdin(self):
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": n, "id": i} for n, i in self.links.items()]}), \
                mock.patch.object(secret.subprocess, "run", self.hc(b"Kept GITHUB_TOKEN.\n")), \
                mock.patch.object(secret.sys, "stdin", types.SimpleNamespace(isatty=lambda: False, read=lambda: "ghp_value123\n")), mock.patch("sys.stdout"):
            secret.cmd_set("GITHUB_TOKEN", self.args(("space", "vm/sp1")))
        argv, stdin = self.calls[-1]
        self.assertEqual(argv[:6], ["hc", "exec", "--stdin", "--on", "mac-mini", "--timeout"])
        self.assertEqual(stdin, b"ghp_value123")
        self.assertNotIn("ghp_value123", " ".join(argv), "never in a command line")
        self.assertEqual(argv[-6:-2], ["set", "GITHUB_TOKEN", "--space", "vm/sp1"])
        self.assertEqual(json.loads(argv[-1]), {"id": M3, "links": self.links})
        with open(secret.VAULT) as f:
            self.assertEqual([e["name"] for e in json.load(f)["secrets"]], ["OLD"], "nothing kept here")

    def test_none_named_set_goes_to_the_linked_machine_that_keeps_them(self):
        # SHEP-33: the web app's machine is marked remote and no keeper is named yet: Settings › Secrets › Add there
        # finds the linked machine that keeps them (herdr-secret where there) and hands it the value on stdin
        self.be(MINI, None, mark=True)
        links = [{"name": "vm", "id": VM, "state": "connected"}, {"name": "m3", "id": M3, "state": "connected"}]

        def run(argv, **k):
            self.calls.append((list(argv), k.get("input")))
            if "where" in argv:
                here = argv[argv.index("--on") + 1] == "m3"
                return types.SimpleNamespace(returncode=0, stdout=json.dumps({"here": here}).encode(), stderr=b"")
            return types.SimpleNamespace(returncode=0, stdout=b"Kept GITHUB_TOKEN.\n", stderr=b"")
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": links}), mock.patch.object(secret.subprocess, "run", run), \
                mock.patch.object(secret.sys, "stdin", types.SimpleNamespace(isatty=lambda: False, read=lambda: "ghp_value123\n")), mock.patch("sys.stdout"):
            secret.cmd_set("GITHUB_TOKEN", self.args())
        asked = [a[a.index("--on") + 1] for a, _ in self.calls if "where" in a]
        self.assertEqual(asked, ["vm", "m3"])
        argv, stdin = self.calls[-1]
        self.assertEqual(argv[:5], ["hc", "exec", "--stdin", "--on", "m3"])
        self.assertEqual(stdin, b"ghp_value123")
        self.assertTrue(all("ghp_value123" not in " ".join(a) for a, _ in self.calls), "never in a command line")
        self.assertEqual(argv[-4:-2], ["set", "GITHUB_TOKEN"])
        with open(secret.VAULT) as f:
            self.assertEqual([e["name"] for e in json.load(f)["secrets"]], ["OLD"], "nothing kept here")

    def test_none_named_and_no_linked_machine_keeps_them(self):
        self.be(MINI, None, mark=True)
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": "vm", "id": VM, "state": "connected"}]}), \
                mock.patch.object(secret.subprocess, "run", lambda argv, **k: types.SimpleNamespace(returncode=0, stdout=b'{"here": false}', stderr=b"")), \
                mock.patch.object(secret.sys, "stdin", types.SimpleNamespace(isatty=lambda: False, read=lambda: "v4lue")):
            with self.assertRaisesRegex(secret.Fail, "No machine linked from here keeps the secrets"):
                secret.cmd_set("GITHUB_TOKEN", self.args())

    def test_value_file_read_and_gone(self):
        os.makedirs(secret.DROP)
        f = os.path.join(secret.DROP, "set-1")
        with open(f, "w") as w:
            w.write("v4lue")
        self.assertEqual(secret.read_value_file(f), "v4lue")
        self.assertFalse(os.path.exists(f))
        other = os.path.join(self.dir, "elsewhere")
        open(other, "w").close()
        with self.assertRaises(secret.Fail):
            secret.read_value_file(other)
        self.assertTrue(os.path.exists(other), "a file outside the drop is never removed")

    def test_unreachable_says_so(self):
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": n, "id": i} for n, i in self.links.items()]}), \
                mock.patch.object(secret.subprocess, "run", self.hc(code=255)):
            with self.assertRaisesRegex(secret.Fail, "Can't reach mac-mini"):
                secret.cmd_names(True)

    def test_names_come_back_from_there(self):
        rows = [{"name": "ELEVENLABS_API_KEY", "scope": "everywhere", "machine": None, "space": None, "at": 1}]
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": n, "id": i} for n, i in self.links.items()]}), \
                mock.patch.object(secret.subprocess, "run", self.hc(json.dumps(rows).encode())), mock.patch.object(secret, "say") as said:
            secret.cmd_names(True)
        self.assertEqual(json.loads(said.call_args[0][0]), rows)

    def test_the_main_machine_renames_the_callers_words(self):
        # on the Mac mini: m3's "this machine" is "m3", m3's own space "sp1" is "m3/sp1", m3's "vm/sp2" is "vm/sp2"
        self.be(MINI, {"id": MINI, "at": 2}, mark=True, vault=[])
        caller = json.dumps({"id": M3, "links": {"mac-mini": MINI, "vm": VM}})
        with mock.patch.object(secret, "hc_json", lambda *a: {"machines": [{"name": "m3", "id": M3}, {"name": "vm", "id": VM}]}):
            self.assertEqual(secret.here_scope(self.args(("machine", ""), ("caller", caller))), ("machine", "m3", None))
            self.assertEqual(secret.here_scope(self.args(("machine", "mac-mini"), ("caller", caller))), ("machine", None, None))
            self.assertEqual(secret.here_scope(self.args(("space", "sp1"), ("caller", caller))), ("space", None, "m3/sp1"))
            self.assertEqual(secret.here_scope(self.args(("space", "vm/sp2"), ("caller", caller))), ("space", None, "vm/sp2"))
            with self.assertRaisesRegex(secret.Fail, "doesn't link"):
                secret.here_scope(self.args(("machine", "laptop"), ("caller", json.dumps({"id": M3, "links": {"laptop": "id-laptop"}}))))
            # and the list back in m3's words
            with open(secret.VAULT, "w") as f:
                json.dump({"version": 1, "secrets": [{"name": "A", "scope": "space", "space": "m3/sp1", "value": "x"},
                                                     {"name": "B", "scope": "machine", "machine": None, "value": "x"},
                                                     {"name": "C", "scope": "machine", "machine": "m3", "value": "x"}]}, f)
            with mock.patch.object(secret, "say") as said:
                secret.cmd_names(True, caller)
            rows = {r["name"]: r for r in json.loads(said.call_args[0][0])}
            self.assertEqual(rows["A"]["space"], "sp1")
            self.assertEqual(rows["B"]["machine"], "mac-mini")
            self.assertEqual(rows["C"]["machine"], None)
            self.assertNotIn("value", rows["A"])

    def test_a_machine_that_no_longer_keeps_them_refuses_a_forwarded_call(self):
        caller = json.dumps({"id": VM, "links": {}})
        with self.assertRaisesRegex(secret.Fail, "doesn't keep"):
            secret.here_scope(self.args(("caller", caller)))
        with self.assertRaisesRegex(secret.Fail, "doesn't keep"):
            secret.cmd_names(True, caller)

    def test_serve_refuses_where_another_machine_keeps_them(self):
        with self.assertRaisesRegex(secret.Fail, "serve answers"):
            secret.serve("vm/t1")


if __name__ == "__main__":
    unittest.main()
