"""The reaction chip, measured in a real layout (3.2.3 drew it as a wide empty bar under the bubble).

It lays out the app's own stylesheets in a real headless Chrome (the one agent-browser keeps, or $SHEPHERDR_TEST_CHROME),
runs the plugin's own fit() (web/plugins/reactions/place.ts) and checks, on both sides, at phone, Fold, side-panel and
desktop widths, in one-line, long and image bubbles, with one chip and two: placed as Claude Duet places it, the chip
sits on the bubble's top corner that faces the middle of the chat (top right for the agent's, top left for yours),
straddling it: its middle on the top edge, about half past the side edge (less only where the column ends, never
outside it). It hugs its content, is 28 px tall and under 56 px wide for one emoji; more chips grow toward the middle in
one row; the message above stays clear of it, and a bubble without one keeps its normal spacing. It skips where no
Chrome is found.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import subprocess
import tempfile
import unittest

from test_bubble_width import CSS, chrome


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# the state classes the chip really carries (pending, just added), read from the component: 3.2.4's just-added chip
# carried "pop", the menu's class, and drew as a 200 px floating bar, which a chip with only "rxc" never showed
_SRC = open(os.path.join(ROOT, "web", "plugins", "reactions", "client.tsx"), encoding="utf-8").read()
STATES = re.findall(r"'([\w-]+)'", re.search(r"cx\('rxc',(.*?)\)\}", _SRC).group(1))
VARIANTS = [" ".join(v) for v in ([], *([x] for x in STATES), STATES)]


def row(mine, text, chips, img=False):
    """chips: (emoji, count) or (emoji, count, state classes, pressed)"""
    side = " mine" if mine else ""
    pic = '<img class="pic" style="display:block;width:240px;height:160px" alt="">' if img else ""
    btns = ""
    for i, c in enumerate(chips):
        e, n, cls, pressed = (*c, VARIANTS[i % len(VARIANTS)], i % 2 == 0)[:4] if len(c) == 2 else c
        btns += (f'<button type="button" class="rxc {cls}" aria-pressed="{str(pressed).lower()}"><span class="e">{e}</span>'
                 f'{f"<span class=n>{n}</span>" if n > 1 else ""}</button>')
    return (f'<div class="bw prev{side}"><div class="bmv"><div class="b{side}" data-menu><div class="md">above</div></div></div></div>'
            f'<div class="bw rx{side}"><div class="bmv"><div class="b{side}" data-menu>{pic}<div class="md">{text}</div></div>'
            f'<div class="rxs">{btns}</div></div></div>')


LONG = "A long message that wraps over several lines in the bubble, " * 6
ROWS = [row(m, t, c, i) for m in (True, False) for t, c, i in (
    ("ok", [("👍", 1)], False),
    ("Tab button seems incorrectly aligned or something - fix with /ui", [("🫡", 1)], False),
    (LONG, [("🎉", 2)], False),
    ("a photo", [("❤️", 1)], True),
    (LONG, [("👍", 1), ("👀", 1)], False),
    ("ok", [("👍", 1), ("🎉", 2)], False),
)]
# one chip alone in every state: settled, pending, just added (popping in), both; yours or the agent's; with a count
ROWS += [row(m, t, [(e, n, v, p)]) for m in (True, False) for t in ("ok", LONG) for e in ("👍", "🫡") for n in (1, 2)
         for v in VARIANTS for p in (True, False)]

PLACE = open(os.path.join(ROOT, "web", "plugins", "reactions", "place.ts"), encoding="utf-8").read()
PLACE_JS = re.sub(r"\((\w+): HTMLElement\)", r"(\1)", PLACE.replace("export function", "function"))

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="app{cls}"><div class="chat{pane}"><div class="scroll" id="col" style="width:{w}px;padding-inline:16px"><div class="msgs">{rows}</div></div></div></div>
<pre id="out"></pre>
<script>{place}</script>
<script>
const col = document.getElementById('col'), bad = [], seen = []
// during the pop: a just-added chip's laid-out size (its scale aside) is already a small pill, never a bar
for (const x of col.querySelectorAll('.rxc')) {{
  const s = getComputedStyle(x), tag = 'popping ' + x.className + ': '
  if (x.offsetWidth >= (x.children.length > 1 ? 72 : 56)) bad.push(tag + 'chip ' + x.offsetWidth + ' wide')
  if (x.offsetHeight !== 28) bad.push(tag + 'chip height ' + x.offsetHeight)
  if (s.position !== 'relative') bad.push(tag + 'chip is ' + s.position)
}}
document.getAnimations().forEach((a) => a.finish())
for (const x of col.querySelectorAll('.rxs')) fit(x)
const m = col.querySelector('.msgs'), ms = getComputedStyle(m), mr = m.getBoundingClientRect()
const lo = mr.left + parseFloat(ms.paddingLeft), hi = mr.right - parseFloat(ms.paddingRight)
for (const bw of col.querySelectorAll('.bw.prev')) if (parseFloat(getComputedStyle(bw).marginTop) !== 0) bad.push('a bubble without a reaction got extra room')
for (const bw of col.querySelectorAll('.bw.rx')) {{
  const mine = bw.classList.contains('mine'), b = bw.querySelector('.b').getBoundingClientRect()
  const chips = [...bw.querySelectorAll('.rxc')], rs = chips.map((x) => x.getBoundingClientRect())
  const above = bw.previousElementSibling.querySelector('.b').getBoundingClientRect(), tag = (mine ? 'mine ' : 'agent ') + Math.round(b.width) + ': '
  chips.forEach((x, i) => {{
    const r = rs[i], s = getComputedStyle(x)
    let inner = 0
    for (const k of x.children) inner += k.getBoundingClientRect().width
    inner += parseFloat(s.columnGap || 0) * (x.children.length - 1) + parseFloat(s.paddingLeft) + parseFloat(s.paddingRight)
    seen.push(Math.round(r.width))
    if (r.width > Math.max(inner, 34) + 1) bad.push(tag + 'chip ' + r.width + ' wider than its content ' + inner)
    if (Math.abs(r.height - 28) > 0.5) bad.push(tag + 'chip height ' + r.height)
    if (r.width >= (x.children.length > 1 ? 72 : 56)) bad.push(tag + x.className + ' chip ' + r.width + ' wide')
    if (s.position !== 'relative') bad.push(tag + x.className + ' chip is ' + s.position)
    // straddles the top edge: its middle on it
    if (Math.abs((r.top + r.bottom) / 2 - b.top) > 1) bad.push(tag + 'chip middle ' + (r.top + r.bottom) / 2 + ' off the top edge ' + b.top)
    if (r.left < lo - 0.5 || r.right > hi + 0.5) bad.push(tag + 'outside the column')
    if (r.top < above.bottom + 2) bad.push(tag + 'touches the message above')
    if (Math.abs(r.top - rs[0].top) > 0.5) bad.push(tag + 'chips not in one row')
  }})
  // the first chip sits on the corner facing the middle: the agent's top right, yours top left, half past the side
  const r = rs[0], edge = mine ? b.left : b.right, past = mine ? edge - r.left : r.right - edge
  // where the column ends, the row moves in just enough: then its far chip touches the column's edge
  const clamped = mine ? Math.min(...rs.map((x) => x.left)) <= lo + 0.5 : Math.max(...rs.map((x) => x.right)) >= hi - 0.5
  if (!clamped && !(r.left < edge && edge < r.right)) bad.push(tag + 'not on the ' + (mine ? 'left' : 'right') + ' corner')
  if (!clamped && Math.abs(past - r.width / 2) > 1) bad.push(tag + 'hangs ' + past + ' past the side, not half of ' + r.width)
  if (mine ? r.right > b.right : r.left < b.left) bad.push(tag + 'off the bubble')
  // more grow toward the middle
  for (let i = 1; i < rs.length; i++) if (mine ? rs[i].right > rs[i - 1].left + 0.5 : rs[i].left < rs[i - 1].right - 0.5) bad.push(tag + 'chip ' + i + ' not toward the middle')
}}
if (col.scrollWidth > col.clientWidth) bad.push('scrolls sideways')
document.getElementById('out').textContent = 'RESULT' + JSON.stringify({{ bad, seen }}) + 'END'
</script></body></html>"""


