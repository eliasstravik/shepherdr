"""The chat's rows keep one rhythm and one left edge (a bubble used to sit almost on a task's "Done and merged" row,
that row started its icon and words at another edge than "Ran a command", and it floated far above the message box).

The layout check lays out the app's own stylesheets in a real headless Chrome (the one agent-browser keeps, or
$SHEPHERDR_TEST_CHROME) with every row type in a row, on a desktop and on touch, and measures: every row's icon at the
chat's edge and its words in one column; 12 px between any two things that differ (from a bubble or card to a row's
words, and back), and on touch, where a row is 44 px tall, 20 px from a row's words and 28 between two rows; 12 px
from the last one to the end of the list. It skips where no Chrome is found.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import subprocess
import tempfile
import unittest

from test_bubble_width import CSS, chrome

ICON = '<svg class="i s16" viewBox="0 0 16 16"></svg>'


def bubble(mine=False, gap=False, text="A message"):
    cls = " ".join(x for x in ("bw", "mine" if mine else "", "gap" if gap else "") if x)
    return f'<div class="{cls}"><div class="bmv"><div class="b{" mine" if mine else ""}"><div class="md">{text}</div></div></div></div>'


ROWS = {
    "command": f'<button class="fold">{ICON}Ran a command</button>',
    "status": f'<div class="donerow">{ICON}Done and merged · Fix cart rounding</div>',
    "task": f'<button class="ref"><span class="tring t-ready tside"><svg class="i c-own" viewBox="0 0 20 20"></svg></span>Fix cart rounding</button>',
    "relay": f'<div class="fold quiet relay">{ICON}<span class="ql">Message to #shop<span class="qm">9:20</span></span></div>',
    "news": f'<button class="fold quiet news">{ICON}<span class="ql">Needs you</span><svg class="i s16 qv"></svg></button>',
}
CARD = '<div class="card"><span class="t">Fix cart rounding</span><span>Ready for you to look at.</span></div>'
SIGN = '<div class="wsign"><span class="b wbub"><span class="wdots"><i></i><i></i><i></i></span></span></div>'

# every row type after a bubble and before one, cards among them, a run of rows, and a row last (the reported spot);
# then the working sign, always the chat's last thing, after a row and after your bubble
SEQS = [[bubble(), ROWS["command"], bubble(), ROWS["status"], bubble(True, True), ROWS["task"], CARD, bubble(),
         ROWS["relay"], ROWS["news"], bubble(True, True), CARD, ROWS["status"], bubble(), ROWS["status"]],
        [bubble(), ROWS["command"], SIGN], [bubble(), bubble(True, True), SIGN]]

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}*{{animation:none!important}}</style></head><body>
<div class="app {mode}"><div class="chat"><div class="scroll" id="col" style="width:{w}px"><div class="msgs">{rows}<div class="mend"></div></div></div></div></div>
<pre id="out"></pre>
<script>
const isRow = (e) => e.matches('.fold,.ref,.donerow')
// a row's words: its box less its own air; a bubble, card or sign: its box
const box = (e) => {{ const r = e.getBoundingClientRect(), s = getComputedStyle(e); return isRow(e) ? {{ top: r.top + parseFloat(s.paddingTop), bottom: r.bottom - parseFloat(s.paddingBottom) }} : r }}
const items = [...document.querySelectorAll('.msgs>*:not(.mend)')]
const gaps = [], icons = [], words = []
for (let i = 1; i < items.length; i++) {{
  const a = items[i - 1], b = items[i]
  const same = a.matches('.bw') && b.matches('.bw') && !b.matches('.gap')
  if (!same) gaps.push([a.className + ' > ' + b.className, Math.round(box(b).top - box(a).bottom)])
}}
for (const e of items.filter(isRow)) {{
  icons.push(Math.round(e.querySelector('svg').getBoundingClientRect().left))
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n
  while ((n = w.nextNode())) if (n.textContent.trim()) {{ const g = document.createRange(); g.selectNodeContents(n); words.push(Math.round(g.getBoundingClientRect().left)); break }}
}}
const m = document.querySelector('.msgs'), end = Math.round(m.getBoundingClientRect().bottom - box(items.at(-1)).bottom)
const col = Math.round(m.getBoundingClientRect().left + parseFloat(getComputedStyle(m).paddingLeft))
document.getElementById('out').textContent = 'RESULT' + JSON.stringify({{ gaps, icons, words, end, col }}) + 'END'
</script></body></html>"""


class ChatRhythm(unittest.TestCase):
    def test_one_rhythm_and_one_left_edge(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        for (mode, w), seq in ((m, q) for m in (("", 720), ("tap", 390), ("tap phone", 360)) for q in SEQS):
            with self.subTest(mode=mode or "desktop", width=w, last=seq[-1][:24]), tempfile.TemporaryDirectory() as d:
                page = os.path.join(d, "p.html")
                with open(page, "w", encoding="utf-8") as f:
                    f.write(PAGE.format(css=css, w=w, mode=mode, rows="".join(seq)))
                out = subprocess.run([exe, "--headless=new", "--use-mock-keychain", "--password-store=basic", "--no-sandbox", "--disable-gpu", f"--user-data-dir={d}/u",
                                      "--window-size=1200,1600", "--virtual-time-budget=3000", "--dump-dom", "file://" + page],
                                     capture_output=True, text=True, timeout=60).stdout
                m = re.search(r"RESULT(.*?)END", out)
                self.assertTrue(m, out[-500:])
                r = json.loads(m.group(1).replace("&quot;", '"').replace("&gt;", ">"))
                # on touch a row is itself 44 px tall (a finger's target), so its words sit further from what's
                # around it: 20 px to a bubble, card or sign, 28 px to the next row; on a desktop 12 everywhere
                def want(pair):
                    rows = sum(bool(re.match(r"(fold|ref|donerow)\b", x.strip())) for x in pair.split(" > "))
                    return (12, 20, 28)[rows] if "tap" in mode else 12
                self.assertEqual([g for g in r["gaps"] if g[1] != want(g[0])], [], r["gaps"])
                self.assertLessEqual(set(r["icons"]), {r["col"]})
                self.assertLessEqual(set(r["words"]), {r["col"] + 24})
                self.assertEqual(r["end"], 12)


if __name__ == "__main__":
    unittest.main()
