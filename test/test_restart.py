"""mods/coordinator/restart.sh for another machine's agent: it runs there, over hc (SHEP-107)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import shutil
import sys
import subprocess
import tempfile
import time
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


LOCAL_HC = r"""
import json, os, re, subprocess, sys
from pathlib import Path
root = Path(os.environ["FAKE_DIR"])
a = sys.argv[1:]
if a[0] == "get":
    print(json.dumps({"cwd": str(root), "template": "assistant", "status": {"app": "claude"},
                      "labels": {"herdr.space": "sp1", "herdr.tab": "tb1", "herdr.role": "coordinator"}}))
elif a[0] == "read":
    print("Previous work is saved.")
elif a[0] == "ls":
    print('{"terminals": []}')
elif a[0] == "run":
    (root / "run-args.json").write_text(json.dumps(a))
    if "--" in a:
        command = a[a.index("--") + 1:]
    else:
        source = root / ".config/herdr-core/templates" / (a[-1] + ".md")
        text = source.read_text()
        (root / "oneoff.md").write_text(text)
        (root / "oneoff-path").write_text(str(source))
        command = ["sh", "-c", re.search(r"^command: (.+)$", text, re.M).group(1)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)
    print('{"address":"t9","first_message":{"sent":false}}')
elif a[0] == "send":
    (root / "send-args.json").write_text(json.dumps(a))
elif a[0] not in ("wait", "kill", "rm"):
    raise AssertionError(a)
"""


class LocalRestart(unittest.TestCase):
    ROLE = "Keep these Assistant role instructions outside the conversation.\n"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.bin = os.path.join(self.root, "bin")
        os.makedirs(self.bin)
        jq = shutil.which("jq")
        self.assertIsNotNone(jq, "restart.sh requires jq")
        os.symlink(jq, os.path.join(self.bin, "jq"))
        self.template = os.path.join(self.root, ".config/herdr-core/templates/assistant.md")
        os.makedirs(os.path.dirname(self.template))
        helper = os.path.join(self.root, ".local/share/shepherdr/bin/herdr-assistant-context")
        os.makedirs(os.path.dirname(helper))
        shutil.copyfile(os.path.join(ROOT, "bin/herdr-assistant-context"), helper)
        for name, body in (("hc", LOCAL_HC), ("claude", self.agent_script()), ("codex", self.agent_script())):
            path = os.path.join(self.bin, name)
            with open(path, "w") as f:
                f.write(f"#!{sys.executable}\n" + body)
            os.chmod(path, 0o755)

    def agent_script(self):
        return ('import json, os, sys\nfrom pathlib import Path\n'
                'Path(os.environ["FAKE_DIR"], "agent-args.json").write_text(json.dumps(sys.argv[1:]))\n')

    def run_script(self, argv=None, resume=False, agent="claude"):
        with open(self.template, "w") as f:
            f.write(f"---\nname: assistant\ncommand: {agent} --model sonnet\n---\n" + self.ROLE)
        env = {"PATH": f"{self.bin}:{os.path.dirname(sys.executable)}:/usr/bin:/bin", "HOME": self.root, "FAKE_DIR": self.root}
        if resume:
            env["HERDR_RESTART_RESUME"] = "1"
        result = subprocess.run(["bash", SCRIPT, "t2", *([json.dumps(argv)] if argv else [])], env=env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "t9")
        return json.loads(read(os.path.join(self.root, "run-args.json")))

    def test_fresh_claude_keeps_role_in_a_durable_file_and_retries_only_the_handoff(self):
        args = self.run_script()
        oneoff = read(os.path.join(self.root, "oneoff.md"))
        body = oneoff.split("---\n", 2)[2]
        self.assertIn("herdr-assistant-context", oneoff.split("---\n", 2)[1])
        self.assertIn("herdr.assistant.context=background", args)
        self.assertNotIn(self.ROLE.strip(), body)
        self.assertIn("You are taking over this tab", body)
        self.assertEqual(json.loads(read(os.path.join(self.root, "send-args.json"))), ["send", "t9", body.rstrip("\n")])
        agent = json.loads(read(os.path.join(self.root, "agent-args.json")))
        self.assertEqual(agent[0], "--append-system-prompt-file")
        self.assertEqual(read(agent[1]), self.ROLE)
        self.assertEqual(agent[2:], ["--model", "sonnet"])
        self.assertFalse(os.path.exists(read(os.path.join(self.root, "oneoff-path"))))
        self.assertTrue(os.path.isfile(agent[1]))

    def test_resume_keeps_its_context_file_without_reinjecting_role_or_handoff(self):
        context = os.path.join(self.root, ".config/herdr-core/assistant-context/existing.txt")
        argv = ["claude", "--append-system-prompt-file", context, "--resume", "saved-session"]
        args = self.run_script(argv, resume=True)
        self.assertIn("herdr.assistant.context=background", args)
        self.assertEqual(json.loads(read(os.path.join(self.root, "agent-args.json"))), argv[1:])
        self.assertFalse(os.path.exists(os.path.join(self.root, "oneoff.md")))
        self.assertFalse(os.path.exists(os.path.join(self.root, "send-args.json")))

    def test_other_agents_keep_the_role_in_the_handoff(self):
        args = self.run_script(agent="codex")
        body = read(os.path.join(self.root, "oneoff.md")).split("---\n", 2)[2]
        self.assertIn(self.ROLE.strip(), body)
        self.assertIn("You are taking over this tab", body)
        self.assertNotIn("herdr.assistant.context=background", args)
        self.assertEqual(json.loads(read(os.path.join(self.root, "agent-args.json"))), ["--model", "sonnet"])


# A fake hc for an agent on this machine: `get` answers its record, `run` logs its arguments.
CHAT_LABEL_HC = r"""#!/usr/bin/env bash
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
            f.write(CHAT_LABEL_HC)
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


