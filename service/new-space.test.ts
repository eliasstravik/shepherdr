import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// New space (3.2: the spaces are the service's own list, the shared document's "spaces"; no Herdr window is asked).
// A throwaway home for "vmb" on this disk, and a fake hc that records how the space's Assistant is started: never a
// real herdr-core. Fake data only.
const APP = mkdtempSync(join(tmpdir(), "shep-newspace-"));
const BIN = join(APP, "bin"), CALLS = join(APP, "calls");
mkdirSync(BIN);
writeFileSync(join(BIN, "hc"), `#!/bin/sh\necho "$*" >> "${CALLS}"\necho '{"address":"t9"}'\n`, { mode: 0o755 });
// "vmb"'s home, on this disk: machine.exec runs there
const VMB = join(APP, "vmb");
mkdirSync(join(VMB, "crescendo"), { recursive: true });

let SP: typeof import("./spaces.ts");
const was = process.env.SHEPHERDR_HC;
beforeAll(async () => {
  process.env.SHEPHERDR_HC = join(BIN, "hc");
  SP = await import("./spaces.ts");
});
afterAll(() => { if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was; });

// herdr-core with a linked "vmb": machine.exec runs the command here, with vmb's HOME
const hub: any = {
  terminals: new Map(),
  async call(method: string, p: any) {
    if (method !== "machine.exec") throw new Error(method);
    const proc = Bun.spawn(p.argv, { env: { ...process.env, HOME: p.on === "vmb" ? VMB : process.env.HOME! }, stdout: "pipe", stderr: "pipe" });
    const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout: Buffer.from(o).toString("base64"), stderr: Buffer.from(e).toString("base64") };
  },
};
const store = () => { const d: Record<string, any> = {}; return { d, value: (k: string) => d[k], set: async (k: string, v: unknown) => { d[k] = v; } }; };

test("a space made on another machine joins the list of spaces, named after its folder, with its icon and its Assistant", async () => {
  const s = store();
  const place = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", icon: "🎵", store: s });
  expect(place).toMatch(/^vmb\/sp[0-9a-f]{32}$/);
  const id = place.slice(4);
  expect(s.d.spaces).toMatchObject([{ id, name: "crescendo", folder: `${VMB}/crescendo`, machine: "vmb" }]);
  // its icon on the id the sidebar knows it by
  expect(s.d["spaces-chat"].icons).toEqual({ [place]: "🎵" });
  // its Assistant, on its machine, in its folder, labelled for it
  const call = readFileSync(CALLS, "utf8");
  expect(call).toContain(`run --bg --keep --no-parent --on vmb --cwd ${VMB}/crescendo --label herdr.role=coordinator --label herdr.coordinator.space=${id} --label herdr.space=${id}`);
  expect(existsSync(join(APP, "herdr-app-calls"))).toBe(false);
});

test("a missing folder is made; one more space is added after the ones there", async () => {
  const s = store();
  s.d.spaces = [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null }];
  const place = await SP.newSpace(hub, { machine: "vmb", path: "~/fresh/one", store: s });
  expect(existsSync(join(VMB, "fresh", "one"))).toBe(true);
  expect(s.d.spaces.map((x: any) => SP.ownId(x))).toEqual(["sp1", place]);
  await expect(SP.newSpace(hub, { machine: "vmb", path: "", store: s })).rejects.toThrow("Pick a folder.");
});

test("the snapshot has the new space before the page is answered", async () => {
  const { Model } = await import("./model.ts");
  const fake: any = { terminals: new Map(), on: () => () => {}, async call(method: string) { throw new Error(method); } };
  const put: Record<string, any> = {};
  const m = new Model(fake, { put: (k: string, v: any) => { put[k] = v; } } as any);
  const doc: Record<string, any> = { spaces: [{ id: "sp1", name: "api", folder: "/srv/api", machine: "vmb" }] };
  m.doc = () => doc;
  expect(await m.waitSpace("vmb/sp9")).toBe(false);
  doc.spaces = [...doc.spaces, { id: "sp9", name: "crescendo", folder: "/srv/crescendo", machine: "vmb" }];
  expect(await m.waitSpace("vmb/sp9")).toBe(true);
  expect(put.spaces.spaces.map((s: any) => s.id)).toEqual(["vmb/sp1", "vmb/sp9"]);
});
