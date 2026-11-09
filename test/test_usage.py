"""Usage insights (docs/insights.md) never calls the network: its files use no network API, import nothing that can,
and the web app's one call goes to its own service (a relative api/action). No analytics or telemetry package either."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)
FILES = ["core/usage.js", "lib/usage.js", "service/usage.ts", "web/src/usage.ts"]
NETWORK = [r"\bXMLHttpRequest\b", r"\bWebSocket\b", r"\bsendBeacon\b", r"\bEventSource\b", r"https?://", r"\bBun\.connect\b",
           r"\bBun\.listen\b", r"\bBun\.serve\b", r"\bnode:(net|http|https|http2|dgram|tls|dns)\b", r"\brequire\(", r"\bimport\(",
           r"\bcurl\b", r"\bwget\b", r"\bnc\b", r"\bssh\b"]
# what each may import: local files and node's file system only
IMPORTS = {"herdr", "node:fs", "node:path", "./addons.js", "./core/usage.js", "./paths.ts", "../core/usage.js", "./window.ts",
           "./paths.js", "./dirs.js", "./core/paths.js"}  # Shepherdr's folders (core/paths.js, lib/dirs.js): paths only
TELEMETRY = ["posthog", "segment", "sentry", "mixpanel", "amplitude", "analytics", "telemetry", "datadog", "plausible", "heap"]


class UsageIsLocal(unittest.TestCase):
    def test_no_network_calls(self):
        for f in FILES:
            text = open(J(f)).read()
            code = re.sub(r"(?m)^\s*(//|\*|/\*).*$", "", text)  # comments may say what it never does
            for pat in NETWORK:
                self.assertNotRegex(code, pat, f"{f} uses {pat}")
            for m in re.findall(r"""^import[^'"]*['"]([^'"]+)['"]""", code, re.M):
                self.assertIn(m, IMPORTS, f"{f} imports {m}")
            calls = re.findall(r"\bfetch\(\s*([^,)]+)", code)
            if f == "web/src/usage.ts":
                self.assertEqual(calls, ["'api/action'"], "the web app sends only to its own service")
            else:
                self.assertEqual(calls, [], f"{f} calls fetch")

    def test_the_window_writes_with_a_local_shell_only(self):
        text = open(J("lib/usage.js")).read()
        progs = re.findall(r"\bexec\(\s*\"(\w+)\"", text)
        self.assertTrue(progs and set(progs) == {"sh"}, progs)
        self.assertNotIn("on:", text, "the window writes on its own machine only")

    def test_no_telemetry_packages(self):
        for p in ("package.json", "web/package.json"):
            if not os.path.isfile(J(p)):
                continue
            pkg = json.load(open(J(p)))
            deps = " ".join({**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}).lower()
            for name in TELEMETRY:
                self.assertNotIn(name, deps, f"{p} depends on a {name} package")

    def test_the_addon_says_its_promise(self):
        a = next(x for x in json.load(open(J("lib", "addons.json")))["addons"] if x["id"] == "insights")
        self.assertTrue(a["switch"])
        self.assertIn("never sent to Shepherdr's makers", a["about"])
        self.assertIn("never your words", a["about"])
        self.assertIn("Usage insights", open(J("templates", "assistant.md")).read())


if __name__ == "__main__":
    unittest.main()
