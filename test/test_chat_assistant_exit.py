"""/exit in an Assistant's chat keeps its tab and offers Restart Assistant (GitHub #1039).

Before, the chat's follow loop closed its own pane once its agent ended unless it was the Coordinator tab's own slot
chat, so an Assistant chat opened from its terminal (Terminal, then Chat) took its tab with it, and a slot chat went
empty, its conversation gone from view. Now an Assistant that ran (a session to resume) stays on a notice with Restart
Assistant. resumable() is run as written in mods/chat/main.js, in node, with its helpers stubbed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, "mods", "chat", "main.js"), encoding="utf-8").read()
RESUMABLE = re.search(r"\n  resumable\(\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
const agent = { sessionOf: (kind, path) => (/([0-9a-f-]{36})\.jsonl$/.exec(path ?? "") || [])[1] ?? null };
const obj = { %(method)s };
const input = %(input)s;
const self = Object.assign({ thread: false, inner: false, addr: "t7", kind: "claude",
  path: "/h/.claude/projects/x/11111111-2222-3333-4444-555555555555.jsonl" }, input.self);
self.assistant = () => (input.assistant ? "sp1" : null);
console.log(JSON.stringify(obj.resumable.call(self)));
"""


def resumable(assistant=True, **state):
    script = HARNESS % {"method": RESUMABLE.group(0).strip(), "input": json.dumps({"assistant": assistant, "self": state})}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "resumable.mjs")
        with open(path, "w") as f:
            f.write(script)
        return json.loads(subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout)


class AssistantExitKeepsItsTab(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if RESUMABLE is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js resumable() not found or no node")

    def test_an_assistant_that_ran_can_be_restarted(self):
        self.assertTrue(resumable())

    def test_a_worker_or_a_task_chat_is_not_offered_it(self):
        self.assertFalse(resumable(assistant=False))
        self.assertFalse(resumable(thread=True))

    def test_one_that_ended_before_it_ever_ran_is_not_offered_it(self):
        # No log yet: the old way (a slot chat goes empty with the message back in the box).
        self.assertFalse(resumable(path=None))

    def test_the_follow_loop_stays_before_it_would_close_the_pane(self):
        loop = SRC[SRC.index("  async follow(cx) {"):]
        loop = loop[:loop.index("this.closeSelf();")]
        self.assertIn("if (this.resumable()) { this.endedAssistant = true; cx.notify(); return; }", loop)

    def test_the_notice_offers_restart_assistant(self):
        self.assertIn('"chat-restart-assistant"', SRC)
        self.assertRegex(SRC, r'"Restart Assistant", null, "primary", t, \(cx\) => this\.restartAssistant\(cx\)')

    def test_restart_resumes_the_same_session(self):
        body = SRC[SRC.index("  restartAssistant(cx) {"):SRC.index("  closeSelf() {")]
        self.assertIn("agent.resumeArgv(this.kind", body)
        self.assertIn("resume: true", body)


if __name__ == "__main__":
    unittest.main()
