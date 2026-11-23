"""A task's agent can't take down the session it runs in (SHEP-323, herdr_task/guard.py).

SHEP-321's agent ran `export HC_SESSION=shep321try` in one shell call and a bare `hc server stop` in the next; the
export was gone, the terminal's own HC_SESSION=shepherdr was back, and the live core went down with every agent.
These run the guard's stand-ins with fake commands behind them; RealCore (opt-in: SHEPHERDR_REAL_CORE=1 and an hc
on PATH) replays the same two calls inside a real throwaway core standing in for the live one."""
import home_guard  # noqa: F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))

from herdr_task import guard  # noqa: E402

FAKE = """#!/bin/sh
echo "$(basename "$0") HC_SESSION=${HC_SESSION:-} $*" >> "$FAKE_LOG"
"""


class Stand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.fake = os.path.join(self.tmp, "real")
        os.makedirs(self.fake)
        for name in guard.GUARDED:
            p = os.path.join(self.fake, name)
            with open(p, "w") as f:
                f.write(FAKE)
            os.chmod(p, 0o755)
        self.log = os.path.join(self.tmp, "log")
        self.dir = guard.guard_dir(os.path.join(self.tmp, "store"))

    def call(self, line, session="shepherdr", **env):
        """One shell call inside a task's terminal: HC_SESSION from its core, the guard first on PATH, as launch
        starts the agent (guard_argv), each call a new shell."""
        e = {"HOME": os.environ["HOME"], "PATH": f"{self.fake}:/usr/bin:/bin", "FAKE_LOG": self.log, "HC_SESSION": session, **env}
        argv = guard.guard_argv(["sh", "-c", line], session, os.path.join(self.tmp, "store"))
        r = subprocess.run(argv, env=e, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        return r

    def ran(self):
        try:
            with open(self.log) as f:
                return f.read().splitlines()
        except FileNotFoundError:
            return []


class Refuses(Stand):
    def test_shep321_bare_stop_after_an_export_in_an_earlier_call(self):
        r1 = self.call("export HC_SESSION=shep321try; unset HC_TERMINAL_SOCKET; hc run --bg --name p1 -- sleep 30")
        self.assertEqual(r1.returncode, 0, r1.stderr)
        r2 = self.call("hc server stop")
        self.assertEqual(r2.returncode, 77)
        self.assertIn('stop the live session "shepherdr"', r2.stderr)
        self.assertIn("HC_SESSION=<throwaway> hc server stop", r2.stderr)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shep321try run --bg --name p1 -- sleep 30"])

    def test_a_throwaway_session_named_on_the_command_goes_through(self):
        self.assertEqual(self.call("HC_SESSION=shep321try hc server stop").returncode, 0)
        self.assertEqual(self.call("HC_SESSION=shep321try hc server restart").returncode, 0)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shep321try server stop", "hc HC_SESSION=shep321try server restart"])

    def test_protected_sessions(self):
        for line in ("hc server restart", "hc --json server stop", "herdr-core server stop",
                     "HC_SESSION=shepherdr hc server stop", "HC_SESSION=default hc server stop",
                     "unset HC_SESSION; hc server stop", "HC_SESSION=mine hc server stop", "hc update",
                     "hc update --version 0.2.0", "HC_SESSION=x hc update"):
            with self.subTest(line):
                self.assertEqual(self.call(line, session="mine").returncode, 77)
        self.assertEqual(self.ran(), [])

    def test_everyday_hc_goes_through(self):
        for line in ("hc ls", "hc run --bg --name x -- claude", "hc wait x --timeout 600", "hc kill x", "hc server status",
                     "hc server --help", "hc update --help", "hc read x --lines 400"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0, line)
        self.assertEqual(len(self.ran()), 8)

    def test_services_and_processes(self):
        refused = ("systemctl --user stop hc-serve-02a62dc5.service", "systemctl --user restart shepherdr.service",
                   "systemctl --user kill hc-hold-9a76bbbf.service", "pkill -f herdr-core", "pkill hc",
                   "killall herdr-core", "pkill -f 'bun service/main.ts'")
        for line in refused:
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        self.assertEqual(self.ran(), [])
        for line in ("systemctl --user status shepherdr.service", "systemctl --user list-units", "pkill -f 'vite preview'",
                     "systemctl --user stop my-own.service"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0)

    def test_installer_on_the_live_home(self):
        for line in ("shepherdr update", "shepherdr install --yes", "shepherdr uninstall", "shepherdr migrate --rollback",
                     "shepherdr web serve-from vm", "shepherdr secrets move-to vm"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 77)
        for line in ("shepherdr install --root /tmp/x", "shepherdr update --dry-run", "shepherdr doctor", "shepherdr version",
                     "shepherdr web status", "shepherdr where"):
            with self.subTest(line):
                self.assertEqual(self.call(line).returncode, 0)

    def test_nested_guard_and_rc_files_putting_the_real_one_first_again(self):
        # a second launch inside the first (or an rc file prepending the real folder) still finds the real one
        r = self.call(f'PATH="{self.dir}:{self.dir}:$PATH" hc ls')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.ran(), ["hc HC_SESSION=shepherdr ls"])


