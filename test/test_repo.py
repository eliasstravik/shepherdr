"""The repo as Herdr and the installer see it: the add-on list covers every mod, the layout has no
live values, nothing personal is shipped, and the version is the same everywhere it's stated."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)


def text_files():
    for top in ("mods", "lib", "bin", "templates", "guard", "layouts"):
        for d, dirs, files in os.walk(J(top)):
            dirs[:] = [x for x in dirs if x != "__pycache__"]
            for f in files:
                if not f.endswith((".svg", ".png", ".pyc")):
                    yield os.path.join(d, f)


class Repo(unittest.TestCase):
    def setUp(self):
        self.addons = json.load(open(J("lib", "addons.json")))

    def test_every_mod_is_in_one_addon(self):
        listed = list(self.addons["core"]["mods"]) + [m for a in self.addons["addons"] for m in a.get("mods", [])]
        self.assertEqual(len(listed), len(set(listed)), "a mod is listed twice in lib/addons.json")
        self.assertEqual(sorted(listed), sorted(os.listdir(J("mods"))))

    def test_mods_have_mod_json_and_main(self):
        for m in os.listdir(J("mods")):
            self.assertTrue(os.path.isfile(J("mods", m, "mod.json")), m)
            json.load(open(J("mods", m, "mod.json")))
            self.assertTrue(os.path.isfile(J("mods", m, "main.js")), m)

    def test_addon_needs_exist(self):
        ids = {a["id"] for a in self.addons["addons"]}
        for a in self.addons["addons"]:
            for n in a.get("needs", []):
                self.assertIn(n, ids, f"{a['id']} needs {n}")

    def test_layout_has_no_live_values(self):
        text = open(J("layouts", "shepherdr.json")).read()
        d = json.loads(text)
        self.assertNotRegex(text, r'"terminal":\s*"t\w+"')
        self.assertNotIn("art-", text)
        used = set(re.findall(r'"mod":\s*"([^"]+)"', text))
        ours = set(os.listdir(J("mods")))
        shipped = set(self.addons["core"]["uses_shipped"])
        self.assertEqual(used - ours - shipped, set(), "the layout uses a mod nobody ships")
        self.assertEqual(d["id"], "root")

    def test_keys_name_our_layout_and_parse(self):
        keys = json.load(open(J("keys.json")))
        layouts = [c for c in keys if c.startswith("layout:")]
        self.assertEqual(layouts, ["layout:shepherdr"])
        for a in [self.addons["core"]] + self.addons["addons"]:
            for k in a.get("keys", []):
                ctx, key = k.split(" ", 1)
                self.assertIn(key, keys.get(ctx, {}), k)

    def test_nothing_personal(self):
        bad = re.compile(r"/home/\w|/Users/\w|eliasstravik|\.ts\.net|prospecterra|thekiln|vm-stravik|skills-me")
        for p in text_files():
            with open(p, encoding="utf-8", errors="replace") as f:
                for n, line in enumerate(f, 1):
                    self.assertIsNone(bad.search(line), f"{os.path.relpath(p, ROOT)}:{n}: {line.strip()[:120]}")

    def test_no_leftovers(self):
        for p in text_files():
            name = os.path.basename(p)
            self.assertNotRegex(name, r"\.bak|\.orig$|\.new$|^zz-", os.path.relpath(p, ROOT))

    def test_version_everywhere(self):
        v = re.search(r'^VERSION = "([^"]+)"', open(J("bin", "shepherdr")).read(), re.M).group(1)
        self.assertEqual(v, "3.0.0")
        self.assertRegex(open(J("CHANGELOG.md")).read(), rf"(?m)^## {re.escape(v)}\b", "CHANGELOG's newest entry")
        self.assertIn(v, open(J("RECIPE.md")).read())
        self.assertIn(v, open(J("README.md")).read())


if __name__ == "__main__":
    unittest.main()
