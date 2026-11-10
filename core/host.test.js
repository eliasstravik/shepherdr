import { expect, test } from "bun:test";
import { newestHost, renamer, moveId, relocate, relocateDoc, keepForeign, relocateSettings, merge3, serveChoice, nodeAlive } from "./host.js";

// the laptop (id L) calls the mini "mac-mini"; the mini (id M) calls the laptop "m3"; both call the VM "vm"
const laptop = { id: "L", links: { "mac-mini": "M", vm: "V" } };
const mini = { id: "M", links: { m3: "L", vm: "V", lonely: "X" } };
const toMini = renamer(laptop, mini), toLaptop = renamer(mini, laptop);

test("the newest host record wins; broken ones don't count", () => {
  expect(newestHost([null, { id: "M", at: 5 }, { id: "L", at: 9 }, { id: "", at: 99 }, { at: 100 }])).toEqual({ id: "L", at: 9 });
  expect(newestHost([])).toBe(null);
  expect(nodeAlive({ id: "M", at: 1000 }, 1000 + 60_000)).toBe(true);
  expect(nodeAlive({ id: "M", at: 1000 }, 1000 + 10 * 60_000)).toBe(false);
});

test("names move through the ids: here is null, an unknown machine is undefined", () => {
  expect(toMini(null)).toBe("m3");
  expect(toMini("mac-mini")).toBe(null);
  expect(toMini("vm")).toBe("vm");
  expect(toMini("gone")).toBe(undefined);
  expect(toLaptop("lonely")).toBe(undefined);
  expect(moveId("sp1", toMini)).toBe("m3/sp1");
  expect(moveId("mac-mini/sp2", toMini)).toBe("sp2");
  expect(moveId("vm/sp3", toMini)).toBe("vm/sp3");
});

test("the shared document reads the same on both machines", () => {
  const here = {
    "tasks.pinned": [":/srv/app#4", "mac-mini:/srv/x#2", "gone:/y#1"],
    "spaces-chat": { icons: { sp1: "🐑", "mac-mini/sp2": "🌙" }, pinned: ["sp1", "vm/sp3"], machines: { "": { name: "Laptop" }, "mac-mini": { icon: "🍎" } },
      sections: [{ id: "a", machine: null, name: "Work", spaces: ["sp1"] }, { id: "b", machine: "mac-mini", name: "Home", spaces: ["mac-mini/sp2"] }] },
    notify: { everywhere: "All", machines: { local: "Off", vm: "All" }, spaces: { "mac-mini/sp2": "Off" } },
    "coordinator.auto": true,
  };
  const there = relocateDoc(here, toMini);
  expect(there["tasks.pinned"]).toEqual(["m3:/srv/app#4", ":/srv/x#2"]);
  expect(there["spaces-chat"].icons).toEqual({ "m3/sp1": "🐑", sp2: "🌙" });
  expect(there["spaces-chat"].pinned).toEqual(["m3/sp1", "vm/sp3"]);
  expect(there["spaces-chat"].machines).toEqual({ m3: { name: "Laptop" }, "": { icon: "🍎" } });
  expect(there["spaces-chat"].sections.map((s) => [s.machine, s.spaces])).toEqual([["m3", ["m3/sp1"]], [null, ["sp2"]]]);
  expect(there.notify).toEqual({ everywhere: "All", machines: { m3: "Off", vm: "All" }, spaces: { sp2: "Off" } });
  expect(there["coordinator.auto"]).toBe(true);
  // and back again, the same (but the machine only the laptop knew)
  const back = relocateDoc(there, toLaptop);
  expect(back["spaces-chat"]).toEqual(here["spaces-chat"]);
  expect(back.notify).toEqual(here.notify);
  expect(back["tasks.pinned"]).toEqual(here["tasks.pinned"].slice(0, 2));
});

test("a change from the laptop keeps what only the mini can name", () => {
  const old = { pinned: ["lonely/sp9", "sp2"], icons: { "lonely/sp9": "🦊" }, sections: [{ id: "z", machine: "lonely", spaces: [] }], machines: { lonely: { icon: "🦊" } } };
  const next = relocate("spaces-chat", { pinned: ["mac-mini/sp2", "sp1"], icons: {}, sections: [], machines: {} }, toMini);
  const merged = keepForeign("spaces-chat", next, old, toLaptop);
  expect(merged.pinned).toEqual(["sp2", "m3/sp1", "lonely/sp9"]);
  expect(merged.icons).toEqual({ "lonely/sp9": "🦊" });
  expect(merged.sections.map((s) => s.id)).toEqual(["z"]);
  expect(merged.machines).toEqual({ lonely: { icon: "🦊" } });
  expect(keepForeign("tasks.pinned", ["m3:/a#1"], ["lonely:/b#2", ":/c#3"], toLaptop)).toEqual(["m3:/a#1", "lonely:/b#2"]);
});

