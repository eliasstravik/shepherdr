import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// New space (3.2: the spaces are the service's own list, the shared document's "spaces"; no Herdr window is asked).
// A throwaway home for "vmb" on this disk, and a fake hc that records how the space's Assistant is started: never a
// real herdr-core. Fake data only.
const APP = mkdtempSync(join(tmpdir(), "shep-newspace-"));
const BIN = join(APP, "bin"), CALLS = join(APP, "calls");
mkdirSync(BIN);
// with a FAIL file: refused as hc refuses a machine its session doesn't have (SHEP-294)
const FAIL = join(APP, "fail");
writeFileSync(join(BIN, "hc"), `#!/bin/sh\necho "$*" >> "${CALLS}"\necho "session=$HC_SESSION" >> "${CALLS}"
if [ -e "${FAIL}" ]; then echo '{"error":{"kind":"machine_unknown","message":"unknown machine \\"vmb\\""}}'; exit 4; fi
echo '{"address":"t9"}'\n`, { mode: 0o755 });
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
  const { place, error } = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", icon: "🎵", store: s });
  expect(error).toBeUndefined();
  expect(place).toMatch(/^vmb\/sp[0-9a-f]{32}$/);
  const id = place.slice(4);
  expect(s.d.spaces).toMatchObject([{ id, name: "crescendo", folder: `${VMB}/crescendo`, machine: "vmb" }]);
  // its icon on the id the sidebar knows it by
  expect(s.d["spaces-chat"].icons).toEqual({ [place]: "🎵" });
  // its Assistant, on its machine, in its folder, labelled for it
  const call = readFileSync(CALLS, "utf8");
  expect(call).toContain(`run --bg --keep --no-parent --on vmb --cwd ${VMB}/crescendo --label herdr.role=coordinator --label herdr.coordinator.space=${id} --label herdr.space=${id}`);
  expect(existsSync(join(APP, "herdr-app-calls"))).toBe(false);
  // in Shepherdr's own session, not herdr-core's default one (SHEP-294)
  const { SESSION } = await import("./session.ts");
  expect(call).toContain(`session=${SESSION}\n`);
});

test("its Assistant not starting is said in plain words, and the space stays for its first message to start one", async () => {
  const s = store();
  writeFileSync(FAIL, "");
  try {
    const made = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", store: s });
    expect(made.error).toBe('The space is made, but its agent didn\'t start: unknown machine "vmb". Send a message in the space to start it.');
    expect(s.d.spaces.map((x: any) => SP.ownId(x))).toEqual([made.place]);
  } finally { rmSync(FAIL); }
  // hc's own last line, when it says no JSON
  expect(SP.notStarted({ code: 1, out: "", err: "hc: no such template\n" })).toContain("didn't start: no such template.");
  expect(SP.notStarted({ code: 2, out: "", err: "" })).toContain("didn't start: hc ended with code 2.");
});

test("a missing folder is made; one more space is added after the ones there", async () => {
  const s = store();
  s.d.spaces = [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null }];
  const { place } = await SP.newSpace(hub, { machine: "vmb", path: "~/fresh/one", store: s });
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

test("New space in a home folder never makes a second space there (SHEP-296)", async () => {
  writeFileSync(CALLS, "");
  // this computer's home folder (as ~, ~/ or the path with a slash): Everything opens, nothing is added or started
  const s = store();
  s.d.spaces = [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null }, { id: "home", name: "Home", folder: process.env.HOME!, machine: null }];
  for (const path of ["~", "~/", `${process.env.HOME}/`]) expect(await SP.newSpace(hub, { machine: null, path, store: s })).toEqual({ place: "home", existed: true });
  expect(s.d.spaces.map((x: any) => x.id)).toEqual(["sp1", "home"]);
  expect(existsSync(CALLS) ? readFileSync(CALLS, "utf8") : "").toBe("");
  // another machine's home folder that has its space: refused in plain words
  s.d.spaces.push({ id: "spv", name: "Home", folder: `${VMB}/`, machine: "vmb" });
  await expect(SP.newSpace(hub, { machine: "vmb", path: "~", store: s })).rejects.toThrow("The home folder on vmb has its space already. Pick another folder.");
  expect(s.d.spaces.length).toBe(3);
  // a folder under home is still a new space
  const { place } = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo/", store: s });
  expect(s.d.spaces.map((x: any) => SP.ownId(x))).toEqual(["sp1", "home", "vmb/spv", place]);
});

// SHEP-298: the agent picked in the New space dialog, its Assistant not started, stays the space's choice, so its chat
// says it and its first message starts on it; one that started (or none picked there) keeps nothing.
test("an agent picked for a new space whose Assistant didn't start is kept as the space's choice", async () => {
  const { CHOICE_KEY, choiceOf } = await import("../core/agents.js") as any;
  const fable = { agent: "claude", model: "claude-fable-5-2", effort: "low", fast: false, perm: null };
  writeFileSync(FAIL, "");
  try {
    const s = store();
    const made = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", store: s, pick: () => fable, keepPick: true });
    expect(made.error).toBeTruthy();
    expect(choiceOf(s.d[CHOICE_KEY], made.place)).toEqual(fable);
    // Settings' choice (no pick in the dialog) is never written down as the space's own
    const s2 = store();
    const m2 = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", store: s2, pick: () => fable });
    expect(choiceOf(s2.d[CHOICE_KEY], m2.place)).toBeNull();
  } finally { rmSync(FAIL); }
  const s3 = store();
  const ok = await SP.newSpace(hub, { machine: "vmb", path: "~/crescendo", store: s3, pick: () => fable, keepPick: true });
  expect(ok.error).toBeUndefined();
  expect(s3.d[CHOICE_KEY]).toBeUndefined();
});
