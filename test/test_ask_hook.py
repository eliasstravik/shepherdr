"""mods/chat/ask-hook.sh, the PermissionRequest hook of Claude Code and Codex (SHEP-91): every ask waits for the chat's
card, whether or not a chat shows the agent right now (a person on the web or a phone still gets it), and the terminal
stays a way to answer. Runs the real script on a throwaway app home with a fake hc; never the real data/chat-asks."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(ROOT, "mods", "chat", "ask-hook.sh")
REQ = {"tool_name": "Bash", "tool_input": {"command": "touch made.txt"}, "cwd": "/tmp/x", "transcript_path": ""}
ALLOW = json.dumps({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}})

# hc get <t> --json: the terminal as the test's state file says (status, argv)
FAKE_HC = """#!/bin/sh
[ "$1" = get ] || exit 1
cat "$FAKE_HC_STATE"
"""


@unittest.skipUnless(shutil.which("jq"), "the hook watches the terminal with jq")
class AskHook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ask-hook-")
        self.app = os.path.join(self.tmp, "app")
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        with open(os.path.join(self.bin, "hc"), "w") as f:
            f.write(FAKE_HC)
        os.chmod(os.path.join(self.bin, "hc"), 0o755)
        self.state = os.path.join(self.tmp, "state.json")
        self.term({"state": "live", "status": "working", "argv": ["claude"]})
        self.asks = os.path.join(self.app, "data", "chat-asks")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def term(self, t):
        with open(self.state + ".tmp", "w") as f:
            json.dump(t, f)
        os.replace(self.state + ".tmp", self.state)

    def start(self, **env):
        e = {"PATH": f"{self.bin}:{os.environ['PATH']}", "HOME": self.tmp, "HERDR_APP_HOME": self.app,
             "HC_TERMINAL_ID": "t9", "FAKE_HC_STATE": self.state, **env}
        p = subprocess.Popen(["sh", HOOK], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=e)
        p.stdin.write(json.dumps(REQ).encode())
        p.stdin.close()
        return p

    @staticmethod
    def out(p, timeout=10):
        p.wait(timeout=timeout)
        with p.stdout:
            return p.stdout.read()

    def waiting(self, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            d = os.path.join(self.asks, "req")
            got = [n for n in os.listdir(d) if n.endswith(".json")] if os.path.isdir(d) else []
            if got:
                return got[0][:-5]
            time.sleep(0.05)
        return None

    def test_asks_the_chat_with_no_chat_showing_the_agent(self):
        # no data/chat-asks/open/<terminal>: before SHEP-91 it left this to the terminal at once
        p = self.start()
        ask = self.waiting()
        self.assertIsNotNone(ask, "the request waits for a card")
        self.assertTrue(ask.startswith("t9."))
        with open(os.path.join(self.asks, "ans", ask + ".json"), "w") as f:
            f.write(ALLOW)
        out = self.out(p)
        self.assertEqual(json.loads(out), json.loads(ALLOW))
        self.assertFalse(os.path.exists(os.path.join(self.asks, "req", ask + ".json")), "the card closes")

    def test_answered_in_the_terminal_closes_the_card(self):
        p = self.start()
        ask = self.waiting()
        self.term({"state": "live", "status": "blocked", "argv": ["claude"]})
        time.sleep(0.8)
        self.term({"state": "live", "status": "working", "argv": ["claude"]})
        out = self.out(p)
        self.assertEqual(out, b"", "no decision from the hook: the terminal's answer stands")
        with open(os.path.join(self.asks, "end", ask)) as f:
            self.assertEqual(f.read().strip(), "Answered in the terminal")

    def test_answer_in_terminal_from_the_card(self):
        p = self.start()
        ask = self.waiting()
        open(os.path.join(self.asks, "ans", ask + ".json"), "w").close()
        out = self.out(p)
        self.assertEqual(out, b"")

    def test_a_task_workers_codex_hands_it_over_through_its_own_hook(self):
        # Codex runs ~/.codex/hooks.json's copy beside the worker's `herdr-task _allow` and waits for both: this copy
        # steps aside, and the one _allow runs (HERDR_ASK_CHAINED) asks the card
        # its real argv (#866: the hook is inside a -c value, never a word of its own, and both put up a card)
        sys_path = os.path.join(ROOT, "mods", "tasks", "bin")
        code = f"import sys; sys.path.insert(0, {sys_path!r}); from herdr_task.launch import own_argv; import json; print(json.dumps(own_argv(['codex', 'go'])))"
        argv = json.loads(subprocess.run(["python3", "-c", code], capture_output=True, text=True, check=True).stdout)
        self.assertNotIn("_allow", argv)
        self.term({"state": "live", "status": "working", "argv": ["sh", "-c", "x", *argv]})
        out = self.out(self.start())
        self.assertEqual(out, b"")
        self.assertIsNone(self.waiting(0.2))
        p = self.start(HERDR_ASK_CHAINED="1")
        self.assertIsNotNone(self.waiting())
        p.kill()
        p.wait()
        p.stdout.close()

    def test_a_task_workers_claude_hands_it_over_through_its_own_hook(self):
        # SHEP-139: a Claude worker gets `herdr-task _allow` in its --settings (own_argv), so a machine without this hook in
        # ~/.claude/settings.json still asks on the card; where both run, this copy steps aside for the chained one
        sys_path = os.path.join(ROOT, "mods", "tasks", "bin")
        code = f"import sys; sys.path.insert(0, {sys_path!r}); from herdr_task.launch import own_argv; import json; print(json.dumps(own_argv(['claude', 'go'])))"
        argv = json.loads(subprocess.run(["python3", "-c", code], capture_output=True, text=True, check=True).stdout)
        self.term({"state": "live", "status": "working", "argv": ["sh", "-c", "x", *argv]})
        self.assertEqual(self.out(self.start()), b"")
        self.assertIsNone(self.waiting(0.2))
        p = self.start(HERDR_ASK_CHAINED="1")
        self.assertIsNotNone(self.waiting())
        p.kill()
        p.wait()
        p.stdout.close()

    def test_a_brief_that_names_the_hook_is_no_worker_hook(self):
        # only the --settings that follows the flag counts, not any argument that mentions it
        self.term({"state": "live", "status": "working", "argv": ["claude", "fix ` _allow --command ` in launch.py"]})
        p = self.start()
        self.assertIsNotNone(self.waiting())
        p.kill()
        p.wait()
        p.stdout.close()

    def test_without_hc_only_while_a_chat_shows_it(self):
        # no hc or jq: it can't tell the terminal answered, so only a fresh flag brings the card
        env = {"PATH": "/usr/bin:/bin" if not os.path.exists("/usr/bin/hc") else "/bin"}
        shutil.rmtree(self.bin)
        out = self.out(self.start(**env))
        self.assertEqual(out, b"")
        self.assertIsNone(self.waiting(0.2))


if __name__ == "__main__":
    unittest.main()
