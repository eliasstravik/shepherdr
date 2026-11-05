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

    # Elements and components whose `title` is no hover popup: a dialog's or card's heading, a row's words, an
    # iframe's name for screen readers.
    TITLE_OK = {"Dialog", "CardShell", "TitleWhere", "Line", "iframe"}

    def test_no_hover_tooltips(self):
        """Nothing pops up on hover (SHEP-25): no `title=` tooltip in the web app, no `.tooltip(` in the window's
        mods. An icon-only control says its words with `aria-label` instead."""
        found = []
        for top in ("web/src", "web/plugins"):
            for d, _, files in os.walk(J(top)):
                for f in files:
                    if not f.endswith((".tsx", ".ts", ".html")):
                        continue
                    p = os.path.join(d, f)
                    with open(p, encoding="utf-8") as fh:
                        src = fh.read()
                    rel = os.path.relpath(p, ROOT)
                    for m in re.finditer(r"(?<![\w.-])title=", src):
                        # the tag it sits on: the last one still open (a <TaskDot /> in an earlier prop is closed)
                        tags = []
                        for t in re.finditer(r"<([A-Za-z][\w.]*)|/>|</[\w.]*>", src[:m.start()]):
                            if t.group(1):
                                tags.append(t.group(1))
                            elif tags:
                                tags.pop()
                        tag = tags[-1] if tags else "?"
                        if tag not in self.TITLE_OK:
                            found.append(f"{rel}:{src.count(chr(10), 0, m.start()) + 1}: title= on <{tag}>")
                    for m in re.finditer(r"setAttribute\(\s*['\"]title['\"]|\.title\s*=(?!=)", src):
                        if not src[max(0, m.start() - 8):m.start()].endswith("document"):
                            found.append(f"{rel}:{src.count(chr(10), 0, m.start()) + 1}: sets a title")
        for top in ("mods", "lib", "core"):
            for d, dirs, files in os.walk(J(top)):
                dirs[:] = [x for x in dirs if x not in ("node_modules", ".last")]
                for f in files:
                    if f.endswith(".js"):
                        p = os.path.join(d, f)
                        with open(p, encoding="utf-8") as fh:
                            for n, line in enumerate(fh, 1):
                                if ".tooltip(" in line:
                                    found.append(f"{os.path.relpath(p, ROOT)}:{n}: .tooltip(")
        self.assertFalse(found, "hover tooltips (use aria-label, or show the words):\n" + "\n".join(found))

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
                        if (m, f) in (("artifacts", "markup.js"), ("artifacts", "recipe-view.js")) and (a or b) in ("./artifact.js", "./artifact-main.js", "./recipe.js", "./recipe-data.js"):
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

    def test_autopilot_from_one_core(self):
        """Settings › Autopilot (Everywhere's and a space's own) takes its words, picks and rule from core/autopilot.js on
        both sides: the window's section and header, and the web app's service, never their own copies."""
        uses = {
            J("mods", "shepherdr-settings", "autopilot-section.js"): ["AP.ROWS", "AP.PRESETS", "AP.EVENTS", "AP.ABOUT", "AP.SAVED", "AP.FIELDS"],
            J("mods", "pane-chat", "autopilot.js"): ["pilotFor", "headerDetail"],
            J("service", "settings.ts"): ["AP.ROWS", "AP.PRESETS", "AP.EVENTS", "AP.ABOUT", "AP.levelOf", "AP.FIELDS"],
            J("service", "compat.ts"): ["AP.blankBeat"],
            J("service", "model.ts"): ["pilotFor", "everywhereOf"],
        }
        for path, names in uses.items():
            text = open(path).read()
            self.assertRegex(text, r"core/autopilot\.js", f"{os.path.relpath(path, ROOT)} doesn't read core/autopilot.js")
            for n in names:
                self.assertIn(n, text, f"{os.path.relpath(path, ROOT)} doesn't use {n}")
            for words in ("Its Assistant wakes on a schedule", "When it wakes by itself", '"Every 30 min"', '["needs-you", "Needs you"]'):
                self.assertNotIn(words, text, f"{os.path.relpath(path, ROOT)} has its own copy of {words!r}")

    def test_task_views_from_one_core(self):
        """The Tasks panel's rows and the task view's Files, Changes and Pull request read their words and rules from
        core on both sides (core/tasks.js, core/needs.js, core/worktree.js): the web app keeps no copy of its own."""
        uses = {
            J("web", "plugins", "tasks", "client.tsx"): ["@core/tasks.js", "@core/needs.js", "TK.capital", "ND.fit", "TK.day", "TK.STATUS", "ND.REASONS"],
            J("web", "plugins", "worktree", "client.tsx"): ["@core/worktree.js", "W.VIEW_WORDS", "W.CHANGE_WORDS", "W.CHECK_WORDS", "W.PR_STATES", "W.checksLine"],
            J("service", "worktree.ts"): ["core/worktree.js", "VIEW_WORDS", "LIST_DIR", "dirEntries", "MARK_ARGS"],
        }
        for path, names in uses.items():
            text = open(path, encoding="utf-8").read()
            for n in names:
                self.assertIn(n, text, f"{os.path.relpath(path, ROOT)} doesn't use {n}")
        web = open(J("web", "plugins", "worktree", "client.tsx"), encoding="utf-8").read()
        for words in ("Loading files…", "Asking GitHub…", "No checks on it.", "Select a file to see its changes."):
            self.assertNotIn(words, web, f"web/plugins/worktree has its own copy of {words!r}")

    def test_artifacts_open_on_all(self):
        """The Artifacts panel opens on All (every folder), like Tasks, in the window and the web; a saved web choice
        lives under a new key, so one saved under the old default ('shepherdr.artifactsAll') starts over on All."""
        win = open(J("mods", "artifacts", "main.js"), encoding="utf-8").read()
        self.assertIn("this.all = true;", win)
        self.assertNotIn("this.all = false;", win)
        web = open(J("web", "plugins", "artifacts", "client.tsx"), encoding="utf-8").read()
        self.assertIn("const ALL = 'shepherdr.artifactsAllFolders'", web)
        self.assertIn("localStorage.getItem(ALL) !== '0'", web)

    def test_parity_has_no_open_rows(self):
        """docs/parity/: every element of every surface matches the window (✓) or is a web-only form with its reason
        (◇); a row still marked ✗ fails, and every surface in docs/parity.md has its page."""
        index = open(J("docs", "parity.md")).read()
        for page in re.findall(r"\(parity/([\w-]+\.md)\)", index):
            text = open(J("docs", "parity", page)).read()
            rows = [l for l in text.splitlines() if l.startswith("|") and not set(l) <= set("|-: ")]
            self.assertTrue(rows, f"docs/parity/{page} has no rows")
            for l in rows:
                self.assertNotIn("✗", l, f"docs/parity/{page}: still differs: {l[:120]}")

    def test_menus_from_one_list(self):
        """The sidebar's and a task row's menus are core/menus.js's lists on both sides: the window's mods and the web
        app build them from it (3.0 decides what each menu offers; the web only draws it)."""
        uses = {
            J("mods", "spaces-chat", "popups.js"): ["addMenu", "spaceMenu", "machineMenu", "sectionMenu"],
            J("mods", "tasks-menu", "main.js"): ["taskMenu"],
            J("web", "plugins", "places", "client.tsx"): ["addMenu", "spaceMenu", "machineMenu", "sectionMenu"],
        }
        for path, names in uses.items():
            text = open(path).read()
            self.assertRegex(text, r"core/menus\.js", f"{os.path.relpath(path, ROOT)} doesn't build from core/menus.js")
            for n in names:
                self.assertIn(n, text, f"{os.path.relpath(path, ROOT)} doesn't use {n}")

    def test_web_header_no_hidden_end(self):
        """The web Assistant header holds no hidden control that ends its agent (SHEP-23): ending or closing is the
        tab's own × and menu in the tab bar; the header's status is words ("Working…", "Needs you"), never a done tick."""
        text = open(J("web", "plugins", "coordinators", "client.tsx")).read()
        self.assertNotIn("PaneEnd", text)
        self.assertNotIn("endAgent", text)
        header = text[text.index("function StatusMark("):text.index("/* ---------- the tab bar's +")]
        self.assertIn("Working…", header)
        self.assertIn("Needs you", header)
        self.assertNotIn("'done'", header)
        self.assertNotIn("XIcon", header)
        # Autopilot sits on the right with the other controls (order > 10), after the status
        self.assertIn("{ order: 12, View: StatusMark }, { order: 14, View: AutopilotHeader }", text)

    def test_tab_bar_from_one_list(self):
        """The tab bar's + menu, a tab's menu, Switch agent, a tab's name and the window header's End agent are
        core/menus.js's on both sides (mods/new-menu-tasks, menu-tasks, coordinator, tabs-tasks, pane-chat and the web app's
        coordinators plugin), and the header's Autopilot words core/autopilot.js's: neither side keeps its own copy."""
        uses = {
            J("mods", "new-menu-tasks", "main.js"): ["NEW_MENU", "assistantRow", "agentChoices", "agentHint"],
            J("mods", "menu-tasks", "main.js"): ["tabMenu", "appMenu"],
            J("mods", "coordinator", "main.js"): ["SWITCH_AGENT"],
            J("mods", "tabs-tasks", "main.js"): ["tabName"],
            J("mods", "pane-chat", "main.js"): ["endAgent"],
            J("web", "plugins", "coordinators", "client.tsx"): ["NEW_MENU", "assistantRow", "agentChoices", "agentHint", "tabMenu", "SWITCH_AGENT", "headerDetail", "appMenu", "openKeybinds"],
            J("service", "compat.ts"): ["tabName"],
        }
        for path, names in uses.items():
            text = open(path).read()
            self.assertRegex(text, r"core/menus\.js", f"{os.path.relpath(path, ROOT)} doesn't read core/menus.js")
            for n in names:
                self.assertIn(n, text, f"{os.path.relpath(path, ROOT)} doesn't use {n}")
            for words in ('"Show Assistant"', "'Show Assistant'", '"Start an agent"', "'Start an agent'", '"This computer only"', '"Edit instructions…"', "'Edit instructions…'", '"Close tab"', "'Close tab'", '"End agent"', "'End agent'"):
                self.assertNotIn(words, text, f"{os.path.relpath(path, ROOT)} has its own copy of {words}")

    def test_features_have_both_sides(self):
        """lib/features.json: every feature has its shared logic, a Herdr side and a web side, every file it names is
        there, and every mod belongs to a feature."""
        feats = json.load(open(J("lib", "features.json")))["features"]
        ids = [f["id"] for f in feats]
        self.assertEqual(len(ids), len(set(ids)), "a feature id is listed twice")
        addons = {"core"} | {a["id"] for a in self.addons["addons"]}
        for f in feats:
            name = f["id"]
            self.assertIn(f["addon"], addons, f"{name}: no add-on {f['addon']}")
            self.assertTrue(f["core"] or f.get("service") or f.get("view_only"), f"{name}: no shared logic")
            for c in f["core"]:
                self.assertTrue(os.path.isfile(J("core", f"{c}.js")), f"{name}: no core/{c}.js")
            for c in f.get("service", []):
                self.assertTrue(os.path.isfile(J("service", c)), f"{name}: no service/{c}")
            herdr = f.get("herdr", {})
            self.assertTrue(herdr.get("mods") or herdr.get("builtin"), f"{name}: no Herdr side")
            for m in herdr.get("mods", []):
                self.assertTrue(os.path.isdir(J("mods", m)), f"{name}: no mod {m}")
            self.assertTrue(f.get("web", {}).get("files"), f"{name}: no web side")
            for w in f["web"]["files"]:
                self.assertTrue(os.path.isfile(J("web", w)), f"{name}: no web/{w}")
            for k in ("herdr", "desktop", "tablet", "phone"):
                self.assertTrue(f.get("forms", {}).get(k), f"{name}: no {k} form")
            # a release has every feature on both sides: nothing left "planned"
            self.assertNotIn("planned", f, f"{name}: still planned ({f.get('planned')})")
        used = {m for f in feats for m in f.get("herdr", {}).get("mods", [])}
        self.assertEqual(sorted(set(os.listdir(J("mods"))) - used), [], "a mod belongs to no feature")
        screens = J("web", "src", "screens")
        named = {w for f in feats for w in f["web"]["files"]}
        for n in os.listdir(screens) if os.path.isdir(screens) else []:
            if n.endswith(".tsx"):
                self.assertIn(f"src/screens/{n}", named, f"web/src/screens/{n} belongs to no feature")

    def test_version_everywhere(self):
        v = re.search(r'^VERSION = "([^"]+)"', open(J("bin", "shepherdr")).read(), re.M).group(1)
        self.assertEqual(v, "3.1.9")
        self.assertRegex(open(J("CHANGELOG.md")).read(), rf"(?m)^## {re.escape(v)}\b", "CHANGELOG's newest entry")
        self.assertIn(v, open(J("RECIPE.md")).read())
        self.assertIn(v, open(J("README.md")).read())


