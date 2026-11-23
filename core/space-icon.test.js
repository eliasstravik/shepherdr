// A space's icon as the service keeps it (core/space-icon.js): an emoji, or a real PNG, JPEG or WebP within the cap.
import { expect, test } from "bun:test";
import { ICON_MAX, iconValue, isPicture } from "./space-icon.js";

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

test("an emoji is kept as given; none goes back to #", () => {
  expect(iconValue("🧪")).toBe("🧪");
  expect(iconValue(" 👨‍👩‍👧 ")).toBe("👨‍👩‍👧");
  expect(iconValue("")).toBe(null);
  expect(iconValue(null)).toBe(null);
  expect(() => iconValue("<script>")).toThrow();
  expect(() => iconValue(42)).toThrow();
});

test("a picture only when its bytes are the type it says, and small", () => {
  const png = `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])}`;
  const jpg = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1])}`;
  const webp = `data:image/webp;base64,${b64([...Buffer.from("RIFF"), 1, 0, 0, 0, ...Buffer.from("WEBPVP8 ")])}`;
  for (const ok of [png, jpg, webp]) expect(iconValue(ok)).toBe(ok);
  expect(isPicture(png)).toBe(true);
  expect(isPicture("🧪")).toBe(false);
  expect(() => iconValue(png.replace("image/png", "image/jpeg"))).toThrow("Only a PNG");
  expect(() => iconValue(`data:image/svg+xml;base64,${btoa("<svg onload=alert(1)>")}`)).toThrow("Only a PNG");
  expect(() => iconValue(`data:text/html;base64,${btoa("<html>")}`)).toThrow("Only a PNG");
  expect(() => iconValue(`${png}"><script>`)).toThrow("Only a PNG");
  expect(() => iconValue(png + "A".repeat(ICON_MAX))).toThrow("too big");
});
