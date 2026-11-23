"""A schedule's run can update Shepherdr, outside its own terminal (SHEP-376, herdr_task/self_update.py).

3.2.3's guard refused `shepherdr update` in the "Update Shepherdr everywhere" schedule's run, so that machine stayed
on the old version. The person now lets that one schedule do it, its run asks `herdr-task update-shepherdr`, and a
runner outside the task's terminal (no guard, its own process session) runs the update and keeps how it went.
These run the real herdr-task in a throwaway store, inside the guard's stand-ins, with a fake `shepherdr` behind
them. SHEPHERDR_REAL_INSTALL=1 adds a real `./install.sh --root <scratch>` and a real update of that root."""
import home_guard  # noqa: F401  (first: a throwaway HOME, the agent's own terminal dropped)

import argparse
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)

from herdr_task import automations, guard, self_update, settings, store  # noqa: E402
from herdr_task.base import Fail  # noqa: E402

FAKE_SHEPHERDR = """#!/bin/sh
{ echo "args: $*"; echo "PATH=$PATH"; echo "guard=${HERDR_GUARD_SESSION:-none}"; } >> "$FAKE_LOG"
echo "Shepherdr 9.9.9 update from /src"
exit ${FAKE_CODE:-0}
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.store = os.path.join(self.tmp, "tasks")
        self.folder = os.path.join(self.tmp, "upd376")
        os.makedirs(self.folder)
        self.fake = os.path.join(self.tmp, "real")
        os.makedirs(self.fake)
        p = os.path.join(self.fake, "shepherdr")
        with open(p, "w") as f:
            f.write(FAKE_SHEPHERDR)
        os.chmod(p, 0o755)
        self.log = os.path.join(self.tmp, "log")
        for x in (mock.patch.object(store, "STORE", self.store), mock.patch.object(settings, "SETTINGS", os.path.join(self.tmp, "settings.json")),
                  mock.patch.object(automations, "ensure_scheduler", lambda quiet=False: {}),
                  mock.patch.object(automations, "default_space", lambda: "sp1"),
                  mock.patch.object(automations, "worker_argv", lambda s, t, space, key=None: ["claude"]),
                  mock.patch.object(automations, "queue_reason", lambda s, t: None),
                  mock.patch.object(automations, "begin", lambda s, t, argv, space, parent=None: t.update(state="running")),
                  mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "", "HERDR_GUARD_SESSION": ""})):
            x.start()
            self.addCleanup(x.stop)

    def auto(self, sub, **kw):
        """`herdr-task auto <sub>` as the person's own terminal runs it (in-process)."""
        a = argparse.Namespace(auto=sub, folder=self.folder, json=True, prompt=None, prompt_file=None, when=None, every=None,
                               on=None, match=None, from_=None, agent=None, space=None, parent=None, set=None, here=False,
                               worktree=False, may_update=None, id=None, title=None)
        for k, v in kw.items():
            setattr(a, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            automations.cmd_auto(a)

    def run_of(self, may_update):
        """A schedule (the person sets may_update) and one run of it: (its task's key, its env key, its brief)."""
        self.auto("add", title="Update Shepherdr everywhere", when="daily 6:00", prompt="Update, then sync the machines.",
                  may_update="on" if may_update else None)
        with store.Store(store.locate(self.folder)) as s:
            t = automations.fire(s, s.data["automations"][-1], "run now")
            return s.ref(t), s.key(t), t["prompt"]

    def ordinary(self):
        with store.Store(store.locate(self.folder)) as s:
            t = s.new("Fix login", "fix it")
            t["state"] = "running"
            return s.ref(t), s.key(t)

    def call(self, line, task_key, **env):
        """One shell call inside a task's terminal: the guard first on PATH, as launch starts its agent."""
        e = {"HOME": os.environ["HOME"], "PATH": f"{BIN}:{self.fake}:/usr/bin:/bin", "FAKE_LOG": self.log,
             "HC_SESSION": "shepherdr", "HERDR_TASK_STORE": self.store, "HERDR_BROWSER_TASK": task_key,
             "SHEPHERDR_NO_MIGRATE": "1", **env}
        argv = guard.guard_argv(["sh", "-c", line], "shepherdr", self.store)
        return subprocess.run(argv, env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=120)

    def ran(self):
        try:
            with open(self.log) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def task(self, ref):
        with store.Store(store.locate(self.folder), False) as s:
            t = s.find(ref)
            return t, next((a for a in s.data["automations"] if a["id"] == t.get("automation")), None)


class ScheduledRun(Base):
    def test_the_allowed_schedule_s_run_updates_outside_the_guard(self):
        ref, key, brief = self.run_of(True)
        self.assertIn(f"update-shepherdr {ref} --folder", brief)
        self.assertIn("Never run `shepherdr update` in your terminal", brief)
        # what the run did before: refused by the guard
        r = self.call("shepherdr update", key)
        self.assertEqual(r.returncode, 77)
        self.assertIn("herdr-task update-shepherdr", r.stderr)
        self.assertEqual(self.ran(), "")
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder}", key)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Shepherdr update: updated at", r.stdout)
        self.assertIn("9.9.9", r.stdout)
        out = self.ran()
        self.assertIn("args: update", out)
        self.assertIn("guard=none", out)
        self.assertNotIn(".guard", out)
        t, a = self.task(ref)
        self.assertEqual(t["shepherdr_update"]["state"], "ok")
        self.assertEqual(a["last_update"]["version"], "9.9.9")
        # the next run is told how the last one went
        with store.Store(store.locate(self.folder)) as s:
            nxt = automations.fire(s, s.data["automations"][-1], "run now")
        self.assertIn("Its last update: updated at", nxt["prompt"])
        # and can ask for the outcome on its own
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder} --status", key)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("updated at", r.stdout)

    def test_a_failed_update_is_reported(self):
        ref, key, _ = self.run_of(True)
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder}", key, FAKE_CODE="3")
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("failed at", r.stdout)
        self.assertIn("exit code 3", r.stdout)
        _, a = self.task(ref)
        self.assertEqual(a["last_update"]["state"], "failed")
        with store.Store(store.locate(self.folder), False) as s:
            self.assertIn("Its last update: failed at", self_update.brief_words(s, a, {"id": 9}, "herdr-task"))

    def test_the_runner_is_its_own_process_session(self):
        seen = {}
        with mock.patch.object(self_update.subprocess, "Popen", lambda argv, **kw: seen.update(argv=argv, **kw)), \
                mock.patch.dict(os.environ, {"PATH": f"{self.store}/.guard/bin:/usr/bin", "HERDR_GUARD_SESSION": "shepherdr"}):
            self_update.spawn(self.folder, 4)
        self.assertTrue(seen["start_new_session"])
        self.assertEqual(seen["argv"][2:4], ["_update-shepherdr", "4"])
        self.assertNotIn("HERDR_GUARD_SESSION", seen["env"])
        self.assertEqual(seen["env"]["PATH"], "/usr/bin")