if __name__ == "__main__":
    unittest.main()


class SessionNote(unittest.TestCase):
    """SHEP-42, SHEP-48: the chat's SessionStart hook (mods/chat/session-note.sh) adds every agent's Reactions
    words (herdr-task _session-note, on or off by its space) to its JSON: an Assistant's, a task worker's, an
    agent tab's. Outside Herdr it says nothing. hc and herdr-task are fakes."""

    def run_hook(self, role, terminal="t5"):
        import shutil
        import subprocess
        import tempfile
        if not shutil.which("jq"):
            self.skipTest("needs jq")
        d = tempfile.mkdtemp()
        log = os.path.join(d, "asked")
        with open(os.path.join(d, "hc"), "w") as f:
            f.write(f"#!/bin/sh\necho '{json.dumps({'labels': {'herdr.role': role} if role else {}})}'\n")
        # what _session-note prints: JSON string content, escaped
        with open(os.path.join(d, "words"), "w") as f:
            f.write(json.dumps(' Reactions (on in Settings): <hc react="👀" to="x"/>', ensure_ascii=False)[1:-1])
        with open(os.path.join(d, "herdr-task"), "w") as f:
            f.write(f"#!/bin/sh\necho \"$@\" >> {log}\ncat {d}/words\n")
        for x in ("hc", "herdr-task"):
            os.chmod(os.path.join(d, x), 0o755)
        env = {**os.environ, "PATH": f"{d}:{os.environ['PATH']}", "HC_TERMINAL_ID": terminal}
        if not terminal:
            env.pop("HC_TERMINAL_ID")
        out = subprocess.run(["sh", os.path.join(ROOT, "mods", "chat", "session-note.sh")], capture_output=True, text=True, env=env)
        if not terminal:
            return out.stdout, os.path.exists(log)
        ctx = json.loads(out.stdout)["hookSpecificOutput"]["additionalContext"]
        if not os.path.exists(log):
            return ctx, ""
        with open(log) as f:
            return ctx, f.read()

    def test_an_assistant_gets_its_reactions_words(self):
        ctx, asked = self.run_hook("coordinator")
        self.assertTrue(ctx.startswith("Herdr chat:"))
        self.assertTrue(ctx.endswith('`herdr-artifact guide` first. Reactions (on in Settings): <hc react="👀" to="x"/>'), ctx[-120:])
        self.assertEqual(asked.split(), ["_session-note", "t5"])

    def test_a_worker_and_an_agent_tab_get_theirs_too(self):
        for role, terminal in ((None, "t9"), ("", "t11")):
            ctx, asked = self.run_hook(role, terminal)
            self.assertTrue(ctx.endswith('`herdr-artifact guide` first. Reactions (on in Settings): <hc react="👀" to="x"/>'), ctx[-120:])
            self.assertEqual(asked.split(), ["_session-note", terminal])

    def test_outside_herdr_it_says_nothing(self):
        out, asked = self.run_hook(None, "")
        self.assertEqual(out, "")
        self.assertFalse(asked)
