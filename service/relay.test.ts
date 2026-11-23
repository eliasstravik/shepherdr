// SHEP-368: every message between agents shows in both chats, the sender's and the receiver's, as one quiet row
// (Message.relay) where it happened: "Message to #root on vm", "Message from Everything on Mac", "Message to Fix login",
// with whether it got there; the call that only sent it is not also a "Ran a command" row.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import * as CL from "../core/chat-log.js";
const { LOG, Conversation, records } = CL as any;

const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 9, 0, s)).toISOString();
const user = (id: string, content: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at(s) });
const calls = (id: string, cmds: [string, string][], s: number) => ({ parentUuid: null, isSidechain: false, type: "assistant", uuid: id, timestamp: at(s),
  message: { model: "claude-opus-5-5", id: `m${id}`, type: "message", role: "assistant", content: cmds.map(([cid, command]) => ({ type: "tool_use", id: cid, name: "Bash", input: { command } })), stop_reason: "tool_use" } });
const result = (cid: string, content: string, s: number, is_error = false) => ({ parentUuid: null, isSidechain: false, type: "user",
  message: { role: "user", content: [{ tool_use_id: cid, type: "tool_result", content, ...(is_error ? { is_error: true } : {}) }] }, uuid: `r${cid}`, timestamp: at(s) });

async function conv(lines: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}

function compat() {
  const c = new Compat() as any;
  c.rows = [{ ref: "SHOP-4", title: "Fix login", key: "shop#4", slug: "shop", id: 4, machine: null, section: "working", worker: "t9", folder: "/work/shop", space: "local/shop" },
    { ref: "SHOP-5", title: "Faster search", key: "shop#5", slug: "shop", id: 5, machine: null, section: "ready", worker: null, folder: "/work/shop", space: "local/shop" }];
  c.machineNames = new Map([["mac", "Mac"]]);
  const terms: Record<string, any> = { t2: { name: "assistant-shop", labels: { "herdr.role": "coordinator" } }, t9: { name: "shop-4-fix-login", labels: { "herdr.task": "shop#4" } } };
  c.terminalsOf = (a: string) => terms[a] ?? null;
  c.chats.set("p:local:shop", "t2");
  c.chats.set("SHOP-4/worker", "t9");
  return c;
}
const assistant = { state: "live", labels: { "herdr.role": "coordinator" }, status: { state: "idle" } };
const worker = { state: "live", labels: { "herdr.task": "shop#4" }, status: { state: "working" } };
const relays = (chat: any) => chat.messages.filter((m: any) => m.relay).map((m: any) => ({ who: m.who, ...m.relay, text: m.text }));

test("the sender's chat: each send is one row, to whom, with whether it got there; a send-only call is no command row", async () => {
  const c = await conv([
    user("p1", "Tell the vm, nudge the login task, and fix search", 0),
    calls("a1", [["c0", "git status"], ["c1", "herdr-task tell-assistant vm/root 'Disk is nearly full'"], ["c2", 'herdr-task reply 4 --folder /work/shop "Keep the total above the fold"']], 1),
    result("c0", "clean", 2), result("c1", "Delivered to vm/t3 (root).", 2), result("c2", "Fix login: sent to t9.", 2),
    calls("a2", [["c3", "herdr-task tell-assistant Everything 'Login is nearly done'"], ["c4", 'herdr-task fix 5 --reason "lint fails"']], 3),
    result("c3", "Not delivered yet, held for t1: the person is writing to it; it goes once they've sent or cleared that.", 4),
    result("c4", "herdr-task: Faster search has no agent at work", 4, true),
  ]);
  const chat = compat().chat("p:local:shop", { conv: c, start: 0, machine: null, addr: "t2", kind: "claude" }, assistant);
  expect(relays(chat)).toEqual([
    { who: "agent", dir: "to", name: "#root on vm", how: "assistant", state: "delivered", text: "Disk is nearly full" },
    { who: "agent", dir: "to", name: "Fix login", how: "reply", state: "delivered", text: "Keep the total above the fold" },
    { who: "agent", dir: "to", name: "Everything", how: "assistant", state: "waiting", why: "the person is writing to it", text: "Login is nearly done" },
    { who: "agent", dir: "to", name: "Faster search", how: "fix", state: "failed", why: "Faster search has no agent at work", text: "lint fails" },
  ]);
  // never said twice: the first turn's row lists git status alone; the second turn's calls only sent, so no row
  const rows = chat.messages.filter((m: any) => m.activity);
  expect(rows.map((m: any) => m.activity.rows.map((r: any) => r.text))).toEqual([["Ran git status"]]);
  expect(rows[0].activity.summary).toBe("Ran a command");
});

test("the receiver's chat: another Assistant's message and a task agent's, each a row naming who sent it", async () => {
  const c = await conv([
    user("u1", '<herdr-assistant from="mac/t1" machine="mac" space="Everything" can-reply="yes">Check the login task, please.</herdr-assistant>', 0),
    user("u2", '<hc from="t9 shop-4-fix-login">Done: login works on phones too.</hc>', 1),
  ]);
  const chat = compat().chat("p:local:shop", { conv: c, start: 0, machine: null, addr: "t2", kind: "claude" }, assistant);
  expect(relays(chat)).toEqual([
    { who: "you", dir: "from", name: "Everything on Mac", text: "Check the login task, please." },
    { who: "you", dir: "from", name: "Fix login", text: "Done: login works on phones too." },
  ]);
});

test("a task's chat: its Assistant's message is a row there too, and what it sends back", async () => {
  const c = await conv([
    user("u1", '<hc from="t2 assistant-shop">Keep the total above the fold.</hc>', 0),
    calls("a1", [["c1", 'hc send t2 "Done: it stays above the fold."']], 1),
    result("c1", "", 2),
  ]);
  const chat = compat().chat("SHOP-4/worker", { conv: c, start: 1, machine: null, addr: "t9", kind: "claude" }, worker);
  expect(relays(chat)).toEqual([
    { who: "you", dir: "from", name: "Assistant", text: "Keep the total above the fold." },
    { who: "agent", dir: "to", name: "Assistant", how: "hc", state: "delivered", text: "Done: it stays above the fold." },
  ]);
  expect(chat.messages.some((m: any) => m.activity)).toBe(false);
});
