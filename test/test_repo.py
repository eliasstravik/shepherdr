"""The repo as the installer and CI see it: nothing personal is shipped, no leftovers, no hover tooltips in the web
app, the shared core is plain JavaScript, every web plugin has its page, the one Herdr mod parses, the version is the
same everywhere it's stated, and every shell script parses."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)
# What ships (bin/shepherdr share_items) and what it's built from
SHIPPED = ("mods", "bin", "hooks", "herdr", "templates", "service", "core", "web/src", "web/plugins", "web/shared")


def text_files():
    for top in SHIPPED:
        for d, dirs, files in os.walk(J(top)):
            dirs[:] = [x for x in dirs if x not in ("__pycache__", "node_modules")]
            for f in files:
                if not f.endswith((".svg", ".png", ".pyc", ".woff2", ".ico")):
                    yield os.path.join(d, f)


class Repo(unittest.TestCase):
    def test_the_window_is_gone(self):
        """3.2 is one web app: no layout, no window mods, no keys of Shepherdr's own, no shared-module copies, no
        add-on or feature manifest, no herdr.dev listing. Of mods/, only the helpers that keep their 3.1 paths stay
        (herdr-task, herdr-artifact), and of lib/ only the marker 3.1's `shepherdr update` looks for."""
        for gone in ("layouts", "keys.json", "guard", "RECIPE.md", "preview.png", "scripts/parity.py", "lib/COPIES",
                     "lib/features.json", "lib/ui.js", "web/viewer"):
            self.assertFalse(os.path.exists(J(gone)), gone)
        self.assertEqual(sorted(os.listdir(J("mods"))), ["artifacts", "tasks"])
        self.assertTrue(os.path.isfile(J("mods", "tasks", "bin", "herdr-task")))
        self.assertTrue(os.path.isfile(J("mods", "artifacts", "bin", "herdr-artifact")))
        self.assertTrue(os.path.isfile(J("mods", "artifacts", "ARTIFACTS.md")))
        self.assertEqual(sorted(os.listdir(J("lib"))), ["addons.json"])
        for f in ("ask-hook.sh", "ask-end.py", "session-note.sh"):
            self.assertTrue(os.path.isfile(J("hooks", f)), f)

    def test_the_one_herdr_mod(self):
        """herdr/open-shepherdr is all Shepherdr puts in the Herdr app: a popup opened by a key (place none, an
        overlay), one button that opens the web app's link, nothing imported from outside its folder, and it parses."""
        self.assertEqual(sorted(os.listdir(J("herdr"))), ["open-shepherdr", "window-notice"])
        self.assertEqual(sorted(os.listdir(J("herdr", "open-shepherdr"))), ["main.js", "mod.json"])
        mod = json.load(open(J("herdr", "open-shepherdr", "mod.json")))
        self.assertEqual(mod["place"], "none")
        self.assertEqual(mod["title"], "Shepherdr")
        self.assertEqual(mod["overlay"]["kind"], "popup")
        src = open(J("herdr", "open-shepherdr", "main.js"), encoding="utf-8").read()
        specs = re.findall(r"""from\s+["']([^"']+)["']""", src)
        self.assertTrue(specs)
        for spec in specs:
            self.assertIn(spec, ("herdr", "gpui-kit", "gpui-base"), f"herdr/open-shepherdr/main.js imports {spec}")
        self.assertEqual(src.count(".on_click("), 1, "one button")
        self.assertEqual(src.count('"Open Shepherdr"'), 1)
        self.assertIn("cx.open_url(this.link)", src)
        self.assertIn("web.json", src)
        self.assertNotIn(".tooltip(", src)
        # the key the installer merges opens this mod, by the name it installs it under
        text = open(J("bin", "shepherdr")).read()
        self.assertIn('BUTTON = "open-shepherdr"', text)
        self.assertIn('KEY = ("global", "ctrl-shift-o", f"mod.open:{BUTTON}")', text)
        if shutil.which("node"):
            with open(J("herdr", "open-shepherdr", "main.js"), "rb") as f:
                p = subprocess.run(["node", "--input-type=module", "--check"], stdin=f, capture_output=True, text=True)
            self.assertEqual(p.returncode, 0, p.stderr)

    def test_the_window_notice(self):
        """herdr/window-notice (SHEP-355) goes in the place of each of 3.1's window views: self-contained, place none, one
        button that opens the web app's link (at the space an Assistant tab names), never a tooltip, and it parses."""
        top = J("herdr", "window-notice")
        self.assertEqual(sorted(os.listdir(top)), ["blank.js", "full.js", "mod.json", "notice.js"])
        self.assertEqual(json.load(open(os.path.join(top, "mod.json"))), {"place": "none", "title": "Shepherdr"})
        for f in ("blank.js", "full.js", "notice.js"):
            src = open(os.path.join(top, f), encoding="utf-8").read()
            for spec in re.findall(r"""from\s+["']([^"']+)["']""", src):
                self.assertIn(spec, ("herdr", "gpui-kit", "gpui-base", "./notice.js"), f"{f} imports {spec}")
            self.assertNotIn(".tooltip(", src)
            if shutil.which("node"):
                p = subprocess.run(["node", "--input-type=module", "--check"], input=src, capture_output=True, text=True)
                self.assertEqual(p.returncode, 0, f + p.stderr)
        src = open(os.path.join(top, "notice.js"), encoding="utf-8").read()
        self.assertIn("Shepherdr 3.1's window views, retired", src[:200], "bin/shepherdr's is_notice() knows a notice by it")
        self.assertIn("Shepherdr 3.1's window views, retired", open(J("bin", "shepherdr")).read())
        self.assertEqual(src.count(".on_click("), 1, "one button")
        self.assertIn("web.json", src)
        if not shutil.which("node"):
            return
        # its link logic, with Herdr's modules stood in for
        body = re.sub(r"^import .*$", "", src, flags=re.M)
        stub = ("const div = () => 0, v_flex = () => 0, h_flex = () => 0, exec = async () => ({}), theme = () => ({}), "
                "props = () => ({}), shared = () => null; class View {}\n")
        test = """
const out = {
  link: linkOf('{"link":"https://box.example.ts.net/shepherdr/"}'), none: linkOf("not json"), plain: linkOf('{"link":"file:///x"}'),
  at: linkAt("https://box.example.ts.net/shepherdr/", { space: "spa1b2" }),
  remote: linkAt("https://box.example.ts.net/shepherdr/?x=1", { space: "vm/sp1" }),
  bad: linkAt("https://box.example.ts.net/shepherdr/", { space: "a b<script>" }),
  nolink: linkAt(null, { space: "sp1" }), words: WORDS.title };
console.log(JSON.stringify(out));"""
        p = subprocess.run(["node", "--input-type=module", "-e", stub + body + test], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout), {
            "link": "https://box.example.ts.net/shepherdr/", "none": None, "plain": None,
            "at": "https://box.example.ts.net/shepherdr/?place=spa1b2",
            "remote": "https://box.example.ts.net/shepherdr/?x=1&place=vm%2Fsp1",
            "bad": "https://box.example.ts.net/shepherdr/", "nolink": None, "words": "Shepherdr now lives in the web app"})

    def test_every_plugin_has_its_page(self):
        """web/plugins.json lists the web app's plugins; each is a folder with its client.tsx."""
        plugins = json.load(open(J("web", "plugins.json")))["plugins"]
        self.assertTrue(plugins)
        self.assertEqual(len(plugins), len(set(plugins)), "a plugin is listed twice in web/plugins.json")
        for name in plugins:
            self.assertTrue(os.path.isfile(J("web", "plugins", name, "client.tsx")), f"web/plugins/{name}/client.tsx")

    def test_the_build_is_the_one_web_app(self):
        """package.json builds the web app only (3.1's recipe viewer is gone), and what the web app no longer uses
        isn't installed."""
        pkg = json.load(open(J("package.json")))
        self.assertEqual(pkg["scripts"]["build"], "vite build --config web/vite.config.ts")
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        for gone in ("tailwindcss", "@tailwindcss/vite", "@heroicons/react", "clsx"):
            self.assertNotIn(gone, deps)
        for kept in ("@novnc/novnc", "@xterm/xterm", "marked", "dompurify", "inter-ui", "react"):
            self.assertIn(kept, deps)

    def test_nothing_personal(self):
        # The upstream repo's public name is fine (feedback's default repo, SHEP-78); the account elsewhere isn't.
        names = r"eliasstravik(?!/shepherdr\b)|prospecterra|thekiln|vm-stravik|skills-me"
        bad = re.compile(r"/home/\w|/Users/\w|\.ts\.net|" + names)
        in_tests = re.compile(names)   # a test may name a made-up home folder or tailnet host (never shipped), but nobody real
        for p in text_files():
            pat = in_tests if re.search(r"\.test\.(ts|tsx|js)$", p) else bad
            with open(p, encoding="utf-8", errors="replace") as f:
                for n, line in enumerate(f, 1):
                    self.assertIsNone(pat.search(line), f"{os.path.relpath(p, ROOT)}:{n}: {line.strip()[:120]}")

    # A `title` on a page element is a hover popup; on a component it is a prop (a heading's words), and whatever
    # element the component puts it on is checked where it's written. An iframe's is its name for screen readers.
    TITLE_OK = {"iframe"}

    def test_no_hover_tooltips(self):
        """Nothing pops up on hover (SHEP-25): no `title=` tooltip in the web app. An icon-only control says its words
        with `aria-label` instead."""
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
                        if tag[:1].islower() and tag not in self.TITLE_OK:
                            found.append(f"{rel}:{src.count(chr(10), 0, m.start()) + 1}: title= on <{tag}>")
                    for m in re.finditer(r"setAttribute\(\s*['\"]title['\"]|\.title\s*=(?!=)", src):
                        if not src[max(0, m.start() - 8):m.start()].endswith("document"):
                            found.append(f"{rel}:{src.count(chr(10), 0, m.start()) + 1}: sets a title")
        self.assertFalse(found, "hover tooltips (use aria-label, or show the words):\n" + "\n".join(found))

    def test_text_boxes_show_focus_quietly(self):
        """No square outline around a text box on focus (SHEP-300: a phone drew one inside the rounded composer).
        Text fields drop the global outline; their box shows focus instead."""
        with open(J("web/src/ds.css"), encoding="utf-8") as fh:
            css = fh.read()
        for tag in ("input", "textarea"):
            self.assertRegex(css, r"(?m)^[^{\n]*(?<![\w.-])" + tag + r":focus-visible[^{\n]*\{outline:0\}",
                             f"{tag} still gets the global focus outline")
        self.assertIn(".cbox:focus-within{", css)
        self.assertIn(".inp:focus{", css)

    def test_task_ring_colours(self):
        """A working task's ring is the app's own yellow, not blue (SHEP-351); Needs you moved to red so the two never
        share a colour, and a status word coloured c-red has a rule behind it."""
        with open(J("web/src/ds.css"), encoding="utf-8") as fh:
            css = fh.read()
        self.assertRegex(css, r"\.tring\{[^}]*color:var\(--amber\)")
        self.assertIn(".tring.t-ask{color:var(--red)}", css)
        self.assertIn(".c-working{color:var(--amber)}", css)
        self.assertIn(".c-red{color:var(--red)}", css)
        self.assertNotRegex(css, r"\.tring[^{]*\{[^}]*var\(--blue\)")

    def test_no_tap_flash(self):
        """No browser box on a press (SHEP-303: Android Chrome flashed blue over every button). The page root turns
        the tap highlight off for everything under it, keyboard focus rings stay, and nothing turns it back on."""
        with open(J("web/src/ds.css"), encoding="utf-8") as fh:
            css = fh.read()
        self.assertRegex(css, r"(?<![\w.-])html\{[^}]*-webkit-tap-highlight-color:transparent")
        self.assertIn(":focus-visible{outline:2px solid var(--fg)", css)
        found = []
        for root, _, files in os.walk(J("web")):
            if "node_modules" in root or os.sep + "dist" in root:
                continue
            for f in files:
                if f.endswith((".css", ".tsx", ".ts", ".html")):
                    with open(os.path.join(root, f), encoding="utf-8") as fh:
                        src = fh.read()
                    for m in re.finditer(r"tap-?highlight-?color[\"']?\s*:\s*([^;}\n]+)", src, re.I):
                        if "transparent" not in m.group(1) and "rgba(0,0,0,0)" not in m.group(1).replace(" ", ""):
                            found.append(f"{os.path.relpath(os.path.join(root, f), J('.'))}: {m.group(0)}")
        self.assertFalse(found, "a tap highlight turned back on:\n" + "\n".join(found))

    def test_the_canvas_from_the_first_paint(self):
        """SHEP-311: the page's root, the browser's bar and the installed app's window are the canvas in each theme from
        the first paint: a phone shows them where the page hasn't drawn yet (the keyboard sliding up, under the gesture
        bar), so white in dark was a flash and a white strip."""
        css = open(J("web/src/ds.css")).read()
        light = re.search(r":root\{color-scheme:light;--canvas:(#[0-9a-f]+);", css)
        dark = re.search(r':root\[data-theme="dark"\]\{color-scheme:dark;--canvas:(#[0-9a-f]+);', css)
        night = re.search(r':root\[data-theme="night"\]\{color-scheme:dark;--canvas:(#[0-9a-f]+);', css)
        self.assertTrue(light and dark and night, "ds.css sets color-scheme with --canvas for light, dark and night")
        self.assertIn('@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--canvas:' + dark[1] + ";", css)
        self.assertIn("html{background:var(--canvas);", css)
        full = lambda c: "#" + "".join(ch * 2 for ch in c[1:]) if len(c) == 4 else c
        L, D, N = full(light[1]), full(dark[1]), full(night[1])
        # Night (#1505) is true black for OLED: the page, the bars and the installed app's window alike
        self.assertEqual(N, "#000000")
        html = open(J("web/index.html")).read()
        head = html[: html.index("</head>")]
        style = head[head.index("<style>") : head.index("</style>")]
        self.assertLess(head.index("<style>"), head.index("<script"), "the canvas comes before any script")
        self.assertIn("html{color-scheme:light;background:%s}" % L, style)
        self.assertIn('html:not([data-theme="light"]){color-scheme:dark;background:%s}' % D, style)
        self.assertIn('html[data-theme="night"]{color-scheme:dark;background:%s}' % N, style)
        self.assertIn('html[data-theme="dark"]{color-scheme:dark;background:%s}' % D, style)
        self.assertIn('<meta name="color-scheme" content="light dark" />', head)
        # SHEP-341: the browser's bar is right with no script, by media, and the script sets every one of them
        self.assertIn('<meta name="theme-color" media="(prefers-color-scheme: light)" content="%s" />' % L, head)
        self.assertIn('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="%s" />' % D, head)
        self.assertEqual(head.count('name="theme-color"'), 2)
        self.assertIn("querySelectorAll('meta[name=theme-color]')", head)
        self.assertIn("night ? '%s' : dark ? '%s' : '%s'" % (N, D, L), head)
        self.assertIn("interactive-widget=resizes-content", head)
        self.assertIn("viewport-fit=cover", head)
        prefs = open(J("web/src/prefs.ts")).read()
        self.assertIn("const BAR = { light: '%s', dark: '%s', night: '%s' }" % (L, D, N), prefs)
        self.assertIn("bar.content = BAR[look()]", prefs)
        self.assertIn("querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')", prefs)
        # SHEP-341: the manifest linked with no script is dark, the app's own: an installed Android app keeps the one
        # it was installed with and paints the window under the gesture bar in its background_color (the white strip
        # of 3.2.2, whose default manifest was white). Light swaps in manifest-light. The same URL stays dark, so an
        # app installed from it sees the new colours at its next manifest check and Chrome updates it.
        self.assertIn('<link rel="manifest" href="manifest.webmanifest"', head)
        self.assertIn("const MANIFEST = { light: 'manifest-light.webmanifest', dark: 'manifest.webmanifest', night: 'manifest-night.webmanifest' }", prefs)
        self.assertIn("if (!dark || night) document.querySelector('link[rel=manifest]').setAttribute('href', night ? 'manifest-night.webmanifest' : 'manifest-light.webmanifest')", head)
        md = json.load(open(J("web/public/manifest.webmanifest")))
        ml = json.load(open(J("web/public/manifest-light.webmanifest")))
        mn = json.load(open(J("web/public/manifest-night.webmanifest")))
        self.assertEqual((mn["background_color"], mn["theme_color"]), (N, N))
        # 3.2.2's dark one, still linked by a page loaded before this: the same as the default
        self.assertEqual(json.load(open(J("web/public/manifest-dark.webmanifest"))), md)
        self.assertEqual((ml["background_color"], ml["theme_color"]), (L, L))
        self.assertEqual((md["background_color"], md["theme_color"]), (D, D))
        # the same app in either (the same id: a new id would install a second app): only the colours differ
        self.assertEqual(md["id"], "./")
        for k in ("background_color", "theme_color"):
            ml.pop(k), md.pop(k), mn.pop(k)
        self.assertEqual(ml, md)
        self.assertEqual(mn, md)
        # the bottom under the gesture bar: the phone's bottom bar runs under it, and without that bar (a tablet, an
        # unfolded phone) the layout keeps the inset clear, painted by the page's canvas
        self.assertIn(".bar{padding-bottom:calc(12px + env(safe-area-inset-bottom))}", css)
        styles = open(J("web/src/styles.css")).read()
        self.assertIn(".app:not(.phone) .device{padding-bottom:env(safe-area-inset-bottom)}", styles)

    def test_no_component_made_inside_a_dialog(self):
        """A dialog with fields is opened with openForm (SHEP-308): a component made inside openDialog's render is a
        new one at each redraw of the app, so its fields are swapped for new ones and the one being typed in loses
        its focus (on a phone the keyboard opening redraws the app, so it closed at once)."""
        found = []
        for top in ("web/src", "web/plugins"):
            for d, _, files in os.walk(J(top)):
                for f in files:
                    if not f.endswith(".tsx"):
                        continue
                    p = os.path.join(d, f)
                    with open(p, encoding="utf-8") as fh:
                        src = fh.read()
                    for m in re.finditer(r"openDialog\(\s*\(\w*\)\s*=>\s*\{(?:(?!\n  \S).)*?\b(?:const|function) [A-Z]\w*\s*(?:=|\()", src, re.S):
                        found.append(f"{os.path.relpath(p, ROOT)}:{src.count(chr(10), 0, m.start()) + 1}")
        self.assertFalse(found, "a component made inside openDialog's render (use openForm):\n" + "\n".join(found))

    def test_no_leftovers(self):
        for p in text_files():
            name = os.path.basename(p)
            self.assertNotRegex(name, r"\.bak|\.orig$|\.new$|^zz-", os.path.relpath(p, ROOT))

    def test_core_is_plain(self):
        """core/ runs in the service and the browser: no Herdr, GPUI, Node or Bun imports."""
        for f in os.listdir(J("core")):
            if f.endswith(".js") and not f.endswith(".test.js"):
                src = open(J("core", f), encoding="utf-8").read()
                for spec in re.findall(r'''from\s+["']([^"']+)["']''', src):
                    self.assertTrue(spec.startswith("./"), f"core/{f} imports {spec}")

    def test_service_spawns_in_its_session(self):
        """Every program the service starts lands in Shepherdr's own herdr-core session (SHEP-294): Bun.spawn and
        Bun.spawnSync only in service/spawn.ts (its helpers give each child an explicit env with HC_SESSION), and node's
        child_process only with an env of its own."""
        bad = []
        for d, dirs, files in os.walk(J("service")):
            dirs[:] = [x for x in dirs if x != "node_modules"]
            for f in files:
                path = os.path.join(d, f)
                rel = os.path.relpath(path, ROOT)
                if not f.endswith((".ts", ".js")) or re.search(r"\.test\.[tj]s$", f) or rel == "service/spawn.ts":
                    continue
                with open(path, encoding="utf-8") as fh:
                    # its code, not its comments
                    src = re.sub(r"/\*.*?\*/|(?<![:\"'`])//[^\n]*", "", fh.read(), flags=re.S)
                if re.search(r"\bBun\s*\.\s*(spawn|spawnSync\b|\$)", src):
                    bad.append(f"{rel}: Bun.spawn (use ./spawn.ts)")
                if re.search(r"""["'](node:)?child_process["']""", src):
                    for call in re.finditer(r"\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(", src):
                        # the call's own line(s), up to its closing: an env of its own
                        tail = src[call.end():call.end() + 400].split("\n\n")[0]
                        if "env" not in tail.split(")\n")[0]:
                            bad.append(f"{rel}: {call.group(1)}( without env")
        self.assertEqual(bad, [])

    def test_every_chrome_skips_the_keychain(self):
        """Every Chrome Shepherdr (or its tests, or a note telling an agent how) starts itself gets --use-mock-keychain
        and --password-store=basic: without them a Mac asks for 'Chromium Safe Storage' in the keychain, again on every
        Deny. A launch line is one naming --user-data-dir, --headless=new or --remote-debugging-port; the flags (or
        herdr-browser's $NO_KEYCHAIN) must be in it or the lines around it (one argument list)."""
        launch = re.compile(r"--user-data-dir|--headless=new|--remote-debugging-port")
        files = list(text_files()) + [J("AGENTS.md")]
        for top in ("test", "docs", "web/demo"):
            for d, dirs, fs in os.walk(J(top)):
                dirs[:] = [x for x in dirs if x not in ("__pycache__", "node_modules")]
                files += [os.path.join(d, f) for f in fs if f.endswith((".py", ".ts", ".md", ".sh"))]
        found = 0
        for f in files:
            if os.path.abspath(f) == os.path.abspath(__file__):
                continue
            try:
                lines = open(f, encoding="utf-8").read().split("\n")
            except (UnicodeDecodeError, OSError):
                continue
            for i, line in enumerate(lines):
                if not launch.search(line):
                    continue
                found += 1
                near = "\n".join(lines[max(0, i - 3):i + 4])
                ok = "$NO_KEYCHAIN" in near or ("--use-mock-keychain" in near and "--password-store=basic" in near)
                self.assertTrue(ok, f"{os.path.relpath(f, ROOT)}:{i + 1} starts Chrome without the keychain flags")
        self.assertGreaterEqual(found, 5, "the launch lines were found")
        browser = open(J("bin", "herdr-browser"), encoding="utf-8").read()
        self.assertIn('NO_KEYCHAIN="--use-mock-keychain --password-store=basic"', browser)

    def test_version_everywhere(self):
        v = re.search(r'^VERSION = "([^"]+)"', open(J("bin", "shepherdr")).read(), re.M).group(1)
        self.assertEqual(v, "3.2.22")
        self.assertEqual(json.load(open(J("package.json")))["version"], v)
        self.assertRegex(open(J("CHANGELOG.md")).read(), rf"(?m)^## {re.escape(v)}\b", "CHANGELOG's newest entry")
        self.assertEqual(re.search(r"(?m)^## (\d+\.\d+\.\d+)", open(J("CHANGELOG.md")).read()).group(1), v, "CHANGELOG's top heading")
        self.assertIn(v, open(J("README.md")).read())


