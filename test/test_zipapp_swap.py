"""herdr-task as a zipapp keeps working while an update replaces its file (SHEP-259).

Python's zipimport reads the archive's index once, then opens the file by name again for each import. An update that
put a different herdr-task there meanwhile (in place, or even swapped in with one rename) made the running one's next
import fail: `zipimport.ZipImportError: bad local file header`. The entry now reads its package into memory once."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import io
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)
from herdr_task import base, cli, machines  # noqa: E402

# Stands in for the entry's last lines: one import, wait for the update, then import every module it hasn't yet.
PROBE = '''
import herdr_task.when
print("started", flush=True)
sys.stdin.readline()
import importlib
for name in NAMES:
    importlib.import_module("herdr_task." + name)
print("imported", len(NAMES), flush=True)
'''


def zipapp(entry, prefix=b""):
    """A herdr-task zipapp like base.bundle()'s, its __main__.py this entry; prefix shifts where every file sits."""
    buf = io.BytesIO()
    buf.write(b"#!/usr/bin/env python3\n" + prefix)
    pkg = os.path.join(BIN, "herdr_task")
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("__main__.py", entry)
        for name in sorted(os.listdir(pkg)):
            if name.endswith(".py"):
                with open(os.path.join(pkg, name), "rb") as f:
                    z.writestr(f"herdr_task/{name}", f.read())
    return buf.getvalue()


def probe_entry(entry_path=os.path.join(BIN, "herdr-task")):
    """The real entry's head (everything before its first herdr_task import), then PROBE."""
    with open(entry_path) as f:
        head = f.read().split("from herdr_task import layout")[0]
    names = sorted(n[:-3] for n in os.listdir(os.path.join(BIN, "herdr_task")) if n.endswith(".py") and n != "__init__.py")
    return head + f"NAMES = {names!r}\n" + PROBE


