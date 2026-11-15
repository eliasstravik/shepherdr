"""herdr-artifact cuts pictures with nothing else installed (#1054): a stock machine may have no ImageMagick and no PIL.
`crop` and the window's Mark up (crop_shot) read and write PNG in plain Python; the guide no longer sends agents to
`magick`. The test PNGs are written here with every row filter PNG has, so the reader's unfiltering is checked."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import json
import os
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
sys.dont_write_bytecode = True
loader = importlib.machinery.SourceFileLoader("herdr_artifact_crop_under_test", TOOL)
spec = importlib.util.spec_from_loader(loader.name, loader)
A = importlib.util.module_from_spec(spec)
loader.exec_module(A)


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def write_png(path, w, h, ch, pixel):
    """A PNG whose rows use filters 0-4 in turn; pixel(x, y) -> a tuple of ch bytes."""
    rows = [bytes(v for x in range(w) for v in pixel(x, y)) for y in range(h)]
    out, prev = [], bytes(w * ch)
    for y, r in enumerate(rows):
        ft = y % 5
        left = lambda i: r[i - ch] if i >= ch else 0
        upleft = lambda i: prev[i - ch] if i >= ch else 0
        enc = bytes((r[i] - (0, left(i), prev[i], (left(i) + prev[i]) >> 1, paeth(left(i), prev[i], upleft(i)))[ft]) & 255
                    for i in range(len(r)))
        out.append(bytes([ft]) + enc)
        prev = r

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2 if ch == 3 else 6, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(b"".join(out))) + chunk(b"IEND", b""))
    return rows


class Crop(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-crop-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        rnd = random.Random(7)
        self.noise = {(x, y): tuple(rnd.randrange(256) for _ in range(4)) for x in range(40) for y in range(30)}

    def test_every_filter_reads_back_exactly(self):
        for ch in (3, 4):
            with self.subTest(channels=ch):
                p = os.path.join(self.dir, f"n{ch}.png")
                rows = write_png(p, 40, 30, ch, lambda x, y: self.noise[x, y][:ch])
                w, h, c, got = A.png_read(p)
                self.assertEqual((w, h, c), (40, 30, ch))
                self.assertEqual([bytes(r) for r in got], rows)

    def test_crop_command_with_no_imagemagick_on_the_path(self):
        src, out = os.path.join(self.dir, "shot.png"), os.path.join(self.dir, "cut.png")
        rows = write_png(src, 40, 30, 4, lambda x, y: self.noise[x, y])
        env = {"HOME": os.environ["HOME"], "PATH": "/nonexistent"}
        r = subprocess.run([sys.executable, "-I", TOOL, "crop", src, out, "--rect", "5,7,20,10", "--json"],
                           env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"out": out, "width": 20, "height": 10})
        _w, _h, _c, got = A.png_read(out)
        self.assertEqual([bytes(x) for x in got], [r_[5 * 4:25 * 4] for r_ in rows[7:17]])

    def test_a_rect_past_the_edge_is_kept_inside_and_max_shrinks(self):
        src, out = os.path.join(self.dir, "s.png"), os.path.join(self.dir, "o.png")
        write_png(src, 40, 30, 3, lambda x, y: (x, y, 0))
        A.png_cut(src, out, 30, 20, 50, 50)
        self.assertEqual(A.png_size(out), (10, 10))
        A.png_cut(src, out, 0, 0, 40, 30, longest=20)
        self.assertEqual(A.png_size(out), (20, 15))

    def test_the_window_mark_up_cuts_and_outlines_without_imagemagick(self):
        shot, out = os.path.join(self.dir, "win.png"), os.path.join(self.dir, "spot.png")
        write_png(shot, 40, 30, 3, lambda x, y: (255, 255, 255))
        app = os.path.join(self.dir, "app")
        os.makedirs(app)
        with open(os.path.join(app, "window.json"), "w") as f:
            json.dump({"bounds": [0, 0, 20, 15]}, f)  # a 2x shot
        with mock.patch.object(A, "APP", app), mock.patch.object(A.shutil, "which", return_value=None):
            self.assertTrue(A.crop_shot(shot, [2, 2, 15, 10], [4, 4, 10, 8], out))
        w, h, ch, rows = A.png_read(out)
        self.assertEqual((w, h), (30, 20))
        blue = bytes((0x2F, 0x81, 0xF7))
        self.assertEqual(bytes(rows[4][4 * 3:5 * 3]), blue)    # the outline's corner, at the spot (2x)
        self.assertEqual(bytes(rows[10][10 * 3:11 * 3]), b"\xff\xff\xff")  # inside it: untouched

    def test_the_guide_needs_no_imagemagick(self):
        with open(A.GUIDE) as f:
            guide = f.read()
        self.assertNotIn("magick", guide)
        self.assertIn("herdr-artifact crop", guide)


if __name__ == "__main__":
    unittest.main()
