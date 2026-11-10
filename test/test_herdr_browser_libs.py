"""herdr-browser checks Chrome's shared libraries before it starts Chrome (SHEP-200, GitHub #918). A library Chrome needs
that the machine lacks makes Chrome exit 127 at once; agent-browser's doctor only checks that Chrome's file is there,
so the task browser used to fail with the loader's line buried in a stderr dump. Now it names the library and the
install command for the distro, and runs nothing. Throwaway homes and folders; the agent-browser is a stand-in."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HB = os.path.join(ROOT, "bin", "herdr-browser")

FAKE_AGENT_BROWSER = """#!/bin/sh
case "$1" in
  --version) echo "agent-browser 0.41.1"; exit 0 ;;
  doctor) echo '{"checks":[{"id":"chrome.installed","status":"pass"}]}'; exit 0 ;;
esac
echo "ran $*"
"""

# ldd's answer for a Chrome with three libraries missing: one by its real name, one with a package name we know.
MISSING = """\tlinux-vdso.so.1 (0x00007ffd)
\tlibgbm.so.1 => not found
\tlibnss3.so => not found
\tlibfoo.so.2 => not found
\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f)
"""
RESOLVED = """\tlibgbm.so.1 => /lib/x86_64-linux-gnu/libgbm.so.1 (0x00007f)
\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f)
"""


@unittest.skipUnless(sys.platform.startswith("linux"), "the library check is Linux's (ldd); macOS has none")
class MissingLibraries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="shepherdr-libs-")
        self.home = os.path.join(self.tmp, "home")
        self.bin = os.path.join(self.tmp, "bin")
        self.fakes = os.path.join(self.tmp, "fakes")
        for d in (self.home, self.bin, self.fakes):
            os.makedirs(d)
        self.ab = os.path.join(self.bin, "agent-browser")
        with open(self.ab, "w") as f:
            f.write(FAKE_AGENT_BROWSER)
        os.chmod(self.ab, 0o755)
        # Chrome where agent-browser installs it: the newest one is the one checked
        self.chrome = os.path.join(self.home, ".agent-browser/browsers/chrome-156.0.8078.73/chrome")
        os.makedirs(os.path.dirname(self.chrome))
        with open(self.chrome, "w") as f:
            f.write("#!/bin/sh\necho chrome\n")
        os.chmod(self.chrome, 0o755)
        self.osr = os.path.join(self.tmp, "os-release")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_ldd(self, output):
        """An ldd that prints `output` and writes its arguments to a file, so a test can see which Chrome was checked."""
        self.ldd_args = os.path.join(self.tmp, "ldd-args")
        path = os.path.join(self.fakes, "ldd")
        with open(path, "w") as f:
            f.write(f"#!/bin/sh\necho \"$@\" > '{self.ldd_args}'\ncat <<'LDD'\n{output}LDD\n")
        os.chmod(path, 0o755)
        return self.fakes

    def ldd_checked(self):
        with open(self.ldd_args) as f:
            return f.read().strip()

    def os_release(self, text):
        with open(self.osr, "w") as f:
            f.write(text)

    def run_hb(self, *args, path=None, extra=None):
        env = {"HOME": self.home, "PATH": f"{path or self.fakes}:{self.bin}:/usr/bin:/bin",
               "HERDR_BROWSER_BIN": self.ab, "HERDR_BROWSER_OS_RELEASE": self.osr, **(extra or {})}
        return subprocess.run(["sh", HB, *args], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL,
                              timeout=60)

    def test_missing_library_is_named_and_nothing_runs(self):
        # The real ldd on a real program that needs a library this machine doesn't have (gcc builds it; no gcc, no test)
        if not shutil.which("gcc"):
            self.skipTest("needs gcc to build a program with a missing library")
        src = os.path.join(self.tmp, "src")
        os.makedirs(src)
        with open(os.path.join(src, "stub.c"), "w") as f:
            f.write("int shep_stub(void){return 0;}\n")
        with open(os.path.join(src, "main.c"), "w") as f:
            f.write("int shep_stub(void);\nint main(void){return shep_stub();}\n")
        lib = os.path.join(src, "libshepmissing.so")
        subprocess.run(["gcc", "-shared", "-fPIC", "-Wl,-soname,libshepmissing.so.1", "-o", lib,
                        os.path.join(src, "stub.c")], check=True)
        subprocess.run(["gcc", "-o", self.chrome, os.path.join(src, "main.c"), lib], check=True)
        os.remove(lib)  # the program still names libshepmissing.so.1, which is now not on this machine
        self.os_release("ID=ubuntu\nID_LIKE=debian\n")
        env_path = f"{self.bin}:/usr/bin:/bin"  # the real ldd
        p = self.run_hb("--task", "a#1", "open", "x", path=env_path)
        self.assertEqual(p.returncode, 127, p.stdout + p.stderr)
        self.assertIn("missing system libraries: libshepmissing.so.1.", p.stderr)
        self.assertIn("No package name is known here for: libshepmissing.so.1.", p.stderr)
        self.assertNotIn("ran ", p.stdout, "agent-browser must not start")
        self.assertNotIn("DevToolsActivePort", p.stderr)

    def test_install_command_for_each_distro(self):
        self.fake_ldd(MISSING)
        cases = [
            ("ID=debian\n", "Install: sudo apt-get install -y libgbm1 libnss3\n"),
            ("ID=ubuntu\nID_LIKE=debian\n", "Install: sudo apt-get install -y libgbm1 libnss3\n"),
            ("ID=fedora\n", "Install: sudo dnf install -y mesa-libgbm nss\n"),
            ("ID=rocky\nID_LIKE=\"rhel centos fedora\"\n", "Install: sudo dnf install -y mesa-libgbm nss\n"),
            ("ID=arch\n", "Install: sudo pacman -S --needed libgbm nss\n"),
            ("ID=alpine\n", "Install: sudo apk add mesa-gbm nss\n"),
        ]
        for osr, install in cases:
            with self.subTest(os=osr):
                self.os_release(osr)
                p = self.run_hb("--task", "a#1", "open", "x")
                self.assertEqual(p.returncode, 127, p.stderr)
                self.assertIn("herdr-browser: Chrome can't start: missing system libraries: libgbm.so.1 libnss3.so "
                              "libfoo.so.2.", p.stderr)
                self.assertIn(install, p.stderr)
                self.assertIn("No package name is known here for: libfoo.so.2.", p.stderr)
                self.assertNotIn("ran ", p.stdout)
        # a distro we don't know: no install command, only the libraries and where to look
        self.os_release("ID=gentoo\n")
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 127, p.stderr)
        self.assertNotIn("Install:", p.stderr)
        self.assertIn("No package name is known here for: libgbm.so.1 libnss3.so libfoo.so.2.", p.stderr)

    def test_chrome_with_its_libraries_runs(self):
        self.fake_ldd(RESOLVED)
        self.os_release("ID=debian\n")
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ran --session herdr-a-1", p.stdout)
        self.assertEqual(self.ldd_checked(), self.chrome, "the newest Chrome is the one checked")

    def test_explicit_chrome_path_is_the_one_checked(self):
        self.fake_ldd(RESOLVED)
        other = os.path.join(self.tmp, "my-chrome")
        with open(other, "w") as f:
            f.write("x")
        p = self.run_hb("--task", "a#1", "open", "x", extra={"AGENT_BROWSER_EXECUTABLE_PATH": other})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.ldd_checked(), other)

    def test_no_chrome_yet_is_not_a_library_problem(self):
        # first use installs Chrome; before it's there, the check has nothing to say
        shutil.rmtree(os.path.join(self.home, ".agent-browser"))
        self.fake_ldd(MISSING)
        self.os_release("ID=debian\n")
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("missing system libraries", p.stderr)

    def test_install_says_the_missing_libraries(self):
        # `herdr-browser --install` is the fix people run: it must not say "ready" for a Chrome that can't start
        self.fake_ldd(MISSING)
        self.os_release("ID=debian\n")
        p = self.run_hb("--install")
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("missing system libraries: libgbm.so.1 libnss3.so libfoo.so.2.", p.stderr)
        self.assertNotIn("ready", p.stdout)
        self.fake_ldd(RESOLVED)
        p = self.run_hb("--install")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ready", p.stdout)


if __name__ == "__main__":
    unittest.main()
