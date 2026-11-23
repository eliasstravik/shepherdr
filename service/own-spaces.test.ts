// 3.2: the spaces are the service's own list (the shared document's "spaces"). Rename, reorder and remove change that
// list and the sidebar's data, through the service's own act(); no Herdr window is asked. And the model carries each
// machine's window spaces over once. A fake hc and a fake herdr-core: never a real one. Fake data only.
import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withoutSpace } from "./spaces.ts";
import { IMPORTED } from "./carry-over.ts";
import { HOME } from "./paths.ts";

const DIR = mkdtempSync(join(tmpdir(), "shep-own-"));
const CALLS = join(DIR, "hc-calls");
mkdirSync(join(DIR, "bin"));
writeFileSync(join(DIR, "bin", "hc"), `#!/bin/sh\necho "$*" >> "${CALLS}"\n`, { mode: 0o755 });
let act: typeof import("./actions.ts").act;
const was = process.env.SHEPHERDR_HC;
beforeAll(async () => {
  process.env.SHEPHERDR_HC = join(DIR, "bin", "hc");
  ({ act } = await import("./actions.ts"));
});
afterAll(() => { if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was; });

const live = (address: string, labels: Record<string, string> = {}, more: Record<string, unknown> = {}) => [address, { address, state: "live", labels, ...more }] as const;
function world() {
  const shared: Record<string, any> = {
    spaces: [{ id: "spA", name: "Home", folder: "/home/someone", machine: null }, { id: "spB", name: "demo", folder: "/home/someone/dev/demo", machine: null },
      { id: "sp1", name: "api", folder: "/srv/api", machine: "vm" }, { id: "sp2", name: "web", folder: "/srv/web", machine: "vm" }],
    "spaces-chat": { icons: { spA: "🏠", "vm/sp1": "📦" }, sections: [{ id: "g1", name: "Work", spaces: ["spB", "vm/sp1"] }], order: { vm: ["vm/sp2", "vm/sp1"] } },
  };
  const hub: any = { terminals: new Map<string, any>([
    live("t1", { "herdr.role": "coordinator", "herdr.coordinator.space": "spA" }), live("t2", { "herdr.role": "coordinator", "herdr.coordinator.space": "spB" }),
    live("vm/t1", { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1" }), live("vm/t7", { "herdr.task": "api#4" }, { parent: "vm/t1" }),
    // another machine's space with the same bare id as one here: never mixed up
    live("box/t1", { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1" }),
  ]) };
  const ids = () => shared.spaces.map((x: any) => (x.machine ? `${x.machine}/${x.id}` : x.id));
  const compat: any = {
    host: "mini", data: shared,
    shared: { value: (k: string) => shared[k], set: async (k: string, v: unknown) => { shared[k] = v; } },
    allSpaces: () => shared.spaces.map((x: any) => ({ id: x.machine ? `${x.machine}/${x.id}` : x.id, folder: x.folder, machine: x.machine ?? null })),
    addrOf: (key: string) => ({ "p:spA": "t1", "p:vm:sp1": "vm/t1" } as Record<string, string>)[key] ?? null,
  };
  writeFileSync(CALLS, "");
  return { hub, compat, shared, ids, calls: () => readFileSync(CALLS, "utf8").trim().split("\n").filter(Boolean) };
}

test("rename: a space's name in the list of spaces, on its machine only; its icon in the sidebar's data", async () => {
  const w = world();
  expect(await act(w.hub, { type: "rename", id: "vm/sp1", name: " API  ", emoji: "🧪" }, w.compat)).toEqual({ ok: true });
  expect(w.shared.spaces.map((x: any) => x.name)).toEqual(["Home", "demo", "API", "web"]);
  expect(w.shared["spaces-chat"].icons["vm/sp1"]).toBe("🧪");
  // unnamed again: it is called after where it is (core spaceName), nothing else asked
  await act(w.hub, { type: "rename", id: "spB", name: "", unname: true }, w.compat);
  expect(w.shared.spaces[1]).toEqual({ id: "spB", name: "", folder: "/home/someone/dev/demo", machine: null });
  await expect(act(w.hub, { type: "rename", id: "spZ", name: "x" }, w.compat)).rejects.toThrow("That space isn't here any more.");
  expect(w.calls()).toEqual([]);
});

test("reorder: a machine's spaces in the order dragged, kept in the sidebar's data; the rest stay where they were", async () => {
  const w = world();
  await act(w.hub, { type: "order", under: "m:vm", ids: ["vm/sp1", "vm/sp2"] }, w.compat);
  expect(w.shared["spaces-chat"].order.vm).toEqual(["vm/sp1", "vm/sp2"]);
  await act(w.hub, { type: "order", under: "m:mini", ids: ["spB", "spA"] }, w.compat);
  expect(w.shared["spaces-chat"].order[""]).toEqual(["spB", "spA"]);
  expect(w.ids()).toEqual(["spA", "spB", "vm/sp1", "vm/sp2"]);   // the list itself keeps its own order
  // a group's spaces, and the machines
  await act(w.hub, { type: "order", under: "s:g1", ids: ["vm/sp1", "spB"] }, w.compat);
  expect(w.shared["spaces-chat"].sections[0].spaces).toEqual(["vm/sp1", "spB"]);
  expect(await act(w.hub, { type: "order", under: "all", ids: ["m:vm", "m:mini"] }, w.compat)).toEqual({ ok: true });
  expect(w.shared["spaces-chat"].machineOrder).toEqual(["vm", ""]);
  expect(w.calls()).toEqual([]);
});

test("remove: gone from the list, its group, its icon and the order; its Assistant ends, nobody else's", async () => {
  const w = world();
  expect(await act(w.hub, { type: "space-remove", place: "vm/sp1" }, w.compat)).toEqual({ ok: true });
  expect(w.ids()).toEqual(["spA", "spB", "vm/sp2"]);
  expect(w.shared["spaces-chat"]).toEqual({ icons: { spA: "🏠" }, sections: [{ id: "g1", name: "Work", spaces: ["spB"] }], order: { vm: ["vm/sp2"] } });
  expect(w.calls()).toEqual(["kill vm/t1"]);
  await expect(act(w.hub, { type: "space-remove", place: "vm/sp1" }, w.compat)).rejects.toThrow("That space isn't here any more.");
  expect(existsSync(join(DIR, "herdr-app"))).toBe(false);
});

test("Everything can't be removed: refused in plain words, nothing changed, its Assistant kept (SHEP-296)", async () => {
  const w = world();
  // this computer's home folder, written with a trailing slash: still Everything
  w.shared.spaces = [{ id: "home", name: "Home", folder: `${HOME}/`, machine: null }, ...w.shared.spaces];
  w.hub.terminals.set("t0", { address: "t0", state: "live", labels: { "herdr.role": "coordinator", "herdr.coordinator.space": "home" } });
  const before = structuredClone(w.shared);
  await expect(act(w.hub, { type: "space-remove", place: "home", stop: true }, w.compat)).rejects.toThrow("Everything is the root chat, so it can't be removed or archived.");
  expect(w.shared).toEqual(before);
  expect(w.calls()).toEqual([]);
  // a second home space an older store holds (Everything is "home"): that one can go
  w.shared.spaces.push({ id: "spH", name: "Home", folder: HOME, machine: null });
  expect(await act(w.hub, { type: "space-remove", place: "spH" }, w.compat)).toEqual({ ok: true });
  expect(w.ids()).toEqual(["home", "spA", "spB", "vm/sp1", "vm/sp2"]);
});

test("a space's own agent stops with hc kill of its Assistant: count, keep its workers, or stop them first", async () => {
  const w = world();
  expect(await act(w.hub, { type: "assistant-close", place: "vm/sp1", mode: "count" }, w.compat)).toEqual({ ok: true, workers: 1 });
  expect(w.calls()).toEqual([]);
  await act(w.hub, { type: "assistant-close", place: "vm/sp1", mode: "keep" }, w.compat);
  expect(w.calls()).toEqual(["kill vm/t1"]);
  await act(w.hub, { type: "assistant-close", place: "vm/sp1", mode: "stop" }, w.compat);
  expect(w.calls().slice(1)).toEqual(["kill vm/t7", "kill vm/t1"]);
  await expect(act(w.hub, { type: "assistant-close", place: "spB" }, w.compat)).rejects.toThrow("no Assistant running");
});

test("the sidebar forgets a removed space; one it never had leaves it as it was", () => {
  const bar = { pinned: ["spA", "spC"], icons: { spA: "🏠", spC: "📦" }, sections: [{ id: "s1", name: "Work", spaces: ["spA", "spB"] }] };
  expect(withoutSpace(bar, "spA")).toEqual({ pinned: ["spC"], icons: { spC: "📦" }, sections: [{ id: "s1", name: "Work", spaces: ["spB"] }] });
  expect(withoutSpace(bar, "spZ")).toBe(bar);
});

test("what the window offered and 3.2 has not (tabs, a fork, worktree spaces, Autopilot) is refused in plain words", async () => {
  const w = world();
  for (const b of [{ type: "tab-new", place: "spA" }, { type: "tab-close", tab: "tb1" }, { type: "fork", chat: "p:spA" }, { type: "worktree", place: "spA", op: "info" },
    { type: "mode", place: "spA", mode: "autopilot" }])
    await expect(act(w.hub, b, w.compat)).rejects.toThrow("Shepherdr can't do that yet.");
  expect(w.calls()).toEqual([]);
});

// The carry-over, as the model runs it: each machine's "herdr-app" document read once, by the machine that keeps the
// shared document, only once that document is read.
test("the model carries the window's spaces over once per machine, then never reads their documents again", async () => {
  const { Model } = await import("./model.ts");
  const docs: Record<string, any> = { here: { spaces: [{ id: "sp1", name: "demo", folder: "/home/someone/dev/demo", tabs: [] }] }, vm: { spaces: [{ id: "sp1", name: "api", folder: "/srv/api", tabs: [] }] } };
  const read: string[] = [];
  let machines: any[] = [];
  const hub: any = {
    terminals: new Map(), on: () => () => {},
    async call(method: string, p: any = {}) {
      if (method === "machine.list") return { machines };
      if (method === "doc.get" && p.name === "herdr-app") { read.push(p.on ?? "here"); return { value: docs[p.on ?? "here"], version: 1 }; }
      throw new Error(`no ${method}`);
    },
  };
  const put: Record<string, any> = {};
  const m = new Model(hub, { put: (k: string, v: any) => { put[k] = v; } } as any);
  m.legacyHistory = async () => ({});
  const doc: Record<string, any> = { "spaces-chat": { sections: [{ id: "g1", name: "Work", spaces: ["sp1"] }] } };
  let ready = false;
  m.doc = () => doc;
  m.own = { ready: () => ready, update: async (change) => { const next = change(structuredClone(doc)); for (const k of Object.keys(doc)) delete doc[k]; Object.assign(doc, next); } };
  const refresh = () => (m as any).refresh();
  // the shared document isn't read yet: nothing is carried over (never onto a list not read)
  await refresh();
  expect(read).toEqual([]);
  ready = true;
  await refresh();
  expect(doc.spaces).toMatchObject([{ id: "sp1", name: "demo", folder: "/home/someone/dev/demo", machine: null }]);
  expect(doc[IMPORTED]).toEqual([""]);
  // its group still points at it
  expect(put.spaces.spaces.map((s: any) => [s.id, s.section])).toEqual([["sp1", "g1"]]);
  // vm connects later: carried over then; this computer's document isn't read again
  machines = [{ name: "vm", state: "connected" }];
  await refresh();
  await refresh();
  expect(read).toEqual(["here", "vm"]);
  expect(doc[IMPORTED]).toEqual(["", "vm"]);
  // this computer's are carried over and none is the home folder: Everything, the root space, is made (once)
  expect(doc.spaces.filter((s: any) => s.id === "home")).toMatchObject([{ id: "home", name: "Home", folder: HOME, machine: null }]);
  expect(put.spaces.spaces.map((s: any) => s.id).sort()).toEqual(["home", "sp1", "vm/sp1"]);
  // removed since: it stays removed
  doc.spaces = doc.spaces.filter((s: any) => s.machine !== "vm");
  await refresh();
  expect(put.spaces.spaces.map((s: any) => s.id).sort()).toEqual(["home", "sp1"]);
  expect(doc.spaces.filter((s: any) => s.id === "home").length).toBe(1);
  expect(read).toEqual(["here", "vm"]);
  // a home space written another way (a trailing slash) is Everything already: no second one is made (SHEP-296)
  doc.spaces = [{ id: "spH", name: "Home", folder: `${HOME}/`, machine: null }, ...doc.spaces.filter((s: any) => s.id !== "home")];
  await refresh();
  expect(doc.spaces.map((s: any) => s.id)).toEqual(["spH", "sp1"]);
});

test("a missing copied document waits for the old session and imports it on retry", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async (method: string) => method === "machine.list" ? { machines: [] } : { value: null } };
  const m = new Model(hub, { put: () => {} } as any);
  const doc: Record<string, any> = {};
  m.doc = () => doc;
  m.own = { ready: () => true, update: async (change) => Object.assign(doc, change(doc)) };
  let available = false;
  m.legacySpaces = async () => { if (!available) throw new Error("unavailable"); return { spaces: [{ id: "sp1", name: "Old", folder: "/old" }] }; };
  m.legacyHistory = async () => ({ sp1: { path: "/old/session.jsonl", kind: "claude" } });
  await m.refresh();
  expect(doc[IMPORTED]).toBeUndefined();
  available = true;
  await m.refresh();
  expect(doc.spaces).toMatchObject([{ id: "sp1", name: "Old", folder: "/old" }]);
  expect(doc[IMPORTED]).toEqual([""]);
  expect(doc["chat.history"].sp1).toEqual({ path: "/old/session.jsonl", kind: "claude" });
});

test("history retries independently without hiding copied spaces", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async (method: string) => method === "machine.list" ? { machines: [] } : { value: { spaces: [{ id: "sp1", name: "Old", folder: "/old" }] } } };
  const m = new Model(hub, { put: () => {} } as any), doc: Record<string, any> = {};
  m.doc = () => doc;
  m.own = { ready: () => true, update: async (change) => Object.assign(doc, change(doc)) };
  let available = false;
  m.legacyHistory = async () => { if (!available) throw new Error("offline"); return { sp1: { path: "/old.jsonl", kind: "claude" } }; };
  await m.refresh();
  expect(doc.spaces).toMatchObject([{ id: "sp1" }]);
  expect(doc["chat.history.imported"]).toEqual([]);
  available = true;
  await m.refresh();
  expect(doc["chat.history"].sp1.path).toBe("/old.jsonl");
  expect(doc["chat.history.imported"]).toEqual([""]);
});

