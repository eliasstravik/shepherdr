"""herdr-browser's own care around agent-browser's arguments, against a fake agent-browser that logs them:
a relative file path is made absolute from the caller's folder (agent-browser's daemon saved it from its own, #964),
and a web address that doesn't answer is refused with why instead of hanging the browser (#1034)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import socket
import subprocess
import tempfile
import unittest

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
            f.write('#!/bin/sh\n[ "$1" = --version ] && { echo "agent-browser 0.41.1"; exit 0; }\n'
                    'for a in "$@"; do printf "%%s\\n" "$a"; done > %s\n' % self.log)
        os.chmod(self.bin, 0o755)

    def run_it(self, *args, **env):
        e = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **env}
        return subprocess.run(["sh", HB, "--task", "dev-shop#2", *args], env=e, cwd=self.here, capture_output=True, text=True)

    def args(self, *args):
        p = self.run_it(*args)
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(self.log) as f:
            return f.read().splitlines()[4:]  # after --session <s> --profile <p>

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
