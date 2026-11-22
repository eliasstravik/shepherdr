import { expect, test } from "bun:test";
import { describe as spot, spotArg, markupHint, markupSent } from "./markup.js";

test("the pin in words and as herdr-artifact takes it", () => {
  expect(spot({ x: 0.42, y: 0.31 })).toBe("42% from the left, 31% from the top of the page (near the top center)");
  expect(spot({ x: 0.5, y: 0.5 })).toBe("50% from the left, 50% from the top of the page (near the middle)");
  expect(spot({ x: 2, y: -1 })).toBe("100% from the left, 0% from the top of the page (near the top right)");
  expect(spotArg({ x: 0.42, y: 0.31 })).toBe("0.420,0.310");
  expect(spotArg({ x: 7, y: "x" })).toBe("1.000,0.000");
});

test("the card's lines name who hears it", () => {
  expect(markupHint("Claude Code")).toBe("Tap the page to drop a pin, or write to Claude Code about all of it.");
  expect(markupSent("the agent")).toBe("Sent to the agent. A new version shows here when it's in.");
});
