import { expect, test } from "bun:test";
import { expand, match, pickInto, plain, reachable, split, token, typing } from "./mentions.js";

// A reach map as herdr-task draws it: here (mini) links to vm-demo over herdr-core, and through it to vm-x; laptop is a
// Tailscale peer it can't log into (no next); vm-demo's document also mirrors mini's space (machine set: not its own).
const graph = {
  core: { id: "c-mini", name: "mini" }, host: "mini",
  spaces: [{ id: "sp-home", name: "home" }, { id: "sp-web", name: "web", icon: "🌐" }],
  assistants: [{ address: "t1", space: "sp-web" }],
  links: [
    { how: "tailscale", to: "laptop", ok: true },
    { how: "ssh", to: "vm-demo.example", ok: true, id: "c-demo", next: { core: { id: "c-demo", name: "vm-demo" }, links: [], spaces: [] } },
    { how: "herdr-core", to: "vm-demo", ok: true, id: "c-demo", next: {
      core: { id: "c-demo", name: "vm-demo" },
      spaces: [{ id: "sp-shop", name: "shop" }, { id: "sp-web", name: "web", machine: "mini" }],
      links: [{ how: "herdr-core", to: "vm-x", ok: true, id: "c-x", next: { core: { id: "c-x", name: "vm-x" }, links: [], spaces: [{ id: "sp-lab", name: "lab" }] } }],
    } },
  ],
};

test("the spaces a reach map reaches: here first, each machine's own, the route tell-assistant takes", () => {
  const got = reachable(graph);
  expect(got.map((s) => [s.name, s.machine, s.target, s.assistant])).toEqual([
    ["home", "mini", "sp-home", false], ["web", "mini", "sp-web", true],
    ["shop", "vm-demo", "vm-demo/sp-shop", false], ["lab", "vm-x", "vm-demo>vm-x/sp-lab", false],
  ]);
  expect(got[1].emoji).toBe("🌐");
  expect(reachable(null)).toEqual([]);
});

test("what is typed after #, and the spaces that match it", () => {
  expect(typing("tell #sh")).toBe("sh");
  expect(typing("#")).toBe("");
  expect(typing("issue#4")).toBe(null);
  expect(typing("tell #shop now")).toBe(null);
  const list = reachable(graph);
  expect(match(list, "s").map((s) => s.name)).toEqual(["shop"]);
  expect(match(list, "vm-x").map((s) => s.name)).toEqual(["lab"]);
});

test("a pick goes in short, and at send becomes its mention; one never picked stays as typed", () => {
  const shop = reachable(graph)[2];
  const box = pickInto("tell #sh", shop);
  expect(box).toBe("tell #shop ");
  expect(expand(`${box}to ship it. Ask #shop. #shopping #other`, [shop])).toBe(
    "tell [#shop](space:vm-demo/sp-shop) to ship it. Ask [#shop](space:vm-demo/sp-shop). #shopping #other");
  expect(expand("tell #shop", [])).toBe("tell #shop");
  expect(expand(token(shop), [shop])).toBe(token(shop));
});

test("a message's mentions, and the window's plain form: out of reach says so", () => {
  const text = "ask [#shop](space:vm-demo/sp-shop) and [#lab](space:vm-demo>vm-x/sp-lab).";
  expect(split(text)).toEqual([
    { text: "ask " }, { mention: { name: "shop", target: "vm-demo/sp-shop", id: "sp-shop", route: "vm-demo" } },
    { text: " and " }, { mention: { name: "lab", target: "vm-demo>vm-x/sp-lab", id: "sp-lab", route: "vm-demo>vm-x" } }, { text: "." },
  ]);
  expect(plain(text, new Set(["sp-shop"]))).toBe("ask `#shop · vm-demo` and `#lab · vm-x · out of reach`.");
});
