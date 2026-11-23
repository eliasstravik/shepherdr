"""herdr-browser checks Chrome's shared libraries before it starts Chrome (SHEP-200, GitHub #918). A library Chrome needs
that the machine lacks makes Chrome exit 127 at once; agent-browser's doctor only checks that Chrome's file is there,
so the task browser used to fail with the loader's line buried in a stderr dump. Now it names the library and the
install command for the distro, and runs nothing. The same goes for Ubuntu's AppArmor block of user namespaces
(SHEP-203, GitHub #920): Chrome's sandbox stays on, and the fix for this Chrome is said, never run. Throwaway homes
and folders; the agent-browser is a stand-in."""
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
# (3.2: the space's browser and the join, answered quietly; the command itself says "ran")
case "$*" in *"session list") exit 0 ;; *"get cdp-url") echo "ws://127.0.0.1:1/devtools/browser/fake"; exit 0 ;; *"herdr-s-"*|*" tab T1"|*" close") exit 0 ;; esac
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
        # no AppArmor restriction unless a test sets one (this machine's real sysctl must not decide the tests)
        env = {"HOME": self.home, "PATH": f"{path or self.fakes}:{self.bin}:/usr/bin:/bin",
               "HERDR_BROWSER_BIN": self.ab, "HERDR_BROWSER_OS_RELEASE": self.osr, "HERDR_BROWSER_NEW_WINDOW": "echo T1",
               "HERDR_BROWSER_USERNS_SYSCTL": os.path.join(self.tmp, "no-such-sysctl"),
               "HERDR_BROWSER_APPARMOR_D": os.path.join(self.tmp, "no-apparmor.d"), **(extra or {})}
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

    # AppArmor's userns block (SHEP-203, GitHub #920): Chrome's sandbox stays on; the fix is said, never run.
    def fake_unshare(self, ok):
        path = os.path.join(self.fakes, "unshare")
        with open(path, "w") as f:
            f.write("#!/bin/sh\nexit %d\n" % (0 if ok else 1))
        os.chmod(path, 0o755)

    def sysctl(self, value):
        path = os.path.join(self.tmp, "apparmor_restrict_unprivileged_userns")
        with open(path, "w") as f:
            f.write(value)
        return path

    def test_userns_blocked_says_the_fix_and_runs_nothing(self):
        self.fake_ldd(RESOLVED)
        self.fake_unshare(ok=False)
        self.os_release("ID=ubuntu\nID_LIKE=debian\n")
        p = self.run_hb("--task", "a#1", "open", "x", extra={"HERDR_BROWSER_USERNS_SYSCTL": self.sysctl("1\n")})
        self.assertEqual(p.returncode, 127, p.stdout + p.stderr)
        self.assertNotIn("ran ", p.stdout, "agent-browser must not start")
        chrome = os.path.realpath(self.chrome)
        self.assertIn("AppArmor blocks unprivileged user namespaces", p.stderr)
        self.assertIn("Chrome's sandbox stays on, and nothing was changed.", p.stderr)
        self.assertIn(f"profile herdr-browser-chrome \"{chrome}\" flags=(unconfined) {{", p.stderr)
        self.assertIn("'  userns,'", p.stderr)
        self.assertIn("sudo tee /etc/apparmor.d/herdr-browser-chrome", p.stderr)
        self.assertIn("sudo apparmor_parser -r /etc/apparmor.d/herdr-browser-chrome", p.stderr)
        self.assertIn("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0", p.stderr)
        self.assertNotIn("no-sandbox", p.stderr)
        self.assertNotIn("missing system libraries", p.stderr)

    def test_userns_works_or_restriction_off_runs(self):
        self.fake_ldd(RESOLVED)
        self.os_release("ID=ubuntu\n")
        for ok, value in ((False, "0\n"), (True, "1\n")):
            with self.subTest(unshare_ok=ok, sysctl=value):
                self.fake_unshare(ok=ok)
                p = self.run_hb("--task", "a#1", "open", "x",
                                extra={"HERDR_BROWSER_USERNS_SYSCTL": self.sysctl(value)})
                self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
                self.assertIn("ran --session herdr-a-1", p.stdout)
                self.assertNotIn("AppArmor", p.stderr)

    def test_profile_for_this_chrome_is_the_fix_in_place(self):
        # the fix applied: the profile names this Chrome's path, and the (unconfined) shell still can't unshare
        self.fake_ldd(RESOLVED)
        self.fake_unshare(ok=False)
        self.os_release("ID=ubuntu\n")
        apparmor = os.path.join(self.tmp, "apparmor.d")
        os.makedirs(apparmor)
        with open(os.path.join(apparmor, "herdr-browser-chrome"), "w") as f:
            f.write(f'abi <abi/4.0>,\nprofile herdr-browser-chrome "{os.path.realpath(self.chrome)}" flags=(unconfined) {{\n  userns,\n}}\n')
        extra = {"HERDR_BROWSER_USERNS_SYSCTL": self.sysctl("1\n"), "HERDR_BROWSER_APPARMOR_D": apparmor}
        p = self.run_hb("--task", "a#1", "open", "x", extra=extra)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ran --session herdr-a-1", p.stdout)
        # a profile for another Chrome (an older version's path) is not the fix for this one
        with open(os.path.join(apparmor, "herdr-browser-chrome"), "w") as f:
            f.write('profile herdr-browser-chrome "/home/someone/chrome-150/chrome" flags=(unconfined) {\n  userns,\n}\n')
        p = self.run_hb("--task", "a#1", "open", "x", extra=extra)
        self.assertEqual(p.returncode, 127, p.stdout + p.stderr)
        self.assertIn("AppArmor blocks unprivileged user namespaces", p.stderr)

    def test_no_sysctl_here_is_not_this_problem(self):
        # a machine without the Ubuntu sysctl (macOS, other distros) with a failing unshare: not AppArmor's
        self.fake_ldd(RESOLVED)
        self.fake_unshare(ok=False)
        self.os_release("ID=debian\n")
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertNotIn("AppArmor", p.stderr)

    def test_install_says_the_userns_fix(self):
        self.fake_ldd(RESOLVED)
        self.fake_unshare(ok=False)
        self.os_release("ID=ubuntu\n")
        p = self.run_hb("--install", extra={"HERDR_BROWSER_USERNS_SYSCTL": self.sysctl("1\n")})
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("AppArmor blocks unprivileged user namespaces", p.stderr)
        self.assertNotIn("ready", p.stdout)


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux arm64's fallback")
class Arm64Chromium(unittest.TestCase):
    """Linux arm64 has no Chrome for Testing to download (GitHub #1264): with no Chrome of agent-browser's own, the
    task browser uses a Chromium already here (Playwright's, else the system's, never Ubuntu's snap), or says the one
    command that installs one."""
    setUp = MissingLibraries.setUp
    tearDown = MissingLibraries.tearDown
    fake_ldd = MissingLibraries.fake_ldd
    ldd_checked = MissingLibraries.ldd_checked
    os_release = MissingLibraries.os_release
    tool_dirs = ("/usr/bin", "/bin")

    def run_hb(self, *args, arch="aarch64", extra=None):
        # PATH: this machine's tools minus any real Chrome or Chromium, so only the test's fakes can be found
        tools = os.path.join(self.tmp, "tools")
        if not os.path.isdir(tools):
            os.makedirs(tools)
            # the first folder with a name wins, as in a shell; lexists, as a dangling link "exists" for symlink()
            # (GitHub's runner has broken links like grub-ntldr-img in both /usr/bin and /bin)
            for d in self.tool_dirs:
                for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                    if "chrom" in n or n.startswith("google-chrome") or os.path.lexists(os.path.join(tools, n)):
                        continue
                    os.symlink(os.path.join(d, n), os.path.join(tools, n))
        env = {"HOME": self.home, "PATH": f"{self.fakes}:{self.bin}:{tools}", "HERDR_BROWSER_ARCH": arch,
               "HERDR_BROWSER_BIN": self.ab, "HERDR_BROWSER_OS_RELEASE": self.osr, "HERDR_BROWSER_NEW_WINDOW": "echo T1",
               "HERDR_BROWSER_USERNS_SYSCTL": os.path.join(self.tmp, "no-such-sysctl"),
               "HERDR_BROWSER_APPARMOR_D": os.path.join(self.tmp, "no-apparmor.d"), **(extra or {})}
        return subprocess.run([os.path.join(tools, "sh"), HB, *args], capture_output=True, text=True, env=env,
                              stdin=subprocess.DEVNULL, timeout=60)

    def exe(self, path, text="#!/bin/sh\necho chromium\n"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, 0o755)
        return path

    def no_own_chrome(self):
        shutil.rmtree(os.path.join(self.home, ".agent-browser"))

    def test_system_chromium_is_used(self):
        self.no_own_chrome()
        self.fake_ldd(RESOLVED)
        self.os_release("ID=debian\n")
        sys_chromium = self.exe(os.path.join(self.fakes, "chromium"))
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("ran --session herdr-a-1", p.stdout)
        self.assertEqual(self.ldd_checked(), sys_chromium)
        self.assertTrue(self.run_hb("--install").returncode == 0)

    def test_tools_folders_that_overlap(self):
        # GitHub's runner: the same names, dangling links among them, in two of the PATH's folders
        a, b = os.path.join(self.tmp, "a"), os.path.join(self.tmp, "b")
        for d in (a, b):
            os.makedirs(d)
            for n in os.listdir("/usr/bin"):
                os.symlink(os.path.join("/usr/bin", n), os.path.join(d, n))
            os.symlink(os.path.join(self.tmp, "gone"), os.path.join(d, "dangling-tool"))
            self.exe(os.path.join(d, "same-tool"))
        self.tool_dirs = (a, b)
        self.test_system_chromium_is_used()
        self.assertEqual(os.readlink(os.path.join(self.tmp, "tools", "same-tool")), os.path.join(a, "same-tool"))

    def test_playwright_chromium_comes_first(self):
        self.no_own_chrome()
        self.fake_ldd(RESOLVED)
        self.exe(os.path.join(self.fakes, "chromium"))
        pw = os.path.join(self.home, ".cache/ms-playwright")
        self.exe(os.path.join(pw, "chromium-1100/chrome-linux/chrome"))
        newest = self.exe(os.path.join(pw, "chromium-1200/chrome-linux/chrome"))
        self.exe(os.path.join(pw, "chromium_headless_shell-1200/chrome-linux/headless_shell"))
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.ldd_checked(), newest)

    def test_own_chrome_and_a_set_path_win(self):
        self.fake_ldd(RESOLVED)
        self.exe(os.path.join(self.fakes, "chromium"))
        p = self.run_hb("--task", "a#1", "open", "x")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.ldd_checked(), self.chrome)
        mine = self.exe(os.path.join(self.tmp, "my-chrome"))
        p = self.run_hb("--task", "a#1", "open", "x", extra={"AGENT_BROWSER_EXECUTABLE_PATH": mine})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual(self.ldd_checked(), mine)

    def test_snap_chromium_is_skipped_and_the_fix_is_said(self):
        self.no_own_chrome()
        self.fake_ldd(RESOLVED)
        self.exe(os.path.join(self.fakes, "chromium-browser"), "#!/bin/sh\nexec /snap/bin/chromium \"$@\"\n")
        for osr, fix in [("ID=ubuntu\nID_LIKE=debian\n", "npx playwright install chromium"),
                         ("ID=debian\n", "sudo apt-get install -y chromium"),
                         ("ID=fedora\n", "sudo dnf install -y chromium")]:
            with self.subTest(os=osr):
                self.os_release(osr)
                p = self.run_hb("--task", "a#1", "open", "x")
                self.assertEqual(p.returncode, 127, p.stdout + p.stderr)
                self.assertIn("there's no Chrome download for Linux arm64, and no Chromium here. Fix it: " + fix,
                              p.stderr)
                self.assertNotIn("ran ", p.stdout)
                p = self.run_hb("--install")
                self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
                self.assertIn("Fix it: " + fix, p.stderr)
                self.assertNotIn("downloading Chrome", p.stderr)

    def test_x64_keeps_downloading(self):
        # elsewhere nothing changes: no Chrome yet means agent-browser installs one, a system Chromium isn't picked
        self.no_own_chrome()
        self.fake_ldd(RESOLVED)
        self.exe(os.path.join(self.fakes, "chromium"))
        p = self.run_hb("--task", "a#1", "open", "x", arch="x86_64")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertFalse(os.path.exists(self.ldd_args), "no Chrome was picked for the library check")


if __name__ == "__main__":
    unittest.main()
