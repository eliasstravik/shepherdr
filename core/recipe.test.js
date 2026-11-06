// SHEP-79: a button may carry a plain https link (href), alone or with a reply; buttons sit side by side
import { expect, test } from "bun:test";
import { problems, blockName } from "./recipe.js";

const one = (b) => problems({ recipe: 1, blocks: [b] });

test("a button needs a label and a reply, an https link or both", () => {
  expect(one({ type: "button", label: "Ship", reply: "ship" })).toEqual([]);
  expect(one({ type: "button", label: "Open", href: "https://github.com/x/y" })).toEqual([]);
  expect(one({ type: "button", label: "Open", href: "https://github.com/x/y", reply: "opened", quiet: true })).toEqual([]);
  expect(one({ type: "button", label: "Open" }).length).toBe(1);
  expect(one({ type: "button", label: "Open", href: "http://github.com" }).length).toBe(1);
  expect(one({ type: "button", label: "Open", href: "javascript:alert(1)" }).length).toBe(1);
});

test("buttons: one to four, each a button", () => {
  const b = { type: "buttons", items: [{ label: "Open Shepherdr on GitHub", href: "https://github.com/x/y" }, { label: "No thanks", reply: "no", quiet: true }] };
  expect(one(b)).toEqual([]);
  expect(blockName(b)).toBe("the buttons “Open Shepherdr on GitHub”");
  expect(one({ type: "buttons", items: [] }).length).toBe(1);
  expect(one({ type: "buttons", items: [{ label: "x" }] }).length).toBe(1);
});
