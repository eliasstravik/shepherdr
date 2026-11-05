import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeSaved, renameSaved, orderSaved, withoutSpace } from "./saved-spaces.ts";

// Herdr installed, its window shut: a herdr-app that fails every "herdr-app do" (and records it), used in place of the real
// one, so a real window is never reached. The space log goes to a throwaway app home; act() reads it when imported.
const APP = mkdtempSync(join(tmpdir(), "shep-saved-"));
const BIN = join(APP, "bin"), CALLS = join(APP, "herdr-app-calls");
mkdirSync(BIN);
writeFileSync(join(BIN, "herdr-app"), `#!/bin/sh\necho "$*" >> "${CALLS}"\necho "herdr-app: no window is running" >&2\nexit 1\n`, { mode: 0o755 });
let act: typeof import("./actions.ts").act;
const was = process.env.HERDR_APP_HOME;
beforeAll(async () => {
  process.env.HERDR_APP_HOME = APP;
  process.env.SHEPHERDR_HERDR_APP = join(BIN, "herdr-app");   // never a real window's, even on a machine with one
  ({ act } = await import("./actions.ts"));
  if (was === undefined) delete process.env.HERDR_APP_HOME; else process.env.HERDR_APP_HOME = was;
});
afterAll(() => { delete process.env.SHEPHERDR_HERDR_APP; });

const tab = (id: string, ...blocks: any[]) => ({ id, name: id, root: { type: "row", id, children: blocks } });
const term = (pane: string, t: string) => ({ type: "block", id: pane, content: { terminal: t } });
const chat = (pane: string) => ({ type: "block", id: pane, content: { mod: "chat", props: { role: "coordinator" } } });
const live = (address: string, labels: Record<string, string> = {}) => [address, { address, state: "live", labels }] as const;

