// SHEP-110: a voice call sees everything the UI shows. The guard: every data source the web app reads (its snapshot's
// every part, each api/ path it fetches, each action it reads with) is reachable by the voice tools' look data, or
// listed in NOT_DATA / WRITES with why. A new panel that reads something new fails here until voice can read it too.
// Fake data only.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { voiceTool, planWords, type VoiceIO, type Where } from "./voice-tools.ts";
import { SOURCES, NOT_DATA, WRITES, scrub, insightsSummary } from "./voice-data.ts";
import { LOOKS, TOOLS, prompt } from "../core/voice.js";

const ROOT = join(import.meta.dir, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const WEB = [...files(join(ROOT, "web/src")), ...files(join(ROOT, "web/plugins"))].map((f) => readFileSync(f, "utf8")).join("\n");
const served = new Set(Object.values(SOURCES).flatMap((s) => s.serves));

test("every api/ path the web app fetches is a voice data source, or not data with why", () => {
  const paths = new Set([...WEB.matchAll(/['`"]api\/([a-z][\w-]*)/g)].map((m) => `api:${m[1]}`));
  expect(paths.size).toBeGreaterThan(10);
  const missing = [...paths].filter((p) => !served.has(p) && !NOT_DATA[p]);
  expect(missing).toEqual([]);
});

test("every action the web app sends is a voice data source (a read) or a change (WRITES)", () => {
  const types = readFileSync(join(ROOT, "web/shared/types.ts"), "utf8");
  const union = types.slice(types.indexOf("export type Action ="), types.indexOf("\n\n", types.indexOf("export type Action =")));
  const sent = new Set([...[...union.matchAll(/type: '([a-z.-]+)'/g)].map((m) => m[1]), ...[...WEB.matchAll(/act\(\{\s*type:\s*'([a-z.-]+)'/g)].map((m) => m[1])]);
  expect(sent.size).toBeGreaterThan(30);
  const missing = [...sent].filter((t) => !served.has(`action:${t}`) && !NOT_DATA[`action:${t}`] && !WRITES.includes(t));
  expect(missing).toEqual([]);
  // a read is never also filed as only a change
  for (const s of served) if (s.startsWith("action:")) expect(sent.has(s.slice(7)) || s === "action:usage").toBe(true);
});

const now = Date.now();
const snap: any = {
  host: "vm", name: "Shepherdr", user: "You",
  machines: [
    { id: "m:vm", machine: "vm", name: "This computer", status: "idle", here: true, stats: { at: now, health: { cpu: 12, memory: 40, disk: 50 }, limits: {
      codex: { state: "ok", at: now - 60_000, plan: "pro", windows: [{ name: "5-hour", used: 37, resets_at: now + 2 * 3600_000 }, { name: "Weekly", used: 81, resets_at: now + 3 * 86400_000 }] },
      claude: { state: "signed-out", at: now - 60_000 } } } },
    { id: "m:mini", machine: "mini", name: "Mac mini", status: "idle" },
  ],
  places: [{ id: "sp1", name: "demo", machine: "vm", chat: "p:sp1", mode: "regular", level: 2, status: "idle" }],
  tasks: [{ id: "DEMO-7", name: "Make the widget blue", status: "ready", place: "sp1", summary: "The widget is blue", at: now, age: "", state: "", on: "", created: "" }],
  needs: [], automations: {}, artifacts: [{ id: "a9", title: "DEMO-7 · Proof", place: "sp1", v: 1, at: now }], asks: {},
  settings: [
    { name: "Window", level: "all", rows: [{ label: "Usage insights", key: "addon.insights", value: "on", options: ["on", "off"] }] },
    { name: "Secrets", level: "all", rows: [], vault: [{ name: "DEMO_API_KEY", scope: "everywhere", where: "Everywhere" }] },
    { name: "Voice", level: "all", rows: [{ label: "Token", key: "voice.token", value: "sk-demo0000000000000000fake", token: "abc123fake" }] },
  ],
};
const web: Where = { client: "web", device: "phone", place: "sp1", task: "DEMO-7" };
function io(over: Partial<VoiceIO> = {}) {
  const reads: any[] = [];
  const x: VoiceIO & { reads: any[] } = {
    reads,
    snap: () => snap, chat: async () => null, send: async () => {}, action: async () => ({ ok: true }),
    read: async (source, args) => { reads.push({ source, args }); return { source, files: [{ path: "src/widget.ts", status: "modified", add: 3, del: 1 }], api_key: "real-looking-secret" }; },
    ...over,
  };
  return x;
}

test("look data's top lists every part of the snapshot (every key the Snapshot type has) and every source", async () => {
  const types = readFileSync(join(ROOT, "web/shared/types.ts"), "utf8");
  const body = types.slice(types.indexOf("export interface Snapshot {"), types.indexOf("\n}", types.indexOf("export interface Snapshot {")));
  const keys = [...body.matchAll(/^  (\w+)\??:/gm)].map((m) => m[1]);
  expect(keys).toContain("machines");
  const full = { ...snap, ...Object.fromEntries(keys.filter((k) => !(k in snap)).map((k) => [k, { fake: 1 }])) };
  const a = await voiceTool("look", { what: "data" }, web, io({ snap: () => full }));
  for (const k of keys) expect(a.result).toContain(`\n${k}:`);
  for (const s of Object.keys(SOURCES)) expect(a.result).toContain(`\n${s}`);
});

test("Codex usage: look machines says the plan's numbers, look data finds and drills into them", async () => {
  const m = await voiceTool("look", { what: "machines" }, web, io());
  expect(m.result).toContain("Codex (pro) plan: 5-hour 63% left · 37% used");
  expect(m.result).toContain("Weekly 19% left");
  expect(m.result).toContain("Claude Code: Not signed in");
  const q = await voiceTool("look", { what: "data", query: "codex" }, web, io());
  expect(q.result).toContain("machines/m:vm/stats/limits/codex/windows/5-hour/used: 37");
  const d = await voiceTool("look", { what: "data", path: "machines/this computer/stats/limits/codex/windows" }, web, io());
  expect(d.error).toBeUndefined();
  expect(d.result).toContain("[5-hour] used: 37; resets_at: in 2 hours");
  const bad = await voiceTool("look", { what: "data", path: "machines/vm/nothing" }, web, io());
  expect(bad.error).toBe(true);
  expect(bad.result).toContain("It has:");
  expect(planWords(snap.machines[0].stats)).toContain("Health:");
});

test("secrets never: names yes, values and secret-looking keys hidden", async () => {
  const s = await voiceTool("look", { what: "data", path: "settings/voice/rows/token" }, web, io());
  expect(s.result).not.toContain("sk-demo");
  expect(s.result).not.toContain("abc123fake");
  expect(s.result).toContain("hidden");
  const q = await voiceTool("look", { what: "data", query: "demo api key" }, web, io());
  expect(q.result).toContain("DEMO_API_KEY");
  const all = JSON.stringify(scrub(snap));
  expect(all).not.toContain("sk-demo");
  expect(all).not.toContain("abc123fake");
  const r = await voiceTool("look", { what: "data", path: "changes", id: "DEMO-7" }, web, io());
  expect(r.result).not.toContain("real-looking-secret");
});

test("a panel's own data: the source is read for the task meant, and drilled into", async () => {
  const x = io();
  const r = await voiceTool("look", { what: "data", path: "changes/files", id: "this" }, web, x);
  expect(x.reads).toEqual([{ source: "changes", args: { task: "DEMO-7" } }]);
  expect(r.result).toContain("[src/widget.ts] status: \"modified\"; add: 3; del: 1");
  const f = await voiceTool("look", { what: "data", path: "file/src/widget.ts", id: "demo" }, web, x);
  expect(x.reads[1]).toEqual({ source: "file", args: { place: "sp1", path: "src/widget.ts" } });
  expect(f.error).toBeUndefined();
  await voiceTool("look", { what: "data", path: "insights" }, web, x);
  expect(x.reads[2]).toEqual({ source: "insights", args: {} });
  const art = await voiceTool("look", { what: "data", path: "artifact", id: "proof" }, web, x);
  expect(x.reads[3]).toEqual({ source: "artifact", args: { artifact: "a9", v: 1, machine: null } });
  expect(art.error).toBeUndefined();
  const failed = await voiceTool("look", { what: "data", path: "pr" }, web, io({ read: async () => { throw new Error("GitHub didn't answer."); } }));
  expect(failed).toEqual({ result: "GitHub didn't answer.", error: true });
});

test("usage insights, summed up: kinds, time on screens, actions, asks", () => {
  const ev = [
    { kind: "view", view: "task", tab: "chat", ms: 120_000, at: now - 1000, from: "web" },
    { kind: "view", view: "task", tab: "chat", ms: 60_000, at: now - 900, from: "phone" },
    { kind: "act", type: "accept", at: now - 800, from: "web" },
    { kind: "feature", type: "voice-call", at: now - 700 },
    { kind: "ask", type: "permission", ms: 240_000, at: now - 600 },
    { kind: "act", type: "accept", at: now - 40 * 86400_000 },
  ].map((e) => JSON.stringify(e));
  const s = insightsSummary([...ev, "not json"], true, 30, now);
  expect(s.events).toBe(5);
  expect(s.time_on_screens).toEqual({ "task chat": "3 min" });
  expect(s.actions).toEqual({ accept: 1 });
  expect(s.asks.median_wait).toBe("4 min");
  expect(s.from).toEqual({ web: 2, phone: 1, unknown: 2 });
});

test("the call's agent knows: data is a look, with a path, and the prompt says it sees everything the app shows", () => {
  expect(LOOKS).toContain("data");
  const look = TOOLS.find((t: any) => t.name === "look") as any;
  expect(look.parameters.properties.path).toBeTruthy();
  expect(prompt()).toContain("look data sees everything the app shows");
});
