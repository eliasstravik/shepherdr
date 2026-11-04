import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIRM, PROMPT, CLOSE_SPACE, RENAME_TAB } from "./confirm.js";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("the window's askers say what core/confirm.js says, and the web reads it from there", () => {
  const coord = read("lib/coordinator.js"), popups = read("mods/spaces-chat/popups.js");
  for (const src of [coord, popups]) {
    expect(src).toContain(`detail: "${CLOSE_SPACE.detail}"`);
    expect(src).toContain(`verb: "${CLOSE_SPACE.verb}"`);
  }
  expect(coord).toContain('"Close this space?"');
  expect(coord).toContain(`title: "${RENAME_TAB.title}"`);
  expect(CLOSE_SPACE.title("gtm")).toBe("Close “gtm”?");
  expect(CLOSE_SPACE.title("~")).toBe("Close this space?");
  const confirm = read("mods/confirm-chat/main.js"), prompt = read("mods/prompt-chat/main.js");
  expect(confirm).toContain(`"${CONFIRM.title}"`);
  expect(confirm).toContain(`p.verb ?? "${CONFIRM.verb}"`);
  expect(prompt).toContain(`p.label ?? "${PROMPT.label}"`);
  expect(prompt).toContain(`p.verb ?? "${PROMPT.verb}"`);
  expect(read("web/plugins/places/client.tsx")).toContain("CF.CLOSE_SPACE");
  expect(read("web/plugins/coordinators/client.tsx")).toContain("CF.RENAME_TAB");
});
