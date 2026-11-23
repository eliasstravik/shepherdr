"""herdr-artifact (Shepherdr 3.2): an artifact is a web page (index.html and the files beside it). Publish keeps every
version (the last 20), a task's proof stays on its task until kept, and the person's note or answer goes to the agent
that made it, else its task's worker, else its space's Assistant. Runs in a throwaway store; no browser, no hc."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import glob
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stdout
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
sys.dont_write_bytecode = True


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


A = load("herdr_artifact_pages_under_test", TOOL)
REAL_CHROME = sorted(glob.glob(os.path.join(home_guard.REAL, ".agent-browser", "browsers", "chrome-*", "chrome")))


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-artifact-")
        self.store = os.path.join(self.dir, "store")
        self.folder = os.path.join(self.dir, "proj")
        os.makedirs(self.folder)
        self.who = {"terminal": "t9", "task": None}
        self.patches = [mock.patch.object(A, "STORE", self.store), mock.patch.object(A, "FILES", os.path.join(self.store, "files")),
                        mock.patch.dict(os.environ, {"HERDR_ARTIFACT_CHROME": ""}),
                        mock.patch.object(A, "me", lambda: dict(self.who))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def page(self, name="page", body="<h1>Hello</h1>", **files):
        d = os.path.join(self.dir, name)
        os.makedirs(d, exist_ok=True)
        for rel, text in {"index.html": f"<!doctype html><title>x</title>{body}", **files}.items():
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            with open(os.path.join(d, rel), "w") as f:
                f.write(text)
        return d

    def run_cmd(self, fn, **k):
        base = dict(id=None, title=None, folder=self.folder, task=None, note=None, json=True, proof=False, version=None, all=False)
        out = io.StringIO()
        with redirect_stdout(out):
            code = fn(types.SimpleNamespace(**{**base, **k}))
        self.assertEqual(code, 0)
        line = out.getvalue().strip().splitlines()[-1]
        return json.loads(line)

    def publish(self, d=None, **k):
        return self.run_cmd(A.cmd_publish, dir=d or self.page(), **k)

    def listed(self):
        return self.run_cmd(A.cmd_list)["artifacts"]

    def html(self, aid, v):
        with open(os.path.join(self.files(aid, v), "index.html")) as f:
            return f.read()

    def files(self, aid, v):
        return os.path.join(self.store, "files", aid, f"v{v}")


class Publish(Base):
    def test_a_page_and_its_files_are_kept_and_listed(self):
        a = self.publish(self.page(body='<img src="img/a.png"><link href="style.css" rel="stylesheet">', **{"style.css": "body{}", "img/a.png": "png"}),
                         title="Coverage by package")
        self.assertRegex(a["id"], r"^coverage-by-package-[0-9a-f]{4}$")
        self.assertEqual((a["version"], a["title"], a["publisher"], a["files"]), (1, "Coverage by package", "t9", ["img/a.png", "index.html", "style.css"]))
        self.assertEqual((a["proof"], a["pinned"], a["thumb"], a["warnings"]), (False, False, False, []))
        for rel in a["files"]:
            self.assertTrue(os.path.isfile(os.path.join(self.files(a["id"], 1), rel)))
        self.assertEqual([x["id"] for x in self.listed()], [a["id"]])
        self.assertEqual(self.run_cmd(A.cmd_list, all=True, folder=None)["artifacts"][0]["folder"], os.path.realpath(self.folder))

    def test_what_it_refuses(self):
        empty = os.path.join(self.dir, "empty")
        os.makedirs(empty)
        with self.assertRaisesRegex(A.Fail, "no index.html"):
            self.publish(empty, title="X")
        with self.assertRaisesRegex(A.Fail, "title"):
            self.publish()
        linked = self.page("linked")
        os.symlink("/etc/hostname", os.path.join(linked, "host.txt"))
        with self.assertRaisesRegex(A.Fail, "host.txt is a link"):
            self.publish(linked, title="X")
        big = self.page("big", **{"data.bin": "x" * 2048})
        with mock.patch.object(A, "MAX_BYTES", 1024), self.assertRaisesRegex(A.Fail, "Too big"):
            self.publish(big, title="X")
        self.assertEqual(self.listed(), [])

    def test_dot_files_and_node_modules_stay_out(self):
        a = self.publish(self.page(**{".env": "SECRET=1", "node_modules/x/index.js": "x", ".git/config": "x", "app.js": "1"}), title="X")
        self.assertEqual(a["files"], ["app.js", "index.html"])
        self.assertFalse(os.path.exists(os.path.join(self.files(a["id"], 1), ".env")))

    def test_links_that_wont_load_are_named(self):
        body = ('<img src="/abs.png"><img src="../up.png"><img src="file:///tmp/x.png"><img src="gone.png"><img src="ok.png?x=1#y">'
                '<a href="https://example.test/">x</a><a href="#top">y</a><a href="mailto:a@example.test">z</a><img src="data:image/png;base64,AA">')
        w = self.publish(self.page(body=body, **{"ok.png": "x"}), title="X")["warnings"]
        self.assertEqual(len(w), 4, w)
        for ref in ("/abs.png", "../up.png", "file:///tmp/x.png", "gone.png"):
            self.assertTrue(any(x.startswith(ref + ":") for x in w), (ref, w))

    def test_update_keeps_earlier_versions_the_last_twenty(self):
        a = self.publish(self.page(body="one"), title="Plan")
        b = self.publish(self.page(body="two"), id=a["id"], folder=None, note="second")
        self.assertEqual((b["id"], b["version"], b["title"]), (a["id"], 2, "Plan"))
        self.assertEqual([(x["v"], x.get("note")) for x in b["versions"]], [(1, None), (2, "second")])
        self.assertIn("one", self.html(a["id"], 1))
        self.assertIn("two", self.html(a["id"], 2))
        with mock.patch.object(A, "KEEP", 3):
            for i in range(3):
                last = self.publish(self.page(body=f"more {i}"), id=a["id"], folder=None)
        self.assertEqual([x["v"] for x in last["versions"]], [3, 4, 5])
        self.assertEqual(sorted(os.listdir(os.path.join(self.store, "files", a["id"]))), ["v3", "v4", "v5"])
        self.assertEqual(len(self.listed()), 1)

    def test_a_tasks_agent_names_its_task(self):
        self.who["task"] = "SHOP-4"
        a = self.publish(title="Coverage")
        # SHEP-322: the task rides in its own field, never in the title; an older "SHOP-4: " in front is dropped
        self.assertEqual((a["title"], a["task"], a["proof"]), ("Coverage", "SHOP-4", False))
        self.assertEqual(self.publish(title="SHOP-4: Plan")["title"], "Plan")

    def test_pictures_are_kept_with_the_version_when_a_browser_took_them(self):
        def fake(folder):
            tmp = tempfile.mkdtemp(dir=self.dir)
            out = {"dir": tmp}
            for n in (A.THUMB, A.THUMB_DARK):
                out[n] = os.path.join(tmp, n)
                A.png_write(out[n], 2, 2, 3, [bytearray(6), bytearray(6)])
            return out
        with mock.patch.object(A, "shoot", fake):
            a = self.publish(title="X")
        self.assertTrue(a["thumb"] and a["versions"][0]["thumb"])
        self.assertEqual(sorted(os.listdir(self.files(a["id"], 1))), [".thumb-dark.png", ".thumb.png", "index.html"])
        self.assertEqual(a["files"], ["index.html"])
        b = self.publish(id=a["id"], folder=None)  # no browser this time: published all the same, without a picture
        self.assertFalse(b["thumb"])
        self.assertEqual([bool(x.get("thumb")) for x in b["versions"]], [True, False])

    def test_a_new_version_gets_its_own_picture_in_a_folder_that_is_not_a_repo(self):
        # SHEP-344: version 2 of a page (an index.html with PNGs beside it), kept for a plain folder
        self.assertFalse(os.path.exists(os.path.join(self.folder, ".git")))
        taken = []

        def fake(folder):
            with open(os.path.join(folder, "index.html")) as f:
                taken.append(f.read())
            tmp = tempfile.mkdtemp(dir=self.dir)
            out = {"dir": tmp}
            for n in (A.THUMB, A.THUMB_DARK):
                out[n] = os.path.join(tmp, n)
                A.png_write(out[n], 2, 2, 3, [bytearray([len(taken)] * 6)] * 2)
            return out
        with mock.patch.object(A, "shoot", fake):
            a = self.publish(self.page("one", body="<h1>One</h1>"), title="Research")
            b = self.publish(self.page("two", body="<h1>Two</h1><img src='a.png'>", **{"a.png": "PNG"}), id=a["id"], folder=None)
        self.assertEqual(b["version"], 2)
        self.assertTrue(b["thumb"] and all(x["thumb"] for x in b["versions"]))
        self.assertIn("Two", taken[1])
        with open(os.path.join(self.files(a["id"], 1), A.THUMB), "rb") as f1, open(os.path.join(self.files(a["id"], 2), A.THUMB), "rb") as f2:
            self.assertNotEqual(f1.read(), f2.read())  # its own picture, not version 1's
        self.assertIn("a.png", os.listdir(self.files(a["id"], 2)))

    @unittest.skipUnless(REAL_CHROME, "no Chrome for Testing on this machine")
    def test_a_real_browser_takes_the_page_light_and_dark(self):
        d = self.page(body="<style>:root{color-scheme:light dark}</style><h1>Hello</h1><img src='a.svg'>",
                      **{"a.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'})
        with mock.patch.dict(os.environ, {"HERDR_ARTIFACT_CHROME": REAL_CHROME[-1]}):
            shots = A.shoot(d)
        try:
            self.assertEqual(A.png_size(shots[A.THUMB]), A.SHOT)
            self.assertEqual(A.png_size(shots[A.THUMB_DARK]), A.SHOT)
            light, dark = (A.png_read(shots[n], upto=4)[3][2][:3] for n in (A.THUMB, A.THUMB_DARK))
            self.assertGreater(sum(light), sum(dark) + 300)
        finally:
            shutil.rmtree(shots["dir"], ignore_errors=True)


class ProofAndFlags(Base):
    def test_a_proof_stays_on_its_task_until_kept(self):
        with self.assertRaisesRegex(A.Fail, "--proof needs the task"):
            self.publish(title="Fix login · Proof", proof=True)
        a = self.publish(title="Fix login · Proof", task="SHOP-4", proof=True)
        self.assertEqual((a["proof"], a["task"], a["title"]), (True, "SHOP-4", "Fix login · Proof"))
        self.assertTrue(self.listed()[0]["proof"])
        self.assertTrue(self.publish(id=a["id"], folder=None)["proof"])  # an update is still its proof
        kept = self.run_cmd(A.cmd_keep, id=a["id"])
        self.assertFalse(kept["proof"])
        self.assertFalse(self.publish(id=a["id"], folder=None, proof=True)["proof"])  # once kept, it stays an artifact

    def test_a_task_page_titled_proof_is_its_proof_without_the_flag(self):
        self.assertTrue(self.publish(title="Fix login · Proof", task="SHOP-4")["proof"])
        self.assertFalse(self.publish(title="Fix login · Proof")["proof"])       # no task: nothing to stay on
        self.assertFalse(self.publish(title="Proof of concept", task="SHOP-4")["proof"])

    def task_list(self, slug, prefix, folder, ids):
        tdir = os.path.join(self.dir, "tasks")
        os.makedirs(tdir, exist_ok=True)
        with open(os.path.join(tdir, slug + ".json"), "w") as f:
            json.dump({"prefix": prefix, "folder": folder, "tasks": [{"id": i} for i in ids]}, f)
        return tdir

    def test_a_task_page_is_filed_under_its_tasks_folder_wherever_it_is_published_from(self):
        """Published from a scratch folder, a task's proof goes to its task's folder, where ready looks."""
        tdir = self.task_list("proj", "SHOP", os.path.realpath(self.folder), [4])
        scratch = os.path.join(self.dir, "scratch")
        os.makedirs(scratch)
        here = os.getcwd()
        os.chdir(scratch)
        try:
            with mock.patch.object(A, "SHEP", lambda rel: tdir if rel == ".herdr/tasks" else rel):
                a = self.publish(title="Fix login · Proof", task="SHOP-4", proof=True, folder=None)
                self.assertEqual(a["folder"], os.path.realpath(self.folder))
                b = self.publish(title="Notes", task="SHOP-9", folder=None)       # a task no list has: here
                self.assertEqual(b["folder"], os.path.realpath(scratch))
                c = self.publish(title="Elsewhere", task="SHOP-4", folder=scratch)  # --folder still wins
                self.assertEqual(c["folder"], os.path.realpath(scratch))
                # two lists with that prefix both have #4: this agent's own list decides, else here
                other = os.path.join(self.dir, "other")
                os.makedirs(other)
                self.task_list("other", "SHOP", other, [4])
                self.assertEqual(self.publish(title="Two", task="SHOP-4", folder=None)["folder"], os.path.realpath(scratch))
                with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "other#4"}):
                    self.assertEqual(A.task_folder("SHOP-4"), other)
        finally:
            os.chdir(here)

    def test_pin_unpin_and_rename(self):
        a = self.publish(title="Plan")
        self.assertTrue(self.run_cmd(A.cmd_pin, id=a["id"])["pinned"])
        self.assertTrue(self.listed()[0]["pinned"])
        self.assertFalse(self.run_cmd(A.cmd_unpin, id=a["id"])["pinned"])
        r = self.run_cmd(A.cmd_rename, id=a["id"], title="  The   plan ")
        self.assertEqual((r["title"], r["version"], r["at"]), ("The plan", 1, a["at"]))
        with self.assertRaisesRegex(A.Fail, "name"):
            self.run_cmd(A.cmd_rename, id=a["id"], title="  ")
        with self.assertRaisesRegex(A.Fail, "No artifact"):
            self.run_cmd(A.cmd_pin, id="nope-0000")

    def test_restore_makes_a_copy_of_an_earlier_version_the_newest(self):
        a = self.publish(self.page(body="one", **{"a.css": "x"}), title="Plan")
        self.publish(self.page("p2", body="two"), id=a["id"], folder=None)
        r = self.run_cmd(A.cmd_restore, id=a["id"], version=1)
        self.assertEqual((r["version"], r["files"]), (3, ["a.css", "index.html"]))
        self.assertEqual([(x["v"], x.get("restored")) for x in r["versions"]], [(1, None), (2, None), (3, 1)])
        self.assertIn("one", self.html(a["id"], 3))
        self.assertIn("two", self.html(a["id"], 2))
        with self.assertRaisesRegex(A.Fail, "newest version"):
            self.run_cmd(A.cmd_restore, id=a["id"], version=3)
        with self.assertRaisesRegex(A.Fail, "isn't kept"):
            self.run_cmd(A.cmd_restore, id=a["id"], version=9)

    def test_rm_removes_it_and_its_files(self):
        a = self.publish(title="Plan")
        self.assertEqual(self.run_cmd(A.cmd_rm, id=a["id"]), {"removed": a["id"]})
        self.assertEqual(self.listed(), [])
        self.assertFalse(os.path.exists(os.path.join(self.store, "files", a["id"])))


class Hc:
    """hc as herdr-artifact asks it: the live terminals, the Assistants (with their folders), and what was sent."""

    def __init__(self, live=(), assistants=None, blocked=False):
        self.live, self.assistants, self.blocked, self.sent = list(live), assistants or {}, blocked, []
        self.real = A.run

    def __call__(self, args, **k):
        if args[0] != "hc":
            return self.real(args, **k)
        ok = lambda out="": types.SimpleNamespace(returncode=0, stdout=out, stderr="")
        if args[1] == "ls" and "--label" in args:
            return ok(json.dumps({"terminals": [{"address": a, "state": "live", "cwd": cwd} for a, cwd in self.assistants.items()]}))
        if args[1] == "ls":
            return ok(json.dumps({"terminals": [{"address": a, "state": "live"} for a in self.live]}))
        if args[1] == "send":
            if self.blocked:
                return types.SimpleNamespace(returncode=1, stdout="", stderr=json.dumps({"error": {"kind": "blocked", "message": "t9 is blocked (question)"}}))
            self.sent.append((args[2], args[3]))
            return ok()
        return types.SimpleNamespace(returncode=1, stdout="", stderr="no")


class Told(Base):
    def tell(self, hc, fn=None, **k):
        with mock.patch.object(A, "run", hc):
            return self.run_cmd(fn or A.cmd_note, **{"spot": None, **k})

    def test_a_note_with_its_pin_goes_to_the_agent_that_made_it(self):
        a = self.publish(title='Plan "B" <x>')
        hc = Hc(live=["t9"])
        out = self.tell(hc, id=a["id"], text="Make the table wider", spot="0.42,0.31")
        self.assertEqual((out["to"], out["why"], out["version"]), ("t9", "made it", 1))
        to, body = hc.sent[0]
        self.assertEqual(to, "t9")
        self.assertEqual(body.splitlines()[0], f'<hc from="artifact" id="{a["id"]}" version="1" title="Plan ”B” x" spot="0.420,0.310">')
        self.assertIn("Make the table wider", body)
        self.assertIn("(Their pin: 42% from the left, 31% from the top of the page (near the top center).)", body)
        self.assertTrue(body.endswith("</hc>"))

    def test_a_note_on_an_older_version_says_so_and_words_stay_words(self):
        a = self.publish(title="Plan")
        self.publish(id=a["id"], folder=None)
        hc = Hc(live=["t9"])
        self.tell(hc, id=a["id"], text="This one", version=1, spot="the second table")
        body = hc.sent[0][1]
        self.assertIn('version="1"', body)
        self.assertIn('on="the second table"', body)
        self.assertIn("(Written on v1; the latest is v2.)", body)

    def test_an_answer_from_the_page(self):
        a = self.publish(title="Plan")
        hc = Hc(live=["t9"])
        out = self.tell(hc, A.cmd_say, id=a["id"], text="Ship it")
        self.assertEqual(out["to"], "t9")
        self.assertEqual(hc.sent[0][1], f'<hc from="artifact" id="{a["id"]}" version="1" title="Plan" answer>\nShip it\n</hc>')
        with self.assertRaisesRegex(A.Fail, "Nothing to send"):
            self.tell(hc, A.cmd_say, id=a["id"], text="  ")

    def test_its_agent_gone_the_note_goes_to_its_spaces_chat(self):
        a = self.publish(title="Plan")
        other = os.path.join(self.dir, "other")
        os.makedirs(other)
        hc = Hc(live=["t1", "t2"], assistants={"t1": other, "t2": self.folder})
        out = self.tell(hc, id=a["id"], text="Change the title")
        self.assertEqual(out["to"], "t2")
        self.assertIn("Assistant", out["why"])
        body = hc.sent[0][1]
        self.assertIn("The agent that made this page has ended, so this comes to you.", body)
        self.assertIn(self.files(a["id"], 1), body)

    def test_no_agent_and_no_chat_says_so(self):
        a = self.publish(title="Plan")
        hc = Hc(live=["t1"], assistants={"t1": os.path.join(self.dir)})
        with self.assertRaisesRegex(A.Fail, "has no chat running"):
            self.tell(hc, id=a["id"], text="Change the title")
        self.assertEqual(hc.sent, [])

    def test_a_note_to_an_agent_waiting_on_a_question_is_held(self):
        a = self.publish(title="Plan")
        hc = Hc(live=["t9"], blocked=True)
        with mock.patch.object(A, "hold_note", return_value=True) as hold:
            out = self.tell(hc, id=a["id"], text="Later")
        self.assertTrue(out["held"])
        self.assertEqual(hold.call_args[0][0], "t9")
        self.assertIn("Later", hold.call_args[0][1])


class CommandLine(unittest.TestCase):
    """The real command, on the throwaway home: new, publish, list, and the page served by preview."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-artifact-cli-")
        self.env = {**os.environ, "HOME": self.dir, "HERDR_ARTIFACT_CHROME": "", "PATH": os.environ.get("PATH", "")}
        self.pid = None

    def tearDown(self):
        if self.pid:
            try:
                os.kill(self.pid, 15)
            except OSError:
                pass
        shutil.rmtree(self.dir, ignore_errors=True)

    def cli(self, *args):
        p = subprocess.run([sys.executable, "-B", TOOL, *args], cwd=self.dir, env=self.env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr + p.stdout)
        return p.stdout

    def get(self, url):
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                return r.status, dict((k.lower(), v) for k, v in r.headers.items()), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict((k.lower(), v) for k, v in e.headers.items()), e.read()

    def test_new_publish_and_preview(self):
        page = os.path.join(self.dir, "page")
        self.cli("new", page)
        with open(os.path.join(page, "index.html")) as f:
            html = f.read()
        self.assertIn("color-scheme: light dark", html)
        self.assertIn("parent.postMessage({ shepherdr: 'answer'", html)
        with open(os.path.join(page, "data.json"), "w") as f:
            f.write('{"n": 1}')
        a = json.loads(self.cli("publish", page, "--title", "First page", "--json"))
        self.assertEqual(a["warnings"], [])
        self.assertEqual(json.loads(self.cli("list", "--all", "--json"))["artifacts"][0]["id"], a["id"])
        self.assertIn(a["id"], self.cli("list"))
        link = json.loads(self.cli("preview", a["id"], "--json"))["link"]
        with open(os.path.join(self.dir, ".herdr", "artifacts", ".preview")) as f:
            self.pid = json.load(f)["pid"]
        self.assertRegex(link, rf"^http://127\.0\.0\.1:\d+/[\w-]+/{a['id']}/v1/$")
        code, head, body = self.get(link)
        self.assertEqual((code, head["content-type"], body.decode()), (200, "text/html; charset=utf-8", html))
        self.assertEqual(head["content-security-policy"], "sandbox allow-scripts allow-forms allow-popups")
        self.assertEqual(self.get(link + "data.json")[::2], (200, b'{"n": 1}'))
        base, token = link.split("/" + a["id"])[0].rsplit("/", 1)
        for bad in (link + ".thumb.png", link + "%2e%2e/%2e%2e/%2e%2e/proj.json", link + "nope.css", f"{base}/{token}/{a['id']}/v7/"):
            self.assertEqual(self.get(bad)[0], 404, bad)
        self.assertEqual(self.get(f"{base}/wrong-token/{a['id']}/v1/")[0], 403)
        self.assertEqual(self.get(link.replace("127.0.0.1", "localhost"))[0], 200)

    def test_the_guide_is_for_pages_and_carries_the_starter_style(self):
        guide = self.cli("guide")
        self.assertIn(A.CSS, guide)
        self.assertIn("parent.postMessage({ shepherdr: 'answer', text:", guide)
        self.assertIn("--proof", guide)
        self.assertIn("Not proven", guide)
        for gone in ("recipe", "herdr-app", "main.js", "--custom"):
            self.assertNotIn(gone, guide)


if __name__ == "__main__":
    unittest.main()
