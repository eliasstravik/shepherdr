"""Personal analytics (herdr_task/analytics.py, core/analytics.js, service/analytics.ts): a record kept only on the
person's own machines. What it records (events and timings, never content), its off switch, its retention, Delete
all, and the promise itself: nothing in its code path opens a network connection or feeds what goes out (feedback
reports, GitHub issues)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import analytics as A  # noqa: E402

DAY = 86400_000


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.dir = os.path.join(self.tmp, "analytics")
        self.settings = os.path.join(self.tmp, "settings.json")
        self.env = mock.patch.dict(os.environ, {"HERDR_ANALYTICS_DIR": self.dir, "HERDR_TASK_SETTINGS": self.settings})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def lines(self):
        out = []
        for p in A.files():
            if p.endswith(".jsonl"):
                with open(p) as f:
                    out += [json.loads(x) for x in f]
        return out

    def run_cmd(self, *argv):
        args = SimpleNamespace(what=argv[0] if argv else "show", period=None, days=7, here=True, json=True)
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = A.cmd_analytics(args)
        return rc, json.loads(buf.getvalue().strip().splitlines()[-1])


class NeverContent(Base):
    def test_only_allowed_fields_and_words(self):
        A.record("message.sent", how="typed", chat="sp1", text="my secret plan", prompt="do X", title="Fix login")
        A.record("message.sent", how="shouted", chat="a chat with spaces in it")
        A.record("task.done", task="SHEP-1", wait_ms=3600000.4, merged=True, model="claude-opus-5-5[1m]")
        got = self.lines()
        self.assertEqual([{k: v for k, v in e.items() if k != "t"} for e in got], [
            {"e": "message.sent", "how": "typed", "chat": "sp1"},
            {"e": "message.sent"},
            {"e": "task.done", "task": "SHEP-1", "wait_ms": 3600000, "merged": True, "model": "claude-opus-5-5[1m]"},
        ])
        raw = "".join(open(p).read() for p in A.files())
        for word in ("secret", "plan", "Fix login", "do X", "spaces"):
            self.assertNotIn(word, raw)

    def test_unknown_event_is_refused(self):
        self.assertFalse(A.record("message.text", chat="sp1"))
        self.assertEqual(self.lines(), [])

    def test_private_folder(self):
        A.record("app.opened", device="phone")
        self.assertEqual(os.stat(self.dir).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(A.files()[0]).st_mode & 0o777, 0o600)


class OffSwitch(Base):
    def test_off_records_nothing_at_all(self):
        with open(self.settings, "w") as f:
            json.dump({"everywhere": {"analytics_off": True}}, f)
        self.assertFalse(A.record("app.opened", device="phone"))
        A.saved({}, {"prefix": "T", "tasks": [{"id": 1, "state": "running"}]})
        self.assertFalse(os.path.exists(self.dir))

    def test_on_and_off_commands(self):
        self.assertEqual(self.run_cmd("off")[1], {"on": False})
        self.assertFalse(A.is_on())
        self.assertEqual(self.run_cmd("on")[1], {"on": True})
        self.assertTrue(A.is_on())


class TaskChanges(Base):
    def test_a_tasks_life(self):
        t = {"id": 4, "state": "todo", "space": "sp1", "mode": "worktree", "created": 1000, "title": "Secret title",
             "prompt": "secret brief", "agent": "claude", "model": "opus", "effort": "high"}
        snap = A.snapshot([])
        evs = A.changes(snap, [dict(t, ref="T-4")], now_ms=2000)
        self.assertEqual([e for e, _ in evs], ["task.added"])
        steps = [
            (dict(t, state="running", started=5000), "task.started", {"waited_ms": 4000}),
            (dict(t, state="ready", started=5000, ready_at=65000), "task.ready", {"worked_ms": 60000}),
            (dict(t, state="running", started=5000, ready_at=65000), "task.sent_back", {"wait_ms": 35000}),
            (dict(t, state="ready", started=5000, ready_at=200000), "task.ready", {}),
            (dict(t, state="done", started=5000, ready_at=200000, done_at=500000, merged=True), "task.done", {"wait_ms": 300000, "merged": True}),
            (dict(t, state="running", started=5000), "task.reopened", {}),
            (dict(t, state="running", stopped_by="limit", stopped_at=600000), "task.stopped", {"by": "limit"}),
            (dict(t, state="running"), "task.carried_on", {"blocked_ms": 100000}),
        ]
        prev = A.snapshot([dict(t, ref="T-4")])
        for i, (now_t, want, fields) in enumerate(steps):
            at = {1: 100000, 2: 100000}.get(i, 700000)
            got = A.changes(prev, [dict(now_t, ref="T-4")], now_ms=at)
            self.assertEqual([e for e, _ in got], [want], f"step {i}")
            for k, v in fields.items():
                self.assertEqual(got[0][1][k], v, f"step {i} {k}")
            self.assertNotIn("title", got[0][1])
            prev = A.snapshot([dict(now_t, ref="T-4")])
        self.assertEqual([e for e, _ in A.changes(prev, [], now_ms=1)], ["task.removed"])

    def test_saved_records_refs_and_needs_you_wait(self):
        before = A.snapshot([{"id": 2, "state": "running"}])
        A.saved(before, {"prefix": "SHOP", "tasks": [{"id": 2, "state": "running", "attention": "Couldn't start: x"}]})
        before = A.snapshot([{"id": 2, "state": "running", "attention": "x"}])
        A.saved(before, {"prefix": "SHOP", "tasks": [{"id": 2, "state": "running"}]})
        got = self.lines()
        self.assertEqual([(e["e"], e["task"]) for e in got], [("task.needs_you", "SHOP-2"), ("task.needs_answered", "SHOP-2")])
        self.assertIsInstance(got[1].get("wait_ms"), int)
        self.assertNotIn("Couldn't", "".join(open(p).read() for p in A.files()))


class Retention(Base):
    def test_old_days_fold_into_a_months_rollup_and_old_rollups_go(self):
        os.makedirs(self.dir)
        now = time.time() * 1000
        old = now - (A.KEEP_DAYS + 5) * DAY
        day = A.day_of(old)
        with open(os.path.join(self.dir, f"{day}.jsonl"), "w") as f:
            f.write(json.dumps({"t": old, "e": "task.done", "wait_ms": 100}) + "\n")
            f.write(json.dumps({"t": old, "e": "task.done", "wait_ms": 300}) + "\n")
        ancient = os.path.join(self.dir, "rollup-2001-01.json")
        with open(ancient, "w") as f:
            f.write("{}")
        A.record("app.opened", device="desktop")
        self.assertFalse(os.path.exists(os.path.join(self.dir, f"{day}.jsonl")))
        self.assertFalse(os.path.exists(ancient))
        with open(os.path.join(self.dir, f"rollup-{day[:7]}.json")) as f:
            r = json.load(f)
        self.assertEqual(r["counts"], {"task.done": 2})
        self.assertEqual(r["sums"], {"task.done.wait_ms": 400})

    def test_a_day_stops_growing(self):
        os.makedirs(self.dir)
        with open(os.path.join(self.dir, A.day_of(time.time() * 1000) + ".jsonl"), "w") as f:
            f.write("x" * (A.DAY_MAX + 1))
        self.assertFalse(A.record("app.opened", device="phone"))


class DeleteAll(Base):
    def test_leaves_nothing_behind(self):
        A.record("app.opened", device="phone")
        A.saved({}, {"prefix": "T", "tasks": [{"id": 1, "state": "running", "attention": "x"}]})
        self.assertTrue(os.listdir(self.dir))
        rc, out = self.run_cmd("delete")
        self.assertEqual(rc, 0)
        self.assertEqual(out, {"deleted": {"this machine": True}})
        self.assertFalse(os.path.exists(self.dir))
        self.assertEqual(self.run_cmd("raw")[1]["events"], [])

    def test_every_machine_of_theirs(self):
        A.record("app.opened", device="phone")
        args = SimpleNamespace(what="delete", period=None, days=7, here=False, json=True)
        with mock.patch.object(A, "_others", return_value=["mini", "laptop"]), \
                mock.patch.object(A, "_theirs", side_effect=lambda m, argv: {"deleted": {"this machine": True}} if m == "mini" else None) as theirs, \
                redirect_stdout(io.StringIO()) as buf:
            rc = A.cmd_analytics(args)
        self.assertEqual([c.args for c in theirs.call_args_list], [("mini", ["delete"]), ("laptop", ["delete"])])
        self.assertEqual(json.loads(buf.getvalue())["deleted"], {"this machine": True, "mini": True, "laptop": False})
        self.assertEqual(rc, 1)  # one not reached: said, not hidden
        self.assertFalse(os.path.exists(self.dir))


class Reading(Base):
    def test_summary_numbers_and_words(self):
        A.record("app.opened", device="phone")
        A.record("message.sent", how="dictated", chat="sp1")
        A.record("message.sent", how="bubble", chat="sp1")
        A.record("task.done", task="T-1", wait_ms=3 * 3600_000)
        A.record("task.ready", task="T-1", agent="claude", model="opus", effort="high", worked_ms=600000)
        rc, s = self.run_cmd("show")
        self.assertEqual(rc, 0)
        self.assertEqual(s["messages"]["how"], {"dictated": 1, "bubble": 1})
        self.assertEqual(s["waits"]["ready_for_review"]["avg_ms"], 3 * 3600_000)
        self.assertEqual(s["agents"][0]["tasks"], 1)
        self.assertIn("Ready for review 3.0 h on average", s["text"])

    def test_other_machines_events_are_merged_with_their_name(self):
        A.record("app.opened", device="phone")
        theirs = {"events": [{"t": int(time.time() * 1000), "e": "task.done", "task": "X-1"}, {"t": 1, "e": "evil", "text": "x"}]}
        args = SimpleNamespace(what="raw", period="week", days=None, here=False, json=True)
        with mock.patch.object(A, "_others", return_value=["mini"]), mock.patch.object(A, "_theirs", return_value=theirs), \
                redirect_stdout(io.StringIO()) as buf:
            A.cmd_analytics(args)
        evs = json.loads(buf.getvalue())["events"]
        self.assertEqual(sorted(e["e"] for e in evs), ["app.opened", "task.done"])
        self.assertEqual([e.get("machine") for e in evs if e["e"] == "task.done"], ["mini"])


class NoNetwork(Base):
    """The promise, by construction: nothing in personal analytics' code reaches for the network."""

    FILES = ["mods/tasks/bin/herdr_task/analytics.py", "core/analytics.js", "service/analytics.ts", "web/plugins/analytics/client.tsx"]
    NET = re.compile(r"\b(import\s+(socket|urllib|http|requests|ssl|ftplib|smtplib)|from\s+(socket|urllib|http|requests)\b|fetch\s*\(|"
                     r"XMLHttpRequest|WebSocket|sendBeacon|node:(net|http|https|dgram|tls)|[\"'](net|http|https|dgram|tls)[\"']|https?://)")

    def test_no_network_in_its_code(self):
        for f in self.FILES:
            with open(os.path.join(ROOT, f)) as fh:
                src = fh.read()
            self.assertIsNone(self.NET.search(src), f"{f} reaches for the network: {self.NET.search(src) and self.NET.search(src).group(0)}")

    def test_its_command_never_opens_a_connection(self):
        def refuse(*a, **k):
            raise AssertionError("personal analytics opened a network connection")
        with mock.patch.object(socket.socket, "connect", refuse), mock.patch.object(socket, "create_connection", refuse), \
                mock.patch.object(socket, "getaddrinfo", refuse):
            A.record("app.opened", device="tablet")
            A.saved({}, {"prefix": "T", "tasks": [{"id": 1, "state": "running"}]})
            for what in ("show", "raw", "export", "delete"):
                self.assertEqual(self.run_cmd(what)[0], 0)

    def test_never_in_what_goes_out(self):
        # feedback reports and GitHub issues are built in these; none of them reads the record
        for f in ("feedback.py", "github.py", "ghnews.py", "news.py", "systemic.py"):
            with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", f)) as fh:
                self.assertNotIn("analytics", fh.read(), f)
        for f in os.listdir(os.path.join(ROOT, "service")):
            if f.endswith(".ts") and not f.endswith(".test.ts") and f not in ("analytics.ts", "main.ts", "voice-data.ts", "next.ts"):
                with open(os.path.join(ROOT, "service", f)) as fh:
                    self.assertNotIn("analytics", fh.read(), f)


class SameRules(unittest.TestCase):
    def test_python_and_javascript_agree(self):
        js = subprocess.run(["node", "--input-type=module", "-e",
                             f"import * as A from {json.dumps(os.path.join(ROOT, 'core', 'analytics.js'))};"
                             "console.log(JSON.stringify({e: Object.keys(A.EVENTS), f: A.FIELDS, c: A.CHOICES, "
                             "x: A.clean({how: 'typed', text: 'hi there', n: 2, how2: 1, device: 'tv'})}))"],
                            capture_output=True, text=True, check=True)
        got = json.loads(js.stdout)
        self.assertEqual(got["e"], list(A.EVENTS))
        self.assertEqual(set(got["f"]), A.FIELDS)
        self.assertEqual({k: set(v) for k, v in got["c"].items()}, A.CHOICES)
        self.assertEqual(got["x"], A.clean({"how": "typed", "text": "hi there", "n": 2, "how2": 1, "device": "tv"}))


if __name__ == "__main__":
    unittest.main()
