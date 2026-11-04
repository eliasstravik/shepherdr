import { expect, test } from "bun:test";
import { artifactStore } from "./compat.ts";

test("a space's artifact store is herdr-artifact's: the repo's main folder, named as the window's Artifacts header", () => {
  expect(artifactStore({ folder: "/h/u" }, "/h/u")).toEqual({ folder: "/h/u", key: "|/h/u", name: "~" });
  expect(artifactStore({ folder: "/h/u/wt/x", git: { repo: "/h/u/dev/app/.git" } }, "/h/u")).toEqual({ folder: "/h/u/dev/app", key: "|/h/u/dev/app", name: "app" });
  // another machine's home reads "~" there too; its key names the machine
  expect(artifactStore({ folder: "/root", machine: "vm" }, "/h/u")).toEqual({ folder: "/root", key: "vm|/root", name: "~" });
  expect(artifactStore({ folder: "/root/dev/site", machine: "vm" }, "/h/u").name).toBe("site");
});