if __name__ == "__main__":
    unittest.main()


def shell_scripts():
    """Every shipped shell script: install.sh and any file under the shipped folders whose first line runs sh or bash."""
    yield J("install.sh")
    for f in text_files():
        try:
            with open(f, encoding="utf-8") as fh:
                first = fh.readline()
        except (UnicodeDecodeError, OSError):
            continue
        if re.match(r"#!\s*(/usr/bin/env\s+)?(/bin/)?(ba)?sh\b", first):
            yield f


class NoTaskNumbers(unittest.TestCase):
    """SHEP-322: the person never sees or types a task number. The agents' instructions name a task by its title;
    its key (SHOP-2) is for commands only, and the prefix is nobody's to pick any more."""

    def read(self, name):
        with open(os.path.join(ROOT, "templates", name)) as f:
            return f.read()

    def test_the_assistant_names_tasks_by_title(self):
        a = self.read("assistant.md")
        for gone in ("PREFIX-n", "by its ID", "config --prefix", "The prefix is yours to pick", "by ID (", "PREFIX-An"):
            self.assertNotIn(gone, a)
        self.assertIn("name a task by its title, never by a key or a number", a)
        self.assertIn("Every `herdr-task` command takes a task by its title", a)
        self.assertIn("never write it in anything the person reads", a)
        self.assertIn("which wait, by title.", a)
        # the news it gets: the title in its words, the key only in the tag
        for line in re.findall(r"<herdr-news task=\"[A-Z]+-\d+\" event=\"[a-z-]+\">([^<]*)</herdr-news>", a):
            self.assertNotRegex(line, r"\b[A-Z]{2,}-\d+\b", line)
        # what it says to the person, in its examples, never holds a key
        for said in re.findall(r'\("([^"]+)"\)', a):
            self.assertNotRegex(said, r"\b[A-Z]{2,}-\d+\b", said)

    def test_the_worker_names_tasks_by_title(self):
        w = self.read("worker.md")
        self.assertIn("Name tasks by their titles in everything you write", w)
        self.assertIn("is for commands only: never write it anywhere the person reads", w)
        self.assertIn("[@Fix login](task:", w)

    def test_the_worker_proof_starts_with_for_you(self):
        w = self.read("worker.md")
        proof = next(l for l in w.splitlines() if l.startswith("- Proof,"))
        self.assertLess(proof.index('"For you"'), proof.index("what changed"))
        for words in ("check or decide", "could not prove", "decisions you took on your own"):
            self.assertIn(words, proof)


