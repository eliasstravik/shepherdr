import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { menuFor, permissionOptions } from "./agents.js";

const source = readFileSync(new URL("../mods/shepherdr-settings/main.js", import.meta.url), "utf8");
const method = source.slice(source.indexOf("  skillPermissions("), source.indexOf("\n  holycow("));
function harness(locked = false) {
  const opened = [], nodes = [];
  const element = () => {
    const handlers = {};
    const el = new Proxy({}, { get: (_, key) => (...args) => {
      if (key === "when") { if (args[0]) args[1](el); }
      else if (key === "on_mouse_down") handlers.down = args[1];
      else if (key === "on_click") handlers.click = args[0];
      return el;
    } });
    nodes.push(handlers); return el;
  };
  const render = new Function("permissionOptions", "div", "h_flex", "svg", "openOverlay", `return ({${method}}).skillPermissions`)(permissionOptions, element, element, element, (p) => opened.push(p));
  const c = { key: "pr", sel: { agent: "claude", model: "chosen", perm: "manual" }, data: { menus: { claude: menuFor("claude", {}) } } };
  render({}, c, locked);
  return { opened, handlers: nodes[0], c };
}

test("HolyCow permissions open beside the clicked button, including rows near the top", () => {
  for (const y of [15, 600]) {
    const { opened, handlers, c } = harness();
    const before = JSON.stringify(c.sel);
    handlers.down({ bounds: { x: 800, y, width: 140, height: 28 } });
    handlers.click({}, { stop_propagation() {} });
    const popup = opened[0];
    expect(popup.at.x).toBeGreaterThan(500);
    expect(popup.at.x + popup.width).toBe(940);
    if (y === 15) expect(popup.at.y).toBeGreaterThan(y + 28);
    else expect(popup.at.y + popup.height).toBeLessThan(y);
    expect(popup.props.options.map((p) => p.label)).toEqual(["Ask for approval", "Approve for me", "Full access"]);
    expect(JSON.stringify(c.sel)).toBe(before);
  }
});

test("the read-only review control cannot open a permission-changing menu", () => {
  expect(harness(true).handlers.click).toBeUndefined();
});
