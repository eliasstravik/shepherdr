// The ElevenLabs key for a voice call (core/voice.js voiceKey): the old file here, the vault here, or the machine that
// keeps the secrets (read into memory only); and the words when that machine has none or can't be reached. KEY_SCRIPT
// runs for real with python3 on a throwaway home, as it runs on the machine that keeps them.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { voiceKey, KEY_SCRIPT, NO_KEY, noKeyOn, unreachable } from "./voice.js";
import { believeRecord, secretsRecord, autoKeeper, followTo, COUNT_SCRIPT } from "./secrets.js";

const KEY = "sk_test_0123456789abcdef0123456789abcdef";
const vault = (secrets) => JSON.stringify({ version: 1, secrets });
const io = (o = {}) => {
  const asked = [];
  return { asked, oldFile: () => "", where: async () => ({ here: true, set: false, name: null }), vault: () => null,
    ask: async (name, script) => { asked.push(name); return null; }, ...o };
};

test("the old file here comes first", async () => {
  expect(await voiceKey(io({ oldFile: () => KEY }))).toEqual({ key: KEY, from: "file" });
});

test("this machine keeps the secrets: its vault's Everywhere entry", async () => {
  const r = await voiceKey(io({ vault: () => vault([{ name: "ELEVENLABS_API_KEY", scope: "machine", machine: null, value: "no" },
    { name: "ELEVENLABS_API_KEY", scope: "everywhere", value: KEY }]) }));
  expect(r).toEqual({ key: KEY, from: "here" });
});

test("this machine keeps them and has none: the key help, nothing asked elsewhere", async () => {
  const x = io({ vault: () => vault([]) });
  expect(await voiceKey(x)).toEqual({ error: NO_KEY, why: "none" });
  expect(x.asked).toEqual([]);
});

test("another machine keeps them: read from there, with the agent it made", async () => {
  const x = io({ where: async () => ({ here: false, set: true, name: "mac-mini" }), vault: () => vault([{ name: "ELEVENLABS_API_KEY", scope: "everywhere", value: "stale-here" }]),
    ask: async (name) => { x.asked.push(name); return `${JSON.stringify({ key: KEY, agent: "agent_123" })}\n`; } });
  expect(await voiceKey(x)).toEqual({ key: KEY, agent: "agent_123", from: "mac-mini" });
  expect(x.asked).toEqual(["mac-mini"]);
});

test("it can't be reached: says so, not 'needs a key'", async () => {
  const r = await voiceKey(io({ where: async () => ({ here: false, set: true, name: "mac-mini" }), ask: async () => null }));
  expect(r).toEqual({ error: unreachable("mac-mini"), why: "unreachable" });
  expect(r.error).not.toContain("need");
  const thrown = await voiceKey(io({ where: async () => ({ here: false, set: true, name: "mac-mini" }), ask: async () => { throw new Error("offline"); } }));
  expect(thrown.why).toBe("unreachable");
  const unlinked = await voiceKey(io({ where: async () => ({ here: false, set: true, name: "" }) }));
  expect(unlinked.why).toBe("unreachable");
});

test("it truly has none: the key help, naming it", async () => {
  const r = await voiceKey(io({ where: async () => ({ here: false, set: true, name: "mac-mini" }), ask: async () => '{"key":"","agent":""}' }));
  expect(r).toEqual({ error: noKeyOn("mac-mini"), why: "none" });
});

// SHEP-33: no machine named to keep them yet (before the services' automatic pick reaches here)
test("none named, the key on a linked machine: found there, no setup", async () => {
  const x = io({ where: async () => ({ here: false, set: false, name: "" }), machines: async () => ["vm-a", "laptop"],
    ask: async (name) => { x.asked.push(name); return name === "laptop" ? JSON.stringify({ key: KEY, agent: "agent_9" }) : '{"key":"","agent":""}'; } });
  expect(await voiceKey(x)).toEqual({ key: KEY, agent: "agent_9", from: "laptop" });
  expect(x.asked).toEqual(["vm-a", "laptop"]);
});

