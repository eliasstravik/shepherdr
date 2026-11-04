"""herdr-artifact (SHEP-19): recipes are the default, a custom panel needs --custom and is never a proof, each version
says its kind, the window's picture of a custom one is kept for the web, and convert keeps an artifact's maker. Runs in
a throwaway store; herdr-app's check is skipped (not found), and nothing is installed."""
import importlib.machinery
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


A = load("herdr_artifact_recipes_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))

PANEL = 'import { View, div } from "gpui-kit";\nexport default class X extends View { render() { return div().child("hi"); } }\n'


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-artifact-")
        store = os.path.join(self.dir, "store")
        self.folder = os.path.join(self.dir, "proj")
        os.makedirs(self.folder)
        self.patches = [mock.patch.object(A, "STORE", store), mock.patch.object(A, "FILES", os.path.join(store, "files")),
                        mock.patch.object(A, "NOTES", os.path.join(store, "notes")),
                        mock.patch.object(A, "APP", os.path.join(self.dir, "app")),
                        mock.patch.object(A.shutil, "which", return_value=None),
                        mock.patch.object(A, "me", return_value={"terminal": "t9", "task": None})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def ns(self, **k):
        base = dict(id=None, title=None, folder=self.folder, task=None, note=None, json=True, custom=False)
        return types.SimpleNamespace(**{**base, **k})

    def publish(self, d, **k):
        with mock.patch("sys.stdout"):
            A.cmd_publish(self.ns(dir=d, **k))

    def record(self, aid):
        with A.Store(A.find_anywhere(aid), write=False) as s:
            return s.find(aid)

    def panel(self, name="panel"):
        d = os.path.join(self.dir, name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "main.js"), "w") as f:
            f.write(PANEL)
        return d

    def only(self):
        with A.Store(A.locate(self.folder), write=False) as s:
            return s.data["artifacts"]

    def test_new_writes_a_recipe_that_publishes(self):
        d = os.path.join(self.dir, "report")
        with mock.patch("sys.stdout"):
            A.cmd_new(types.SimpleNamespace(dir=d, custom=False))
        self.assertEqual(os.listdir(d), ["recipe.json"])
        self.assertEqual(A.recipe_problems(d, ["recipe.json"]), [])
        self.publish(d, title="Coverage")
        a = self.only()[0]
        self.assertEqual(a["files"], ["recipe.json"])
        self.assertEqual(a["versions"][-1]["kind"], "recipe")

    def test_a_custom_panel_needs_custom(self):
        d = self.panel()
        with self.assertRaisesRegex(A.Fail, "recipe"):
            self.publish(d, title="Board")
        self.assertEqual(self.only(), [])
        self.publish(d, title="Tic-tac-toe", custom=True)
        self.assertEqual(self.only()[0]["versions"][-1]["kind"], "custom")

    def test_a_proof_is_never_a_custom_panel(self):
        with self.assertRaisesRegex(A.Fail, "proof is always a recipe"):
            self.publish(self.panel(), title="SHEP-1: Fix it · Proof", custom=True)
        self.assertEqual(self.only(), [])

    def test_the_windows_picture_is_kept_beside_a_custom_version(self):
        self.publish(self.panel(), title="Game", custom=True)
        aid = self.only()[0]["id"]
        pic = os.path.join(self.dir, "shot.png")
        with open(pic, "wb") as f:
            f.write(b"\x89PNG")
        with mock.patch("sys.stdout"):
            A.cmd_picture(types.SimpleNamespace(id=aid, version=1, shot=None, panel=None, image=pic, machine=None, json=True))
        self.assertTrue(os.path.isfile(os.path.join(A.FILES, aid, "v1", A.PICTURE)))
        self.assertIsInstance(self.record(aid)["versions"][0]["picture"], int)
        # a recipe needs none
        d = os.path.join(self.dir, "r")
        with mock.patch("sys.stdout"):
            A.cmd_new(types.SimpleNamespace(dir=d, custom=False))
        self.publish(d, title="Report")
        rid = self.only()[0]["id"]
        with self.assertRaisesRegex(A.Fail, "needs no picture"):
            A.cmd_picture(types.SimpleNamespace(id=rid, version=1, shot=None, panel=None, image=pic, machine=None, json=True))

    def test_convert_keeps_the_maker_and_marks_the_old_versions(self):
        with mock.patch.object(A, "me", return_value={"terminal": "t1", "task": None}):
            self.publish(self.panel(), title="Plan", custom=True, task="HAT-2")
        a = self.only()[0]
        a["versions"][0].pop("kind")  # as one made before versions had kinds
        a["at"] = 5
        with A.Store(A.locate(self.folder)) as s:
            s.data["artifacts"] = [a, {"id": "newer-1a2b", "title": "Newer", "version": 1, "versions": [], "at": 9}]
            s.dirty = True
        d = os.path.join(self.dir, "as-recipe")
        os.makedirs(d)
        with open(os.path.join(d, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": [{"type": "text", "md": "hi"}]}, f)
        with mock.patch("sys.stdout"):
            A.cmd_convert(types.SimpleNamespace(id=a["id"], recipe=d, json=True, out=None, publish=False, force=False))
        b = self.record(a["id"])
        self.assertEqual((b["publisher"], b["task"], b["title"]), ("t1", "HAT-2", "HAT-2: Plan"))
        self.assertEqual([(x["v"], x["kind"]) for x in b["versions"]], [(1, "custom"), (2, "recipe")])
        self.assertIn("recipe", b["versions"][1]["note"])
        # its time and place in the list stay
        self.assertEqual(b["at"], 5)
        self.assertEqual([x["id"] for x in self.only()], [a["id"], "newer-1a2b"])

    def test_convert_leaves_a_panel_that_answers_clicks_to_a_hand(self):
        d = self.panel()
        with open(os.path.join(d, "main.js"), "a") as f:
            f.write('div().on_click(() => {});\n')
        self.assertEqual(A.live_parts(d, ["main.js"]), ["it answers clicks (tabs, filters, a form, a game)"])
        self.assertEqual(A.live_parts(self.panel("still"), ["main.js"]), [])

    def test_a_drawn_panel_becomes_headings_tables_code_and_lists(self):
        spec = "\n".join([
            "v_flex .size_full[] .p[Number(16.0)]",
            "  div .font_weight[Number(600.0)]",
            '    text "Tests"',
            "  h_flex .font_medium[]",
            "    div",
            '      text "Name"',
            "    div",
            '      text "Value"',
            "  h_flex",
            "    div",
            '      text "a"',
            "    div",
            '      text "1"',
            "  v_flex .p[Number(8.0)] .bg[Str(\"#111111\")] .overflow_x_scroll[]",
            "    div .whitespace_nowrap[]",
            '      text "$ ls"',
            "    div .whitespace_nowrap[]",
            '      text "file"',
            "  div .font_semibold[]",
            '    text "Not proven"',
            "  div",
            '    text "A live run."',
        ])
        self.assertEqual(A.recipe_from_spec(spec)["blocks"], [
            {"type": "heading", "text": "Tests", "level": 3},
            {"type": "table", "columns": ["Name", "Value"], "rows": [["a", "1"]]},
            {"type": "code", "text": "$ ls\nfile"},
            {"type": "heading", "text": "Not proven", "level": 3},
            {"type": "list", "items": ["A live run."]},
        ])


if __name__ == "__main__":
    unittest.main()
