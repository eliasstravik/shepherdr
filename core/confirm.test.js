import { expect, test } from "bun:test";
import { CONFIRM, PROMPT, CLOSE_SPACE, RENAME_TAB } from "./confirm.js";

test("a space's close and a rename ask in these words", () => {
  expect(CLOSE_SPACE.title("gtm")).toBe("Close “gtm”?");
  expect(CLOSE_SPACE.title("~")).toBe("Close this space?");
  for (const w of [CLOSE_SPACE.detail, CLOSE_SPACE.verb, RENAME_TAB.title, CONFIRM.title, CONFIRM.verb, PROMPT.label, PROMPT.verb]) expect(typeof w).toBe("string");
});
