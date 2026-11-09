"""mods/coordinator/restart.sh for another machine's agent: it runs there, over hc (SHEP-107)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import subprocess
import tempfile
import unittest

def read(p):
    with open(p) as f:
        return f.read()


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "mods", "coordinator", "restart.sh")

# A fake hc: logs each call (and what came on stdin); `exec` answers as the other machine would, `machine ls` says
# whether that machine is reachable.
FAKE_HC = r"""#!/usr/bin/env bash
log=$FAKE_DIR/calls
printf '%s\n' "$*" >>"$log"
case $1 in
  exec)
    cat >"$FAKE_DIR/stdin"
    printf '%s\n' "$@" >"$FAKE_DIR/exec-args"
    [ "$FAKE_STATE" = connected ] || exit 1
    echo t9 ;;
  machine) printf '{"machines":[{"name":"vmb","state":"%s"}]}\n' "$FAKE_STATE" ;;
  *) echo "the local core was used: $*" >&2; exit 9 ;;
esac
"""


class RemoteRestart(unittest.TestCase):
    def run_script(self, state, env=None):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        with open(hc, "w") as f:
            f.write(FAKE_HC)
        os.chmod(hc, 0o755)
        e = {"PATH": f"{d}/bin:/usr/bin:/bin", "HOME": d, "FAKE_DIR": d, "FAKE_STATE": state, **(env or {})}
        r = subprocess.run(["bash", SCRIPT, "vmb/t2", json.dumps(["claude", "--model", "sonnet"])], env=e,
                           capture_output=True, text=True, timeout=30)
        return r, d

    def test_runs_on_its_machine(self):
        r, d = self.run_script("connected", {"HERDR_RESTART_CHAT": "pane1", "HERDR_RESTART_RESUME": "1"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "vmb/t9")
        args = read(os.path.join(d, "exec-args")).split("\n")
        self.assertEqual(args[:3], ["exec", "--on", "vmb"])
        self.assertIn("HERDR_RESTART_CHAT=pane1", args)
        self.assertIn("HERDR_RESTART_RESUME=1", args)
        # the script itself goes over, with that machine's own address for the agent
        tail = args[args.index("--") + 1:]
        self.assertEqual(tail[:3], ["bash", "-s", "t2"])
        self.assertEqual(json.loads(tail[3]), ["claude", "--model", "sonnet"])
        self.assertEqual(read(os.path.join(d, "stdin")), read(SCRIPT))
        # nothing ran on this machine's core
        self.assertTrue(all(c.startswith("exec ") for c in read(os.path.join(d, "calls")).splitlines()))

    def test_no_env_without_a_chat(self):
        r, d = self.run_script("connected")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("--env", read(os.path.join(d, "exec-args")).split("\n"))

    def test_offline_says_so(self):
        r, _ = self.run_script("disconnected")
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), "vmb is offline. Try again once it's back.")
        self.assertEqual(r.stdout, "")


# A fake hc for an agent on this machine: `get` answers its record, `run` logs its arguments.
LOCAL_HC = r"""#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_DIR/calls"
case $1 in
  get) echo '{"address":"t2","cwd":"/tmp","labels":{"herdr.chat":"vmb/p7","herdr.role":"coordinator"}}' ;;
  run) printf '%s\n' "$@" >"$FAKE_DIR/run-args"; echo '{"address":"t9"}' ;;
  ls) echo '{"terminals":[]}' ;;
esac
"""


class ChatLabel(unittest.TestCase):
    """The new agent's herdr.chat holds its pane as its own machine names it, never a window's "<machine>/<pane>"
    (GitHub #761: another machine's window then misses the pane and ends the agent)."""

    def restart(self, env):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        with open(hc, "w") as f:
            f.write(LOCAL_HC)
        os.chmod(hc, 0o755)
        e = {"PATH": f"{d}/bin:/usr/bin:/bin", "HOME": d, "HERDR_APP_HOME": d, "FAKE_DIR": d, "HERDR_RESTART_RESUME": "1", **env}
        r = subprocess.run(["bash", SCRIPT, "t2", json.dumps(["claude", "--resume", "s1"])], env=e,
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "t9")
        return read(os.path.join(d, "run-args")).split("\n")

    def test_window_name_from_the_chat(self):
        self.assertIn("herdr.chat=p7", self.restart({"HERDR_RESTART_CHAT": "vmb/p7"}))

    def test_window_name_from_its_label(self):
        args = self.restart({})
        self.assertIn("herdr.chat=p7", args)
        self.assertNotIn("herdr.chat=vmb/p7", args)


if __name__ == "__main__":
    unittest.main()
