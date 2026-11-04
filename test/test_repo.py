"""The repo as Herdr and the installer see it: the add-on list covers every mod, the layout has no
live values, nothing personal is shipped, and the version is the same everywhere it's stated."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)


def text_files():
    for top in ("mods", "lib", "bin", "templates", "guard", "layouts", "service", "core", "web/src"):
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

    def test_mod_imports_resolve(self):
        """Every relative import in a mod names a file inside that mod (shared copies included): a moved module
        (lib/ to core/) can't leave a mod pointing at nothing. herdr-app check would catch it too, but runs init()."""
        imp = re.compile(r'''(?:^|\n)\s*(?:import|export)\s[^'";]*?from\s+["'](\.{1,2}/[^"']+)["']|import\(\s*["'](\.{1,2}/[^"']+)["']''')
        for m in os.listdir(J("mods")):
            top = J("mods", m)
            for d, dirs, files in os.walk(top):
                dirs[:] = [x for x in dirs if x not in ("__pycache__", "bin")]
                for f in files:
                    if not f.endswith(".js"):
                        continue
                    src = open(os.path.join(d, f), encoding="utf-8").read()
                    for a, b in imp.findall(src):
                        if (m, f) == ("artifacts", "markup.js") and (a or b) in ("./artifact.js", "./artifact-main.js"):
                            continue  # copied into each installed artifact, where herdr-artifact writes these
                        target = os.path.normpath(os.path.join(d, a or b))
                        self.assertTrue(target.startswith(top + os.sep), f"{os.path.relpath(os.path.join(d, f), ROOT)}: {a or b} leaves the mod")
                        self.assertTrue(os.path.isfile(target), f"{os.path.relpath(os.path.join(d, f), ROOT)}: {a or b} isn't there")

    def test_core_is_plain(self):
        """core/ runs in the window, the service and the browser: no Herdr, GPUI, Node or Bun imports."""
        if not os.path.isdir(J("core")):
            return
        for f in os.listdir(J("core")):
            if f.endswith(".js") and not f.endswith(".test.js"):
                src = open(J("core", f), encoding="utf-8").read()
                for spec in re.findall(r'''from\s+["']([^"']+)["']''', src):
                    self.assertTrue(spec.startswith("./"), f"core/{f} imports {spec}")

    def test_features_have_both_sides(self):
        """lib/features.json: every feature has its core, a Herdr side and a web side; every mod and every web screen
        belongs to a feature; once a feature is built (no "planned"), the files it names are there."""
        feats = json.load(open(J("lib", "features.json")))["features"]
        ids = [f["id"] for f in feats]
        self.assertEqual(len(ids), len(set(ids)), "a feature id is listed twice")
        addons = {"core"} | {a["id"] for a in self.addons["addons"]}
        screens_dir = J("web", "src", "screens")
        for f in feats:
            name = f["id"]
            self.assertIn(f["addon"], addons, f"{name}: no add-on {f['addon']}")
            self.assertTrue(f["core"] or f.get("view_only"), f"{name}: no shared core")
            herdr = f.get("herdr", {})
            self.assertTrue(herdr.get("mods") or herdr.get("builtin"), f"{name}: no Herdr side")
            for m in herdr.get("mods", []):
                self.assertTrue(os.path.isdir(J("mods", m)), f"{name}: no mod {m}")
            self.assertTrue(f.get("web", {}).get("screens"), f"{name}: no web side")
            for k in ("herdr", "desktop", "tablet", "phone"):
                self.assertTrue(f.get("forms", {}).get(k), f"{name}: no {k} form")
            if f.get("planned"):
                continue
            for c in f["core"]:
                self.assertTrue(os.path.isfile(J("core", f"{c}.js")), f"{name}: no core/{c}.js")
            for s in f["web"]["screens"]:
                self.assertTrue(os.path.isfile(os.path.join(screens_dir, f"{s}.tsx")), f"{name}: no web/src/screens/{s}.tsx")
        used = {m for f in feats for m in f.get("herdr", {}).get("mods", [])}
        self.assertEqual(sorted(set(os.listdir(J("mods"))) - used), [], "a mod belongs to no feature")
        named = {s for f in feats for s in f["web"]["screens"]}
        if os.path.isdir(screens_dir):
            shipped = {n[:-4] for n in os.listdir(screens_dir) if n.endswith(".tsx") and not n.endswith(".test.tsx")}
            self.assertEqual(sorted(shipped - named), [], "a web screen belongs to no feature")

    def test_version_everywhere(self):
        v = re.search(r'^VERSION = "([^"]+)"', open(J("bin", "shepherdr")).read(), re.M).group(1)
        self.assertEqual(v, "3.0.0")
        self.assertRegex(open(J("CHANGELOG.md")).read(), rf"(?m)^## {re.escape(v)}\b", "CHANGELOG's newest entry")
        self.assertIn(v, open(J("RECIPE.md")).read())
        self.assertIn(v, open(J("README.md")).read())


if __name__ == "__main__":
    unittest.main()
