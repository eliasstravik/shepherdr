import { expect, test } from "bun:test";
import { Host } from "./host.ts";
import { Store } from "./store.ts";

// Two cores linked both ways: the laptop (id L) calls the mini "mac-mini"; the mini (id M) calls the laptop "m3".
// Each has its own documents; doc.get/doc.set with on: reach the other one's, as herdr-core's link does.
function world() {
  const docs: Record<string, Map<string, { value: any; version: number }>> = { L: new Map(), M: new Map() };
  const names: Record<string, Record<string, string>> = { L: { "mac-mini": "M", vm: "V" }, M: { m3: "L", vm: "V" } };
  const up = { L: true, M: true } as Record<string, boolean>;
  const hub = (self: "L" | "M") => ({
    terminals: new Map(),
    on() { return () => {}; },
    async call(method: string, p: any = {}) {
      const at = p.on ? names[self][p.on] : self;
      if (p.on && !up[at]) throw Object.assign(new Error("unreachable"), { kind: "unavailable" });
      if (method === "server.status") return { core: { id: self, name: self === "L" ? "laptop" : "mac" } };
      if (method === "machine.list") return { machines: Object.entries(names[self]).map(([name, id]) => ({ name, id, state: up[id] === false ? "unreachable" : "connected" })) };
      if (method === "doc.get") return docs[at].get(p.name) ?? { value: null, version: 0 };
      if (method === "doc.set") {
        const d = docs[at].get(p.name) ?? { value: null, version: 0 };
        if (d.version !== p.version) throw Object.assign(new Error("conflict"), { kind: "conflict" });
        docs[at].set(p.name, { value: p.value, version: d.version + 1 });
        return { version: d.version + 1 };
      }
      throw new Error(`no ${method}`);
    },
  });
  return { docs, up, hub };
}

test("the newest host record reaches every machine, and the one that slept learns it when it wakes", async () => {
  const w = world();
  const laptop = new Host(w.hub("L") as any, "t"), mini = new Host(w.hub("M") as any, "t");
  await laptop.poll(); await mini.poll();
  expect(laptop.serving()).toBe(true);                 // no record: each serves itself
  w.up.L = false;                                      // the laptop sleeps; the move happens on the mini
  w.docs.M.set("shepherdr.host", { value: { id: "M", at: 100 }, version: 1 });
  await mini.poll();
  expect(mini.serving()).toBe(true);
  w.up.L = true;                                       // it wakes: the mini hands the record on
  await mini.poll();
  expect(w.docs.L.get("shepherdr.host")?.value).toEqual({ id: "M", at: 100 });
  await laptop.poll();
  expect(laptop.serving()).toBe(false);
  expect(laptop.hubName()).toBe("mac-mini");
  expect(laptop.reachable()).toBe(true);
  // a service of its own: the host leaves its tasks to it, and the laptop ticks no other machine while the host is up
  expect(mini.participants().has("m3")).toBe(true);
  expect(laptop.tickOn()).toEqual([]);
});

test("a pin made on the laptop is the mini's pin, in the mini's words, and back", async () => {
  const w = world();
  w.docs.L.set("shepherdr.host", { value: { id: "M", at: 1 }, version: 1 });
  w.docs.M.set("shepherdr.host", { value: { id: "M", at: 1 }, version: 1 });
  const laptop = new Host(w.hub("L") as any, "t"), mini = new Host(w.hub("M") as any, "t");
  await mini.poll(); await laptop.poll();
  const onLaptop = new Store(w.hub("L") as any, laptop), onMini = new Store(w.hub("M") as any, mini);
  await onLaptop.set("spaces-chat", { pinned: ["sp1", "mac-mini/sp2"], icons: { sp1: "🐑" }, sections: [] });
  expect(w.docs.L.get("shepherdr")).toBe(undefined);   // nothing written on the laptop: the mini holds it
  const there = (await onMini.load()).value["spaces-chat"] as any;
  expect(there.pinned).toEqual(["m3/sp1", "sp2"]);
  expect(there.icons).toEqual({ "m3/sp1": "🐑" });
  // the phone (the mini's web app) unpins the laptop's space; the laptop's window reads it in its own words
  await onMini.set("spaces-chat", { ...there, pinned: ["sp2"] });
  expect(((await onLaptop.load()).value["spaces-chat"] as any).pinned).toEqual(["mac-mini/sp2"]);
  // the mini asleep: the laptop's reads fail plainly (its window keeps its own copy until it's back)
  w.up.M = false;
  await laptop.poll();
  await expect(onLaptop.load()).rejects.toThrow("can't be reached");
});

test("a machine this one only links can't make itself the host; a record from the future doesn't count", async () => {
  const w = world();
  const laptop = new Host(w.hub("L") as any, "t");
  w.docs.M.set("shepherdr.host", { value: { id: "M", at: Date.now() }, version: 1 });
  await laptop.poll();
  expect(laptop.serving()).toBe(true);                 // the mini's own claim: not believed by the laptop
  w.docs.L.set("shepherdr.host", { value: { id: "M", at: Date.now() + 3_600_000 }, version: 1 });
  await laptop.poll();
  expect(laptop.serving()).toBe(true);                 // an hour ahead: not a real record
  w.docs.L.set("shepherdr.host", { value: { id: "M", at: 5 }, version: 2 });
  w.docs.M.set("shepherdr.host", { value: { id: "L", at: 9 }, version: 2 });
  await laptop.poll();
  expect(laptop.serving()).toBe(true);                 // the host itself handed it back
  expect(w.docs.L.get("shepherdr.host")?.value).toEqual({ id: "L", at: 9 });
});
