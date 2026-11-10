"""Local image import, cancellation and picker errors without opening a desktop dialog."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("wallpaper_import", ROOT / "mods/shepherdr-settings/wallpaper.py")
wallpaper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wallpaper)


class Wallpaper(unittest.TestCase):
    def test_import_owns_a_copy_and_passes_unusual_names_as_one_argument(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work)
            source = root / "Summer's $(touch never) 🌞.jpg"
            source.write_bytes(b"original")
            def decode(args, **kwargs):
                self.assertEqual(args[-1], str(source))
                Path(args[2]).write_bytes(b"decoded PNG")
                return subprocess.CompletedProcess(args, 0, json.dumps({"name": source.name, "width": 800, "height": 600}), "")
            with patch.object(wallpaper.sys, "platform", "darwin"), patch.object(wallpaper.subprocess, "run", side_effect=decode):
                result = wallpaper.import_image(root, source)
            source.unlink()
            self.assertEqual((root / result["path"]).read_bytes(), b"decoded PNG")
            self.assertEqual(result["name"], source.name)
            self.assertEqual((root / result["path"]).stat().st_mode & 0o777, 0o600)
            self.assertEqual(list((root / wallpaper.DIRECTORY).glob("import-*")), [])

    def test_cancel_does_not_create_a_wallpaper(self):
        with tempfile.TemporaryDirectory() as work, patch.object(wallpaper.sys, "platform", "darwin"), \
             patch.object(wallpaper, "mac_picker", return_value="/picker"), \
             patch.object(wallpaper.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '{"cancelled":true}', "")):
            root = Path(work)
            self.assertEqual(wallpaper.import_image(root), {"cancelled": True})
            self.assertEqual(list((root / wallpaper.DIRECTORY).iterdir()), [])

    def test_decode_failure_is_returned_to_the_ui_without_an_image(self):
        with tempfile.TemporaryDirectory() as work, patch.object(wallpaper.sys, "platform", "darwin"), \
             patch.object(wallpaper.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, '{"error":"Invalid image"}', "")):
            root = Path(work)
            request = "a" * 32
            wallpaper.main(["worker", str(root), request, "bad.png"])
            self.assertEqual(json.loads((root / wallpaper.DIRECTORY / (request + ".json")).read_text()), {"error": "Invalid image"})
            self.assertFalse(list((root / wallpaper.DIRECTORY).glob("*.png")))

    def test_picker_is_detached_from_herdr_exec_timeout(self):
        with tempfile.TemporaryDirectory() as work, patch.object(wallpaper.subprocess, "Popen") as start, patch("builtins.print"):
            wallpaper.main(["pick", work])
            self.assertTrue(start.call_args.kwargs["start_new_session"])
            self.assertEqual(start.call_args.args[0][2:4], ["worker", work])

    def test_request_cannot_escape_the_wallpaper_folder(self):
        with tempfile.TemporaryDirectory() as work:
            with self.assertRaises(ValueError):
                wallpaper.main(["worker", work, "../elsewhere"])

    def test_native_picker_is_built_once_with_a_named_app_window(self):
        with tempfile.TemporaryDirectory() as work:
            def compile(args, **kwargs):
                Path(args[-1]).touch()
                return subprocess.CompletedProcess(args, 0, "", "")
            with patch.object(wallpaper.subprocess, "run", side_effect=compile) as build:
                first = wallpaper.mac_picker(Path(work))
                self.assertEqual(wallpaper.mac_picker(Path(work)), first)
                self.assertEqual(build.call_count, 1)
            info = wallpaper.plistlib.loads((Path(first).parents[1] / "Info.plist").read_bytes())
            self.assertEqual(info["CFBundleName"], "BossGoat Wallpaper")
