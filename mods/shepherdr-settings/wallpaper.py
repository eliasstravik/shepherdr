#!/usr/bin/env python3
"""Import a local wallpaper. The picker runs independently of Herdr's 30-second exec limit."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import uuid

DIRECTORY = "data/bossgoat-wallpaper"
MAX_BYTES = 30 * 1024 * 1024


def mac_picker(root):
    source = Path(__file__).with_name("pick-wallpaper.swift")
    version = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    bundle = root / DIRECTORY / "BossGoat Wallpaper.app" / "Contents"
    binary = bundle / "MacOS" / "BossGoatWallpaper"
    stamp = bundle / "source-version"
    if not binary.exists() or not stamp.exists() or stamp.read_text() != version:
        binary.parent.mkdir(parents=True, exist_ok=True)
        (bundle / "Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": "org.neuralherd.bossgoat.wallpaper",
            "CFBundleName": "BossGoat Wallpaper", "CFBundleExecutable": binary.name,
            "CFBundlePackageType": "APPL", "NSHighResolutionCapable": True,
        }))
        compiled = binary.with_suffix(".new")
        result = subprocess.run(["/usr/bin/swiftc", str(source), "-o", str(compiled)], capture_output=True, text=True)
        if result.returncode:
            raise ValueError("Couldn’t open the image picker. Install Apple’s Command Line Tools, then try again.")
        compiled.replace(binary)
        stamp.write_text(version)
    return str(binary)


def import_image(root, source=None):
    folder = root / DIRECTORY
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="import-", dir=folder) as work:
        output = Path(work) / "image.png"
        if sys.platform == "darwin":
            args = ([mac_picker(root), str(output)] if source is None else
                    ["/usr/bin/swift", str(Path(__file__).with_name("pick-wallpaper.swift")), str(output), str(source)])
            result = subprocess.run(args, capture_output=True, text=True)
            try:
                info = json.loads(result.stdout)
            except ValueError:
                raise ValueError("Couldn’t open the image picker. Install Apple’s Command Line Tools, then try again.")
            if info.get("cancelled"):
                return info
            if result.returncode or info.get("error"):
                raise ValueError(info.get("error", "Couldn’t read this image."))
        else:
            if source is None:
                picker = root / "mods/chat/pick-files.py"
                result = subprocess.run([sys.executable, str(picker), "Choose a BossGoat wallpaper"], capture_output=True, text=True)
                if result.returncode:
                    raise ValueError("Couldn’t open the desktop image picker.")
                paths = result.stdout.splitlines()
                if not paths:
                    return {"cancelled": True}
                if len(paths) != 1:
                    raise ValueError("Choose one image at a time.")
                source = Path(paths[0])
            if not source.is_file() or not 0 < source.stat().st_size <= MAX_BYTES:
                raise ValueError("Choose an image smaller than 30 MB.")
            from gi.repository import GdkPixbuf
            kind, width, height = GdkPixbuf.Pixbuf.get_file_info(str(source))
            if not kind or kind.get_name() not in ("png", "jpeg", "webp") or width * height > 60_000_000:
                raise ValueError("Choose a PNG, JPEG or WebP image with no more than 60 megapixels.")
            image = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(source), 4096, 4096, True).apply_embedded_orientation()
            image.savev(str(output), "png", [], [])
            info = {"name": source.name, "width": image.get_width(), "height": image.get_height()}
        data = output.read_bytes()
        name = hashlib.sha256(data).hexdigest() + ".png"
        target = folder / name
        os.chmod(output, 0o600)
        os.replace(output, target)
        return {**info, "path": f"{DIRECTORY}/{name}"}


def main(args):
    action, root = args[0], Path(args[1])
    folder = root / DIRECTORY
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if action in ("pick", "import"):
        request = uuid.uuid4().hex
        subprocess.Popen([sys.executable, __file__, "worker", str(root), request, *args[2:]],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        print(json.dumps({"request": request}))
        return
    if action != "worker" or len(args[2]) != 32 or any(c not in "0123456789abcdef" for c in args[2]):
        raise ValueError("Invalid wallpaper request")
    result_file = folder / (args[2] + ".json")
    try:
        result = import_image(root, Path(args[3]) if len(args) > 3 else None)
    except Exception as error:
        result = {"error": str(error)}
    temporary = result_file.with_suffix(".tmp")
    temporary.write_text(json.dumps(result))
    os.chmod(temporary, 0o600)
    temporary.replace(result_file)


if __name__ == "__main__":
    main(sys.argv[1:])
