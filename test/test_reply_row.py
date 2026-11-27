"""The suggested replies' row has its own space under the chat (in 3.2.6 the chat's last message ran into the row and
was sliced off by a hard edge, and the row could arrive scrolled so its first bubble was cut at the screen's edge).

The layout check lays out the app's own stylesheets in a real headless Chrome (the one agent-browser keeps, or
$SHEPHERDR_TEST_CHROME), driven over its debugging port so it draws frames (test/chrome_page.ts), with the chat's real code for staying at its end (web/plugins/chat/stick.ts, bundled with bun),
scrolls a long chat to its end, then brings the row in, at a folded phone's, an open Fold's and a desktop's width, with
one, two and three bubbles, short and long. It measures: the last message's box ends above the row's; the chat still
at its end; the first bubble at the box's left edge, fully in view; 8 px between bubbles and down to the box; a fade
only at the edge where more bubbles continue. It skips where no Chrome or bun is found.
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

STICK = os.path.join(ROOT, "web", "plugins", "chat", "stick.ts")

LONG = "Here is what changed in the workout screens, and what I would like you to look at next. " * 3
SETS = {
    "one": ["Ship it"],
    "two": ["Yes, merge it", "Show me the diff first"],
    "three": ["Yes, merge it", "Show me the diff first", "status?"],
    "long": ["I still think it looks wrong, here is why", "Show me the before and after first please", "status?"],
}

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}
html,body{{height:auto;overflow:visible}}
.col{{height:{h}px}}
</style></head><body>
<div class="app{tap}"><section class="col chat" style="width:{w}px"><div class="scroll"><div class="msgs">{rows}</div></div>
<div class="foot"><div class="cbox"><div class="crow"><textarea class="cin" rows="1"></textarea></div></div></div></section></div>
<script type="module">
{stick}
const texts = {texts}
const sc = document.querySelector('.scroll'), msgs = sc.firstElementChild, foot = document.querySelector('.foot')
const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
sc.scrollTop = sc.scrollHeight
let atEnd = true
sc.addEventListener('scroll', () => {{ atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80 }})
keepAtEnd(sc, msgs, () => atEnd)
await frame(); await frame()
const before = sc.scrollHeight - sc.scrollTop - sc.clientHeight
// the row comes: built as the app builds it, above the box
const row = document.createElement('div')
row.className = 'sugs'
row.innerHTML = texts.map((t, i) => `<button type="button" class="sug${{i ? '' : ' pri'}}">${{t}}</button>`).join('')
foot.insertBefore(row, foot.firstChild)
row.scrollLeft = 200  // a leftover sideways scroll: a new set still starts at its first bubble
const stop = rowEdges(row)
await frame(); await frame()
const r = (e) => e.getBoundingClientRect()
const last = r(msgs.lastElementChild.querySelector('.b')), view = r(sc), rr = r(row), box = r(foot.querySelector('.cbox'))
const bs = [...row.children].map(r)
const fits = row.scrollWidth <= row.clientWidth
const cs = getComputedStyle(row)
window.done = {{
  before, after: sc.scrollHeight - sc.scrollTop - sc.clientHeight,
  last: [last.top, last.bottom], view: [view.top, view.bottom], row: [rr.top, rr.bottom],
  first: [bs[0].left, bs[0].right], boxLeft: box.left, boxTop: box.top, rowLeft: rr.left, rowRight: rr.right,
  gaps: bs.slice(1).map((b, i) => b.left - bs[i].right), down: box.top - Math.max(...bs.map((b) => b.bottom)),
  scrollLeft: row.scrollLeft, fits, fl: cs.getPropertyValue('--fl').trim(), fr: cs.getPropertyValue('--fr').trim(),
  mask: cs.maskImage || cs.webkitMaskImage,
}}
</script></body></html>"""


def bundle():
    bun = shutil.which("bun")
    if not bun:
        return None
    out = subprocess.run([bun, "build", "--target=browser", "--format=esm", STICK], capture_output=True, text=True,
                         timeout=60)
    if out.returncode:
        return None
    return re.sub(r"export\s*\{[^}]*\};?", "", out.stdout)


