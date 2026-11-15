"""Coming back to a space whose tab is an Assistant chat puts the keyboard in its message box (GitHub #1059).

A chat copy in a tab the window doesn't show isn't drawn, so its `wasFocused` stayed true from its last draw; coming back,
refocus() didn't see the pane as newly focused and left the box without the keyboard whenever another area held it (the
other space's chat, or the Tasks panel). forgetHidden() (run by the chat's 1 s timer, hidden copies too) forgets it.
Both methods are run as written in mods/chat/main.js, in node, with the window's helpers stubbed."""
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
REFOCUS = re.search(r"\n  refocus\(paneFocused, showsBox, cx\) \{\n.*?\n  \}\n", SRC, re.S)
FORGET = re.search(r"\n  forgetHidden\(ps = panes\(\), tab = focused\(\)\?\.tab\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
// Another area holds the keyboard: the other space's chat took it while this one was hidden.
const KEY_HOLDER = "keyboard.holder";
const shared = () => ({ who: "pane-other", at: 1 });
const dialogHolds = () => false, liveHolder = (h) => h;
const keysElsewhere = (holder, mine) => Boolean(holder?.who && holder.who !== mine);
let shownTab = "tab-mine";
const panes = () => [{ pane: "pane-mine", tab: "tab-mine" }, { pane: "pane-other", tab: "tab-other" }];
const focused = () => ({ tab: shownTab });
const obj = { %(methods)s };
const focusCalls = [];
const cx = { timer: { after: (ms, fn) => fn() } };
// Shown and focused at its last draw, its box blurred when the window moved to the other space.
const self = { box: { focus: () => focusCalls.push(1) }, wasFocused: true, hadBox: true, focused: false, call: null,
  press: null, pressMoved: false, refocusAt: 0, thread: false, inner: false,
  myPane: () => "pane-mine", areaKey: () => "pane-mine", forgetHidden: obj.forgetHidden };
const input = %(input)s;
if (input.hidden) { shownTab = "tab-other"; if (input.timer) self.forgetHidden(); }
shownTab = "tab-mine";
if (input.timer) self.forgetHidden();
obj.refocus.call(self, true, true, cx);
console.log(JSON.stringify({ focus: focusCalls.length }));
"""


def run(**inp):
    methods = REFOCUS.group(0).strip() + ",\n" + FORGET.group(0).strip()
    script = HARNESS % {"methods": methods, "input": json.dumps(inp)}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "switch.mjs")
        with open(path, "w") as f:
            f.write(script)
        out = subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["focus"]


class ChatBoxTakesKeysAfterSpaceSwitch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if REFOCUS is None or FORGET is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js refocus()/forgetHidden() not found or no node")

    def test_without_the_timer_coming_back_leaves_the_box_without_keys(self):
        # The bug as it was: the hidden copy is never drawn, wasFocused stays true, the other chat holds the keyboard.
        self.assertEqual(run(hidden=True, timer=False), 0)

    def test_coming_back_to_the_space_focuses_the_box(self):
        self.assertGreater(run(hidden=True, timer=True), 0)

    def test_a_chat_that_stayed_shown_does_not_take_the_keyboard_back(self):
        # Shown all along while another area holds the keyboard (#633): the timer changes nothing.
        self.assertEqual(run(hidden=False, timer=True), 0)

    def test_the_timer_runs_forget_hidden(self):
        self.assertRegex(SRC, r"cx\.timer\.every\(1000, \(cx\) => \{\n\s+this\.forgetHidden\(\);")


if __name__ == "__main__":
    unittest.main()
