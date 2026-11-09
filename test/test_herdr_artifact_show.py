"""herdr-artifact open and link (SHEP-99): an agent shows the person an artifact wherever they are. With no Herdr window
on the machine (a VM) open never crashes: it asks the person's web app page through the core label herdr.show and
prints the artifact's link, which the web app's host wrote in herdr-core's document shepherdr.web. Runs the real
command in a throwaway home with a fake hc first on PATH and no herdr-app; nothing is installed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
LINK = "https://hub.example.test/shepherdr/"

# hc as herdr-artifact uses it: connect answers hello and doc.get (shepherdr.web: $FAKE_WEB, JSON, or unset);
# label is logged to $FAKE_LOG; get knows no labels.
FAKE_HC = r'''#!/usr/bin/env python3
import json, os, sys
cmd = sys.argv[1:2]
if cmd == ["connect"]:
    for line in sys.stdin:
        m = json.loads(line)
        if m["method"] == "hello":
            r = {"generation": 1, "framed": False, "methods": ["doc.get"]}
        elif m["method"] == "doc.get" and m["params"]["name"] == "shepherdr.web" and os.environ.get("FAKE_WEB"):
            r = {"value": json.loads(os.environ["FAKE_WEB"]), "version": 3}
        else:
            r = {"value": None, "version": 0}
        print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
elif cmd == ["label"]:
    with open(os.environ["FAKE_LOG"], "a") as f:
        f.write(json.dumps(sys.argv[2:]) + "\n")
elif cmd == ["get"]:
    print("{}")
else:
    sys.exit(2)
'''


class Show(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-show-")
        self.home = os.path.join(self.dir, "home")
        self.bin = os.path.join(self.dir, "bin")
        self.log = os.path.join(self.dir, "labels.log")
        self.folder = os.path.join(self.dir, "proj")
        for d in (self.home, self.bin, self.folder):
            os.makedirs(d)
        hc = os.path.join(self.bin, "hc")
        with open(hc, "w") as f:
            f.write(FAKE_HC)
        os.chmod(hc, 0o755)
        # python3 and the basics only: no herdr-app (and no real hc) on this PATH
        py = os.path.join(self.bin, "python3")
        os.symlink(sys.executable, py)
        self.env = {"HOME": self.home, "PATH": f"{self.bin}:/usr/bin:/bin", "FAKE_LOG": self.log,
                    "HERDR_APP_HOME": os.path.join(self.dir, "app"), "HC_TERMINAL_ID": "t5"}
        rec = os.path.join(self.dir, "report")
        os.makedirs(rec)
        with open(os.path.join(rec, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": [{"type": "text", "md": "How to group tasks."}]}, f)
        out = self.run_tool("publish", rec, "--title", "How to group tasks", "--folder", self.folder, "--json")
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)
        self.aid = json.loads(out.stdout.strip().splitlines()[-1])["id"]

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_tool(self, *args, **env):
        return subprocess.run([sys.executable, TOOL, *args], env={**self.env, **env}, cwd=self.folder,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)

    def labels(self):
        try:
            with open(self.log) as f:
                return [json.loads(x) for x in f]
        except OSError:
            return []

    def test_open_without_a_window_asks_the_screen_and_gives_the_link(self):
        r = self.run_tool("open", self.aid, FAKE_WEB=json.dumps({"link": LINK, "id": "hub-core"}))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        self.assertIn(f"Link: {LINK}?artifact={self.aid}", r.stdout)
        self.assertIn("Asked the person's screen", r.stdout)
        (label,) = self.labels()
        self.assertEqual(label[0], "t5")
        key, _, value = label[1].partition("=")
        self.assertEqual(key, "herdr.show")
        ask = json.loads(value)
        self.assertEqual(ask["artifact"], self.aid)
        self.assertTrue(ask["id"] and ask["at"] > 0)

    def test_open_json_says_what_it_did(self):
        r = self.run_tool("open", self.aid, "--json", FAKE_WEB=json.dumps({"link": LINK.rstrip("/"), "id": "hub-core"}))
        out = json.loads(r.stdout)
        self.assertEqual(out, {"id": self.aid, "link": f"{LINK}?artifact={self.aid}", "screen": True, "window": None})

    def test_link_prints_only_the_link(self):
        r = self.run_tool("link", self.aid, FAKE_WEB=json.dumps({"link": LINK, "id": "hub-core"}))
        self.assertEqual((r.returncode, r.stdout), (0, f"{LINK}?artifact={self.aid}\n"))
        self.assertEqual(self.labels(), [])

    def test_no_host_word_then_this_machines_own_service(self):
        os.makedirs(os.path.join(self.home, ".herdr", "shepherdr"))
        with open(os.path.join(self.home, ".herdr", "shepherdr", "web.json"), "w") as f:
            json.dump({"on": True, "link": "https://laptop.example.test/shepherdr/"}, f)
        r = self.run_tool("link", self.aid)
        self.assertEqual(r.stdout, f"https://laptop.example.test/shepherdr/?artifact={self.aid}\n")

    def test_no_link_known_still_asks_the_screen(self):
        r = self.run_tool("open", self.aid)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("No web link is known here yet", r.stdout)
        self.assertEqual(len(self.labels()), 1)
        self.assertEqual(self.run_tool("link", self.aid).returncode, 1)

    def test_outside_an_agents_terminal_the_link_is_enough(self):
        r = self.run_tool("open", self.aid, HC_TERMINAL_ID="", FAKE_WEB=json.dumps({"link": LINK, "id": "hub-core"}))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Asked", r.stdout)
        self.assertEqual(self.labels(), [])

    def test_an_unknown_artifact_says_so(self):
        r = self.run_tool("open", "nope-1234")
        self.assertEqual(r.returncode, 1)
        self.assertIn("No artifact 'nope-1234'", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
