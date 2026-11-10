"""Cursor plan usage reads real limits without starting agents or changing sign-ins."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mods/tasks/bin"))
from herdr_task import machine


class CursorUsage(unittest.TestCase):
    def test_separate_pools_and_billing_reset(self):
        got = machine.parse_cursor({"billingCycleEnd": "1794053334000", "planUsage": {
            "autoPercentUsed": 23.2, "apiPercentUsed": 0}}, {"planInfo": {"planName": "Pro"}})
        self.assertEqual(got, {"state": "ok", "plan": "Pro", "windows": [
            {"name": "Auto + Composer", "used": 23.2, "resets_at": 1794053334000},
            {"name": "API models", "used": 0, "resets_at": 1794053334000}]})

    def test_reported_percent_takes_precedence_over_spend(self):
        got = machine.parse_cursor({"planUsage": {"autoPercentUsed": 0, "autoSpend": 500, "autoLimit": 1000}})
        self.assertEqual(got["windows"], [{"name": "Auto + Composer", "used": 0}])

    def test_older_response_with_spend_and_a_real_limit(self):
        got = machine.parse_cursor({"planUsage": {"includedSpend": 250, "limit": 1000},
                                    "spendLimitUsage": {"individualUsed": 100, "individualLimit": 500}})
        self.assertEqual(got["windows"], [{"name": "Included usage", "used": 25}, {"name": "On-demand", "used": 20}])

    def test_missing_or_invalid_limits_never_become_unused_allowances(self):
        for data in (None, {}, {"planUsage": {}}, {"planUsage": {"limit": 1000}},
                     {"planUsage": {"includedSpend": 20, "limit": 0}},
                     {"spendLimitUsage": {"individualUsed": 100}},
                     {"spendLimitUsage": {"individualUsed": 0, "individualLimit": 0}}):
            with self.subTest(data=data):
                self.assertEqual(machine.parse_cursor(data)["state"], "unknown")
        for value in (True, -1, float("nan"), float("inf"), "23"):
            with self.subTest(value=value):
                self.assertEqual(machine.parse_cursor({"planUsage": {"apiPercentUsed": value}})["state"], "unknown")

    def test_unknown_reset_does_not_invent_a_date_and_overages_are_preserved(self):
        got = machine.parse_cursor({"billingCycleEnd": "bad", "planUsage": {"apiPercentUsed": 120}})
        self.assertEqual(got["windows"], [{"name": "API models", "used": 120}])

    def test_file_sign_in_is_read_without_rewriting_it(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(machine, "HOME", tmp), patch.object(machine, "MAC", False), patch.dict(os.environ, {}, clear=True):
            path = Path(tmp) / ".config/cursor/auth.json"
            path.parent.mkdir(parents=True)
            saved = '{"accessToken":"fixture-only-token","refreshToken":"never-used"}'
            path.write_text(saved)
            self.assertEqual(machine._cursor_token(), "fixture-only-token")
            self.assertEqual(path.read_text(), saved)

    def test_mac_uses_only_the_cursor_access_token_entry(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(machine, "MAC", True), patch.object(machine.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="fixture-only-token\n")) as run:
            self.assertEqual(machine._cursor_token(), "fixture-only-token")
            self.assertEqual(run.call_args.args[0], ["/usr/bin/security", "find-generic-password", "-a", "cursor-user", "-s", "cursor-access-token", "-w"])

    def test_api_key_does_not_report_a_different_saved_accounts_usage(self):
        with patch.dict(os.environ, {"CURSOR_API_KEY": "fixture-key"}, clear=True), patch.object(machine.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                machine._cursor_token()
            run.assert_not_called()

    def test_selected_team_is_used_and_optional_plan_failure_keeps_usage(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(machine, "which", return_value="cursor-agent"), patch.object(machine, "_cursor_token", return_value="fixture-only-token"), patch.object(machine, "_json_file", return_value={"authInfo": {"activeTeamId": 42}}), patch.object(machine, "_cursor_rpc", side_effect=[{"planUsage": {"apiPercentUsed": 8}}, URLError("offline")]) as rpc:
            got = machine.cursor()
            self.assertEqual(got["state"], "ok")
            self.assertEqual(rpc.call_args_list[0].args, ("GetCurrentPeriodUsage", "fixture-only-token", 42))
            self.assertNotIn("fixture-only-token", json.dumps(got))

    def test_failed_reads_do_not_leak_responses_or_trigger_sign_in(self):
        for error in (HTTPError("https://api2.cursor.sh", 401, "fixture-only-token", {}, None),
                      HTTPError("https://api2.cursor.sh", 429, "fixture-only-token", {}, None),
                      URLError("fixture-only-token"), ValueError("fixture-only-token"),
                      subprocess.TimeoutExpired("security", 5)):
            with self.subTest(error=type(error)), patch.dict(os.environ, {}, clear=True), patch.object(machine, "which", return_value="cursor-agent"), patch.object(machine, "_cursor_token", return_value="fixture-only-token"), patch.object(machine, "_json_file", return_value={}), patch.object(machine, "_cursor_rpc", side_effect=error) as rpc:
                got = machine.cursor()
                self.assertEqual(got["state"], "unknown")
                self.assertNotIn("fixture-only-token", json.dumps(got))
                self.assertEqual(rpc.call_count, 1)

    def test_absent_signed_out_and_custom_endpoint_are_distinct(self):
        with patch.object(machine, "which", return_value=None):
            self.assertIsNone(machine.cursor())
        with patch.dict(os.environ, {}, clear=True), patch.object(machine, "which", return_value="cursor-agent"), patch.object(machine, "_cursor_token", return_value=None):
            self.assertEqual(machine.cursor(), {"state": "signed-out"})
        with patch.dict(os.environ, {"CURSOR_API_ENDPOINT": "https://example.invalid"}, clear=True), patch.object(machine, "which", return_value="cursor-agent"), patch.object(machine, "_cursor_token") as token:
            self.assertEqual(machine.cursor()["state"], "unknown")
            token.assert_not_called()

    def test_rpc_uses_fixed_tls_origin_and_never_follows_redirects(self):
        with patch("urllib.request.build_opener") as build:
            response = build.return_value.open.return_value.__enter__.return_value
            response.read.return_value = b'{"planUsage":{"apiPercentUsed":12}}'
            self.assertEqual(machine._cursor_rpc("GetCurrentPeriodUsage", "fixture-only-token", 42)["planUsage"]["apiPercentUsed"], 12)
            req = build.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url, "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage")
            self.assertEqual(req.data, b"{}")
            self.assertEqual(req.get_header("X-cursor-team-id"), "42")
            self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 10)
            redirect = build.call_args.args[0]()
            self.assertIsNone(redirect.redirect_request(req, None, 302, "", {}, "https://example.invalid"))
            self.assertTrue(build.call_args.args[1]._context.check_hostname)

    def test_limits_collects_cursor_without_affecting_other_readers(self):
        with patch.object(machine, "claude", return_value=None), patch.object(machine, "codex", return_value=None), patch.object(machine, "cursor", return_value={"state": "signed-out"}):
            got = machine.limits()
            self.assertEqual(got["cursor"]["state"], "signed-out")
            self.assertGreater(got["cursor"]["at"], 0)
