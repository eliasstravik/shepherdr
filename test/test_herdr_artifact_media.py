"""herdr-artifact's media (SHEP-209): a clip, a sound or a PDF is a block of its own, its file sizes are limited with a
clear error, a recipe's media blocks must name a file of their kind beside it, the stored copy gets a poster and an
mp4 a browser can play (ffmpeg when it is here), and the viewer's Range answers match service/media.ts. Runs in a
throwaway store; herdr-app's check is skipped (not found), and nothing is installed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.machinery
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REAL_WHICH = shutil.which


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


A = load("herdr_artifact_media_under_test", os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact"))
HAS_FFMPEG = bool(REAL_WHICH("ffmpeg") and REAL_WHICH("ffprobe"))


def sparse(path, size):
    with open(path, "wb") as f:
        f.truncate(size)


class Kinds(unittest.TestCase):
    def test_a_file_has_its_kind_from_its_name(self):
        self.assertEqual(A.file_kind("a.PNG"), "image")
        self.assertEqual(A.file_kind("a.webm"), "video")
        self.assertEqual(A.file_kind("a.mov"), "video")
        self.assertEqual(A.file_kind("a.m4a"), "audio")
        self.assertEqual(A.file_kind("a.pdf"), "pdf")
        self.assertIsNone(A.file_kind("a.txt"))

    def test_a_clip_sound_or_pdf_is_allowed_in_a_folder(self):
        for name in ("a.mp4", "a.webm", "a.mov", "a.mp3", "a.m4a", "a.wav", "a.ogg", "a.pdf"):
            self.assertIn(os.path.splitext(name)[1], A.ALLOWED, name)


class Limits(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-media-limits-")
        self.recipe = {"recipe": 1, "blocks": [{"type": "text", "md": "x"}]}
        with open(os.path.join(self.dir, "recipe.json"), "w") as f:
            json.dump(self.recipe, f)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_a_video_over_its_limit_says_how_to_make_it_smaller(self):
        sparse(os.path.join(self.dir, "long.mp4"), 41 * A.MB)
        with self.assertRaises(A.Fail) as e:
            A.gather(self.dir)
        self.assertIn("long.mp4 is 41 MB", str(e.exception))
        self.assertIn("at most 40 MB", str(e.exception))
        self.assertIn("ffmpeg", str(e.exception))

    def test_a_sound_and_a_pdf_have_their_own_limits(self):
        sparse(os.path.join(self.dir, "a.mp3"), 21 * A.MB)
        with self.assertRaises(A.Fail) as e:
            A.gather(self.dir)
        self.assertIn("a sound can be at most 20 MB", str(e.exception))
        os.remove(os.path.join(self.dir, "a.mp3"))
        sparse(os.path.join(self.dir, "a.pdf"), 20 * A.MB)
        _, files = A.gather(self.dir)
        self.assertIn("a.pdf", files)

    def test_a_picture_or_other_file_stays_at_4_MB(self):
        sparse(os.path.join(self.dir, "shot.png"), 5 * A.MB)
        with self.assertRaises(A.Fail) as e:
            A.gather(self.dir)
        self.assertIn("shot.png is 5.0 MB", str(e.exception))

    def test_the_whole_artifact_is_at_most_64_MB(self):
        for i in range(3):
            sparse(os.path.join(self.dir, f"clip{i}.mp4"), 30 * A.MB)
        with self.assertRaises(A.Fail) as e:
            A.gather(self.dir)
        self.assertIn("at most 200 files, 64 MB in all", str(e.exception))


class RecipeChecks(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-media-recipe-")
        for name in ("clip.mp4", "poster.jpg", "song.mp3", "doc.pdf", "shot.png"):
            open(os.path.join(self.dir, name), "wb").close()
        self.files = sorted(os.listdir(self.dir))

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def problems(self, *blocks):
        with open(os.path.join(self.dir, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": list(blocks)}, f)
        return A.recipe_problems(self.dir, self.files)

    def test_each_media_block_takes_its_kind(self):
        self.assertEqual(self.problems({"type": "video", "src": "clip.mp4", "poster": "poster.jpg"}), [])
        self.assertEqual(self.problems({"type": "audio", "src": "song.mp3"}), [])
        self.assertEqual(self.problems({"type": "pdf", "src": "doc.pdf"}), [])
        self.assertEqual(self.problems({"type": "pair", "before": {"src": "shot.png"}, "after": {"src": "clip.mp4"}}), [])
        self.assertTrue(self.problems({"type": "video", "src": "shot.png"}))
        self.assertTrue(self.problems({"type": "audio", "src": "clip.mp4"}))
        self.assertTrue(self.problems({"type": "pdf", "src": "song.mp3"}))
        self.assertTrue(self.problems({"type": "image", "src": "clip.mp4"}))
        self.assertTrue(self.problems({"type": "pair", "before": {"src": "shot.png"}, "after": {"src": "song.mp3"}}))

    def test_a_poster_is_a_picture_beside_the_clip(self):
        self.assertTrue(self.problems({"type": "video", "src": "clip.mp4", "poster": "clip.mp4"}))
        self.assertTrue(self.problems({"type": "video", "src": "clip.mp4", "poster": "missing.jpg"}))

    def test_a_missing_file_is_named(self):
        bad = self.problems({"type": "video", "src": "gone.webm"})
        self.assertTrue(any("gone.webm" in x for x in bad))


class MakingReady(unittest.TestCase):
    """the stored copy: a poster for a clip with none, an mp4 for one no browser plays (ffmpeg, when it's here)"""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="shepherdr-media-ready-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def recipe(self, *blocks):
        with open(os.path.join(self.dir, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": list(blocks)}, f)

    def test_without_ffmpeg_a_mov_is_only_noted(self):
        with mock.patch.object(A.shutil, "which", return_value=None):
            open(os.path.join(self.dir, "a.mov"), "wb").close()
            self.recipe({"type": "video", "src": "a.mov"})
            files, notes = A.ready_media(self.dir, ["a.mov", "recipe.json"])
        self.assertEqual(files, ["a.mov", "recipe.json"])
        self.assertTrue(any("Safari" in n for n in notes))
        with open(os.path.join(self.dir, "recipe.json")) as f:
            self.assertNotIn("poster", json.load(f)["blocks"][0])

    @unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg and ffprobe")
    def test_with_ffmpeg_a_clip_gets_a_poster_once_and_a_browser_mp4(self):
        clip = os.path.join(self.dir, "clip.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=1",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", clip], check=True)
        hevc = os.path.join(self.dir, "hevc.mov")
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=10:duration=1",
                            "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-an", hevc], capture_output=True)
        self.recipe({"type": "video", "src": "clip.mp4"}, {"type": "pair", "before": {"src": "clip.mp4"}, "after": {"src": "hevc.mov"}})
        files, notes = A.ready_media(self.dir, sorted(x for x in ("clip.mp4", "hevc.mov") if os.path.exists(os.path.join(self.dir, x))))
        with open(os.path.join(self.dir, "recipe.json")) as f:
            recipe = json.load(f)
        first, pair = recipe["blocks"]
        self.assertEqual(first["poster"], "clip.poster.jpg")
        self.assertEqual(pair["before"]["poster"], "clip.poster.jpg")  # the same clip, the same still
        self.assertIn("clip.poster.jpg", files)
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "clip.poster.jpg")))
        if r.returncode == 0:
            self.assertEqual(pair["after"]["src"], "hevc.web.mp4")
            self.assertNotIn("hevc.mov", files)
            self.assertIn("hevc.web.mp4", files)
            self.assertTrue(any("hevc.web.mp4" in n for n in notes))

    @unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg and ffprobe")
    def test_a_clip_that_is_not_a_clip_is_noted_not_published_as_fine(self):
        bad = os.path.join(self.dir, "broken.mov")
        with open(bad, "wb") as f:
            f.write(b"not a movie" * 100)
        self.recipe({"type": "video", "src": "broken.mov"})
        files, notes = A.ready_media(self.dir, ["broken.mov"])
        self.assertTrue(notes)
        self.assertIn("broken.mov", files)


class Spans(unittest.TestCase):
    """a Range header's part of a file, the answers service/media.ts gives"""

    def test_the_span_of_a_file(self):
        self.assertIsNone(A.span(None, 100))
        self.assertEqual(A.span("bytes=0-9", 100), (0, 9))
        self.assertEqual(A.span("bytes=10-", 100), (10, 99))
        self.assertEqual(A.span("bytes=-20", 100), (80, 99))
        self.assertEqual(A.span("bytes=90-500", 100), (90, 99))
        self.assertEqual(A.span("bytes=200-", 100), "bad")


if __name__ == "__main__":
    unittest.main()
