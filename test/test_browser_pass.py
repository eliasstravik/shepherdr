"""herdr-task's tick and the tasks' browsers (browsers.browser_pass): a Done task's browser is closed only once its
agent has stopped using it (GitHub #1138: an auto-merged task's agent checking its proof got a blank page between two
commands), and a browser Herdr closes leaves why for herdr-browser to say (#1147)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
sys.dont_write_bytecode = True
from herdr_task import browsers  # noqa: E402


class BrowserPass(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shep-bpass-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "browser")
        self.store = os.path.join(self.tmp, "store")
        os.makedirs(self.root)
        os.makedirs(self.store)
        self.closed = []
        for p in (mock.patch.object(browsers, "ROOT", self.root), mock.patch.object(browsers, "STORE", self.store),
                  mock.patch.object(browsers, "browser_path", lambda: "/fake/herdr-browser"),
                  mock.patch.object(browsers, "idle_ms", lambda: 10 * 60000),
                  mock.patch.object(browsers, "_live_sessions", lambda bp: {"herdr-shop-2"}),
                  mock.patch.object(browsers, "_close", lambda bp, key: self.closed.append(key))):
            p.start()
            self.addCleanup(p.stop)

    def task(self, state, used_min_ago):
        with open(os.path.join(self.store, "shop.json"), "w") as f:
            json.dump({"tasks": [{"id": 2, "state": state}]}, f)
        with open(os.path.join(self.root, "shop-2.task"), "w") as f:
            f.write("shop#2\n")
        os.makedirs(os.path.join(self.root, "shop-2"), exist_ok=True)
        used = os.path.join(self.root, "shop-2.used")
        open(used, "w").close()
        t = time.time() - used_min_ago * 60
        os.utime(used, (t, t))

    def closed_note(self):
        try:
            with open(os.path.join(self.root, "shop-2.closed")) as f:
                return f.read()
        except OSError:
            return None

    def test_a_done_task_in_use_keeps_its_browser(self):
        self.task("done", 1)
        report = {}
        browsers.browser_pass(report)
        self.assertEqual(self.closed, [])
        self.assertTrue(os.path.isdir(os.path.join(self.root, "shop-2")), "its profile stays while it's used")
        self.assertEqual(report, {})

    def test_a_done_task_left_alone_is_closed_and_says_why(self):
        self.task("done", 11)
        report = {}
        browsers.browser_pass(report)
        self.assertEqual(self.closed, ["shop#2"])
        self.assertFalse(os.path.isdir(os.path.join(self.root, "shop-2")))
        self.assertEqual(report["browsers_forgotten"], ["shop#2"])
        self.assertIn("the task is Done", self.closed_note())

    def test_an_idle_browser_is_closed_and_says_why(self):
        self.task("work", 11)
        browsers.browser_pass({})
        self.assertEqual(self.closed, ["shop#2"])
        self.assertIn("closed after 10 minutes unused", self.closed_note())
        self.task("work", 2)
        self.closed.clear()
        os.remove(os.path.join(self.root, "shop-2.closed"))
        browsers.browser_pass({})
        self.assertEqual(self.closed, [])
        self.assertIsNone(self.closed_note())


if __name__ == "__main__":
    unittest.main()
