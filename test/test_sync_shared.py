"""bin/sync-shared on a copy of the tree: a published artifact's generated mod (art-<id>, art-<id>--v<n>) carries
frozen copies of dirs.js and core/paths.js; they are not unlisted copies of lib/ (GitHub #1008, #1027)."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ArtifactModsAreNotCopies(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        skip = shutil.ignore_patterns("node_modules", "__pycache__", ".last")
        for top in ("lib", "core", "bin", "mods"):
            shutil.copytree(os.path.join(ROOT, top), os.path.join(self.tmp, top), ignore=skip, symlinks=True)
        self.mods = os.path.join(self.tmp, "mods")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def art_mod(self, name, stale=False):
        """An artifact's mod as herdr-artifact installs one: the markup helpers copied in (stale: an older release's)."""
        top = os.path.join(self.mods, name)
        for rel in ("dirs.js", os.path.join("core", "paths.js")):
            os.makedirs(os.path.dirname(os.path.join(top, rel)), exist_ok=True)
            with open(os.path.join(self.mods, "artifacts", rel), "rb") as f:
                data = f.read()
            with open(os.path.join(top, rel), "wb") as f:
                f.write(data + (b"\n// older release\n" if stale else b""))
        with open(os.path.join(top, "main.js"), "w") as f:
            f.write("export default {}\n")

    def run_sync(self, *args):
        return subprocess.run([sys.executable, os.path.join(self.tmp, "bin", "sync-shared"), *args],
                              capture_output=True, text=True, cwd=self.tmp)

    def test_check_passes_with_artifact_mods(self):
        self.art_mod("art-proof-0f09")
        self.art_mod("art-proof-0f09--v2", stale=True)
        self.art_mod("art-notes-1a2b", stale=True)
        p = self.run_sync("--check")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertNotIn("art-", p.stdout + p.stderr)

    def test_sync_leaves_artifact_mods_alone(self):
        self.art_mod("art-notes-1a2b", stale=True)
        dirs = os.path.join(self.mods, "art-notes-1a2b", "dirs.js")
        with open(dirs, "rb") as f:
            before = f.read()
        p = self.run_sync()
        self.assertEqual(p.returncode, 0, p.stderr)
        with open(dirs, "rb") as f:
            self.assertEqual(f.read(), before)

    def test_a_real_unlisted_copy_is_still_named(self):
        top = os.path.join(self.mods, "partly")
        os.makedirs(top)
        shutil.copyfile(os.path.join(self.mods, "artifacts", "dirs.js"), os.path.join(top, "dirs.js"))
        p = self.run_sync("--check")
        self.assertEqual(p.returncode, 1)
        self.assertIn("mods/partly/dirs.js looks like a copy of lib/dirs.js", p.stderr)


if __name__ == "__main__":
    unittest.main()
