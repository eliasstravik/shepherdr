// Rename a machine: the sidebar's long-press menu sends "rename" with "m:<machine>". The name is only what the list
// shows: the machine's key, its id and its spaces' addresses keep the real one. Its emoji stays when only the name
// changes; an empty name gives it back its own. A fake shared document, no Herdr asked. Fake data only.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { act } from "./actions.ts";

function world() {
  const shared: Record<string, any> = { spaces: [{ id: "sp1", name: "api", folder: "/srv/api", machine: "vm-demo" }], "spaces-chat": { machines: { "vm-demo": { icon: "🧪" } } } };
  const c = new Compat() as any;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.shared = { value: (k: string) => shared[k], set: async (k: string, v: unknown) => { shared[k] = v; } };
  c.host = "mini";
  const snap = () => c.snapshot({ host: "mini", user: "me", machines: [{ name: "mini", here: true, state: "connected" }, { name: "vm-demo", here: false, state: "connected" }],
    spaces: [{ id: "vm-demo/sp1", name: "api", folder: "/srv/api", machine: "vm-demo" }], sections: [], rows: [] });
  return { c, shared, snap, hub: { terminals: new Map() } as any };
}

test("rename a machine: saved in the sidebar's data for every device, its emoji kept, the real name everywhere else", async () => {
  const w = world();
  expect(await act(w.hub, { type: "rename", id: "m:vm-demo", name: "  Dev box " }, w.c)).toEqual({ ok: true });
  expect(w.shared["spaces-chat"].machines["vm-demo"]).toEqual({ name: "Dev box", icon: "🧪" });
  const s = w.snap();
  const m = s.machines.find((x: any) => x.id === "m:vm-demo");
  expect(m).toMatchObject({ id: "m:vm-demo", machine: "vm-demo", name: "Dev box", ownName: "vm-demo", emoji: "🧪" });
  // its spaces keep the real machine in their ids and addresses
  const p = s.places.find((x: any) => x.name === "api");
  expect(p.machine).toBe("vm-demo");
  expect(p.id).toContain("vm-demo");
  expect(p.id).not.toContain("Dev box");
});

test("this computer is renamed under its own key; an empty name gives a machine back its own", async () => {
  const w = world();
  await act(w.hub, { type: "rename", id: "m:mini", name: "Studio" }, w.c);
  expect(w.shared["spaces-chat"].machines[""]).toEqual({ name: "Studio" });
  expect(w.snap().machines.find((x: any) => x.here)).toMatchObject({ machine: "mini", name: "Studio", ownName: "This computer" });
  await act(w.hub, { type: "rename", id: "m:mini", name: "" }, w.c);
  await act(w.hub, { type: "rename", id: "m:vm-demo", name: "Dev box" }, w.c);
  await act(w.hub, { type: "rename", id: "m:vm-demo", name: "" }, w.c);
  expect(w.shared["spaces-chat"].machines).toEqual({ "vm-demo": { icon: "🧪" } });
  expect(w.snap().machines.map((x: any) => x.name)).toEqual(["This computer", "vm-demo"]);
});