def swap_while_running(entry, how):
    """Starts a zipapp, replaces its file with a different one (how: "rename" or "in place") once it's running, then
    lets it import the rest. -> (returncode, stdout, stderr)."""
    d = tempfile.mkdtemp(prefix="shep-zipapp-")
    path = os.path.join(d, "herdr-task")
    with open(path, "wb") as f:
        f.write(zipapp(entry))
    os.chmod(path, 0o755)
    p = subprocess.Popen([sys.executable, path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         universal_newlines=True)
    try:
        assert p.stdout.readline().strip() == "started", p.stderr.read()
        newer = zipapp(entry, prefix=b"# a newer herdr-task\n" * 40)
        if how == "rename":
            tmp = path + ".new"
            with open(tmp, "wb") as f:
                f.write(newer)
            os.replace(tmp, path)
        else:
            with open(path, "wb") as f:
                f.write(newer)
        out, err = p.communicate("go\n", timeout=60)
    finally:
        if p.poll() is None:
            p.kill()
    return p.returncode, out, err


class SwapWhileRunning(unittest.TestCase):
    def test_a_running_herdr_task_keeps_importing_after_an_update_renames_a_new_copy_in(self):
        code, out, err = swap_while_running(probe_entry(), "rename")
        self.assertEqual(code, 0, err)
        self.assertIn("imported", out)

    def test_a_running_herdr_task_keeps_importing_even_when_its_file_is_rewritten_in_place(self):
        code, out, err = swap_while_running(probe_entry(), "in place")
        self.assertEqual(code, 0, err)
        self.assertIn("imported", out)

    def test_the_built_zipapp_still_runs_and_knows_where_it_is(self):
        d = tempfile.mkdtemp(prefix="shep-zipapp-")
        path = os.path.join(d, "herdr-task")
        with open(path, "wb") as f:
            f.write(base.bundle())
        os.chmod(path, 0o755)
        r = subprocess.run([sys.executable, path, "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        # from memory, yet its modules name the file they came from (base.ENTRY, bundle() and tracebacks need it)
        entry = probe_entry().split("NAMES =")[0] + "import herdr_task.base as b\nprint(b.ENTRY)\n" \
            "print(type(b.__spec__.loader).__name__)\nprint(b.bundle() == open(b.ENTRY, 'rb').read())\n"
        with open(path, "wb") as f:
            f.write(zipapp(entry))
        r = subprocess.run([sys.executable, path], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.split(), [os.path.realpath(path), "Held", "True"])


class InstallsSwapInOneStep(unittest.TestCase):
    """Every install of herdr-task on a machine writes beside it and renames it in, never over the running file."""

    def test_herdr_task_on_writes_a_temp_copy_then_moves_it_in(self):
        import json
        ran, wrote = [], []

        def run(argv, cwd=None, check=False):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 1 if "test" in argv else 0, "{}" if "test" not in argv else "", "")

        def write(argv, **kw):
            wrote.append(argv)
            return subprocess.CompletedProcess(argv, 0, b"", b"")
        store = tempfile.mkdtemp()
        with mock.patch.object(cli, "run", run), mock.patch.object(cli, "STORE", store), \
                mock.patch.object(cli, "sync_held", lambda: None), mock.patch.object(cli, "guard", lambda a: None), \
                mock.patch.object(cli, "install_secret", lambda m: None), mock.patch.object(cli.subprocess, "run", write):
            cli.remote_run("vm", ["autopilot", "list", "--json"])
        files = [a for a in wrote if a[:3] == ["hc", "file", "write"]]
        self.assertEqual(len(files), 1)
        tmp = files[0][-1]
        self.assertNotEqual(tmp, ".local/bin/herdr-task")
        self.assertTrue(tmp.startswith(".local/bin/herdr-task."))
        move = [a for a in ran if a[:2] == ["hc", "exec"] and "mv -f" in " ".join(a)]
        self.assertEqual(len(move), 1, json.dumps(ran))
        self.assertEqual(move[0][-2:], [tmp, ".local/bin/herdr-task"])
        # the moving command really moves: run its shell part here on throwaway files
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "new"), "w") as f:
            f.write("new")
        sh = move[0][move[0].index("--") + 1:]
        subprocess.run(sh[:4] + [os.path.join(d, "new"), os.path.join(d, "herdr-task")], check=True)
        self.assertTrue(os.access(os.path.join(d, "herdr-task"), os.X_OK))
        self.assertFalse(os.path.exists(os.path.join(d, "new")))

    def test_a_sync_swaps_the_file_while_a_reader_keeps_the_old_one(self):
        import base64
        import hashlib
        import json
        home = tempfile.mkdtemp(prefix="shep-sync-home-")
        dest = os.path.join(home, ".local", "bin", "herdr-task")
        os.makedirs(os.path.dirname(dest))
        with open(dest, "wb") as f:
            f.write(b"old")
        held = open(dest, "rb")
        before = os.stat(dest).st_ino
        data = b"#!/bin/sh\necho new\n"
        payload = {"op": "install", "stamp": ".herdr/tools.json", "version": "t", "from": "test", "links": [], "touch": [],
                   "files": [{"path": ".local/bin/herdr-task", "data": base64.b64encode(data).decode(),
                              "sha": hashlib.sha256(data).hexdigest(), "mode": 0o755, "at": 1}]}
        env = {"HOME": home, "PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        r = subprocess.run([sys.executable, "-c", machines.INSTALL], input=json.dumps(payload), env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout.splitlines()[-1])["files"][".local/bin/herdr-task"], "installed")
        self.assertNotEqual(os.stat(dest).st_ino, before)  # a new file, renamed in
        self.assertEqual(held.read(), b"old")             # what a running copy holds stays whole
        held.close()
        self.assertEqual([n for n in os.listdir(os.path.dirname(dest)) if ".herdr-new" in n], [])


if __name__ == "__main__":
    unittest.main()
