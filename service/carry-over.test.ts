// The window's spaces carried over into the service's own list, once per machine (service/carry-over.ts). Fake data only.
import { expect, test } from "bun:test";
import { carryOver } from "./carry-over.ts";

const tab = (id: string, terminal: string) => ({ id, name: "", root: { type: "block", id: `p${id}`, content: { terminal } } });
const here = { spaces: [{ id: "sp1", name: "demo", folder: "/home/someone/dev/demo", tabs: [tab("tb1", "t1")] }, { id: "sp2", name: "", folder: "/home/someone", tabs: [] }] };
const vm = { spaces: [{ id: "sp1", name: "api", folder: "/srv/api", tabs: [] }] };

test("each machine's window spaces land in the own list with their id, name, folder and machine", () => {
  const r = carryOver(undefined, undefined, new Map<string | null, any>([[null, here], ["vm", vm]]), 5)!;
  expect(r.spaces).toEqual([
    { id: "sp1", name: "demo", folder: "/home/someone/dev/demo", machine: null, at: 5 },
    { id: "sp2", name: "", folder: "/home/someone", machine: null, at: 5 },
    { id: "sp1", name: "api", folder: "/srv/api", machine: "vm", at: 5 },
  ]);
  expect(r.imported.sort()).toEqual(["", "vm"]);
});

test("done once: a machine in the marker is never read again, so a space removed since stays removed", () => {
  const first = carryOver([], [], new Map<string | null, any>([[null, here]]))!;
  expect(carryOver(first.spaces, first.imported, new Map<string | null, any>([[null, here]]))).toBeNull();
  const left = first.spaces.filter((s) => s.id !== "sp2");
  expect(carryOver(left, first.imported, new Map<string | null, any>([[null, here]]))).toBeNull();
});

test("a machine that wasn't reachable is carried over when it first connects; what is there already is kept", () => {
  const made = { id: "spnew", name: "made since", folder: "/tmp/x", machine: null, at: 1 };
  const first = carryOver([made], undefined, new Map<string | null, any>([[null, here]]), 2)!;
  expect(first.imported).toEqual([""]);
  expect(first.spaces[0]).toEqual(made);
  const later = carryOver(first.spaces, first.imported, new Map<string | null, any>([[null, here], ["vm", vm]]), 3)!;
  expect(later.imported).toEqual(["", "vm"]);
  expect(later.spaces.map((s) => `${s.machine ?? ""}/${s.id}`)).toEqual(["/spnew", "/sp1", "/sp2", "vm/sp1"]);
});

test("a space already in the own list is not doubled; another machine with no document yet is looked at again later", () => {
  const own = [{ id: "sp1", name: "renamed here", folder: "/home/someone/dev/demo", machine: null }];
  const r = carryOver(own, [], new Map<string | null, any>([[null, here], ["bare", null]]))!;
  expect(r.spaces.filter((s) => s.id === "sp1" && !s.machine)).toEqual([own[0]]);
  expect(r.spaces.length).toBe(2);
  // its copy may still be on its way at the switch: not marked done with its spaces missing
  expect(r.imported).toEqual([""]);
});
