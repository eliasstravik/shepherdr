import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { wallpaper, cover, DEFAULT_TRANSPARENCY, DEFAULT_WALLPAPER, WALLPAPER_DIR, SOLID_BACKGROUNDS, wallpaperColors } from "./wallpaper.js";

const chosen = { path: `${WALLPAPER_DIR}/${"a".repeat(64)}.png`, width: 1920, height: 1080, name: "A picture.png", transparency: 60 };

test("a saved image is shown only in BossGoat, including after switching away and back", () => {
  expect(wallpaper(chosen, "BossGoat")).toEqual(chosen);
  for (const layout of ["main", "terminals", "shepherdr", "BossGoat-copy", null]) expect(wallpaper(chosen, layout)).toBeNull();
  expect(wallpaper(chosen, "BossGoat")).toEqual(chosen);
  expect(wallpaper(undefined, "terminals")).toBeNull();
});

test("preferences cannot load remote URLs, arbitrary files or invalid image dimensions", () => {
  for (const path of ["https://example.com/photo.png", "/etc/passwd", `${WALLPAPER_DIR}/../photo.png`, "data/photo.svg"])
    expect(wallpaper({ ...chosen, path })).toBeNull();
  for (const width of [0, -1, 4097, NaN, Infinity, "1920", 1.5]) expect(wallpaper({ ...chosen, width })).toBeNull();
  expect(wallpaper({ ...chosen, height: 0 })).toBeNull();
});

test("missing and invalid transparency values remain usable, and transparency stays bounded", () => {
  expect(wallpaper({ ...chosen, transparency: undefined }).transparency).toBe(DEFAULT_TRANSPARENCY);
  expect(wallpaper({ ...chosen, transparency: NaN }).transparency).toBe(DEFAULT_TRANSPARENCY);
  expect(wallpaper({ ...chosen, transparency: -50 }).transparency).toBe(0);
  expect(wallpaper({ ...chosen, transparency: 200 }).transparency).toBe(100);
});

test("cover fills a resized workspace without stretching the photo", () => {
  for (const [width, height] of [[800, 600], [400, 900], [2400, 300]]) {
    const box = cover(chosen, width, height);
    expect(box.w).toBeGreaterThanOrEqual(width);
    expect(box.h).toBeGreaterThanOrEqual(height);
    expect(box.w / box.h).toBeCloseTo(chosen.width / chosen.height);
    expect(box.left * 2 + box.w).toBeCloseTo(width);
    expect(box.top * 2 + box.h).toBeCloseTo(height);
  }
  expect(cover(chosen, 0, 100)).toBeNull();
  expect(cover(chosen, 100, NaN)).toBeNull();
});


test("fresh installations and reset use the bundled image without a local file selection", () => {
  expect(wallpaper()).toEqual(DEFAULT_WALLPAPER);
  expect(wallpaper(null)).toEqual(DEFAULT_WALLPAPER);
  expect(wallpaper({ ...DEFAULT_WALLPAPER, path: "mods/chat/Warp_bg.png", name: "Warp_bg.png", transparency: 45 }))
    .toEqual({ ...DEFAULT_WALLPAPER, transparency: 45 });
  expect(wallpaper({ path: DEFAULT_WALLPAPER.path, transparency: 100 }).transparency).toBe(100);
  const image = readFileSync(new URL(`../${DEFAULT_WALLPAPER.path}`, import.meta.url));
  expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(image.readUInt32BE(16)).toBe(DEFAULT_WALLPAPER.width);
  expect(image.readUInt32BE(20)).toBe(DEFAULT_WALLPAPER.height);
});

test("existing custom images and Fade settings keep their appearance", () => {
  const { transparency, ...legacy } = chosen;
  expect(wallpaper({ ...legacy, fade: transparency })).toEqual(chosen);
  expect(wallpaper({ ...chosen, fade: 15 })).toEqual(chosen);
  expect(wallpaper({ ...chosen, transparency: 0, fade: 75 }).transparency).toBe(0);
});


test("solid presets render without an image and stay limited to BossGoat", () => {
  for (const preset of SOLID_BACKGROUNDS) {
    const saved = { kind: "solid", preset: preset.id, path: chosen.path, color: "#ff00ff" };
    const selected = wallpaper(saved);
    expect(selected.color).toBe(preset.color);
    expect(selected.path).toBeUndefined();
    expect(selected.transparency).toBeUndefined();
    expect(cover(selected, 800, 600)).toBeNull();
    expect(wallpaper(saved, "terminals")).toBeNull();
  }
  expect(wallpaper({ kind: "solid", preset: "unknown" })).toBeNull();
});

test("light and dark presets keep ordinary chat text readable", () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = (rgb) => rgb.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    .reduce((total, c, i) => total + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const preset of SOLID_BACKGROUNDS) {
    const selected = wallpaper({ kind: "solid", preset: preset.id });
    const colors = wallpaperColors(selected);
    for (const surface of [colors.surface, colors.background]) {
      for (const text of [colors.foreground, colors.muted]) {
        const alpha = text.length === 9 ? parseInt(text.slice(7), 16) / 255 : 1;
        const back = rgb(surface), front = rgb(text).map((c, i) => c * alpha + back[i] * (1 - alpha));
        const levels = [luminance(front), luminance(back)].sort((a, b) => b - a);
        expect((levels[0] + 0.05) / (levels[1] + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
  expect(wallpaperColors(DEFAULT_WALLPAPER).surface).toBe("#ffffff");
});
