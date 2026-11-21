"""The window chat's lookJobs() (mods/chat/main.js) keeps an open subagent row open (GitHub #1103): a reviewer's or
helper's row (id c:<address>) is never one of jobs(), so it closed itself a moment after it was opened. The method
is run as written in main.js, in node, with the window's helpers stubbed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "mods", "chat", "main.js")
SRC = open(MAIN, encoding="utf-8").read()
MATCH = re.search(r"\n  async lookJobs\(cx\) \{\n.*?\n  \}\n", SRC, re.S)

HARNESS = r"""
const input = %(input)s;
const terminals = () => input.kids;
const subagentsOf = (ks, addr) => ks.filter((k) => k.parent === addr);
const obj = { %(method)s };
const self = { t: { foreground: { pid: 1 } }, conv: {}, phase: "ready", addr: "m/t1", jobOpen: input.open,
  bgJobs: { due: () => false }, jobs: () => input.jobs, jobOut: new Map() };
await obj.lookJobs.call(self, { notify: () => {} });
console.log(JSON.stringify({ open: self.jobOpen }));
"""


def run(open_id, kids=(), jobs=()):
    inp = {"open": open_id, "kids": list(kids), "jobs": list(jobs)}
    script = HARNESS % {"method": MATCH.group(0).strip(), "input": json.dumps(inp)}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "jobs.mjs")
        with open(path, "w") as f:
            f.write(script)
        out = subprocess.run(["node", path], capture_output=True, text=True, check=True).stdout
    return json.loads(out)["open"]


class SubagentRowStaysOpen(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MATCH is None or shutil.which("node") is None:
            raise unittest.SkipTest("main.js lookJobs() not found or no node")

    def test_an_open_reviewer_row_stays_open_while_the_reviewer_is_there(self):
        self.assertEqual(run("c:m/t2", kids=[{"address": "m/t2", "parent": "m/t1"}]), "c:m/t2")

    def test_it_closes_once_the_reviewer_is_gone(self):
        self.assertIsNone(run("c:m/t2", kids=[]))

    def test_a_shell_row_closes_once_its_job_ends_as_before(self):
        self.assertIsNone(run("t9", kids=[{"address": "m/t2", "parent": "m/t1"}]))
        self.assertEqual(run("t9", jobs=[{"id": "t9"}]), "t9")


if __name__ == "__main__":
    unittest.main()
