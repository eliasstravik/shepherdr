"""The message box grows with its text without moving the chat above it (the chat flickered while typing in Safari).

To measure its text the box was set back to one line for an instant, so the chat above it got taller for that instant:
Safari scrolled the chat up by the box's extra lines on every key, and the chat's own "stay at the end" pulled it back
down. Chrome happens to put the scroll back, so this checks the cause itself, in a real headless Chrome with the app's
own stylesheets and web/src/grow.ts: while the box measures, everything around it keeps its height; the box is one
line for one line of text and six at most; a long chat at its end stays at its end as you type. It skips where no
Chrome or bun is found.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

from test_bubble_width import CSS, ROOT, chrome

GROW = os.path.join(ROOT, "web", "src", "grow.ts")

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}
html,body{{height:auto;overflow:visible}}
.col{{height:{h}px}}
</style></head><body>
<div class="app"><section class="col chat" style="width:{w}px"><div class="scroll"><div class="msgs">{rows}</div></div>
<div class="foot"><div class="cbox"><div class="crow"><textarea class="cin" rows="1"></textarea></div></div></div></section></div>
<script type="module">
{grow}
const sc = document.querySelector('.scroll'), foot = document.querySelector('.foot'), t = document.querySelector('textarea')
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
fitBox(t)
sc.scrollTop = sc.scrollHeight
await frame(); await frame()
// what the page around the box measures at the instant the box reads its text's height
const seen = []
const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
Object.defineProperty(t, 'scrollHeight', {{ get() {{ seen.push([foot.offsetHeight, sc.clientHeight]); return own.get.call(this) }} }})
const steps = []
let text = ''
for (let i = 1; i <= 8; i++) {{
  text += (i > 1 ? '\\n' : '') + 'line ' + i
  t.value = text
  const was = [foot.offsetHeight, sc.clientHeight]
  seen.length = 0
  fitBox(t)
  steps.push({{ was, seen: seen.slice(), h: t.offsetHeight }})
  if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80) sc.scrollTop = sc.scrollHeight  // the chat's own stay-at-the-end
}}
// typing on in a box at its six lines: each key measures again
for (let i = 0; i < 5; i++) {{
  t.value += ' more'
  const was = [foot.offsetHeight, sc.clientHeight]
  seen.length = 0
  fitBox(t)
  steps.push({{ was, seen: seen.slice(), h: t.offsetHeight }})
}}
await frame(); await frame()
const gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight
t.value = 'one'
fitBox(t)
window.done = {{ steps, gap, one: t.offsetHeight, held: t.parentElement.style.minHeight }}
</script></body></html>"""


def bundle():
    bun = shutil.which("bun")
    if not bun:
        return None
    out = subprocess.run([bun, "build", "--target=browser", "--format=esm", GROW], capture_output=True, text=True,
                         timeout=60)
    if out.returncode:
        return None
    return re.sub(r"export\s*\{[^}]*\};?", "", out.stdout)


class BoxGrow(unittest.TestCase):
    def test_rules(self):
        ui = open(os.path.join(ROOT, "web", "src", "ui.tsx"), encoding="utf-8").read()
        # the box measures through fitBox, before the frame is drawn
        self.assertRegex(ui, r"useLayoutEffect\(\(\) => \{\s*if \(ref\.current\) fitBox\(ref\.current\)")

    def test_page_holds_still_while_the_box_measures(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        bun = shutil.which("bun")
        grow = bundle()
        if not bun or grow is None:
            self.skipTest("no bun here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        rows = "".join(f'<div class="bw"><div class="bmv"><div class="b"><div class="md">Message {i}, a line or two of words.</div></div></div></div>' for i in range(30))
        for w, h in ((390, 760), (1280, 760)):
            with self.subTest(width=w), tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                page = os.path.join(d, "p.html")
                with open(page, "w", encoding="utf-8") as f:
                    f.write(PAGE.format(css=css, w=w, h=h, rows=rows, grow=grow))
                out = subprocess.run([bun, os.path.join(ROOT, "test", "chrome_page.ts"), exe, "file://" + page, os.path.join(d, "u")],
                                     capture_output=True, text=True, timeout=90)
                self.assertEqual(out.returncode, 0, out.stdout[-800:] + out.stderr[-800:])
                res = json.loads(out.stdout.strip().splitlines()[-1])
                for s in res["steps"]:
                    # the box read its height once, and the foot and the chat above kept theirs meanwhile
                    self.assertEqual(len(s["seen"]), 1, s)
                    self.assertEqual(s["seen"][0], s["was"], s)
                heights = [s["h"] for s in res["steps"]]
                # it grows a line at a time, up to six lines, then stays
                self.assertEqual(heights[0], 44, heights)
                self.assertEqual(heights[5:], [164] * (len(heights) - 5), heights)
                self.assertEqual(heights, sorted(heights), heights)
                # the chat is still at its end, the box back to one line, nothing left held
                self.assertLess(res["gap"], 1, res)
                self.assertEqual(res["one"], 44, res)
                self.assertEqual(res["held"], "", res)


if __name__ == "__main__":
    unittest.main()