// herdr-core on this computer and on "vm": each machine's "herdr-app" document, versioned (doc.set only lands on the
// version it read, as the real one), and the terminals hc lists here (vm's as "vm/t…").
function world() {
  const docs: Record<string, { value: any; version: number }> = {
    here: { version: 7, value: { spaces: [
      { id: "spA", name: "Home", folder: "~", tabs: [tab("tbA", chat("pA"), term("pA2", "t1"))] },
      { id: "spB", name: "Home", folder: "~", tabs: [tab("tbB", term("pB", "t2"))] },
      { id: "spC", name: "app", folder: "~/app", tabs: [tab("tbC", term("pC", "t3"))] },
    ] } },
    vm: { version: 3, value: { spaces: [
      { id: "sp1", name: "api", folder: "/srv/api", tabs: [tab("tb1", term("p1", "t1"))] },
      { id: "sp2", name: "web", folder: "/srv/web", tabs: [tab("tb2", term("p2", "t2"))] },
    ] } },
  };
  const killed: string[] = [], writes: string[] = [];
  let race: (() => void) | null = null;
  const hub = {
    terminals: new Map<string, any>([
      live("t1"), live("t2"), live("t3"),
      live("t9", { "herdr.role": "coordinator", "herdr.coordinator.space": "spA" }),   // spA's Assistant
      live("t8", { "herdr.chat": "pA" }),                                               // parked on spA's chat pane
      live("t7", { "herdr.role": "coordinator", "herdr.coordinator.space": "spC" }),   // another space's Assistant
      live("vm/t1"), live("vm/t2"), live("vm/t5", { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1" }),
      live("t5", { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1" }),   // here, same label: not vm's
    ]),
    on() { return () => {}; },
    async call(method: string, p: any = {}): Promise<any> {
      const at = p.on ?? "here";
      if (method === "doc.get") return structuredClone(docs[at]);
      if (method === "doc.set") {
        race?.(); race = null;
        if (docs[at].version !== p.version) throw Object.assign(new Error("conflict"), { kind: "conflict" });
        docs[at] = { value: p.value, version: p.version + 1 };
        writes.push(at);
        return { version: p.version + 1 };
      }
      if (method === "terminal.kill") { killed.push(p.terminal); hub.terminals.get(p.terminal).state = "finished"; return {}; }
      throw new Error(`no ${method}`);
    },
  };
  return { docs, hub, killed, writes, raceOnce: (fn: () => void) => { race = fn; } };
}
const ids = (d: any) => d.value.spaces.map((s: any) => s.id);

test("a window space closes with no window: gone from this computer's saved spaces, what ran in it ends", async () => {
  const w = world();
  const gone = await closeSaved(w.hub, "spA");
  expect(gone).toEqual({ id: "spA", machine: null, name: "Home", folder: "~" });
  expect(ids(w.docs.here)).toEqual(["spB", "spC"]);                 // the other Home stays
  expect(w.docs.here.version).toBe(8);
  expect(w.killed.sort()).toEqual(["t1", "t8", "t9"]);              // its tab's terminal, its Assistant, its parked agent
  expect(w.docs.vm.version).toBe(3);                                // another machine's spaces untouched
});

test("another machine's space closes there: only its document changes, only its terminals end", async () => {
  const w = world();
  expect((await closeSaved(w.hub, "vm/sp1"))?.machine).toBe("vm");
  expect(ids(w.docs.vm)).toEqual(["sp2"]);
  expect(w.writes).toEqual(["vm"]);
  expect(w.docs.here.version).toBe(7);
  expect(w.killed.sort()).toEqual(["vm/t1", "vm/t5"]);              // not this computer's t1 or t5
});

test("a window that writes meanwhile isn't overwritten: the close lands on top of its write", async () => {
  const w = world();
  // a window starting writes first (it adds a space): the close's write conflicts, reads again and keeps it
  w.raceOnce(() => { w.docs.here = { version: 8, value: { spaces: [...w.docs.here.value.spaces, { id: "spD", name: "new", folder: "/x", tabs: [] }] } }; });
  await closeSaved(w.hub, "spB");
  expect(ids(w.docs.here)).toEqual(["spA", "spC", "spD"]);
  expect(w.docs.here.version).toBe(9);
});

test("a space not in the saved spaces changes nothing; a terminal another space shows keeps running", async () => {
  const w = world();
  expect(await closeSaved(w.hub, "spZ")).toBeNull();
  expect(w.writes).toEqual([]);
  w.docs.here.value.spaces[2].tabs.push(tab("tbX", term("pX", "t2")));   // spC shows spB's t2 too
  await closeSaved(w.hub, "spB");
  expect(w.killed).toEqual([]);
});

test("rename and reorder with no window: only that space or tab, on its machine", async () => {
  const w = world();
  expect(await renameSaved(w.hub, "spB", "Old home")).toEqual({ was: "Home" });
  expect(await renameSaved(w.hub, "vm/tb2", "Front")).toEqual({ was: "tb2" });
  expect(w.docs.here.value.spaces[1].name).toBe("Old home");
  expect(w.docs.vm.value.spaces[1].tabs[0].name).toBe("Front");
  expect(await renameSaved(w.hub, "spZ", "x")).toBeNull();
  await orderSaved(w.hub, null, ["spC", "spA"]);
  expect(ids(w.docs.here)).toEqual(["spC", "spA", "spB"]);
  await orderSaved(w.hub, "vm", ["vm/sp2", "vm/sp1"]);
  expect(ids(w.docs.vm)).toEqual(["sp2", "sp1"]);
});

test("the sidebar forgets a closed space: out of Pinned, its section and its icon", () => {
  const bar = { pinned: ["spA", "spC"], icons: { spA: "🏠", spC: "📦" }, sections: [{ id: "s1", name: "Work", spaces: ["spA", "spB"] }] };
  expect(withoutSpace(bar, "spA")).toEqual({ pinned: ["spC"], icons: { spC: "📦" }, sections: [{ id: "s1", name: "Work", spaces: ["spB"] }] });
  expect(withoutSpace(bar, "spZ")).toBe(bar);
});

// The web's Close space (POST /api/action space-remove) through the service's own act(), the window shut.
function compat(w: ReturnType<typeof world>) {
  const shared: Record<string, any> = { "spaces-chat": { pinned: ["vm/sp1"], icons: { spA: "🏠" }, sections: [] } };
  return { shared: { value: (k: string) => shared[k], set: async (k: string, v: unknown) => { shared[k] = v; } }, host: "mini", data: shared } as any;
}

test("Close space from the web, no window: a window space on this computer closes instead of the red error", async () => {
  const w = world(), c = compat(w);
  expect(await act(w.hub as any, { type: "space-remove", place: "spA" }, c)).toEqual({ ok: true });
  expect(ids(w.docs.here)).toEqual(["spB", "spC"]);
  expect(c.data["spaces-chat"].icons).toEqual({});
  const log = readFileSync(join(APP, "data", "backups", "space-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.at(-1)).toMatchObject({ space: "spA", name: "Home", action: "close", machine: null });
  expect(readFileSync(CALLS, "utf8")).toContain("do space.close --id spA");   // the window was asked first
});

test("Close space from the web, no window: another machine's space closes on that machine", async () => {
  const w = world(), c = compat(w);
  expect(await act(w.hub as any, { type: "space-remove", place: "vm/sp1" }, c)).toEqual({ ok: true });
  expect(ids(w.docs.vm)).toEqual(["sp2"]);
  expect(ids(w.docs.here)).toEqual(["spA", "spB", "spC"]);
  expect(c.data["spaces-chat"].pinned).toEqual([]);
  await expect(act(w.hub as any, { type: "space-remove", place: "vm/sp1" }, c)).rejects.toThrow("That space isn't here any more.");
});

test("rename and reorder from the web, no window", async () => {
  const w = world(), c = compat(w);
  await act(w.hub as any, { type: "rename", id: "spB", name: "Old home" }, c);
  expect(w.docs.here.value.spaces[1].name).toBe("Old home");
  await expect(act(w.hub as any, { type: "rename", id: "spB", name: "", unname: true }, c)).rejects.toThrow("needs the Herdr window open");
  await act(w.hub as any, { type: "tab-rename", tab: "vm/tb1", name: "API" }, c);
  expect(w.docs.vm.value.spaces[0].tabs[0].name).toBe("API");
  await act(w.hub as any, { type: "order", under: "m:vm", ids: ["vm/sp2", "vm/sp1"] }, c);
  expect(ids(w.docs.vm)).toEqual(["sp2", "sp1"]);
  await act(w.hub as any, { type: "order", under: "m:mini", ids: ["spC", "spB", "spA"] }, c);
  expect(ids(w.docs.here)).toEqual(["spC", "spB", "spA"]);
});
