import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// New space on another machine with the Herdr window (SHEP-56). A throwaway app home with spaces-chat (so the service
// asks the window), and a herdr-app that answers space.new as the real window does (herdr-app src/window.rs new_space:
// ids made with fresh_id_on, so another machine's come back as "<machine>/<id>"), never a real window.
const APP = mkdtempSync(join(tmpdir(), "shep-newspace-"));
const BIN = join(APP, "bin"), CALLS = join(APP, "calls"), REPLY = join(APP, "reply");
mkdirSync(join(APP, "mods", "spaces-chat"), { recursive: true });
mkdirSync(BIN);
writeFileSync(join(BIN, "herdr-app"), `#!/bin/sh\necho "$*" >> "${CALLS}"\ncat "${REPLY}"\n`, { mode: 0o755 });
// "vmb"'s home, on this disk: machine.exec runs there
const VMB = join(APP, "vmb");
mkdirSync(join(VMB, "crescendo"), { recursive: true });

let SP: typeof import("./spaces.ts");
const was = process.env.HERDR_APP_HOME;
beforeAll(async () => {
  process.env.HERDR_APP_HOME = APP;
  process.env.SHEPHERDR_HERDR_APP = join(BIN, "herdr-app");
  SP = await import("./spaces.ts");
});
afterAll(() => {
  delete process.env.SHEPHERDR_HERDR_APP;
  if (was === undefined) delete process.env.HERDR_APP_HOME; else process.env.HERDR_APP_HOME = was;
});

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

test("a space made on another machine keeps the window's id: no doubled machine", async () => {
  writeFileSync(REPLY, JSON.stringify({ space: "vmb/sp9", tab: "vmb/tb9", terminal: "vmb/t3" }));
  const s = store();
  const place = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", icon: "🎵", store: s });
  expect(place).toBe("vmb/sp9");
  expect(readFileSync(CALLS, "utf8")).toContain(`space.new --folder ${VMB}/crescendo --name crescendo --machine vmb`);
  // its icon on the id the sidebar knows it by
  expect(s.d["spaces-chat"].icons).toEqual({ "vmb/sp9": "🎵" });
});

test("this computer's space keeps its plain id", () => {
  expect(SP.placeId("sp4", null)).toBe("sp4");
  expect(SP.placeId("vmb/sp4", "vmb")).toBe("vmb/sp4");
  // an older window that answered unqualified
  expect(SP.placeId("sp4", "vmb")).toBe("vmb/sp4");
});

test("the window's own error reaches the dialog", async () => {
  writeFileSync(REPLY, JSON.stringify({ error: "vmb's spaces haven't loaded yet" }));
  await expect(SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", store: store() })).rejects.toThrow("Herdr couldn't make it: vmb's spaces haven't loaded yet");
  expect(existsSync(join(VMB, "crescendo"))).toBe(true);
});

test("the snapshot has the new space before the page is answered, once vmb's document has it", async () => {
  const { Model } = await import("./model.ts");
  // vmb's document gets the space a moment after the window answers (its write still on its way)
  let reads = 0;
  const doc = (n: number) => ({ spaces: [{ id: "sp1", name: "api", folder: "/srv/api", tabs: [] }, ...(n > 1 ? [{ id: "sp9", name: "crescendo", folder: "/srv/crescendo", tabs: [] }] : [])] });
  const fake: any = {
    terminals: new Map(),
    on: () => () => {},
    async call(method: string, p: any) {
      if (method === "doc.get") return { value: p.on === "vmb" ? doc(++reads) : { spaces: [] }, version: 1 };
      throw new Error(method);
    },
  };
  const put: Record<string, any> = {};
  const m = new Model(fake, { put: (k: string, v: any) => { put[k] = v; } } as any);
  (m as any).machines = ["vmb"];
  expect(await m.waitSpace("vmb/sp9")).toBe(true);
  expect(put.spaces.spaces.map((s: any) => s.id)).toContain("vmb/sp9");
  expect(reads).toBeGreaterThan(1);
  // one that never comes: answered anyway, after the wait
  expect(await m.waitSpace("vmb/sp404", 700)).toBe(false);
});