class ShellScripts(unittest.TestCase):
    """#731: macOS /bin/sh is bash 3.2, which scans a here-doc inside $( ) for quotes, so one apostrophe in its
    text breaks the whole script ("unexpected EOF while looking for matching `''"). Shipped scripts keep
    here-docs out of $( ), and each one parses."""

    def test_found_the_scripts(self):
        names = {os.path.relpath(f, ROOT) for f in shell_scripts()}
        self.assertIn(os.path.join("hooks", "session-note.sh"), names)
        self.assertIn("install.sh", names)
        self.assertIn(os.path.join("hooks", "ask-hook.sh"), names)
        self.assertIn(os.path.join("bin", "herdr-browser"), names)
        self.assertIn(os.path.join("bin", "herdr-desktop"), names)

    def test_no_here_doc_inside_command_substitution(self):
        # $( up to its first ), across lines, holding a here-doc (<< or <<-, not the <<< here-string)
        pat = re.compile(r"\$\([^)]*?(?<!<)<<-?(?!<)\s*['\"]?\w")
        for f in shell_scripts():
            with open(f, encoding="utf-8") as fh:
                m = pat.search(fh.read())
            self.assertIsNone(m, f"{os.path.relpath(f, ROOT)}: here-doc inside $( ): {m and m.group(0)!r}")

    def test_pattern_catches_the_old_note(self):
        pat = re.compile(r"\$\([^)]*?(?<!<)<<-?(?!<)\s*['\"]?\w")
        self.assertTrue(pat.search("note=$(cat <<'JSON'\nthe person's message\nJSON\n)"))
        self.assertTrue(pat.search("x=$(\n  cat <<EOF\nhi\nEOF\n)"))
        self.assertFalse(pat.search('new=$(jq -r .a <<<"$out")'))

    def test_no_bash4_builtins(self):
        # #736: macOS's /bin/bash 3.2 has no mapfile/readarray; restart.sh died there before restarting anything
        pat = re.compile(r"^[^#\n]*\b(mapfile|readarray)\b", re.M)
        for f in shell_scripts():
            with open(f, encoding="utf-8") as fh:
                m = pat.search(fh.read())
            self.assertIsNone(m, f"{os.path.relpath(f, ROOT)}: bash 4's {m and m.group(1)} (a while read loop works on 3.2)")

    def test_each_parses(self):
        # #908: macOS's bash is 3.2, and `bash -n` on a script that quotes an apostrophe inside a double-quoted ${...}
        # fails there ("syntax error near unexpected token `('"); plain bash fails it too, bash --posix and dash don't.
        # So every script parses under plain bash, and one whose first line says sh also under sh (dash here).
        import shutil
        import subprocess
        for f in shell_scripts():
            with open(f, encoding="utf-8") as fh:
                first = fh.readline()
            runs = [["bash", "-n"]] + ([] if "bash" in first else [["sh", "-n"]])
            for cmd in runs:
                if not shutil.which(cmd[0]):
                    continue
                out = subprocess.run(cmd + [f], capture_output=True, text=True)
                self.assertEqual(out.returncode, 0, f"{' '.join(cmd)} {os.path.relpath(f, ROOT)}: {out.stderr}")


