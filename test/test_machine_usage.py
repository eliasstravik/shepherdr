"""Plan usage is never read: the probe names each agent's own command, and runs no agent CLI at all."""
import home_guard  # noqa: F401
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PROBE = Path(__file__).resolve().parents[1] / "mods/tasks/bin/herdr_task/machine.py"


class MachineUsage(unittest.TestCase):
    def probe(self, *clis):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in clis:
                cli = root / name
                cli.write_text(f"#!/bin/sh\ntouch '{root / ('ran-' + name)}'\n")
                cli.chmod(0o700)
            env = dict(os.environ, PATH=f"{root}:/usr/bin:/bin")
            res = subprocess.run([sys.executable, str(PROBE), "--limits"], env=env, text=True,
                                 capture_output=True, timeout=15, check=True)
            self.assertEqual(sorted(p.name for p in root.glob("ran-*")), [])
            return json.loads(res.stdout)["limits"]

    def test_no_agent_usage_is_read_only_where_to_see_it(self):
        limits = self.probe("claude", "codex")
        self.assertEqual({k: v["state"] for k, v in limits.items()}, {"claude": "no-access", "codex": "no-access"})
        self.assertIn("/usage", limits["claude"]["why"])
        self.assertIn("/status", limits["codex"]["why"])
        self.assertNotIn("windows", limits["codex"])

    def test_the_probe_has_no_app_server_or_model_list(self):
        src = PROBE.read_text()
        for word in ("app-server", "rateLimits", "model/list", "account/read", "--codex-models"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
