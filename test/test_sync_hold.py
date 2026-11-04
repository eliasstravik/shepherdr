"""The installer's hold (~/.herdr/sync-hold) stops every way a helper reaches another machine: the
scheduler's sync, `herdr-task machines sync`, herdr-task's and herdr-artifact's self-copy when they
run a command there, and `herdr-secret install --on`. Every hc call is swapped for a recorder, so
nothing reaches a machine and nothing runs with another HOME."""
import importlib.machinery
import importlib.util
import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import base, cli, machines  # noqa: E402


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


artifact = load("herdr_artifact_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))
secret = load("herdr_secret_under_test", os.path.join(ROOT, "bin", "herdr-secret"))


class Calls:
    """Stands in for subprocess.run / run: records each call, answers with `code`."""
    def __init__(self, code=0):
        self.calls, self.code = [], code

    def __call__(self, args, *a, **k):
        self.calls.append(list(args))
        # herdr-task's look for its source there (cli.remote_run): the other machine holds none
        if list(args[-3:-1]) == ["test", "-d"]:
            return types.SimpleNamespace(returncode=1, stdout="", stderr="")
        return types.SimpleNamespace(returncode=self.code, stdout="", stderr="")

    def writes(self):
        return [c for c in self.calls if c[:3] == ["hc", "file", "write"]]


class Hold(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-hold-")
        self.hold = os.path.join(self.dir, "sync-hold")
        self.store = os.path.join(self.dir, "tasks")
        self.patches = [mock.patch.object(base, "SYNC_HOLD", self.hold), mock.patch.object(artifact, "SYNC_HOLD", self.hold),
                        mock.patch.object(secret, "SYNC_HOLD", self.hold), mock.patch.object(cli, "STORE", self.store),
                        mock.patch.object(artifact, "STORE", self.store)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def held(self, on=True):
        if on:
            with open(self.hold, "w") as f:
                f.write("held by shepherdr 3.0.0 install at now: run `shepherdr doctor`\n")
        elif os.path.exists(self.hold):
            os.remove(self.hold)

    def test_herdr_task_self_copy(self):
        for on in (True, False):
            self.held(on)
            shutil.rmtree(self.store, ignore_errors=True)
            calls = Calls()
            with mock.patch.object(cli.subprocess, "run", calls), mock.patch.object(cli, "run", calls), \
                    mock.patch.object(cli, "guard", lambda a: None), mock.patch.object(cli, "bundle", lambda: b"new herdr-task"), \
                    mock.patch.object(cli.shutil, "which", lambda n: os.path.join(ROOT, "bin", "herdr-secret")), mock.patch("sys.stdout"), mock.patch("sys.stderr"):
                cli.remote("m1", ["list"])
            secrets = [c for c in calls.calls if c[1:3] == ["install", "--on"]]
            if on:
                self.assertEqual(calls.writes(), [], "held: herdr-task copied itself anyway")
                self.assertEqual(secrets, [], "held: herdr-secret went along anyway")
                self.assertTrue(any("exec" in c for c in calls.calls), "held: the copy already there still runs")
            else:
                self.assertEqual(len(calls.writes()), 1)
                self.assertEqual(len(secrets), 1)

    def test_herdr_task_missing_there_while_held(self):
        self.held()
        calls = Calls(code=127)
        with mock.patch.object(cli.subprocess, "run", calls), mock.patch.object(cli, "run", calls), \
                mock.patch.object(cli, "guard", lambda a: None), mock.patch.object(cli, "bundle", lambda: b"x"), \
                mock.patch.object(cli.shutil, "which", lambda n: None):
            with self.assertRaisesRegex(base.Fail, "wait"):
                cli.remote("m1", ["list"])
        self.assertEqual(calls.writes(), [])

    def test_herdr_artifact_self_copy(self):
        for on in (True, False):
            self.held(on)
            shutil.rmtree(self.store, ignore_errors=True)
            calls = Calls()
            with mock.patch.object(artifact.subprocess, "run", calls), mock.patch.object(artifact, "run", calls), \
                    mock.patch("sys.stdout"), mock.patch("sys.stderr"):
                artifact.remote("m1", ["list"])
            self.assertEqual(len(calls.writes()), 0 if on else 1)
        self.held()
        calls = Calls(code=127)
        shutil.rmtree(self.store, ignore_errors=True)
        with mock.patch.object(artifact.subprocess, "run", calls), mock.patch.object(artifact, "run", calls):
            with self.assertRaisesRegex(artifact.Fail, "wait"):
                artifact.remote("m1", ["list"])
        self.assertEqual(calls.writes(), [])

    def test_herdr_secret_install_on(self):
        self.held()
        calls = Calls()
        with mock.patch.object(secret.subprocess, "run", calls):
            with self.assertRaisesRegex(secret.Fail, "wait"):
                secret.cmd_install("m1")
        self.assertEqual(calls.calls, [])

    def test_machines_sync_and_scheduler(self):
        links = [{"name": "m1", "state": "connected"}]
        man = {"version": "v2", "files": [], "links": [], "touch": []}
        for on in (True, False):
            self.held(on)
            synced, spawned, state = [], [], {"seen": "v2", "seen_at": 0, "machines": {}}
            with mock.patch.object(machines, "connected_machines", lambda: links), mock.patch.object(machines, "manifest", lambda: man), \
                    mock.patch.object(machines, "sync_machine", lambda n, m, op, force: synced.append(n) or {"machine": n, "state": "current", "details": [], "version": "v2"}), \
                    mock.patch.object(machines, "_save_state", lambda fn: fn(state)), \
                    mock.patch.object(machines, "_spawn", lambda argv, log: spawned.append(argv)), \
                    mock.patch.object(machines, "_busy", lambda n: False), mock.patch.object(machines, "_reach_cache", lambda: {"at": machines.now()}), \
                    mock.patch.object(machines, "addon_off", lambda n: False):
                machines.machines_pass({})
                rows = machines.sync(op="install")["machines"]
                check = machines.sync(op="check")["machines"]
            if on:
                self.assertEqual(rows[0]["state"], "held")
                self.assertEqual(synced, ["m1"], "held: only the read-only check reached the machine")
                self.assertEqual(spawned, [], "held: the scheduler started a sync")
            else:
                self.assertEqual(rows[0]["state"], "current")
                self.assertEqual(synced, ["m1", "m1"])
                self.assertEqual(spawned, [["machines", "sync", "--auto", "m1"]])
            self.assertEqual(check[0]["state"], "current")


if __name__ == "__main__":
    unittest.main()