class Refused(Base):
    def test_an_ordinary_task_is_still_refused(self):
        ref, key = self.ordinary()
        self.assertEqual(self.call("shepherdr update", key).returncode, 77)
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder}", key)
        self.assertEqual(r.returncode, 1)
        self.assertIn("Refused: only a run of a schedule the person let update Shepherdr", r.stdout + r.stderr)
        self.assertEqual(self.ran(), "")

    def test_a_schedule_the_person_did_not_allow_is_refused(self):
        ref, key, brief = self.run_of(False)
        self.assertNotIn("update-shepherdr", brief)
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder}", key)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.ran(), "")

    def test_another_task_can_t_ask_in_the_allowed_run_s_name(self):
        ref, _, _ = self.run_of(True)
        _, other = self.ordinary()
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder}", other)
        self.assertEqual(r.returncode, 1)
        self.assertIn("own terminal", r.stdout + r.stderr)
        self.assertEqual(self.ran(), "")

    def test_a_task_s_agent_can_t_grant_the_allowance(self):
        self.auto("add", title="Nightly", when="daily 6:00")
        with mock.patch.dict(os.environ, {"HERDR_GUARD_SESSION": "shepherdr"}):
            with self.assertRaises(Fail) as e:
                self.auto("edit", id="1", may_update="on")
            with self.assertRaises(Fail):
                self.auto("add", title="Mine", when="daily 7:00", may_update="on")
        self.assertIn("Only the person", str(e.exception))
        with store.Store(store.locate(self.folder), False) as s:
            self.assertEqual([a.get("may_update") for a in s.data["automations"]], [None])
        # and from the task's terminal, by the CLI, it is refused too
        ref, key = self.ordinary()
        r = self.call(f"herdr-task auto edit 1 --folder {self.folder} --may-update-shepherdr on", key)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("Only the person", r.stdout + r.stderr)
        # the person can, and take it back
        self.auto("edit", id="1", may_update="on")
        self.auto("edit", id="1", may_update="off")
        with store.Store(store.locate(self.folder), False) as s:
            self.assertNotIn("may_update", s.data["automations"][0])


@unittest.skipUnless(os.environ.get("SHEPHERDR_REAL_INSTALL") == "1", "a real install into a scratch root (slow): SHEPHERDR_REAL_INSTALL=1")
class RealInstall(Base):
    def test_a_real_update_of_a_scratch_root(self):
        root = os.path.join(self.tmp, "root")
        os.makedirs(root)
        p = subprocess.run(["sh", os.path.join(ROOT, "install.sh"), "--root", root, "--yes"], capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, env={**os.environ, "HC_SESSION": "upd376try", "SHEPHERDR_SESSION": "upd376try"})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        ref, key, _ = self.run_of(True)
        sh = os.path.join(root, ".local", "bin")
        r = self.call(f"herdr-task update-shepherdr {ref} --folder {self.folder} --root {root}", key,
                      PATH=f"{BIN}:{sh}:{os.environ['PATH']}", HC_SESSION="upd376try", SHEPHERDR_SESSION="upd376try")
        t, _ = self.task(ref)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr + json.dumps(t.get("shepherdr_update")))
        with open(t["shepherdr_update"]["log"]) as f:
            text = f.read()
        self.assertIn("update from", text)
        if os.environ.get("SHOW"):
            print(p.stdout[-800:], r.stdout, text[-1500:])


if __name__ == "__main__":
    unittest.main()
