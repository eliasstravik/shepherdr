// SHEP-33: nobody named a machine to keep the secrets. The service on the machine serving the web app names one on its
// own (where the secrets are now), hands it to every machine it links, including one that reaches nobody itself, and
// then wants to move them to itself (Settings › Secrets: "Same as Serve from"). A fake herdr-core per machine, as in
// host.test.ts: S serves the web app, L is a laptop with a vault, V a VM with no service that links nobody.
import { expect, test } from "bun:test";
import { SecretsHome } from "./secrets.ts";

const SECRETS = "shepherdr.secrets", HOST = "shepherdr.host";

function world(vaults: Record<string, { count: number; remote: boolean } | null>) {
  const docs: Record<string, Map<string, { value: any; version: number }>> = { S: new Map(), L: new Map(), V: new Map() };
  const names: Record<string, Record<string, string>> = { S: { laptop: "L", vm: "V" }, L: { server: "S" }, V: {} };
  const exec: string[] = [];
  const hub = (self: string) => ({
    terminals: new Map(),
    on() { return () => {}; },
    async call(method: string, p: any = {}) {
      const at = p.on ? names[self][p.on] : self;
      if (p.on && !vaults[at] && method !== "doc.get" && method !== "doc.set") throw new Error("unreachable");
      if (p.on && vaults[at] === null) throw new Error("unreachable");
      if (method === "server.status") return { core: { id: self, name: self } };
      if (method === "machine.list") return { machines: Object.entries(names[self]).map(([name, id]) => ({ name, id, state: vaults[id] ? "connected" : "unreachable" })) };
      if (method === "doc.get") return docs[at].get(p.name) ?? { value: null, version: 0 };
      if (method === "doc.set") {
        const d = docs[at].get(p.name) ?? { value: null, version: 0 };
        if (d.version !== p.version) throw Object.assign(new Error("conflict"), { kind: "conflict" });
        docs[at].set(p.name, { value: p.value, version: d.version + 1 });
        return { version: d.version + 1 };
      }
      if (method === "machine.exec") {
        exec.push(`${at}: ${p.argv.slice(0, 2).join(" ")}`);
        return { code: 0, stdout: Buffer.from(JSON.stringify(vaults[at])).toString("base64") };
      }
      throw new Error(`no ${method}`);
    },
  });
  for (const m of ["S", "L", "V"]) docs[m].set(HOST, { value: { id: "S", at: 1 }, version: 1 });
  return { docs, exec, hub };
}
const rec = (w: ReturnType<typeof world>, m: string) => w.docs[m].get(SECRETS)?.value ?? null;

test("no keeper named, the laptop's vault has secrets: it's named on every machine, the VM too, and the server follows", async () => {
  const w = world({ S: { count: 0, remote: true }, L: { count: 5, remote: false }, V: { count: 0, remote: true } });
  const home = new SecretsHome(w.hub("S") as any, () => ({ count: 0, remote: true }));
  await home.poll();
  for (const m of ["S", "L", "V"]) expect(rec(w, m)).toMatchObject({ id: "L", by: "S", auto: true });
  // only counts were asked for, never a vault's text
  expect(w.exec.every((x) => x.endsWith("python3 -c"))).toBe(true);
  expect(home.view()).toMatchObject({ here: false, set: true, auto: true, serve: null, name: "laptop", reachable: true });
  // the server (Serve from) moves them to itself, the safe way, now the laptop is on
  expect(home.shouldFollow()).toBe(true);
});

test("the laptop's own service learns it from the server: it had none of its own", async () => {
  const w = world({ S: { count: 0, remote: true }, L: { count: 5, remote: false }, V: { count: 0, remote: true } });
  w.docs.S.set(SECRETS, { value: { id: "L", at: Date.now(), by: "S", auto: true }, version: 1 });
  const laptop = new SecretsHome(w.hub("L") as any, () => ({ count: 5, remote: false }));
  await laptop.poll();
  expect(rec(w, "L")).toMatchObject({ id: "L", auto: true });
  expect(laptop.here()).toBe(true);
  // only the machine serving the web app starts the move
  expect(laptop.shouldFollow()).toBe(false);
});

test("once they're on the server: same as Serve from, nothing more to move", async () => {
  const w = world({ S: { count: 5, remote: false }, L: { count: 0, remote: true }, V: { count: 0, remote: true } });
  const home = new SecretsHome(w.hub("S") as any, () => ({ count: 5, remote: false }));
  await home.poll();
  expect(rec(w, "V")).toMatchObject({ id: "S", auto: true });
  expect(home.view()).toMatchObject({ here: true, auto: true, serve: null });
  expect(home.shouldFollow()).toBe(false);
});

test("no vault seen and the laptop asleep: nothing named yet (it may hold them)", async () => {
  const w = world({ S: { count: 0, remote: true }, L: null, V: { count: 0, remote: true } });
  const home = new SecretsHome(w.hub("S") as any, () => ({ count: 0, remote: true }));
  await home.poll();
  for (const m of ["S", "V"]) expect(rec(w, m)).toBe(null);
});

test("a keeper the person picked stays: nothing automatic, no move", async () => {
  const w = world({ S: { count: 0, remote: true }, L: { count: 5, remote: false }, V: { count: 0, remote: true } });
  w.docs.S.set(SECRETS, { value: { id: "L", at: Date.now() - 1000, by: "L" }, version: 1 });
  const home = new SecretsHome(w.hub("S") as any, () => ({ count: 0, remote: true }));
  await home.poll();
  expect(rec(w, "V")).toMatchObject({ id: "L" });
  expect(rec(w, "V").auto).toBeUndefined();
  expect(home.shouldFollow()).toBe(false);
  expect(w.exec).toEqual([]);
});
