"""service/restart.sh for another machine's agent: it runs there, over hc (SHEP-107)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import unittest

def read(p):
    with open(p) as f:
        return f.read()


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "service", "restart.sh")

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


class NoTab(unittest.TestCase):
    """GitHub #980: an Assistant the service started without the window (a web-only install, service/spaces.ts) has
    a space but no tab or chat. restart.sh quit at its first guard without a word, and the remote side dropped its
    stderr: all anyone saw was "It didn't restart". It restarts in the background under its space now, and a
    restart that can't says why, across machines too."""

    def restart(self, labels, env=None, argv=("claude", "--resume", "s1"), state="idle"):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        rec = json.dumps({"address": "t2", "cwd": "/tmp", "template": "assistant", "labels": labels, "status": {"state": state}})
        with open(hc, "w") as f:
            f.write(LOCAL_HC.replace(LOCAL_HC.split("\n")[3], f"  get) echo '{rec}' ;;"))
        os.chmod(hc, 0o755)
        e = {"PATH": f"{d}/bin:/usr/bin:/bin", "HOME": d, "HERDR_APP_HOME": d, "FAKE_DIR": d, "HERDR_RESTART_RESUME": "1", **(env or {})}
        r = subprocess.run(["bash", SCRIPT, "t2", json.dumps(list(argv))], env=e, capture_output=True, text=True, timeout=30)
        p = os.path.join(d, "run-args")
        return r, (read(p).split("\n") if os.path.exists(p) else None)

    def test_a_space_alone_restarts_in_the_background(self):
        r, args = self.restart({"herdr.space": "sp1", "herdr.coordinator.space": "sp1", "herdr.role": "coordinator"})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "t9")
        self.assertIn("--keep", args)
        for label in ("herdr.space=sp1", "herdr.coordinator.space=sp1", "herdr.role=coordinator"):
            self.assertIn(label, args)
        self.assertFalse(any(a.startswith("herdr.tab=") for a in args), "no empty tab label")

    def test_chat_picker_does_not_restart_a_busy_assistant(self):
        r, args = self.restart({"herdr.space": "sp1"}, {"HERDR_RESTART_WHEN_IDLE": "1"}, state="working")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Wait for this turn to finish", r.stderr)
        self.assertIsNone(args)

    def test_nowhere_to_go_says_why(self):
        r, args = self.restart({"herdr.role": "coordinator"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("t2 has no space, tab or chat to restart into.", r.stderr)
        self.assertIsNone(args)

    def test_the_other_machine_says_why(self):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        with open(hc, "w") as f:
            f.write(FAKE_HC.replace("    echo t9 ;;", '    [ -n "$FAKE_WHY" ] && { echo "$FAKE_WHY" >&2; exit 1; }\n    echo t9 ;;'))
        os.chmod(hc, 0o755)
        e = {"PATH": f"{d}/bin:/usr/bin:/bin", "HOME": d, "FAKE_DIR": d, "FAKE_STATE": "connected",
             "FAKE_WHY": "t2 has no space, tab or chat to restart into."}
        r = subprocess.run(["bash", SCRIPT, "vmb/t2", "[]"], env=e, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), "It didn't restart on vmb: t2 has no space, tab or chat to restart into.")


class Bash32(unittest.TestCase):
    """macOS's /bin/bash is 3.2, without bash 4's mapfile and readarray (GitHub #736): restart.sh still restarts."""

    def restart(self, env):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        with open(hc, "w") as f:
            f.write(LOCAL_HC)
        os.chmod(hc, 0o755)
        # BASH_ENV runs before the script: it takes bash 4's builtins away, as on bash 3.2.
        old = os.path.join(d, "bash32")
        with open(old, "w") as f:
            f.write("enable -n mapfile readarray\n")
        e = {"PATH": f"{d}/bin:/usr/bin:/bin", "HOME": d, "HERDR_APP_HOME": d, "FAKE_DIR": d, "BASH_ENV": old, **env}
        r = subprocess.run(["bash", SCRIPT, "t2", json.dumps(["claude", "--model", "a b"])], env=e,
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "t9")
        return r, read(os.path.join(d, "run-args")).split("\n")

    def test_resume(self):
        r, args = self.restart({"HERDR_RESTART_RESUME": "1"})
        self.assertNotIn("command not found", r.stderr)
        self.assertEqual(args[args.index("herdr-clean") + 1:][:3], ["claude", "--model", "a b"])

    def test_handoff(self):
        r, args = self.restart({})
        self.assertNotIn("command not found", r.stderr)
        self.assertIn("herdr.agent=claude", args)


BARE_HC = r"""#!/usr/bin/env bash
case $1 in
  get) echo '{"address":"t2","cwd":"/tmp","labels":{"herdr.space":"s1","herdr.tab":"t1"}}' ;;
  run) printf '%s\n' "$@" >"$FAKE_DIR/run-args"
       for a in "$@"; do f="$HOME/.config/herdr-core/templates/$a.md"; [ -f "$f" ] && cp "$f" "$FAKE_DIR/one.md"; done
       echo '{"address":"t9","first_message":{"sent":true}}' ;;
esac
"""


class BarePath(unittest.TestCase):
    """GitHub #1431: a herdr-core started outside a login shell (launchd, ssh) runs restart.sh, and every terminal it
    starts, with only /usr/bin:/bin. hc and claude live in ~/.local/bin: the script finds hc there, and the new agent's
    command finds claude where a fresh start does (core/clean-env.js AGENT_PATH)."""

    def restart(self, env):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        own = os.path.join(d, ".local", "bin")
        os.makedirs(own)
        os.makedirs(os.path.join(d, ".config", "herdr-core", "templates"))
        for name, body in (("hc", BARE_HC), ("claude", "#!/bin/sh\necho \"claude ran $*\"\n")):
            with open(os.path.join(own, name), "w") as f:
                f.write(body)
            os.chmod(os.path.join(own, name), 0o755)
        jq = shutil.which("jq")
        os.symlink(jq, os.path.join(own, "jq"))   # wherever jq is, not on the bare PATH unless it's in /usr/bin
        bare = {"PATH": "/usr/bin:/bin", "HOME": d}
        r = subprocess.run(["bash", SCRIPT, "t2", json.dumps(["claude", "--model", "sonnet"])],
                           env={**bare, "FAKE_DIR": d, **env}, capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip(), "t9")
        return d, bare, read(os.path.join(d, "run-args")).split("\n")

    def test_resume(self):
        d, bare, args = self.restart({"HERDR_RESTART_RESUME": "1"})
        cmd = args[args.index("--") + 1:-1]
        ran = subprocess.run(cmd, env=bare, capture_output=True, text=True, timeout=30)
        self.assertEqual(ran.stdout.strip(), "claude ran --model sonnet", ran.stderr)

    def test_same_path_as_a_fresh_start(self):
        js = re.search(r"export const AGENT_PATH = `(.*)`;", read(os.path.join(ROOT, "core", "clean-env.js"))).group(1)
        sh = re.search(r"^apath='(.*)'$", read(SCRIPT), re.M).group(1)
        self.assertEqual(sh, js.replace("\\$", "$"))

    def test_handoff(self):
        d, bare, _ = self.restart({})
        line = next(x for x in read(os.path.join(d, "one.md")).splitlines() if x.startswith("command: "))
        ran = subprocess.run(["sh", "-c", line[len("command: "):]], env=bare, capture_output=True, text=True, timeout=30)
        self.assertEqual(ran.stdout.strip(), "claude ran --model sonnet", ran.stderr)


if __name__ == "__main__":
    unittest.main()
