// The ElevenLabs key for a voice call (core/voice.js voiceKey): the old file here, the vault here, or the machine that
// keeps the secrets (read into memory only); and the words when that machine has none or can't be reached. KEY_SCRIPT
// runs for real with python3 on a throwaway home, as it runs on the machine that keeps them.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { voiceKey, KEY_SCRIPT, NO_KEY, NO_MAIN, noKeyOn, unreachable } from "./voice.js";
import { believeRecord, secretsRecord } from "./secrets.js";

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

test("marked remote with no machine named: says to pick one", async () => {
  expect(await voiceKey(io({ where: async () => ({ here: false, set: false, name: "" }) }))).toEqual({ error: NO_MAIN, why: "unnamed" });
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
  expect(believeRecord(null, { mini })).toBe(null);
  expect(believeRecord(m3, {})).toEqual(m3);
  // m3 handed it to the mini: a machine that still names m3 follows m3's newer record
  expect(believeRecord(m3, { m3: mini })).toEqual(mini);
  // a record from any other machine doesn't count (a VM can't name itself)
  expect(believeRecord(m3, { vm: { id: "vm", at: 999 } })).toEqual(m3);
  expect(secretsRecord({ id: "x", at: Date.now() + 3_600_000 })).toBe(null);
});
