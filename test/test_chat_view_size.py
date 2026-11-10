"""The window chat's image thumbnails get their pixel size from `magick identify` or, without ImageMagick, from
ffprobe (mods/chat/attach.js, VIEW). The ffprobe option string `-of csv=p=0:s=' '` is rejected (ffprobe 8, and the
ffprobe here too), so the size was never found and the picture stayed an empty grey box (SHEP-194, GitHub #914).
The VIEW script is run as it is written in attach.js, in sh, with `magick` absent. ffprobe is a stub that rejects
the old option string the way ffprobe 8 does; a real ffprobe, when installed, also checks a generated PNG."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import re
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATTACH = os.path.join(ROOT, "mods", "chat", "attach.js")

# `const VIEW = `...`;` from attach.js, its template text as written (node evaluates it, so escapes match the app).
SRC = open(ATTACH, encoding="utf-8").read()
MATCH = re.search(r"const VIEW = `(.*?)`;", SRC, re.S)

# An ffprobe that behaves like ffprobe 8 on the old option string: it refuses `s=` in -of, and prints
# "width,height" for the csv writer with p=0 (its real output).
FAKE_FFPROBE = r"""#!/bin/sh
for a in "$@"; do
  case "$a" in *s=*) echo "[csv @ 0x0] Failed to parse option string '$a' provided to writer context" >&2; exit 1;; esac
done
echo "640,480"
"""

# `magick` is not installed (the case this is about): it fails like a missing command.
FAKE_MAGICK = "#!/bin/sh\nexit 127\n"


def script_text():
    # The template literal's text, evaluated by node the way the app's JS does.
    body = MATCH.group(1)
    out = subprocess.run(
        ["node", "-e", "process.stdout.write(eval('`' + require('fs').readFileSync(0, 'utf8') + '`'))"],
        input=body, capture_output=True, text=True, check=True).stdout
    return out


def png(w, h):
    # A minimal valid PNG (one grey row per line, zlib-compressed), enough for any ffprobe to read the size.
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\x80" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def run_view(files, bin_dir, out_dir):
    # sh -c VIEW view <dir> <files...>, with PATH = bin_dir first, then the system's.
    env = dict(os.environ, PATH=bin_dir + os.pathsep + os.environ.get("PATH", ""))
    r = subprocess.run(["sh", "-c", script_text(), "view", out_dir, *files],
                       capture_output=True, text=True, env=env)
    lines = {}
    for line in r.stdout.split("\n"):
        parts = line.split("\t")
        if len(parts) == 3:
            lines[parts[0]] = parts[2]
    return lines


class ViewSizeWithoutImageMagick(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if MATCH is None or shutil.which("node") is None:
            raise unittest.SkipTest("attach.js VIEW not found or no node")

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.bin = os.path.join(self.tmp, "bin")
        os.mkdir(self.bin)
        self.img = os.path.join(self.tmp, "photo.png")
        with open(self.img, "wb") as f:
            f.write(png(3, 2))
        self.out = os.path.join(self.tmp, "view")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def stub(self, name, text):
        path = os.path.join(self.bin, name)
        with open(path, "w") as f:
            f.write(text)
        os.chmod(path, 0o755)

    def test_size_found_when_ffprobe_takes_the_option_string_it_accepts(self):
        # ffprobe 8 (stub): the old `s=' '` form is refused, so the size must come from the csv form that works.
        self.stub("ffprobe", FAKE_FFPROBE)
        self.stub("magick", FAKE_MAGICK)
        sizes = run_view([self.img], self.bin, self.out)
        self.assertEqual(sizes.get(self.img), "640 480")

    @unittest.skipUnless(shutil.which("ffprobe"), "no ffprobe installed here")
    def test_size_found_by_the_real_ffprobe_without_magick(self):
        self.stub("magick", FAKE_MAGICK)
        sizes = run_view([self.img], self.bin, self.out)
        self.assertEqual(sizes.get(self.img), "3 2")


if __name__ == "__main__":
    unittest.main()
