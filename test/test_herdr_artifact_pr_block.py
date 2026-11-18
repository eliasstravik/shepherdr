"""herdr-artifact's `pr` recipe block: `pr-block` turns gh's answer into a block (state, checks, review), the publish
check accepts it and says what is wrong with a bad one, and a recipe's table cells are Markdown. gh is faked; nothing
is installed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import json
import os
import shutil
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


A = load("herdr_artifact_pr_block_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))
URL = "https://github.com/eliasstravik/shepherdr/pull/12"
VIEW = {"number": 12, "title": "Add a pr block", "url": URL, "state": "OPEN", "isDraft": False, "statusCheckRollup": [], "reviewDecision": ""}


class Ref(unittest.TestCase):
    def test_a_reference_reads_as_repo_and_number(self):
        self.assertEqual(A.parse_pr_ref("eliasstravik/shepherdr#12"), ("eliasstravik/shepherdr", 12))
        self.assertEqual(A.parse_pr_ref(URL + "/files"), ("eliasstravik/shepherdr", 12))
        self.assertEqual(A.parse_pr_ref("#12"), (None, 12))
        with self.assertRaises(A.Fail):
            A.parse_pr_ref("not a pr")


class Block(unittest.TestCase):
    def block(self, **over):
        return A.pr_block({**VIEW, **over}, "eliasstravik/shepherdr")

    def test_state_from_gh(self):
        self.assertEqual(self.block()["state"], "open")
        self.assertEqual(self.block(isDraft=True)["state"], "draft")
        self.assertEqual(self.block(state="MERGED")["state"], "merged")
        self.assertEqual(self.block(state="CLOSED", isDraft=True)["state"], "closed")

    def test_checks_roll_up_to_one_chip(self):
        ok, bad, run = {"conclusion": "SUCCESS"}, {"conclusion": "FAILURE"}, {"status": "IN_PROGRESS", "conclusion": ""}
        self.assertNotIn("ci", self.block())
        self.assertEqual(self.block(statusCheckRollup=[ok, {"conclusion": "SKIPPED"}])["ci"], "pass")
        self.assertEqual(self.block(statusCheckRollup=[ok, bad, run])["ci"], "fail")
        self.assertEqual(self.block(statusCheckRollup=[ok, run])["ci"], "pending")
        self.assertEqual(self.block(statusCheckRollup=[{"state": "SUCCESS"}])["ci"], "pass")

    def test_review_decision(self):
        self.assertNotIn("review", self.block())
        self.assertEqual(self.block(reviewDecision="APPROVED")["review"], "approved")
        self.assertEqual(self.block(reviewDecision="CHANGES_REQUESTED")["review"], "changes")
        self.assertEqual(self.block(reviewDecision="REVIEW_REQUIRED")["review"], "required")

    def test_the_block_passes_the_publish_check(self):
        self.assertEqual(A.pr_problems(self.block(reviewDecision="APPROVED", statusCheckRollup=[{"conclusion": "SUCCESS"}]), "1"), [])


class Command(unittest.TestCase):
    def run_cmd(self, ref, view=None, code=0):
        out = types.SimpleNamespace(returncode=code, stdout=json.dumps(view or VIEW), stderr="boom")
        with mock.patch.object(A, "run", return_value=out) as r, mock.patch("builtins.print") as p:
            rc = A.cmd_pr_block(types.SimpleNamespace(ref=ref, json=True))
        return rc, r.call_args[0][0], json.loads(p.call_args[0][0])

    def test_asks_gh_for_that_repo(self):
        rc, args, block = self.run_cmd("eliasstravik/shepherdr#12")
        self.assertEqual((rc, args[:4], args[-2:]), (0, ["gh", "pr", "view", "12"], ["-R", "eliasstravik/shepherdr"]))
        self.assertEqual((block["type"], block["repo"], block["number"]), ("pr", "eliasstravik/shepherdr", 12))

    def test_a_bare_number_takes_the_repo_from_the_url(self):
        _, args, block = self.run_cmd("12")
        self.assertNotIn("-R", args)
        self.assertEqual(block["repo"], "eliasstravik/shepherdr")

    def test_a_gh_failure_is_said(self):
        with self.assertRaises(A.Fail) as e:
            self.run_cmd("a/b#1", code=1)
        self.assertIn("boom", str(e.exception))


class Publish(unittest.TestCase):
    def check(self, blocks):
        d = tempfile.mkdtemp(prefix="shepherdr-prblock-")
        self.addCleanup(shutil.rmtree, d, True)
        with open(os.path.join(d, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": blocks}, f)
        return A.recipe_problems(d, ["recipe.json"])

    def test_a_pr_block_is_a_known_type_with_checked_fields(self):
        good = {"type": "pr", "repo": "a/b", "number": 1, "title": "t", "url": URL, "state": "merged", "ci": "pass"}
        self.assertEqual(self.check([good]), [])
        for bad in ({"repo": "x"}, {"number": True}, {"title": ""}, {"url": "http://x.y"}, {"state": "gone"}, {"ci": "ok"}, {"review": "lgtm"}):
            self.assertEqual(len(self.check([{**good, **bad}])), 1, bad)

    def test_a_table_with_links_is_fine(self):
        self.assertEqual(self.check([{"type": "table", "columns": ["PR"], "rows": [["[x](https://github.com/a/b/pull/1)"]]}]), [])


if __name__ == "__main__":
    unittest.main()
