"""herdr-task's tick and the agents' browsers (browsers.browser_pass; 3.2: one browser per space, a tab per agent):
a Done task's tab is closed only once its agent has stopped using it (GitHub #1138: an auto-merged task's agent
checking its proof got a blank page between two commands) and the space's browser stays; a space's browser nobody used
for its idle time is closed, sign-ins kept, never under a person who drives; and the real herdr-browser, told to
close a space, leaves each agent why (#1147) and keeps the profile."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import fake_ab

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
        os.makedirs(os.path.join(self.root, "spaces", "sp1"))
        os.makedirs(self.store)
        self.ran = []
        for p in (mock.patch.object(browsers, "ROOT", self.root), mock.patch.object(browsers, "STORE", self.store),
                  mock.patch.object(browsers, "browser_path", lambda: "/fake/herdr-browser"),
                  mock.patch.object(browsers, "desktop_path", lambda: "/fake/herdr-desktop"),
                  mock.patch.object(browsers, "idle_ms", lambda: 10 * 60000),
                  mock.patch.object(browsers, "_own", lambda argv: self.ran.append(argv))):
            p.start()
            self.addCleanup(p.stop)

    def aged(self, rel, min_ago, text=""):
        path = os.path.join(self.root, rel)
        with open(path, "w") as f:
            f.write(text)
        t = time.time() - min_ago * 60
        os.utime(path, (t, t))

    def task(self, state, used_min_ago, space_used_min_ago=None):
        with open(os.path.join(self.store, "shop.json"), "w") as f:
            json.dump({"tasks": [{"id": 2, "state": state}]}, f)
        self.aged("shop-2.task", 0, "shop#2\n")
        self.aged("shop-2.space", 0, "sp1\n")
        self.aged("shop-2.used", used_min_ago)
        self.aged("spaces/sp1.cdp", 60, "ws://127.0.0.1:1/devtools/browser/x\n")
        self.aged("spaces/sp1.used", used_min_ago if space_used_min_ago is None else space_used_min_ago)

    def test_a_done_task_in_use_keeps_its_tab(self):
        self.task("done", 1)
        report = {}
        browsers.browser_pass(report)
        self.assertEqual(self.ran, [])
        self.assertEqual(report, {})

    def test_a_done_task_left_alone_loses_its_tab_and_desktop_not_the_spaces_browser(self):
        self.task("done", 11, space_used_min_ago=1)   # another agent of the space used the browser a minute ago
        report = {}
        browsers.browser_pass(report)
        self.assertEqual(self.ran, [["/fake/herdr-browser", "--own", "--task", "shop#2", "--space", "sp1", "--forget"],
                                    ["/fake/herdr-desktop", "--own", "--task", "shop#2", "--space", "sp1", "--down"]])
        self.assertEqual(report, {"browsers_forgotten": ["shop#2"]})
        self.assertTrue(os.path.isdir(os.path.join(self.root, "spaces", "sp1")), "the space's sign-ins stay")

    def test_an_idle_spaces_browser_is_closed_and_a_used_one_is_not(self):
        self.task("work", 11)
        report = {}
        browsers.browser_pass(report)
        self.assertEqual(len(self.ran), 1)
        self.assertEqual(self.ran[0][:6], ["/fake/herdr-browser", "--own", "--chat", "--space", "sp1", "--close-space"])
        self.assertIn("closed after 10 minutes unused", self.ran[0][6])
        self.assertEqual(report, {"browsers_closed": ["sp1"]})
        self.ran.clear()
        self.task("work", 11, space_used_min_ago=2)   # the person, or another agent of the space, two minutes ago
        browsers.browser_pass({})
        self.assertEqual(self.ran, [])

    def test_never_closed_under_the_person(self):
        self.task("work", 30)
        self.aged("shop-2.you", 1)
        browsers.browser_pass({})
        self.assertEqual(self.ran, [])
        os.remove(os.path.join(self.root, "shop-2.you"))
        self.aged("spaces/sp1.desk", 1, "123\n")       # signing in on the desktop: a normal Chrome holds the profile
        browsers.browser_pass({})
        self.assertEqual(self.ran, [])

    def test_a_chats_own_tab_lives_with_its_space(self):
        self.aged("chat-sp1.task", 0, "chat:sp1\n")
        self.aged("chat-sp1.space", 0, "sp1\n")
        self.aged("chat-sp1.used", 500)
        browsers.browser_pass({})
        self.assertEqual(self.ran, [])

    def test_the_brief_and_the_workers_env(self):
        line = browsers.browser_line()
        self.assertIn("your own tab in your space's browser", line)
        self.assertIn('/fake/herdr-browser hands "', line)
        self.assertIn("/fake/herdr-desktop snapshot", line)
        # the agents' instructions say the same: their own tab, a desktop, and how to ask for the person's hands
        for name in ("assistant.md", "worker.md"):
            with open(os.path.join(ROOT, "templates", name)) as f:
                words = f.read()
            self.assertIn("`herdr-desktop <agent-desktop command>`", words, name)
            self.assertIn('run `herdr-browser hands "<what, a few words>"` and wait. If a command says the person took over, stop until their message.', words, name)
            self.assertNotIn("its sign-ins stay with the task", words, name)
        self.assertEqual(browsers.browser_env("shop#2", "sp1"), ["HERDR_BROWSER_TASK=shop#2", "HERDR_BROWSER_SPACE=sp1"])
        self.assertEqual(browsers.browser_env("shop#2", None), ["HERDR_BROWSER_TASK=shop#2"])


class TheRealWrapper(unittest.TestCase):
    """bin/herdr-browser itself on a throwaway home, against the stand-in agent-browser."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-bpass-hb-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.root = os.path.join(self.home, ".herdr", "browser")
        self.log = os.path.join(self.home, "ab.log")
        self.bin = os.path.join(self.home, "agent-browser")
        with open(self.bin, "w") as f:
            f.write(fake_ab.script('echo "$sess: $*" >> %s' % self.log))
        os.chmod(self.bin, 0o755)

    def hb(self, *args):
        env = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **fake_ab.ENV}
        return subprocess.run(["sh", os.path.join(ROOT, "bin", "herdr-browser"), *args], env=env, capture_output=True, text=True, timeout=60)

    def has(self, name):
        return os.path.lexists(os.path.join(self.root, name))

    def test_closing_a_space_tells_each_agent_why_once_and_keeps_sign_ins(self):
        for task in ("shop#2", "shop#3"):
            self.assertEqual(self.hb("--task", task, "--space", "sp1", "open", "about:blank").returncode, 0)
        self.assertEqual(self.hb("--task", "other#1", "--space", "sp2", "open", "about:blank").returncode, 0)
        for f in ("shop-2.cdp", "shop-2.tab", "shop-3.cdp", "spaces/sp1.cdp", "spaces/sp2.cdp"):
            self.assertTrue(self.has(f), f)
        os.makedirs(os.path.join(self.root, "spaces", "sp1"), exist_ok=True)
        self.hb("--own", "--chat", "--space", "sp1", "--close-space", "it was closed after 10 minutes unused")
        for f in ("shop-2.cdp", "shop-2.tab", "shop-3.cdp", "spaces/sp1.cdp"):
            self.assertFalse(self.has(f), f)
        self.assertTrue(self.has("other-1.cdp"), "another space's browser is left alone")
        self.assertTrue(self.has("spaces/sp1"), "the profile stays")
        p = self.hb("--task", "shop#2", "--space", "sp1", "snapshot")
        self.assertIn("had been closed (it was closed after 10 minutes unused)", p.stderr)
        self.assertIn("Sign-ins are kept", p.stderr)
        self.assertNotIn("had been closed", self.hb("--task", "shop#2", "--space", "sp1", "snapshot").stderr)

    def test_a_spaces_profile_starts_from_a_tasks_own_and_the_old_place_stays_a_link(self):
        old = os.path.join(self.root, "shop-2")
        os.makedirs(os.path.join(old, "Default"))
        with open(os.path.join(old, "Default", "Cookies"), "w") as f:
            f.write("signed in")
        other = os.path.join(self.root, "shop-9", "Default")   # another task's 3.1 profile: stays where it is
        os.makedirs(other)
        self.assertEqual(self.hb("--task", "shop#2", "--space", "sp1", "open", "about:blank").returncode, 0)
        with open(os.path.join(self.root, "spaces", "sp1", "Default", "Cookies")) as f:
            self.assertEqual(f.read(), "signed in")
        self.assertTrue(os.path.islink(old))
        self.assertTrue(os.path.isdir(other))
        # Done: its tab and files go, the link too; the space's profile stays
        self.hb("--own", "--task", "shop#2", "--space", "sp1", "--forget")
        self.assertFalse(self.has("shop-2"))
        self.assertFalse(self.has("shop-2.task"))
        self.assertTrue(os.path.isfile(os.path.join(self.root, "spaces", "sp1", "Default", "Cookies")))

    def test_the_agents_own_close_is_its_tab_only(self):
        self.hb("--task", "shop#2", "--space", "sp1", "open", "about:blank")
        p = self.hb("--task", "shop#2", "--space", "sp1", "close")
        self.assertIn("your tab is closed", p.stdout)
        self.assertFalse(self.has("shop-2.cdp"))
        self.assertTrue(self.has("spaces/sp1.cdp"))
        with open(self.log) as f:
            self.assertNotIn("herdr-s-sp1: close", f.read())

    def test_whose_from_the_environment_a_chat_or_the_list(self):
        def name(*args, **env):
            e = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **env}
            return json.loads(subprocess.run(["sh", os.path.join(ROOT, "bin", "herdr-browser"), *args, "--name"], env=e,
                                             capture_output=True, text=True).stdout)
        j = name(HERDR_BROWSER_TASK="shop#2", HERDR_BROWSER_SPACE="vm/sp1")
        self.assertEqual((j["who"], j["name"], j["space"], j["owner"]), ("shop#2", "shop-2", "sp1", "herdr-s-sp1"))
        c = name("--chat", "--space", "sp1")
        self.assertEqual((c["who"], c["name"], c["session"], c["profile"]), ("chat:sp1", "chat-sp1", "herdr-chat-sp1", j["profile"]))
        self.assertEqual(name("--task", "shop#2")["space"], "list-shop")   # no space known: its list's browser
        for flag in ("--profile", "--cdp", "--pin-tab", "--session"):
            p = self.hb("--task", "shop#2", "--space", "sp1", "open", flag, "x")
            self.assertEqual(p.returncode, 2, flag)


if __name__ == "__main__":
    unittest.main()