class Launch(unittest.TestCase):
    def test_every_task_agent_starts_guarded(self):
        with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", "launch.py")) as f:
            self.assertIn("in_shell(guard_argv(cmd))", f.read())

    def test_the_rule_in_plain_words(self):
        from herdr_task import templates
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            worker = f.read()
        for words in (templates.WORKER_MD, worker):
            self.assertIn(templates.LIVE_RULE, words)
        self.assertIn(templates.WORKER_MD_BEFORE_LIVE, templates.OLD_WORKERS)   # an unedited old one gets today's
        for name in ("templates/assistant.md", "AGENTS.md"):
            with open(os.path.join(ROOT, name)) as f:
                self.assertIn("`HC_SESSION=<throwaway> hc", f.read())

    def test_rewritten_when_changed(self):
        with tempfile.TemporaryDirectory() as t:
            d = guard.guard_dir(t)
            with open(os.path.join(d, "guard.sh"), "w") as f:
                f.write("#!/bin/sh\nexec \"$@\"\n")
            guard.guard_dir(t)
            with open(os.path.join(d, "hc")) as f:
                self.assertEqual(f.read(), guard.SCRIPT)


HC = shutil.which("hc")


@unittest.skipUnless(HC and os.environ.get("SHEPHERDR_REAL_CORE") == "1", "a real herdr-core: SHEPHERDR_REAL_CORE=1")
class RealCore(unittest.TestCase):
    """SHEP-321's two shell calls in a terminal of a real throwaway core ("live"), with and without the guard."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        n = f"{os.getpid()}{int(time.time()) % 100000}"
        self.live, self.try_ = f"shep323live{n}", f"shep323try{n}"
        # a clean environment: the throwaway HOME, no terminal of the real core
        self.env = {"HOME": os.environ["HOME"], "PATH": os.environ["PATH"], "TERM": "xterm"}
        for s in (self.live, self.try_):
            self.addCleanup(self.hc, s, "server", "stop")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.assertEqual(self.hc(self.live, "server", "start").returncode, 0)
        self.pid = self.status(self.live)["pid"]

    def hc(self, session, *args):
        # the session named on every call, never inherited (the lesson of SHEP-321)
        return subprocess.run([HC, *args], env={**self.env, "HC_SESSION": session}, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, universal_newlines=True, timeout=60)

    def status(self, session):
        r = self.hc(session, "server", "status", "--json")
        try:
            return json.loads(r.stdout)
        except ValueError:
            return {}

    def replay(self, guarded):
        out = os.path.join(self.tmp, "out")
        script = os.path.join(self.tmp, "agent.sh")
        with open(script, "w") as f:
            # each line a shell of its own, as an agent's tool calls are
            f.write(f"""
sh -c 'export HC_SESSION={self.try_}; unset HC_TERMINAL_SOCKET; hc run --bg --name p1 -- sleep 30 >/dev/null 2>&1'
sh -c 'hc server stop >/dev/null 2>{out}.err; echo "bare stop: $?" >> {out}'
sh -c 'HC_SESSION={self.try_} hc server stop >/dev/null 2>&1; echo "throwaway stop: $?" >> {out}'
echo done >> {out}
""")
        argv = ["sh", script]
        if guarded:
            argv = guard.guard_argv(argv, self.live, os.path.join(self.tmp, "store"))
        argv = ["env", f"PATH={self.env['PATH']}", *argv]   # as the person's shell gives it its PATH
        r = self.hc(self.live, "run", "--bg", "--name", "agent", "--", *argv)
        self.assertEqual(r.returncode, 0, r.stderr)
        for _ in range(150):
            if os.path.exists(out):
                with open(out) as f:
                    if "done" in f.read():
                        break
            if not guarded and self.status(self.live).get("pid") != self.pid:
                break
            time.sleep(0.2)
        try:
            with open(out) as f:
                return f.read()
        except FileNotFoundError:
            return ""

    def test_with_the_guard_the_live_core_survives(self):
        said = self.replay(True)
        self.assertIn("bare stop: 77", said)
        self.assertIn("throwaway stop: 0", said)
        self.assertEqual(self.status(self.live).get("pid"), self.pid)   # the same core, still up

    def test_without_it_the_bare_stop_takes_the_live_core_down(self):
        # the bug, reproduced on the stand-in: the stop lands on the session the terminal runs in
        self.replay(False)
        for _ in range(50):
            if self.status(self.live).get("pid") != self.pid:
                break
            time.sleep(0.2)
        self.assertNotEqual(self.status(self.live).get("pid"), self.pid)


if __name__ == "__main__":
    unittest.main()
