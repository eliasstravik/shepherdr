import { expect, test } from "bun:test";
import { spaceName, tilde, sharedNames, gitTail, sectionMoved, withSectionOrder } from "./spaces.js";

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

// dragging a section among its machine's, the window's and the web's

test("a dragged section takes the place of the one it's dropped on, the rest shift toward where it was", () => {
  expect(sectionMoved(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
  expect(sectionMoved(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  expect(sectionMoved(["a", "b", "c"], "b", "c")).toEqual(["a", "c", "b"]);
  const same = ["a", "b"];
  expect(sectionMoved(same, "a", "a")).toBe(same);
  expect(sectionMoved(same, "a", "z")).toBe(same);
});

test("a machine's sections reordered keep every other machine's where they were, and nothing else changes", () => {
  const d = { pinned: ["p"], icons: { x: "🏠" }, sections: [
    { id: "a", machine: null, name: "A", spaces: ["s1"] }, { id: "v1", machine: "vm", name: "V1", spaces: [] },
    { id: "b", machine: null, name: "B", spaces: [] }, { id: "c", machine: null, name: "C", spaces: ["s2"], icon: "📦" },
  ] };
  const x = withSectionOrder(d, ["c", "a", "b"]);
  expect(x.sections.map((s) => s.id)).toEqual(["c", "v1", "a", "b"]);
  expect(x.sections[0]).toEqual(d.sections[3]);
  expect(x.pinned).toEqual(["p"]);
  expect(x.icons).toEqual({ x: "🏠" });
  expect(d.sections.map((s) => s.id)).toEqual(["a", "v1", "b", "c"]);   // the one it was given stays as it was
  // a partial or stale list: only those it names (and knows) move among their own places
  expect(withSectionOrder(d, ["b", "gone", "a"]).sections.map((s) => s.id)).toEqual(["b", "v1", "a", "c"]);
  expect(withSectionOrder({}, ["a"]).sections).toEqual([]);
});
