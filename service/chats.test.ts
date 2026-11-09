import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "./hub.ts";
import { Chats } from "./chats.ts";

// A throwaway home with one Claude session: the agent with pid 4242 writes to its log.
const home = mkdtempSync(join(tmpdir(), "chats-test-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
mkdirSync(join(home, ".claude", "sessions"), { recursive: true });
mkdirSync(join(home, ".claude", "projects", "-work-demo"), { recursive: true });
writeFileSync(join(home, ".claude", "sessions", "4242.json"), JSON.stringify({ pid: 4242, sessionId: "0000aaaa-1111-2222-3333-444455556666" }));
const log = join(home, ".claude", "projects", "-work-demo", "0000aaaa-1111-2222-3333-444455556666.jsonl");
writeFileSync(log, JSON.stringify({ type: "user", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello there" } }) + "\n");

// The hub as herdr-core feeds it, its machine.exec run here in that home.
function hub() {
  const h = new Hub("hc");
  (h as any).client = {
    call: async (method: string, p: any) => {
      if (method !== "machine.exec") throw new Error(`no ${method} here`);
      const r = Bun.spawnSync(p.argv, { env: { PATH: process.env.PATH!, HOME: home } });
      const b64 = (b: Buffer) => b.toString("base64");
      return { code: r.exitCode, stdout: b64(r.stdout), stderr: b64(r.stderr) };
    },
    attach: async () => ({ close() {} }),
  };
  return h;
}
const feed = (h: Hub, type: string, terminal: string, data: any) =>
  (h as any).event({ jsonrpc: "2.0", method: "event", params: { seq: 1, type, terminal, data } });

test("a terminal's new program reaches its record (the core's foreground event)", () => {
  const h = hub();
  feed(h, "restarted", "t7", { address: "t7", state: "live", argv: ["bash"], cwd: "/work/demo", labels: {}, foreground: null });
  feed(h, "foreground", "t7", { name: "claude", pid: 4242, argv: ["claude"], cwd: "/work/demo" });
  expect((h.terminals.get("t7") as any).foreground).toEqual({ name: "claude", pid: 4242, argv: ["claude"], cwd: "/work/demo" });
});

// SHEP-87: an Assistant relaunched in its terminal showed "not a chat agent" until the service restarted.
test("a followed chat finds the log of an agent that starts in its terminal later", async () => {
  const h = hub();
  feed(h, "restarted", "t7", { address: "t7", state: "live", argv: ["bash"], cwd: "/work/demo", labels: {}, foreground: { name: "bash", pid: 4000, argv: ["bash"], cwd: "/work/demo" } });
  const chats = new Chats(h);
  const seen: string[] = [];
  chats.watch("t7", (r) => seen.push(String(r.state)));
  await Bun.sleep(300);
  expect(chats.reader("t7")!.state).toBe("none");
  feed(h, "foreground", "t7", { name: "claude", pid: 4242, argv: ["claude"], cwd: "/work/demo" });
  for (let i = 0; i < 30 && chats.reader("t7")!.state !== "ready"; i++) await Bun.sleep(100);
  const r = chats.reader("t7")!;
  expect(r.state).toBe("ready");
  expect(r.path).toBe(log);
  expect(seen.at(-1)).toBe("ready");
});

// SHEP-90: a task's worker restarted in a new terminal (t1y's sh ended, t1z runs the agent): its followed chat stayed
// on the old terminal ("Can't find this conversation") until the service restarted, as the page sends the same key.
test("a followed task chat moves to its worker's new terminal by itself", async () => {
  const { Live } = await import("./live.ts");
  const h = hub();
  feed(h, "restarted", "t1y", { address: "t1y", state: "live", argv: ["sh"], cwd: "/work/demo", labels: {}, foreground: { name: "sh", pid: 4001, argv: ["sh"], cwd: "/work/demo" } });
  const map = new Map([["DEMO-1/worker", "t1y"]]);
  const live = new Live(h, { on() {}, load: async () => ({}) } as any, () => null, "test");
  live.chats = new Chats(h);
  live.compat = { addrOf: (k: string) => map.get(k) ?? null, chat: (k: string, r: any) => ({ key: k, state: r.state, path: r.path ?? null }) } as any;
  const got: any[] = [];
  const ws: any = { data: { who: "demo" }, readyState: 1, getBufferedAmount: () => 0, send: (t: string) => { const m = JSON.parse(t); if (m.type === "chat") got.push(m.chat); } };
  live.join(ws);
  live.message(ws, JSON.stringify({ type: "watch", chats: ["DEMO-1/worker"], visible: true }));
  for (let i = 0; i < 30 && !got.length; i++) await Bun.sleep(100);
  expect(got.at(-1)?.state).toBe("none");
  // herdr-task restarts the worker as a new terminal running the agent; the next snapshot maps the key there
  feed(h, "lost", "t1y", { state: "ended" });
  feed(h, "restarted", "t1z", { address: "t1z", state: "live", argv: ["claude"], cwd: "/work/demo", labels: {}, foreground: { name: "claude", pid: 4242, argv: ["claude"], cwd: "/work/demo" } });
  map.set("DEMO-1/worker", "t1z");
  live.setSnapshot({ tasks: [{ id: "DEMO-1" }] });
  for (let i = 0; i < 30 && got.at(-1)?.state !== "ready"; i++) await Bun.sleep(100);
  expect(got.at(-1)).toEqual({ key: "DEMO-1/worker", state: "ready", path: log });
  expect(live.watched()).toEqual(["t1z"]);
});

// #748: herdr-core's live list can have no foreground for this machine's own terminals: hc get has it.
test("a local agent's chat is found when the live list lacks its foreground", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chats-hc-"));
  const fake = join(dir, "hc");
  writeFileSync(fake, `#!/bin/sh\necho '{"foreground":{"name":"claude","pid":4242,"argv":["claude"],"cwd":"/work/demo"}}'\n`, { mode: 0o755 });
  const was = process.env.SHEPHERDR_HC;
  process.env.SHEPHERDR_HC = fake;
  try {
    const h = hub();
    feed(h, "restarted", "t5", { address: "t5", state: "live", argv: ["claude"], cwd: "/work/demo", labels: {}, foreground: null });
    const chats = new Chats(h);
    chats.watch("t5", () => {});
    for (let i = 0; i < 30 && chats.reader("t5")!.state !== "ready"; i++) await Bun.sleep(100);
    expect(chats.reader("t5")!.state).toBe("ready");
    expect(chats.reader("t5")!.path).toBe(log);
  } finally {
    if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was;
    rmSync(dir, { recursive: true, force: true });
  }
});