def chat_rows():
    rows = []
    for i in range(14):
        mine = " mine" if i % 3 == 2 else ""
        rows.append(f'<div class="bw{mine}"><div class="bmv"><div class="b{mine}"><div class="md">Message {i}. {LONG if i % 4 == 0 else "Short one."}</div></div></div></div>')
    return "".join(rows)


class ReplyRow(unittest.TestCase):
    def test_rules(self):
        css = open(CSS[0], encoding="utf-8").read()
        # the row starts at the box's edge (its padding only makes room for a focus ring) and fades where more continues
        self.assertRegex(css, r"\.sugs\{[^}]*margin:0 -4px 4px[;}]")
        self.assertRegex(css, r"\.sugs\{[^}]*padding:4px[;}]")
        self.assertRegex(css, r"\.sugs\{[^}]*mask-image:linear-gradient\(to right,transparent,#000 var\(--fl\)")
        # the chat's bottom edge fades instead of slicing, and never over a terminal: a mask on what scrolls, leaving
        # the scroll bar's strip out, never a layer over it (#1499: a band one shade off, a dimmed scroll bar)
        self.assertIn(":is(.chat,.pane):has(>.foot>.cbox):not(:has(>.scroll>.msgs>.tw))>.scroll{", css)
        self.assertRegex(css, r"\.foot>\.cbox\):not[^{]*\{[^}]*mask:linear-gradient\(#000,#000\) right/var\(--sbw,0px\) 100% no-repeat,linear-gradient\(to bottom,#000 calc\(100% - 16px\),transparent\)")
        self.assertNotIn(":is(.chat,.pane)>.foot:has(>.cbox)::before{", css)
        client = open(os.path.join(ROOT, "web", "plugins", "chat", "client.tsx"), encoding="utf-8").read()
        self.assertIn("keepAtEnd(sc, box, () => stuck.current,", client)
        self.assertIn("rowEdges(row.current)", client)

    def test_row_has_its_own_space(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        bun = shutil.which("bun")
        stick = bundle()
        if not bun or stick is None:
            self.skipTest("no bun here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        rows = chat_rows()
        for w, h, tap in ((412, 760, " phone tap"), (880, 700, " tap"), (1280, 760, "")):
            for name, texts in SETS.items():
                with self.subTest(width=w, set=name), tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
                    page = os.path.join(d, "p.html")
                    with open(page, "w", encoding="utf-8") as f:
                        f.write(PAGE.format(css=css, w=w, h=h, tap=tap, rows=rows, stick=stick, texts=json.dumps(texts)))
                    out = subprocess.run([bun, os.path.join(ROOT, "test", "chrome_page.ts"), exe, "file://" + page, os.path.join(d, "u")],
                                         capture_output=True, text=True, timeout=90)
                    self.assertEqual(out.returncode, 0, out.stdout[-800:] + out.stderr[-800:])
                    res = json.loads(out.stdout.strip().splitlines()[-1])
                    # it was at its end, and stays there when the row comes
                    self.assertLess(res["before"], 1, res)
                    self.assertLess(res["after"], 1, res)
                    # the chat's window ends above the row, and the last message is fully inside it
                    self.assertLessEqual(res["view"][1], res["row"][0] + 0.5, res)
                    self.assertLessEqual(res["last"][1], res["view"][1] + 0.5, res)
                    self.assertLessEqual(res["last"][1], res["row"][0] + 0.5, res)
                    # the first bubble at the box's left edge, fully in view, the row at its start
                    self.assertEqual(res["scrollLeft"], 0, res)
                    self.assertAlmostEqual(res["first"][0], res["boxLeft"], delta=0.5, msg=res)
                    self.assertGreaterEqual(res["first"][0], res["rowLeft"], res)
                    # even gaps: 8 px between bubbles and down to the box
                    for g in res["gaps"]:
                        self.assertAlmostEqual(g, 8, delta=0.5, msg=res)
                    self.assertAlmostEqual(res["down"], 8, delta=0.5, msg=res)
                    # a fade only where more continues: never at the start, at the end when they don't fit
                    self.assertEqual(res["fl"], "0px", res)
                    self.assertEqual(res["fr"], "0px" if res["fits"] else "24px", res)
                    self.assertIn("linear-gradient", res["mask"], res)


if __name__ == "__main__":
    unittest.main()
