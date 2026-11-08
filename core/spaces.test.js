import { expect, test } from "bun:test";
import { spaceName, tilde, sharedNames, gitTail, inOrder, withOrder, keptOrder } from "./spaces.js";

test("two spaces with one name on a machine each show their folder, from ~ (the sidebar's rows, both sides)", () => {
  // built, so the repo's no-home-paths rule has nothing to find
  expect(tilde(["", "home", "u", "dev", "app"].join("/"))).toBe("~/dev/app");
  expect(tilde(["", "Users", "u"].join("/"))).toBe("~");
  expect(tilde("/srv/app")).toBe("/srv/app");
  const rows = [
    { id: "a", machine: null, name: "Home" }, { id: "b", machine: null, name: "home" }, { id: "c", machine: "vm", name: "Home" },
    { id: "d", machine: null, name: "app" }, { id: "e", machine: null, name: "app", linked: true },
  ];
  expect([...sharedNames(rows)].sort()).toEqual(["a", "b"]);
});

test("a space is called as the window's sidebar calls it, never ~", () => {
  expect(spaceName({ name: "web", folder: "/x/y" })).toBe("web");
  expect(spaceName({ name: "~", folder: "/srv/u" }, { home: "/srv/u" })).toBe("Home");
  expect(spaceName({ name: "~", folder: "/tmp/abc/tt-repo" })).toBe("tt-repo");
  expect(spaceName({ name: "~", folder: "/root/" })).toBe("Home");
  expect(spaceName({ name: "", folder: "/srv/app" }, { repo: "app-repo" })).toBe("app-repo");
  expect(spaceName({ name: "dev", folder: "/srv/app" }, { named: false, repo: "app" })).toBe("app");
});

test("after a space's name only its repo and branch where unusual, no ahead/behind counts (SHEP-32)", () => {
  expect(gitTail({ name: "herdr", branch: "spike", ahead: 2, behind: 1 }, { name: "web" })).toEqual({ where: "herdr · spike" });
  expect(gitTail({ name: "web", branch: "main" }, { name: "web" })).toEqual({ where: "" });
  expect(gitTail({ name: "herdr", branch: null }, { name: "herdr", tag: "mini" })).toEqual({ where: "mini · detached" });
});

// SHEP-130: a dragged order holds, whatever Herdr's own order is
const sp = (id, machine = null) => ({ id, machine });
const ids = (l) => l.map((s) => s.id);

test("each machine's spaces show in the dragged order; the machines keep their slots", () => {
  // Herdr's order: this computer's, then vm's from its document, then a space the service made on vm (always last)
  const list = [sp("a"), sp("b"), sp("vm/t"), sp("vm/s"), sp("vm/home", "vm")].map((s) => ({ ...s, machine: s.id.startsWith("vm/") ? "vm" : null }));
  expect(ids(inOrder(list, undefined))).toEqual(["a", "b", "vm/t", "vm/s", "vm/home"]);
  const order = { vm: ["vm/home", "vm/t", "vm/s"], "": ["b", "a"] };
  expect(ids(inOrder(list, order))).toEqual(["b", "a", "vm/home", "vm/t", "vm/s"]);
});

test("a space the order doesn't name keeps its place after the one before it in Herdr's; a gone one is skipped", () => {
  const list = [sp("a"), sp("new"), sp("b"), sp("c")];
  expect(ids(inOrder(list, { "": ["c", "a", "gone", "b"] }))).toEqual(["c", "a", "new", "b"]);
  expect(ids(inOrder([sp("first"), sp("a"), sp("b")], { "": ["b", "a"] }))).toEqual(["first", "b", "a"]);
});

test("a drag keeps the spaces it didn't show (in a section, hidden) where they were, and the other machines' orders", () => {
  const d = withOrder({ pinned: ["x"], order: { vm: ["vm/2", "vm/1"] } }, null, ["c", "a"], ["a", "s", "b", "c"]);
  expect(d.order).toEqual({ vm: ["vm/2", "vm/1"], "": ["c", "a", "s", "b"] });
  expect(d.pinned).toEqual(["x"]);
  expect(withOrder({}, "vm", ["vm/home", "vm/t"]).order).toEqual({ vm: ["vm/home", "vm/t"] });
  expect(keptOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a", "b"]);
});
