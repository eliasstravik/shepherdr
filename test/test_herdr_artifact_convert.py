"""herdr-artifact convert (Shepherdr 3.2): once per machine, every artifact 3.1 kept becomes a page. A recipe (every
kept version of it) is drawn as a plain index.html with its pictures beside it; a custom window panel becomes a page
showing the picture the window last took, or a line saying what it was. Ids, titles, versions, times and tasks stay,
what a version was is kept out of the page (.old/), and a second run changes nothing."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
loader = importlib.machinery.SourceFileLoader("herdr_artifact_convert_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))
spec = importlib.util.spec_from_loader(loader.name, loader)
A = importlib.util.module_from_spec(spec)
loader.exec_module(A)

RECIPE = {"recipe": 1, "cover": "after.png", "blocks": [
    {"type": "heading", "text": "Coverage", "level": 1},
    {"type": "text", "md": "**92%** of lines, up from 81%. See [the run](https://ci.example.test/1?a=1&b=2).\n\n- one\n- two with `code`\n\n```\nnpm test <all>\n```"},
    {"type": "list", "items": ["first *item*", "second"], "ordered": True},
    {"type": "table", "columns": ["Package", {"label": "Coverage", "align": "right"}], "rows": [["api", "88%"], ["web <b>", "**95%**"]]},
    {"type": "chart", "kind": "bar", "labels": ["Mon", "Tue"], "series": [{"name": "Runs", "values": [3, 5]}, {"name": "Fails", "values": [1]}]},
    {"type": "stats", "items": [{"label": "Lines", "value": "92%", "note": "+11"}, {"label": "Files", "value": "148"}]},
    {"type": "image", "src": "after.png", "caption": "The new chart"},
    {"type": "image", "src": "../../secret.png", "caption": "Not beside it"},
    {"type": "video", "src": "flow.mp4", "poster": "after.png", "caption": "The flow", "loop": True, "muted": True},
    {"type": "audio", "src": "note.mp3"},
    {"type": "pdf", "src": "spec.pdf", "caption": "The spec"},
    {"type": "pair", "before": {"src": "before.png", "caption": "Old"}, "after": {"src": "after.png", "caption": "New"}},
    {"type": "code", "text": "$ make\n<ok>", "lang": "sh"},
    {"type": "callout", "tone": "warn", "title": "Careful", "md": "Not on *Windows*."},
    {"type": "columns", "columns": [[{"type": "text", "md": "Left side"}], [{"type": "text", "md": "Right side"}]]},
    {"type": "tabs", "tabs": [{"label": "Details tab", "blocks": [{"type": "text", "md": "Inside the tab"}]}]},
    {"type": "details", "summary": "More", "blocks": [{"type": "text", "md": "Folded words"}]},
    {"type": "divider"},
    {"type": "choice", "question": "Ship it?", "options": [{"label": "Ship", "description": "merge today"}, {"label": "Wait"}]},
    {"type": "form", "fields": [{"name": "who", "label": "Who", "kind": "select", "options": ["Ann", "Bo"], "value": "Bo"},
                                {"name": "ok", "label": "Agree", "kind": "checkbox", "value": True}], "submit": "Send it"},
    {"type": "button", "label": "Looks good", "reply": "Looks good."},
    {"type": "buttons", "items": [{"label": "Yes", "reply": "y"}, {"label": "Docs", "href": "https://docs.example.test/"}]},
    {"type": "nonsense"}, "not a block"]}


class Convert(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-artifact-convert-")
        self.store = os.path.join(self.dir, "store")
        self.files = os.path.join(self.store, "files")
        os.makedirs(self.files)
        self.patches = [mock.patch.object(A, "STORE", self.store), mock.patch.object(A, "FILES", self.files),
                        mock.patch.dict(os.environ, {"HERDR_ARTIFACT_CHROME": ""})]
        for p in self.patches:
            p.start()
        # what 3.1 left: a recipe with two kept versions (a task's proof), a custom panel with the window's picture,
        # one without, and a page 3.2 already made
        self.put("cov-1a2b", 1, {"recipe.json": json.dumps({"recipe": 1, "blocks": [{"type": "text", "md": "First try"}]})})
        self.put("cov-1a2b", 2, {"recipe.json": json.dumps(RECIPE), "after.png": "png", "before.png": "png", "flow.mp4": "mp4", "note.mp3": "mp3", "spec.pdf": "pdf"})
        self.put("game-3c4d", 1, {"main.js": "export default class X {}", "artifact.js": "x", "lib/util.js": "y", ".window.png": "PNGDATA"})
        self.put("tool-5e6f", 1, {"main.js": "export default class Y {}", "recipe.json": "{}"})
        self.put("page-7a8b", 1, {"index.html": "<h1>Already a page</h1>"})
        self.arts = [
            {"id": "cov-1a2b", "title": "SHOP-4: Coverage <report> · Proof", "version": 2, "folder": "/srv/shop", "publisher": "t4", "task": "SHOP-4", "at": 2000,
             "created": 1000, "files": ["after.png", "recipe.json"], "pinned": True,
             "versions": [{"v": 1, "at": 1000, "publisher": "t4", "kind": "recipe"}, {"v": 2, "at": 2000, "publisher": "t4", "kind": "recipe", "note": "the chart"}]},
            {"id": "game-3c4d", "title": "Tic-tac-toe", "version": 1, "folder": "/srv/shop", "publisher": "t5", "task": None, "at": 1500, "created": 1500,
             "files": ["artifact.js", "lib/util.js", "main.js"], "versions": [{"v": 1, "at": 1500, "publisher": "t5", "kind": "custom", "picture": 1600}]},
            {"id": "tool-5e6f", "title": "Live tool", "version": 1, "folder": "/srv/shop", "publisher": None, "task": None, "at": 1200, "created": 1200,
             "files": ["main.js"], "versions": [{"v": 1, "at": 1200}]},
            {"id": "page-7a8b", "title": "A page", "version": 1, "folder": "/srv/shop", "publisher": "t6", "task": None, "at": 3000, "created": 3000,
             "files": ["index.html"], "versions": [{"v": 1, "at": 3000, "publisher": "t6"}]}]
        self.list = os.path.join(self.store, "srv-shop.json")
        with open(self.list, "w") as f:
            json.dump({"version": 1, "folder": "/srv/shop", "kind": "folder", "name": "shop", "slug": "srv-shop", "artifacts": self.arts}, f)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def put(self, aid, v, files):
        for rel, text in files.items():
            p = os.path.join(self.files, aid, f"v{v}", rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as f:
                f.write(text)

    def convert(self, **k):
        out = io.StringIO()
        with redirect_stdout(out):
            code = A.cmd_convert(types.SimpleNamespace(**{"json": True, "id": None, "all": True, "pictures": False, **k}))
        return code, json.loads(out.getvalue().strip().splitlines()[-1])

    def read(self, aid, v, rel="index.html"):
        with open(os.path.join(self.files, aid, f"v{v}", rel)) as f:
            return f.read()

    def text(self):
        with open(self.list) as f:
            return f.read()

    def records(self):
        with open(self.list) as f:
            return {a["id"]: a for a in json.load(f)["artifacts"]}

    def test_a_recipe_becomes_a_readable_page_every_kept_version(self):
        code, out = self.convert()
        self.assertEqual(code, 0)
        self.assertEqual({x["id"]: (x["versions"], x["was"]) for x in out["converted"]},
                         {"cov-1a2b": ([1, 2], ["recipe"]), "game-3c4d": ([1], ["custom"]), "tool-5e6f": ([1], ["custom"])})
        self.assertIn("First try", self.read("cov-1a2b", 1))
        page = self.read("cov-1a2b", 2)
        self.assertTrue(page.startswith("<!doctype html>"))
        for want in ("<title>SHOP-4: Coverage &lt;report&gt; · Proof</title>", "color-scheme: light dark", '<meta name="viewport"',
                     "<h1>SHOP-4: Coverage &lt;report&gt; · Proof</h1>", "<h2>Coverage</h2>",
                     "<strong>92%</strong> of lines", '<a href="https://ci.example.test/1?a=1&amp;b=2" target="_blank" rel="noopener">the run</a>',
                     "<ul><li>one</li><li>two with <code>code</code></li></ul>", "<pre><code>npm test &lt;all&gt;</code></pre>",
                     "<ol><li>first <em>item</em></li><li>second</li></ol>",
                     '<th>Package</th><th class="right">Coverage</th>', '<td>web &lt;b&gt;</td><td class="right"><strong>95%</strong></td>',
                     '<tr><td>Mon</td><td class="right">3</td><td class="right">1</td></tr>', '<tr><td>Tue</td><td class="right">5</td><td class="right"></td></tr>',
                     '<b>92%</b>Lines <span class="muted">+11</span>',
                     '<figure><img src="after.png" alt="The new chart"><figcaption>The new chart</figcaption></figure>',
                     '<video controls playsinline preload="metadata" src="flow.mp4" loop muted poster="after.png"></video><figcaption>The flow</figcaption>',
                     '<audio controls preload="metadata" src="note.mp3"></audio>', '<a href="spec.pdf" target="_blank" rel="noopener">The spec</a> (PDF)',
                     '<img src="before.png" alt="Old"><figcaption>Before · Old</figcaption>', "<figcaption>After · New</figcaption>",
                     "<pre><code>$ make\n&lt;ok&gt;</code></pre>", '<div class="note warn"><p><strong>Careful</strong></p><p>Not on <em>Windows</em>.</p></div>',
                     "Left side", "Right side", "<h3>Details tab</h3>", "Inside the tab", "<details><summary>More</summary><p>Folded words</p></details>", "<hr>",
                     "<p><strong>Ship it?</strong></p><ul><li>Ship: <span class=\"muted\">merge today</span></li><li>Wait</li></ul>",
                     '<li>Who: <span class="muted">Ann, Bo · Bo</span></li>', '<li>Agree: <span class="muted">yes</span></li>', "[Send it]", "[Looks good]",
                     '[Yes] [Docs] <a href="https://docs.example.test/"'):
            self.assertIn(want, page)
        # nothing it would have to run or fetch from elsewhere, and no path out of its folder
        for never in ("<script", "secret.png\"", 'src="../', "not a block", "nonsense"):
            self.assertNotIn(never, page)
        self.assertIn("Not beside it (../../secret.png: not kept)", page)
        # its pictures stay beside the page; what it was is kept, out of the page
        self.assertEqual(sorted(os.listdir(os.path.join(self.files, "cov-1a2b", "v2"))),
                         [".old", "after.png", "before.png", "flow.mp4", "index.html", "note.mp3", "spec.pdf"])
        self.assertEqual(json.loads(self.read("cov-1a2b", 2, ".old/recipe.json")), RECIPE)

    def test_a_custom_panel_shows_the_windows_picture_or_says_what_it_was(self):
        self.convert()
        game = self.read("game-3c4d", 1)
        self.assertIn("<h1>Tic-tac-toe</h1>", game)
        self.assertIn('<img src="window.png" alt="Tic-tac-toe">', game)
        self.assertEqual(self.read("game-3c4d", 1, "window.png"), "PNGDATA")
        self.assertEqual(sorted(os.listdir(os.path.join(self.files, "game-3c4d", "v1"))), [".old", ".window.png", "index.html", "window.png"])
        self.assertEqual(sorted(os.listdir(os.path.join(self.files, "game-3c4d", "v1", ".old"))), ["artifact.js", "lib", "main.js"])
        tool = self.read("tool-5e6f", 1)
        self.assertIn("<h1>Live tool</h1>", tool)
        self.assertIn("made for the old Herdr window", tool)
        self.assertNotIn("<img", tool)

    def test_ids_titles_versions_times_and_tasks_stay(self):
        before = {a["id"]: a for a in self.arts}
        self.convert()
        after = self.records()
        self.assertEqual(list(after), list(before))  # the same order
        for aid, a in after.items():
            for k in ("id", "title", "version", "folder", "publisher", "task", "at", "created"):
                self.assertEqual(a[k], before[aid][k], (aid, k))
            self.assertEqual([(x["v"], x["at"], x.get("publisher"), x.get("note")) for x in a["versions"]],
                             [(x["v"], x["at"], x.get("publisher"), x.get("note")) for x in before[aid]["versions"]])
            self.assertFalse(any("kind" in x or "picture" in x for x in a["versions"]), aid)
        self.assertTrue(after["cov-1a2b"]["pinned"])
        # a task's proof by its title stays on its task (not in Artifacts); the others are artifacts as before
        self.assertEqual({k: bool(v.get("proof")) for k, v in after.items()}, {"cov-1a2b": True, "game-3c4d": False, "tool-5e6f": False, "page-7a8b": False})
        self.assertEqual(after["cov-1a2b"]["files"], ["after.png", "before.png", "flow.mp4", "index.html", "note.mp3", "spec.pdf"])
        self.assertEqual(after["game-3c4d"]["files"], ["index.html", "window.png"])
        self.assertEqual([x["was"] for x in after["cov-1a2b"]["versions"]], ["recipe", "recipe"])
        self.assertEqual(after["game-3c4d"]["versions"][0]["was"], "custom")
        self.assertEqual(after["page-7a8b"], before["page-7a8b"])
        self.assertEqual(self.read("page-7a8b", 1), "<h1>Already a page</h1>")

    def test_a_second_run_changes_nothing(self):
        self.convert()
        first = self.text()
        page = self.read("cov-1a2b", 2)
        self.assertTrue(os.path.isfile(os.path.join(self.store, ".pages")))
        code, out = self.convert()
        self.assertEqual((code, out), (0, {"converted": [], "done": True}))
        # asked for by id (the mark doesn't stop that): still nothing to do, nothing rewritten
        code, out = self.convert(id="cov-1a2b")
        self.assertEqual((code, out), (0, {"converted": [], "failed": []}))
        os.remove(os.path.join(self.store, ".pages"))
        code, out = self.convert()
        self.assertEqual((code, out), (0, {"converted": [], "failed": []}))
        self.assertEqual(self.text(), first)
        self.assertEqual(self.read("cov-1a2b", 2), page)

    def test_nothing_kept_is_nothing_to_do(self):
        shutil.rmtree(self.store)
        self.assertEqual(self.convert(), (0, {"converted": [], "failed": []}))
        os.makedirs(self.store)
        self.assertEqual(self.convert(), (0, {"converted": [], "failed": []}))
        self.assertEqual(self.convert(), (0, {"converted": [], "done": True}))

    def test_one_stopped_half_way_is_finished_by_the_next_run(self):
        # its recipe already moved aside, no page written yet
        d = os.path.join(self.files, "cov-1a2b", "v1")
        os.makedirs(os.path.join(d, ".old"))
        os.replace(os.path.join(d, "recipe.json"), os.path.join(d, ".old", "recipe.json"))
        self.convert()
        self.assertIn("First try", self.read("cov-1a2b", 1))

    def test_a_converted_page_gets_its_picture_when_a_browser_is_here(self):
        seen = []

        def fake(folder):
            seen.append(folder)
            tmp = tempfile.mkdtemp(dir=self.dir)
            out = {"dir": tmp, A.THUMB: os.path.join(tmp, A.THUMB)}
            A.png_write(out[A.THUMB], 2, 2, 3, [bytearray(6), bytearray(6)])
            return out
        with mock.patch.object(A, "shoot", fake):
            self.convert(pictures=True)
        self.assertEqual(len(seen), 3)  # each converted artifact's newest version, never the page that was one already
        after = self.records()
        self.assertEqual([bool(x.get("thumb")) for x in after["cov-1a2b"]["versions"]], [False, True])
        self.assertTrue(os.path.isfile(os.path.join(self.files, "cov-1a2b", "v2", ".thumb.png")))
        self.assertNotIn(".thumb.png", after["cov-1a2b"]["files"])

    def test_pictures_fills_in_the_ones_missing_later(self):
        def fake(folder):
            tmp = tempfile.mkdtemp(dir=self.dir)
            out = {"dir": tmp, A.THUMB: os.path.join(tmp, A.THUMB)}
            A.png_write(out[A.THUMB], 2, 2, 3, [bytearray(6), bytearray(6)])
            return out

        def pictures():
            out = io.StringIO()
            with redirect_stdout(out):
                A.cmd_pictures(types.SimpleNamespace(json=True, id=None, all=True))
            return json.loads(out.getvalue())
        self.convert()  # fast: no pictures
        self.assertFalse(any(x.get("thumb") for a in self.records().values() for x in a["versions"]))
        self.assertEqual(pictures(), {"taken": [], "browser": False})
        with mock.patch.object(A, "shoot", fake), mock.patch.object(A, "chrome_bin", lambda: "/a/chrome"):
            self.assertEqual(pictures()["taken"], ["cov-1a2b", "game-3c4d", "page-7a8b", "tool-5e6f"])
            self.assertEqual(pictures()["taken"], [])  # each has its picture now
        after = self.records()
        self.assertEqual([bool(x.get("thumb")) for x in after["cov-1a2b"]["versions"]], [False, True])
        self.assertTrue(all(a["versions"][-1]["thumb"] for a in after.values()))

    def test_a_converted_page_is_listed_and_updated_like_any_other(self):
        self.convert()
        out = io.StringIO()
        with redirect_stdout(out):
            A.cmd_list(types.SimpleNamespace(all=True, json=True, folder=None))
        arts = {a["id"]: a for a in json.loads(out.getvalue())["artifacts"]}
        self.assertEqual((arts["cov-1a2b"]["version"], arts["cov-1a2b"]["pinned"], arts["cov-1a2b"]["task"]), (2, True, "SHOP-4"))
        self.assertEqual(A.page_file(os.path.join(self.files, "cov-1a2b", "v2"), ".old/recipe.json"), None)
        self.assertTrue(A.page_file(os.path.join(self.files, "cov-1a2b", "v2"), "").endswith("/v2/index.html"))


if __name__ == "__main__":
    unittest.main()