class Bash32(unittest.TestCase):
    """macOS's /bin/bash is 3.2, without bash 4's mapfile and readarray (GitHub #736): restart.sh still restarts."""

    def restart(self, env):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        hc = os.path.join(d, "bin", "hc")
        with open(hc, "w") as f:
            f.write(CHAT_LABEL_HC)
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


class Detach(unittest.TestCase):
    """lib/coordinator.js's script() runs the helper scripts detached, also where there is no setsid (macOS, #736)."""

    def detach(self, with_setsid):
        src = read(os.path.join(ROOT, "lib", "coordinator.js"))
        m = re.search(r"^export const DETACH = '(.*)';$", src, re.M)
        self.assertIsNotNone(m, "lib/coordinator.js exports DETACH, the shell line script() runs")
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, "bin"))
        for tool in ["bash", "nohup", "sleep"] + (["setsid"] if with_setsid else []):
            os.symlink(shutil.which(tool), os.path.join(d, "bin", tool))
        sh = os.path.join(d, "helper.sh")
        with open(sh, "w") as f:
            f.write('sleep 0.5; printf "%s\\n" "$@" >"$OUT"\n')
        out = os.path.join(d, "out")
        t = time.time()
        r = subprocess.run(["bash", "-c", m.group(1), sh, "t2", "a b"], env={"PATH": f"{d}/bin", "HOME": d, "OUT": out},
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(time.time() - t, 0.5, "it returns at once, the script running on")
        for _ in range(50):
            if os.path.exists(out) and read(out).endswith("\n"):
                break
            time.sleep(0.1)
        self.assertEqual(read(out), "t2\na b\n")

    @unittest.skipUnless(shutil.which("setsid"), "setsid is not installed; macOS uses the tested nohup fallback")
    def test_with_setsid(self):
        self.detach(True)

    def test_without_setsid(self):
        self.detach(False)


if __name__ == "__main__":
    unittest.main()