class ReactionChip(unittest.TestCase):
    def test_chip_hugs_its_emoji_and_straddles_the_top_corner_facing_the_middle(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        # phone, a Fold's side-panel column and open width, desktop, a task's side panel (bubbles up to 92%, so the
        # chip has to move in); mouse and finger sizes
        for w, cls, pane in ((358, " phone tap", ""), (420, " tap", ""), (727, " tap", ""), (1180, "", ""), (340, " tap", " pane")):
            with self.subTest(width=w, cls=cls, pane=pane), tempfile.TemporaryDirectory() as d:
                page = os.path.join(d, "p.html")
                with open(page, "w", encoding="utf-8") as f:
                    f.write(PAGE.format(css=css, w=w, cls=cls, pane=pane, place=PLACE_JS, rows="".join(ROWS)))
                out = subprocess.run([exe, "--headless=new", "--use-mock-keychain", "--password-store=basic", "--no-sandbox", "--disable-gpu", f"--user-data-dir={d}/u",
                                      "--window-size=1300,4000", "--virtual-time-budget=2000", "--dump-dom", "file://" + page],
                                     capture_output=True, text=True, timeout=60).stdout
                m = re.search(r"RESULT(.*?)END", out)
                self.assertTrue(m, out[-500:])
                got = json.loads(m.group(1).replace("&quot;", '"'))
                self.assertEqual(got["bad"], [])
                # a lone emoji's chip is a small pill, never a bar
                self.assertLessEqual(min(got["seen"]), 36)
                self.assertLess(max(got["seen"]), 72)


if __name__ == "__main__":
    unittest.main()
