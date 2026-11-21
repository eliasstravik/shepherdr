"""The window chat's refocus() (mods/chat/main.js) never takes the keyboard from a text selection (SHEP-192, GitHub #916):
a drag over the messages selects them, and the message box taking focus a moment later made Ctrl+C copy nothing.
The method is run as it is written in main.js, in node, with the window's helpers stubbed: the box's focus is
recorded, the timers run at once."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "mods", "chat", "main.js")

# The method as written: from `  refocus(` to the line before `  render(cx) {`.
SRC = open(MAIN, encoding="utf-8").read()
MATCH = re.search(r"\n  refocus\(paneFocused, showsBox, cx\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
const shared = () => null, dialogHolds = () => false, keysElsewhere = () => false, liveHolder = (h) => h;
const KEY_HOLDER = "keyboard.holder";
const obj = { %(method)s };
const input = %(input)s;
const focusCalls = [];
const timers = [];
const self = Object.assign({ box: { focus: () => focusCalls.push(1) }, wasFocused: false, hadBox: false,
  focused: false, call: null, press: null, refocusAt: 0, areaKey: () => "pane", cardKeys: () => !!input.self.cardBox }, input.self);
const cx = { timer: { after: (ms, fn) => timers.push([ms, fn]) } };
obj.refocus.call(self, input.paneFocused, input.showsBox, cx);
for (const [, fn] of timers) fn();
console.log(JSON.stringify({ focus: focusCalls.length }));
"""


def run(self_state, paneFocused=True, showsBox=True):
    method = MATCH.group(0).strip()
    inp = {"self": self_state, "paneFocused": paneFocused, "showsBox": showsBox}
    script = HARNESS % {"method": method, "input": json.dumps(inp)}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "refocus.mjs")
        with open(path, "w") as f:
            f.write(script)
        out = subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["focus"]


class RefocusKeepsSelection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MATCH is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js refocus() not found or no node")

    def test_pane_focused_by_a_click_takes_the_box_when_nothing_is_dragged(self):
        # Opening or clicking the pane puts the keyboard in the box (the behaviour kept).
        self.assertEqual(run({"pressMoved": False, "press": {"at": 0}}), 2)

    def test_a_drag_that_selects_text_keeps_the_keyboard_off_the_box(self):
        # The repro: the pane gets focus from the press of a drag; the box's timers (0 and 600 ms) must not steal it.
        self.assertEqual(run({"pressMoved": True, "press": {"at": 0}}), 0)

    def test_a_selection_is_not_taken_by_a_later_render_either(self):
        # Pane focused, box blurred, press more than 1.5 s old: the other branch refocuses; not over a selection.
        state = {"wasFocused": True, "hadBox": True, "focused": False, "pressMoved": True, "press": {"at": 0}}
        self.assertEqual(run(state), 0)

    def test_without_a_selection_that_later_render_refocuses_the_box(self):
        state = {"wasFocused": True, "hadBox": True, "focused": False, "pressMoved": False, "press": {"at": 0}}
        self.assertEqual(run(state), 1)


class RefocusLeavesCardBoxes(unittest.TestCase):
    """GitHub #1224: typing in a question card's Other… box (or a secret's masked box) went to the reply box: every key
    redraws, and a redraw 1.5 s after the last press gave the reply box the keyboard back."""

    @classmethod
    def setUpClass(cls):
        if MATCH is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js refocus() not found or no node")

    def test_a_later_render_leaves_a_card_box_that_has_the_keyboard(self):
        state = {"wasFocused": True, "hadBox": True, "focused": False, "pressMoved": False, "press": {"at": 0}, "cardBox": True}
        self.assertEqual(run(state), 0)

    def test_the_pane_newly_focused_leaves_it_too(self):
        # A click on Other… in a pane that hadn't the keyboard: the box's timers must not take it from the card's box.
        self.assertEqual(run({"pressMoved": False, "press": {"at": 0}, "cardBox": True}), 0)

    def test_the_chat_asks_every_kind_of_card(self):
        body = re.search(r"\n  cardKeys\(\) \{\n(.*?)\n  \}\n", SRC, re.S).group(1)
        for c in ("this.cards", "this.workerCards", "this.codexCards", "this.secretCards"):
            self.assertIn(c, body)


class CardBoxesSayTheyHoldKeys(unittest.TestCase):
    """cards.js and secret-card.js's holdsKeys(), run as written with a stand-in box that fires focus and blur."""

    def holds(self, path, setup):
        src = open(os.path.join(ROOT, "mods", "chat", path), encoding="utf-8").read()
        method = re.search(r"\n  holdsKeys\(\) \{\n.*?\n  \}\n", src, re.S).group(0).strip()
        script = "const obj = { %s };\n%s" % (method, setup)
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "h.mjs")
            with open(p, "w") as f:
                f.write(script)
            return subprocess.run(["node", p], capture_output=True, text=True, check=True).stdout.split()

    def test_question_cards(self):
        out = self.holds("cards.js", """
const b = {}; const self = { typing: null, states: new Map([["a1", { boxes: [b] }]]) };
const h = () => obj.holdsKeys.call(self);
console.log(h()); self.typing = b; console.log(h()); self.states.delete("a1"); console.log(h());""")
        self.assertEqual(out, ["false", "true", "false"])

    def test_secret_cards(self):
        out = self.holds("secret-card.js", """
const b = {}; const self = { typing: null, states: new Map([["x|K", { box: b }]]) };
const h = () => obj.holdsKeys.call(self);
console.log(h()); self.typing = b; console.log(h()); self.states.clear(); console.log(h());""")
        self.assertEqual(out, ["false", "true", "false"])

    def test_their_boxes_note_focus_and_blur(self):
        for path in ("cards.js", "secret-card.js"):
            src = open(os.path.join(ROOT, "mods", "chat", path), encoding="utf-8").read()
            self.assertIn('b.on("focus", () => { this.typing = b; });', src)
            self.assertIn('b.on("blur", () => { if (this.typing === b) this.typing = null; });', src)


class ChatTracksDrags(unittest.TestCase):
    def test_the_chat_root_notes_a_drag_and_its_release(self):
        self.assertIn("on_mouse_up(\"left\", () => { this.pressing = false; })", SRC)
        self.assertRegex(SRC, r"on_mouse_move\(\(e\) => \{ if \(e\.bounds\) this\.noteArea\(e\.bounds\); this\.noteDrag\(e\.position\); \}\)")
        self.assertIn("this.pressing = true; this.pressMoved = false;", SRC)


if __name__ == "__main__":
    unittest.main()
