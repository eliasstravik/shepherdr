"""Provider probes run only against local stand-ins, with no provider login or network."""
import home_guard  # noqa: F401
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PROBE = Path(__file__).resolve().parents[1] / "mods/tasks/bin/herdr_task/machine.py"

FAKE_CODEX = """
import json, os, sys

assert sys.argv[1:3] == ['app-server', '--disable']
for line in sys.stdin:
    m = json.loads(line)
    with open(os.environ['REQUESTS'], 'a') as f:
        f.write(line)
    if m['method'] == 'initialize':
        result = {}
    elif m['method'] == 'initialized':
        continue
    elif m['method'] == 'account/read':
        assert m['params'] == {'refreshToken': False}
        result = {'account': json.loads(os.environ['ACCOUNT'])}
    elif m['method'] == 'account/rateLimits/read':
        result = {'rateLimits': {'primary': {'usedPercent': 23, 'windowDurationMins': 300}}}
    else:
        raise AssertionError(m)
    print(json.dumps({'id': m['id'], 'result': result}), flush=True)
"""


class MachineUsage(unittest.TestCase):
    def probe(self, account):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            codex = root / "codex"
            codex.write_text(f"#!{sys.executable}\n{FAKE_CODEX}")
            codex.chmod(0o700)
            claude = root / "claude"
            claude.write_text(f"#!/bin/sh\ntouch '{root / 'ran-claude'}'\n")
            claude.chmod(0o700)
            config = root / "claude-config"
            config.mkdir()
            requests = root / "requests"
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", REQUESTS=str(requests),
                       ACCOUNT=json.dumps(account), CLAUDE_CONFIG_DIR=str(config))
            res = subprocess.run([sys.executable, str(PROBE), "--limits"], env=env, text=True,
                                 capture_output=True, timeout=15, check=True)
            self.assertFalse((root / "ran-claude").exists())
            self.assertEqual(list(config.iterdir()), [])
            return json.loads(res.stdout)["limits"], [json.loads(line)["method"] for line in requests.read_text().splitlines()]

    def test_subscription_limits_use_only_the_codex_protocol(self):
        limits, calls = self.probe({"type": "chatgpt"})
        self.assertEqual(calls, ["initialize", "initialized", "account/read", "account/rateLimits/read"])
        self.assertEqual(limits["codex"]["windows"], [{"name": "5-hour", "used": 23}])
        self.assertEqual(limits["claude"]["state"], "no-access")
        self.assertIn("/usage", limits["claude"]["why"])

    def test_api_key_and_signed_out_skip_subscription_request(self):
        for account, state in ((None, "signed-out"), ({"type": "apiKey"}, "no-plan")):
            with self.subTest(state=state):
                limits, calls = self.probe(account)
                self.assertEqual(calls, ["initialize", "initialized", "account/read"])
                self.assertEqual(limits["codex"]["state"], state)
