"""herdr-browser's own care around agent-browser's arguments, against a fake agent-browser that logs them
(test/fake_ab.py: it answers the space's browser and the join, and logs the command itself):
a relative file path is made absolute from the caller's folder (agent-browser's daemon saved it from its own, #964),
and a web address that doesn't answer is refused with why instead of hanging the browser (#1034)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import socket
import subprocess
import tempfile
import unittest

import fake_ab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HB = os.path.join(ROOT, "bin", "herdr-browser")
# a private address nothing answers on: a connection to it waits until its timeout
SILENT = "10.255.255.1"


class BrowserArgs(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-browser-args-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.here = os.path.join(self.home, "work")
        os.makedirs(self.here)
        self.log = os.path.join(self.home, "ab.log")
        self.bin = os.path.join(self.home, "agent-browser")
        with open(self.bin, "w") as f:
            f.write(fake_ab.script('for a in "$@"; do printf "%%s\\n" "$a"; done > %s' % self.log))
        os.chmod(self.bin, 0o755)

    def run_it(self, *args, **env):
        e = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **fake_ab.ENV, **env}
        return subprocess.run(["sh", HB, "--task", "dev-shop#2", "--space", "sp1", *args], env=e, cwd=self.here, capture_output=True, text=True)

    def args(self, *args):
        p = self.run_it(*args)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(self.log) as f:
            return f.read().splitlines()  # the command, after --session <s> --cdp <url> --pin-tab --idle-timeout 0

    def test_a_relative_screenshot_lands_where_the_agent_is(self):
        self.assertEqual(self.args("screenshot", "shot.png"), ["screenshot", os.path.join(self.here, "shot.png")])
        self.assertEqual(self.args("screenshot", "--full", "out/a b.jpg"), ["screenshot", "--full", os.path.join(self.here, "out/a b.jpg")])
        self.assertEqual(self.args("screenshot", "#card", "card.png"), ["screenshot", "#card", os.path.join(self.here, "card.png")])

    def test_absolute_paths_selectors_and_refs_stay(self):
        self.assertEqual(self.args("screenshot", "/abs/x.png"), ["screenshot", "/abs/x.png"])
        self.assertEqual(self.args("screenshot", "@e3"), ["screenshot", "@e3"])
        self.assertEqual(self.args("screenshot"), ["screenshot"])
        self.assertEqual(self.args("click", "a.png"), ["click", "a.png"])  # not a file command: as given

    def test_pdf_recording_download_and_folders(self):
        h = self.here
        self.assertEqual(self.args("pdf", "page.pdf"), ["pdf", f"{h}/page.pdf"])
        self.assertEqual(self.args("record", "start", "clip.webm", "https://example.test"),
                         ["record", "start", f"{h}/clip.webm", "https://example.test"])
        self.assertEqual(self.args("download", "#get", "files/report"), ["download", "#get", f"{h}/files/report"])
        self.assertEqual(self.args("--screenshot-dir", "shots", "screenshot"), ["--screenshot-dir", f"{h}/shots", "screenshot"])
        self.assertEqual(self.args("--download-path=dl", "click", "@e1"), [f"--download-path={h}/dl", "click", "@e1"])

    def test_a_page_that_answers_is_opened(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        self.addCleanup(s.close)
        url = f"http://127.0.0.1:{s.getsockname()[1]}/"
        self.assertEqual(self.args("open", url), ["open", url])
        # nothing listening (refused at once): Chrome shows its own error page, so it goes through
        s2 = socket.socket()
        s2.bind(("127.0.0.1", 0))
        port = s2.getsockname()[1]
        s2.close()
        self.assertEqual(self.args("open", f"http://127.0.0.1:{port}/"), ["open", f"http://127.0.0.1:{port}/"])

    def test_a_page_that_doesnt_answer_is_refused_with_why(self):
        try:
            socket.create_connection((SILENT, 80), timeout=0.5).close()
            self.skipTest("this network answers on the silent address")
        except socket.timeout:
            pass
        except OSError:
            self.skipTest("this network refuses the silent address at once")
        p = self.run_it("open", f"http://{SILENT}/", HERDR_BROWSER_CONNECT_WAIT="0.5")
        self.assertEqual(p.returncode, 4)
        self.assertIn(f"can't open http://{SILENT}/: {SILENT}:80 did not answer within 0.5 s", p.stderr)
        self.assertFalse(os.path.exists(self.log), "the browser wasn't sent there")


if __name__ == "__main__":
    unittest.main()


class BrowserAnswers(unittest.TestCase):
    """What herdr-browser says when agent-browser doesn't answer as it should: a dropped reply is tried once more
    (#1081), an open that never comes back is cut off with why (#1154), and a browser Herdr closed says so once (#1147)."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-browser-ans-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.bin = os.path.join(self.home, "agent-browser")
        self.count = os.path.join(self.home, "count")

    def fake(self, body):
        with open(self.bin, "w") as f:
            f.write(fake_ab.script('echo x >> %s\nn=$(wc -l < %s | tr -d " ")\n%s' % (self.count, self.count, body)))
        os.chmod(self.bin, 0o755)

    def run_it(self, *args, **env):
        e = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **fake_ab.ENV, **env}
        return subprocess.run(["sh", HB, "--task", "dev-shop#2", "--space", "sp1", *args], env=e, capture_output=True, text=True, timeout=60)

    def calls(self):
        with open(self.count) as f:
            return len(f.read().splitlines())

    def test_a_dropped_reply_is_tried_once_more(self):
        self.fake('[ "$n" = 1 ] && { echo "Invalid response: EOF" >&2; exit 1; }; echo "viewport set"')
        p = self.run_it("set", "viewport", "390", "844")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("viewport set", p.stdout)
        self.assertIn("trying once more", p.stderr)
        self.assertEqual(self.calls(), 2)

    def test_dropped_twice_says_so_plainly(self):
        self.fake('echo "Invalid response: EOF" >&2; exit 1')
        p = self.run_it("set", "viewport", "390", "844")
        self.assertEqual(p.returncode, 1)
        self.assertIn("dropped its answer to set twice", p.stderr)
        self.assertEqual(self.calls(), 2)

    def test_an_acting_command_is_never_repeated(self):
        self.fake('echo "Invalid response: EOF" >&2; exit 1')
        p = self.run_it("click", "@e2")
        self.assertEqual(p.returncode, 1)
        self.assertEqual(self.calls(), 1)

    def test_an_open_that_never_comes_back_is_cut_off_with_why(self):
        self.fake('exec sleep 30')
        p = self.run_it("open", "about:blank", HERDR_BROWSER_OPEN_WAIT="2")
        self.assertEqual(p.returncode, 124)
        self.assertIn("didn't finish within 2 s", p.stderr)

    def test_a_browser_herdr_closed_says_so_once(self):
        self.fake('echo ok')
        root = os.path.join(self.home, ".herdr", "browser")
        os.makedirs(root, exist_ok=True)
        with open(os.path.join(root, "dev-shop-2.closed"), "w") as f:
            f.write("it was closed after 10 minutes unused\n")
        p = self.run_it("snapshot")
        self.assertIn("had been closed (it was closed after 10 minutes unused)", p.stderr)
        self.assertIn("set the viewport again", p.stderr)
        self.assertNotIn("had been closed", self.run_it("snapshot").stderr)
