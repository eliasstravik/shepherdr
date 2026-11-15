"""A recipe artifact's Copy buttons (mods/artifacts/recipe-view.js): the window binds no copy key to a page's
selected text, so each piece of code gets a button that writes it to the clipboard. `fenced` and `copyButton` are run
as they are written, in node, with the window's element builder stubbed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEW = os.path.join(ROOT, "mods", "artifacts", "recipe-view.js")
SRC = open(VIEW, encoding="utf-8").read()
FENCED = re.search(r"^const fenced = .*$", SRC, re.M)
BUTTON = re.search(r"\n  copyButton\(key, text, label, t\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
%(fenced)s
const built = [];
const el = () => { const e = new Proxy({}, { get: (_, k) => k === "on_click" ? (fn) => { built.push(fn); return e; }
  : k === "child" ? (c) => { if (typeof c === "string") built.label = c; return e; } : () => e }); return e; };
const div = el;
const obj = { %(button)s };
const input = %(input)s;
const out = { fenced: input.md === undefined ? null : fenced(input.md) };
if (input.press) {
  const self = { copied: new Set() };
  const t = { border: 0, surface: 0, background: 0, foreground: 0, muted: 0 };
  obj.copyButton.call(self, "k", input.press, "Copy", t);
  out.before = built.label;
  const clip = [];
  const cx = { stop_propagation() {}, notify() {}, write_to_clipboard: (s) => clip.push(s) };
  built[0](null, cx);
  out.clipboard = clip;
  built.length = 0;
  obj.copyButton.call(self, "k", input.press, "Copy", t);
  out.after = built.label;
}
console.log(JSON.stringify(out));
"""


def run(**inp):
    script = HARNESS % {"fenced": FENCED.group(0), "button": BUTTON.group(0).strip(), "input": json.dumps(inp)}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "copy.mjs")
        with open(path, "w") as f:
            f.write(script)
        return json.loads(subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout)


class RecipeCopyButtons(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if FENCED is None or BUTTON is None or shutil.which("node") is None:
            raise unittest.SkipTest("recipe-view.js fenced/copyButton not found or no node")

    def test_a_command_in_a_text_block_is_found_whole(self):
        md = "**Run this once:**\n\n```\nsudo sh -c 'mkdir -p /tmp/x && chmod 0700 /tmp/x'\n```\n"
        self.assertEqual(run(md=md)["fenced"], ["sudo sh -c 'mkdir -p /tmp/x && chmod 0700 /tmp/x'"])

    def test_each_fence_gets_its_own_copy_and_its_lines_stay_as_written(self):
        md = "One:\n```bash\na  b\nc\n```\nTwo:\n~~~\nd\n~~~"
        self.assertEqual(run(md=md)["fenced"], ["a  b\nc", "d"])

    def test_a_longer_fence_keeps_a_shorter_one_inside_it(self):
        md = "````md\n```js\nx()\n```\n````"
        self.assertEqual(run(md=md)["fenced"], ["```js\nx()\n```"])

    def test_inline_code_and_plain_text_get_no_button(self):
        self.assertEqual(run(md="Use `herdr-task list` here.")["fenced"], [])
        self.assertEqual(run(md=None)["fenced"], [])

    def test_a_press_copies_exactly_the_code_and_the_button_says_copied(self):
        out = run(press="echo 'a & <b>'")
        self.assertEqual(out["clipboard"], ["echo 'a & <b>'"])
        self.assertEqual((out["before"], out["after"]), ("Copy", "Copied"))


if __name__ == "__main__":
    unittest.main()