class SessionNote(unittest.TestCase):
    """SHEP-42, SHEP-48: the chat's SessionStart hook (hooks/session-note.sh) adds every agent's Reactions
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
        out = subprocess.run(["sh", os.path.join(ROOT, "hooks", "session-note.sh")], capture_output=True, text=True, env=env)
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


class TestsOnAThrowawayHome(unittest.TestCase):
    """SHEP-147: no test reaches the person's real home (its question hook, chat cards, data, herdr-core)."""

    def test_every_test_file_loads_the_guard_first(self):
        import ast
        for f in sorted(os.listdir(J("test"))):
            if f.startswith("test") and f.endswith(".py"):
                body = ast.parse(open(J("test", f)).read()).body
                first = next(n for n in body if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)))
                self.assertTrue(isinstance(first, ast.Import) and first.names[0].name == "home_guard",
                                f"test/{f}: `import home_guard` must be its first statement")
        preload = open(J("test", "preload.ts")).read()
        self.assertIn("SHEPHERDR_HC", preload)
        self.assertIn("HC_TERMINAL_SOCKET", preload)

    def test_the_run_is_on_a_throwaway_home(self):
        self.assertNotEqual(os.path.realpath(os.path.expanduser("~")), home_guard.REAL)
        for k in ("HC_TERMINAL_SOCKET", "HC_TERMINAL_ID", "HERDR_APP_HOME"):
            self.assertNotIn(k, os.environ)

    def test_touching_the_real_home_fails_at_once(self):
        import subprocess
        hook = os.path.join(home_guard.REAL, ".local", "share", "herdr", "ask", "ask-hook.sh")
        with self.assertRaises(home_guard.RealHome):
            open(hook)
        with self.assertRaises(home_guard.RealHome):
            open(os.path.join(home_guard.REAL, ".config", "herdr-app", "data", "chat-asks", "req", "x.json"), "w")
        with self.assertRaises(home_guard.RealHome):
            subprocess.run(["true"], env={"HOME": home_guard.REAL, "PATH": os.environ["PATH"]})
        with self.assertRaises(home_guard.RealHome):
            subprocess.run(["true"], env={"PATH": os.environ["PATH"]})
        # this repo's own files are fine, wherever its worktree lives
        open(J("README.md")).close()
        subprocess.run(["true"], check=True)


class TerminalAndScreenInMenus(unittest.TestCase):
    """Terminal and Screen are rows of the space's name menu and the task's ⋯ menu, never header buttons."""

    def src(self, name):
        with open(os.path.join(ROOT, 'web', 'plugins', name, 'client.tsx')) as f:
            return f.read()

    def test_no_header_buttons(self):
        for name in ('terminal', 'screens'):
            s = self.src(name)
            self.assertNotIn('reg.header.push', s, name)
            self.assertNotIn('reg.taskHeader.push', s, name)

    def test_rows_in_both_menus(self):
        t, sc = self.src('terminal'), self.src('screens')
        self.assertIn('spaceTermRow', t)
        self.assertIn('taskTermRow', t)
        self.assertEqual(sc.count('screenRow(getState().ui'), 2)

    def test_header_keeps_tasks_and_artifacts(self):
        for name in ('tasks', 'artifacts'):
            self.assertIn('reg.header.push', self.src(name), name)

    def test_no_voice_button_in_the_header(self):
        # the voice call's button is the message box's round button (SHEP-363)
        self.assertNotIn('reg.header.push', self.src('voice'))
