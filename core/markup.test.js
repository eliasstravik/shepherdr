import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { describe as spot, MARKUP, markupHint, markupSent } from "./markup.js";

const window = readFileSync(new URL("../mods/artifacts/markup.js", import.meta.url), "utf8");
const body = (src) => src.slice(src.indexOf("function describe("), src.indexOf("\n}\n", src.indexOf("function describe(")));

test("the spot in words, as the window sends it", () => {
  expect(spot({ x: 120, y: 80, w: 180, h: 80 }, { width: 720, height: 540 })).toBe("the 180×80 px area at x 120–300, y 80–160 of the 720×540 panel (near the top left)");
  expect(spot({ x: 360, y: 270, w: 0, h: 0 }, { width: 720, height: 540 })).toBe("the point at x 360, y 270 of the 720×540 panel (near the middle)");
});

test("the window's markup.js has the same describe() and the same words", () => {
  expect(body(window)).toBe(body(readFileSync(new URL("./markup.js", import.meta.url), "utf8")));
  for (const w of Object.values(MARKUP)) expect(window).toContain(JSON.stringify(w).slice(1, -1).replace(/\\"/g, '"'));
  expect(window).toContain("Click a spot or drag over an area, or write to ${keeperName()} about all of it.");
  expect(markupHint("Claude Code")).toBe("Click a spot or drag over an area, or write to Claude Code about all of it.");
  expect(window).toContain("Sent to ${keeperName(out.to)}. A new version shows here when it's in.");
  expect(markupSent("the agent")).toBe("Sent to the agent. A new version shows here when it's in.");
});