test("the settings file moves to the host as an own file", () => {
  const file = { version: 1, everywhere: { tasks: { merge: "auto" } }, machines: { local: { machine: { start_load: 2 } }, "mac-mini": { home: false } },
    spaces: { sp1: { name: "app", folder: "/srv/app", tasks: { proof: false } }, "mac-mini/sp2": { name: "x", machine: "mac-mini", folder: "/srv/x" } } };
  const there = relocateSettings({ ...file, pushed_from: "herdr-app", here: "mac-mini" }, toMini);
  expect(there.pushed_from).toBe(undefined);
  expect(there.here).toBe(undefined);
  expect(there.machines).toEqual({ m3: { machine: { start_load: 2 } }, local: { home: false } });
  expect(there.spaces).toEqual({ "m3/sp1": { name: "app", folder: "/srv/app", tasks: { proof: false } }, sp2: { name: "x", folder: "/srv/x" } });
  expect(relocateSettings(there, toLaptop).machines).toEqual(file.machines);
});

test("a three-way merge takes each side's own changes, the host's when both changed one", () => {
  const base = { everywhere: { tasks: { merge: "ask", proof: true } }, spaces: { a: { x: 1 } } };
  const mine = { everywhere: { tasks: { merge: "auto", proof: true } }, spaces: { a: { x: 1 }, b: { y: 2 } } };
  const theirs = { everywhere: { tasks: { merge: "checks", proof: false } }, spaces: {} };
  expect(merge3(base, mine, theirs)).toEqual({ everywhere: { tasks: { merge: "checks", proof: false } }, spaces: { b: { y: 2 } } });
  // removed here only: gone there too
  expect(merge3({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1 });
  expect(merge3(null, { a: 1 }, {})).toEqual({ a: 1 });
});

test("a machine's line in the picker", () => {
  expect(serveChoice({ here: true, name: "m3", os: "linux", state: "connected" })).toBe("This computer · Linux");
  expect(serveChoice({ name: "mac-mini", os: "darwin", state: "connected" })).toBe("mac-mini · macOS");
  expect(serveChoice({ name: "vm", os: null, state: "unreachable" })).toBe("vm · Offline");
});

test("the dragged order of each machine's spaces reads the same on both machines; the mini's own stays (SHEP-130)", () => {
  const order = { "": ["sp2", "sp1"], "mac-mini": ["mac-mini/sp9", "mac-mini/sp4"], vm: ["vm/sp3"], gone: ["gone/sp1"] };
  const there = relocate("spaces-chat", { order }, toMini);
  expect(there.order).toEqual({ m3: ["m3/sp2", "m3/sp1"], "": ["sp9", "sp4"], vm: ["vm/sp3"] });
  expect(relocate("spaces-chat", there, toLaptop).order).toEqual({ "": ["sp2", "sp1"], "mac-mini": ["mac-mini/sp9", "mac-mini/sp4"], vm: ["vm/sp3"] });
  const merged = keepForeign("spaces-chat", relocate("spaces-chat", { order: { "": ["sp1"] } }, toMini), { order: { lonely: ["lonely/a"], m3: ["m3/old"] } }, toLaptop);
  expect(merged.order).toEqual({ lonely: ["lonely/a"], m3: ["m3/sp1"] });
});

test("the machines' dragged order reads the same on both machines; one only the mini knows keeps its place (SHEP-153)", () => {
  const there = relocate("spaces-chat", { machineOrder: ["vm", "", "mac-mini", "gone"] }, toMini);
  expect(there.machineOrder).toEqual(["vm", "m3", ""]);
  expect(relocate("spaces-chat", there, toLaptop).machineOrder).toEqual(["vm", "", "mac-mini"]);
  // the laptop moves itself first; the mini's "lonely" (the laptop can't name it) stays after vm, where it was
  const merged = keepForeign("spaces-chat", relocate("spaces-chat", { machineOrder: ["", "vm", "mac-mini"] }, toMini), { machineOrder: ["vm", "lonely", "m3", ""] }, toLaptop);
  expect(merged.machineOrder).toEqual(["m3", "vm", "lonely", ""]);
});
