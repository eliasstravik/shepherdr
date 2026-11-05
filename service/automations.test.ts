// SHEP-43: an automation's row says its machine, and one set off from another folder (--from) says which.
import { expect, test } from "bun:test";
import { automationsBySpace } from "./compat.ts";

const spaces: any[] = [
  { id: "home", name: "Home", folder: "/w/home", machine: null },
  { id: "vm-b/s1", name: "shop", folder: "/w/shop", machine: "vm-b" },
];

test("each automation carries its machine (none: this computer)", () => {
  const out = automationsBySpace([
    { id: 1, title: "Here", folder: "/w/home", machine: null },
    { id: 2, title: "There", folder: "/w/shop", machine: "vm-b" },
  ], spaces);
  expect(out.home[0]).toMatchObject({ name: "Here", listName: "Home", machine: null });
  expect(out["vm-b/s1"][0]).toMatchObject({ name: "There", listName: "shop", machine: "vm-b" });
});

test("--from: the other folder's machine, its space's name there (else its last part) and the events", () => {
  const out = automationsBySpace([
    { id: 1, title: "A", folder: "/w/home", machine: null, on: ["merged"], from: { machine: "vm-b", folder: "/w/shop" } },
    { id: 2, title: "B", folder: "/w/shop", machine: "vm-b", on: ["ready"], from: { machine: null, folder: "/w/other" } },
    { id: 3, title: "C", folder: "/w/home", machine: null },
  ], spaces);
  expect(out.home[0].from).toEqual({ machine: "vm-b", place: "shop", events: ["merged"] });
  // none on the other folder: the automation's own machine
  expect(out["vm-b/s1"][0].from).toEqual({ machine: "vm-b", place: "other", events: ["ready"] });
  expect(out.home[1].from).toBeUndefined();
});
