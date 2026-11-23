"""The reaction chip, measured in a real layout (3.2.3 drew it as a wide empty bar under the bubble).

The earlier tests only matched class names and CSS strings, so they passed while the chip looked wrong: none laid the
chip out and measured it. This one lays out the app's own stylesheets in a real headless Chrome (the one agent-browser
keeps, or $SHEPHERDR_TEST_CHROME) and checks, on both sides, at phone, Fold and desktop widths, in one-line, long and
image bubbles, with one chip and several: the chip's width is its content's (emoji, count, padding), it is 28 px tall,
it overlaps the bubble's bottom edge by about a third, it sits 8 px in from the bubble's own corner (right for yours,
left for the agent's), the next row starts below it, and nothing leaves the column. It skips where no Chrome is found.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import subprocess
import tempfile
import unittest

from test_bubble_width import CSS, chrome


def row(mine, text, chips, img=False):
    side = " mine" if mine else ""
    pic = '<img class="pic" style="display:block;width:240px;height:160px" alt="">' if img else ""
    btns = "".join(f'<button class="rxc"><span class="e">{e}</span>{f"<span class=n>{n}</span>" if n > 1 else ""}</button>'
                   for e, n in chips)
    return (f'<div class="bw{side}"><div class="bmv"><div class="b{side}" data-menu>{pic}<div class="md">{text}</div></div>'
            f'<div class="rxs">{btns}</div></div></div><div class="b next">next</div>')


LONG = "A long message that wraps over several lines in the bubble, " * 6
ROWS = [row(m, t, c, i) for m in (True, False) for t, c, i in (
    ("ok", [("👍", 1)], False),
    ("Tab button seems incorrectly aligned or something - fix with /ui", [("🫡", 1)], False),
    (LONG, [("🎉", 2)], False),
    ("a photo", [("❤️", 1)], True),
    (LONG, [("👍", 1), ("👀", 1), ("🎉", 2)], False),
)]

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="app{cls}"><div class="chat"><div class="scroll" id="col" style="width:{w}px;padding-inline:16px"><div class="msgs">{rows}</div></div></div></div>
<pre id="out"></pre>
<script>
const col = document.getElementById('col'), c = col.getBoundingClientRect(), bad = [], seen = []
for (const bw of col.querySelectorAll('.bw')) {{
  const mine = bw.classList.contains('mine'), b = bw.querySelector('.b').getBoundingClientRect()
  const rxs = bw.querySelector('.rxs').getBoundingClientRect(), chips = [...bw.querySelectorAll('.rxc')]
  const next = bw.nextElementSibling.getBoundingClientRect(), tag = (mine ? 'mine ' : 'agent ') + Math.round(b.width) + ': '
  for (const x of chips) {{
    const r = x.getBoundingClientRect(), s = getComputedStyle(x)
    let inner = 0
    for (const k of x.children) inner += k.getBoundingClientRect().width
    inner += parseFloat(s.columnGap || 0) * (x.children.length - 1) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight)
    seen.push(Math.round(r.width))
    if (r.width > Math.max(inner, 28) + 1) bad.push(tag + 'chip ' + r.width + ' wider than its content ' + inner)
    if (Math.abs(r.height - 28) > 0.5) bad.push(tag + 'chip height ' + r.height)
    const tuck = b.bottom - r.top
    if (tuck < 7 || tuck > 12) bad.push(tag + 'overlap ' + tuck)
    if (r.left < c.left + 16 - 0.5 || r.right > c.right - 16 + 0.5) bad.push(tag + 'outside the column')
  }}
  const inset = mine ? b.right - rxs.right : rxs.left - b.left
  if (Math.abs(inset - 8) > 0.5) bad.push(tag + 'inset from the corner ' + inset)
  if (next.top < rxs.bottom) bad.push(tag + 'next row overlaps the chips')
  if (chips.length > 1 && new Set(chips.map((x) => Math.round(x.getBoundingClientRect().top))).size !== 1 && rxs.width < b.width - 16) bad.push(tag + 'chips not in one row')
}}
if (col.scrollWidth > col.clientWidth) bad.push('scrolls sideways')
document.getElementById('out').textContent = 'RESULT' + JSON.stringify({{ bad, seen }}) + 'END'
</script></body></html>"""


class ReactionChip(unittest.TestCase):
    def test_chip_hugs_its_emoji_and_tucks_onto_the_bubble_corner(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        # phone, a Fold's side-panel column and open width, desktop; mouse and finger sizes
        for w, cls in ((358, " phone tap"), (420, " tap"), (727, " tap"), (1180, "")):
            with self.subTest(width=w, cls=cls), tempfile.TemporaryDirectory() as d:
                page = os.path.join(d, "p.html")
                with open(page, "w", encoding="utf-8") as f:
                    f.write(PAGE.format(css=css, w=w, cls=cls, rows="".join(ROWS)))
                out = subprocess.run([exe, "--headless=new", "--use-mock-keychain", "--password-store=basic", "--no-sandbox", "--disable-gpu", f"--user-data-dir={d}/u",
                                      "--window-size=1300,4000", "--virtual-time-budget=2000", "--dump-dom", "file://" + page],
                                     capture_output=True, text=True, timeout=60).stdout
                m = re.search(r"RESULT(.*?)END", out)
                self.assertTrue(m, out[-500:])
                got = json.loads(m.group(1).replace("&quot;", '"'))
                self.assertEqual(got["bad"], [])
                # a lone emoji's chip is a small pill, never a bar
                self.assertLessEqual(min(got["seen"]), 36)


if __name__ == "__main__":
    unittest.main()
