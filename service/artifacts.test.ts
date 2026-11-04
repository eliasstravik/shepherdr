import { expect, test } from "bun:test";
import { artifactOf, artifactStore } from "./compat.ts";

test("a space's artifact store is herdr-artifact's: the repo's main folder, named as the window's Artifacts header", () => {
  expect(artifactStore({ folder: "/h/u" }, "/h/u")).toEqual({ folder: "/h/u", key: "|/h/u", name: "~" });
  expect(artifactStore({ folder: "/h/u/wt/x", git: { repo: "/h/u/dev/app/.git" } }, "/h/u")).toEqual({ folder: "/h/u/dev/app", key: "|/h/u/dev/app", name: "app" });
  // another machine's home reads "~" there too; its key names the machine
  expect(artifactStore({ folder: "/root", machine: "vm" }, "/h/u")).toEqual({ folder: "/root", key: "vm|/root", name: "~" });
  expect(artifactStore({ folder: "/root/dev/site", machine: "vm" }, "/h/u").name).toBe("site");
});

test("each version says its kind and its window picture: a converted one was a panel, then a recipe", () => {
  const a = artifactOf({ id: "x-1a2b", title: "Plan", version: 2, at: 2, folder: "/h/u", files: ["recipe.json"],
    versions: [{ v: 1, at: 1, kind: "custom", picture: 5 }, { v: 2, at: 2, kind: "recipe" }] }, []);
  expect(a.kind).toBe("recipe");
  expect(a.versions.map((x) => [x.n, x.kind, x.picture])).toEqual([[2, "recipe", undefined], [1, "gpui", 5]]);
});
