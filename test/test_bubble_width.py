"""A message bubble never runs past the chat column (the reactions and swipe-to-reply rework put each bubble in a
wrapper grid whose one auto column grew to a quoted reply's full one-line width, so the bubble, its quote and its
reaction chips ran past the column's right edge and were cut off there).

The layout check lays out the app's own stylesheets in a real headless Chrome (the one agent-browser keeps, or
$SHEPHERDR_TEST_CHROME) and measures a long quoted reply with a reaction in a narrow column, on both sides; it skips
where no Chrome is found. The rule check runs everywhere.
"""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import glob
import json
import os
import re
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = [os.path.join(ROOT, "web", "src", n) for n in ("ds.css", "styles.css")]
REAL_HOME = os.path.expanduser("~" + os.environ.get("USER", ""))


def chrome():
    if os.environ.get("SHEPHERDR_TEST_CHROME"):
        return os.environ["SHEPHERDR_TEST_CHROME"]
    found = sorted(glob.glob(os.path.join(REAL_HOME, ".agent-browser", "browsers", "chrome-*", "chrome")))
    return found[-1] if found else None


QUOTE = ("Dependency check started on its schedule in the shop space. It found three packages behind and is updating "
         "them now. Supercalifragilisticexpialidociouslylongwordwithoutanybreaksatall")


def bubble(mine, quote=True, text="Use /ui to fix"):
    side = " mine" if mine else ""
    q = f'<span class="quote">{QUOTE}</span>' if quote else ""
    return (f'<div class="bw{side}"><div class="bmv"><div class="b{side}" data-menu>{q}<div class="md">{text}</div></div>'
            f'<div class="rxs"><button class="rxc"><span class="e">👍</span></button></div></div></div>')


PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head><body>
<div class="chat"><div class="scroll" id="col" style="width:{w}px;padding-inline:16px"><div class="msgs">{rows}</div></div></div>
<pre id="out"></pre>
<script>
const col = document.getElementById('col'), c = col.getBoundingClientRect(), pad = 16, bad = []
for (const e of col.querySelectorAll('.b,.quote,.rxs,.rxc')) {{
  const r = e.getBoundingClientRect()
  if (r.right > c.right - pad + 0.5 || r.left < c.left + pad - 0.5) bad.push(e.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right))
}}
for (const q of col.querySelectorAll('.quote')) if (getComputedStyle(q).textOverflow !== 'ellipsis') bad.push('quote without ellipsis')
if (col.scrollWidth > col.clientWidth) bad.push('scrolls sideways ' + col.scrollWidth + '/' + col.clientWidth)
document.getElementById('out').textContent = 'RESULT' + JSON.stringify({{ col: [c.left, c.right], bad }}) + 'END'
</script></body></html>"""


class BubbleWidth(unittest.TestCase):
    def test_rules_bound_the_wrapper_column(self):
        css = open(CSS[0], encoding="utf-8").read()
        rule = lambda sel: (re.search(r"(?:^|\n|\})" + re.escape(sel) + r"\{([^}]*)\}", css) or [None, ""])[1]
        # one column that never grows past the wrapper's cap, for the wrapper and the part that slides
        self.assertIn("grid-template-columns:minmax(0,1fr)", rule(".bw"))
        self.assertIn("grid-template-columns:minmax(0,1fr)", rule(".bmv"))
        # the bubble and the chips stay inside it
        self.assertIn(".bw>.bmv>.b{max-width:100%}", css)
        self.assertIn("max-width:calc(100% - 16px)", rule(".rxs"))

    def test_long_quoted_reply_in_a_narrow_column_stays_inside(self):
        exe = chrome()
        if not exe or not os.access(exe, os.X_OK):
            self.skipTest("no headless Chrome here")
        css = "".join(open(p, encoding="utf-8").read() for p in CSS)
        rows = "".join([bubble(True), bubble(False), bubble(True, False), bubble(True, False, "x" * 200),
                        bubble(False, False, "https://example.com/" + "a" * 200)])
        for w in (320, 390, 700):
            with self.subTest(width=w), tempfile.TemporaryDirectory() as d:
                page = os.path.join(d, "p.html")
                with open(page, "w", encoding="utf-8") as f:
                    f.write(PAGE.format(css=css, w=w, rows=rows))
                out = subprocess.run([exe, "--headless=new", "--use-mock-keychain", "--password-store=basic", "--no-sandbox", "--disable-gpu", f"--user-data-dir={d}/u",
                                      "--window-size=1200,900", "--virtual-time-budget=2000", "--dump-dom", "file://" + page],
                                     capture_output=True, text=True, timeout=60).stdout
                m = re.search(r"RESULT(.*?)END", out)
                self.assertTrue(m, out[-500:])
                self.assertEqual(json.loads(m.group(1).replace("&quot;", '"'))["bad"], [])


if __name__ == "__main__":
    unittest.main()