test("a copied document reported not found is read from the old session", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async (method: string) => { if (method === "machine.list") return { machines: [] }; throw Object.assign(new Error("document not found"), { kind: "not_found" }); } };
  const m = new Model(hub, { put: () => {} } as any), doc: Record<string, any> = {};
  m.doc = () => doc;
  m.own = { ready: () => true, update: async (change) => Object.assign(doc, change(doc)) };
  m.legacySpaces = async () => ({ spaces: [{ id: "sp1", name: "Old", folder: "/old" }] });
  m.legacyHistory = async () => ({});
  await m.refresh();
  expect(doc.spaces).toMatchObject([{ id: "sp1", name: "Old" }]);
  expect(doc[IMPORTED]).toEqual([""]);
});

test("an unrelated missing method never marks spaces imported", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async (method: string) => { if (method === "machine.list") return { machines: [] }; throw Object.assign(new Error("Method not found"), { kind: "method_not_found" }); } };
  const m = new Model(hub, { put: () => {} } as any), doc: Record<string, any> = {};
  m.doc = () => doc;
  m.own = { ready: () => true, update: async (change) => Object.assign(doc, change(doc)) };
  m.legacyHistory = async () => ({});
  await m.refresh();
  expect(doc[IMPORTED]).toBeUndefined();
});

test("a machine absent from the old session has no old spaces", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async (method: string) => method === "machine.list" ? { machines: [{ name: "vm", state: "connected" }] } : { value: null } };
  const m = new Model(hub, { put: () => {} } as any), doc: Record<string, any> = {};
  m.doc = () => doc;
  m.own = { ready: () => true, update: async (change) => Object.assign(doc, change(doc)) };
  m.legacySpaces = async (machine) => { if (machine) throw Object.assign(new Error("Unknown machine"), { kind: "machine_unknown" }); return null };
  m.legacyHistory = async () => ({});
  await m.refresh();
  expect(doc[IMPORTED]).toContain('vm');
});