test("none named, a key in this machine's own vault: used, nothing asked", async () => {
  const x = io({ where: async () => ({ here: false, set: false, name: "" }), vault: () => vault([{ name: "ELEVENLABS_API_KEY", scope: "everywhere", value: KEY }]), machines: async () => ["laptop"] });
  expect(await voiceKey(x)).toEqual({ key: KEY, from: "here" });
  expect(x.asked).toEqual([]);
});

test("none named and no key anywhere reachable: the one clear error", async () => {
  const x = io({ where: async () => ({ here: false, set: false, name: "" }), machines: async () => ["laptop", "off"],
    ask: async (name) => { x.asked.push(name); return name === "off" ? null : '{"key":"","agent":""}'; } });
  const r = await voiceKey(x);
  expect(r).toEqual({ error: NO_KEY, why: "none" });
  expect(r.error).toStartWith("Voice calls need an ElevenLabs key: add it in Settings › Secrets");
  expect(x.asked).toEqual(["laptop", "off"]);
});

test("KEY_SCRIPT on the machine that keeps them: the vault's key, the agent only when made with it", () => {
  const home = mkdtempSync(join(tmpdir(), "shep-voice-key-"));
  const run = () => {
    const p = Bun.spawnSync(["python3", "-c", KEY_SCRIPT], { env: { PATH: process.env.PATH ?? "", HOME: home }, stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    return JSON.parse(p.stdout.toString());
  };
  try {
    expect(run()).toEqual({ key: "", agent: "" });
    mkdirSync(join(home, ".herdr"));
    mkdirSync(join(home, ".config", "herdr-app", "secrets"), { recursive: true });
    writeFileSync(join(home, ".herdr", "vault.json"), vault([{ name: "ELEVENLABS_API_KEY", scope: "everywhere", value: KEY }]));
    const agent = join(home, ".config", "herdr-app", "secrets", "elevenlabs-agent.env");
    writeFileSync(agent, "ELEVENLABS_AGENT_ID=agent_old\nELEVENLABS_KEY_TAG=0000000000000000\n");
    expect(run()).toEqual({ key: KEY, agent: "" });
    const tag = createHash("sha256").update(KEY).digest("hex").slice(0, 16);
    writeFileSync(agent, `ELEVENLABS_AGENT_ID=agent_123\nELEVENLABS_KEY_TAG=${tag}\n`);
    expect(run()).toEqual({ key: KEY, agent: "agent_123" });
    // the old file there, when the vault has none
    writeFileSync(join(home, ".herdr", "vault.json"), vault([]));
    writeFileSync(join(home, ".config", "herdr-app", "secrets", "elevenlabs.env"), `export ELEVENLABS_API_KEY="${KEY}"\n`);
    expect(run().key).toBe(KEY);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("which machine keeps them: its own record, or a newer one from that machine", () => {
  const m3 = { id: "m3", at: 100 }, mini = { id: "mini", at: 200 };
  // none of its own: the newest it's handed (a VM nothing reaches into learns it from whoever reaches it)
  expect(believeRecord(null, { m3, mini })).toEqual(mini);
  expect(believeRecord(null, {})).toBe(null);
  expect(believeRecord(m3, {})).toEqual(m3);
  // m3 handed it to the mini: a machine that still names m3 follows m3's newer record
  expect(believeRecord(m3, { m3: mini })).toEqual(mini);
  // a record from any other machine doesn't count (a VM can't name itself)
  expect(believeRecord(m3, { vm: { id: "vm", at: 999 } })).toEqual(m3);
  expect(secretsRecord({ id: "x", at: Date.now() + 3_600_000 })).toBe(null);
});

// SHEP-33: nobody named a machine to keep the secrets: every machine names the same one, where they are now, and the
// machine serving the web app ("server" here, an example) then moves them to itself
test("autoKeeper: the machine whose vault has secrets", () => {
  expect(autoKeeper([{ id: "server", count: 0 }, { id: "laptop", count: 4 }, { id: "vm", count: null }], "server")).toEqual({ id: "laptop" });
  // a vault on a machine marked remote (left behind) doesn't count
  expect(autoKeeper([{ id: "server", count: 2, remote: true }, { id: "laptop", count: 4 }], "server")).toEqual({ id: "laptop" });
});

test("autoKeeper: several have secrets: the most that isn't serving the web app (moving there merges both), else the lowest id", () => {
  expect(autoKeeper([{ id: "laptop", count: 1 }, { id: "server", count: 9 }], "server")).toEqual({ id: "laptop" });
  expect(autoKeeper([{ id: "laptop", count: 9 }, { id: "desk", count: 1 }], null)).toEqual({ id: "laptop" });
  expect(autoKeeper([{ id: "b", count: 3 }, { id: "a", count: 3 }], "c")).toEqual({ id: "a" });
  expect(autoKeeper([{ id: "server", count: 3 }], "server")).toEqual({ id: "server" });
});

test("autoKeeper: none has secrets: the web app's machine, but only once every machine answered", () => {
  expect(autoKeeper([{ id: "laptop", count: 0 }, { id: "server", count: 0 }], "server")).toEqual({ id: "server" });
  // a sleeping laptop may hold them: wait for it
  expect(autoKeeper([{ id: "laptop", count: null }, { id: "server", count: 0 }], "server")).toBe(null);
  // nothing serves the web app: nothing to name (each machine keeps its own, as before)
  expect(autoKeeper([{ id: "laptop", count: 0 }], null)).toBe(null);
  // #800: every machine marked remote, no vault anywhere, nothing serving: one is named, or none ever could keep one
  expect(autoKeeper([{ id: "m2", count: 0, remote: true }, { id: "m1", count: 0, remote: true }], null)).toEqual({ id: "m1" });
  expect(autoKeeper([{ id: "m2", count: 0, remote: true }, { id: "m1", count: 0, remote: false }], null)).toBe(null);
  expect(autoKeeper([{ id: "m2", count: 0, remote: true }, { id: "m1", count: null, remote: true }], null)).toBe(null);
});

test("followTo: only the machine serving the web app moves them, only when they follow it and are elsewhere", () => {
  const now = Date.now();
  expect(followTo({ id: "laptop", at: now, auto: true }, "server", "server")).toBe("server");
  expect(followTo({ id: "laptop", at: now, auto: true }, "server", "laptop")).toBe(null);
  expect(followTo({ id: "server", at: now, auto: true }, "server", "server")).toBe(null);
  // the person picked the laptop: it stays
  expect(followTo({ id: "laptop", at: now }, "server", "server")).toBe(null);
  expect(followTo({ id: "laptop", at: now, auto: true }, null, "server")).toBe(null);
});

test("an automatic record keeps its mark", () => {
  const now = Date.now();
  expect(secretsRecord({ id: "laptop", at: now, by: "server", auto: true })).toEqual({ id: "laptop", at: now, by: "server", auto: true });
  expect(secretsRecord({ id: "laptop", at: now, auto: "yes" })).toEqual({ id: "laptop", at: now });
});

test("COUNT_SCRIPT: how many secrets a vault has, never a value", () => {
  const home = mkdtempSync(join(tmpdir(), "shep-count-"));
  const run = () => JSON.parse(Bun.spawnSync(["python3", "-c", COUNT_SCRIPT], { env: { PATH: process.env.PATH ?? "", HOME: home }, stdout: "pipe" }).stdout.toString());
  try {
    expect(run()).toEqual({ count: 0, remote: false });
    mkdirSync(join(home, ".herdr"));
    writeFileSync(join(home, ".herdr", "vault.json"), vault([{ name: "A", scope: "everywhere", value: KEY }, { name: "B", scope: "everywhere", value: "x" }]));
    writeFileSync(join(home, ".herdr", "secret-remote"), "");
    const out = Bun.spawnSync(["python3", "-c", COUNT_SCRIPT], { env: { PATH: process.env.PATH ?? "", HOME: home }, stdout: "pipe" }).stdout.toString();
    expect(JSON.parse(out)).toEqual({ count: 2, remote: true });
    expect(out).not.toContain(KEY);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
