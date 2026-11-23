// SHEP-415: a task replied to in the space's chat, as to a message (its row's Reply in chat, or a slide on it). What
// the Assistant gets is the person's words under the task's tag line (title, state, folder), so "status?" is about it,
// and the chat shows the quoted task above the sent message. Fake data.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quoteOf } from "./actions.ts";
import { Compat } from "./compat.ts";
import { messageBody } from "../core/send.js";
import { Conversation, LOG, records } from "../core/chat-log.js";

const login = { ref: "SHOP-2", id: 2, title: "Fix login", status_text: "Working", why: "", folder: "/srv/shop", prompt: "Make sign-in work", state: "working" };
const other = { ref: "SHOP-3", id: 3, title: "Dark mode", status_text: "Ready", why: "", folder: "/srv/shop", prompt: "Add a dark theme", state: "ready" };
const fake = (tasks: any[]) => ({ replyTaskOf: (id: string) => (id === "vm:SHOP-2" ? login : null), tasksFor: () => tasks }) as any;

test("a reply to a task carries its tag line first and names it on the reply tag", () => {
  const q = quoteOf({ type: "send", chat: "p:sp1", text: "status?", replyTask: "vm:SHOP-2" }, fake([login, other]), null);
  expect(q.quote).toBe("Fix login");
  expect(q.quoteTask).toBe("vm:SHOP-2");
  expect(q.tags).toBe('<hc task="SHOP-2" title="Fix login" state="Working" folder="/srv/shop">Make sign-in work</hc>\n');
  const body = messageBody({ text: "status?", quote: q.quote, tags: q.tags, task: q.quoteTask });
  expect(body.split("\n")).toEqual(['<hc reply-to="Fix login" task="vm:SHOP-2"/>', '<hc task="SHOP-2" title="Fix login" state="Working" folder="/srv/shop">Make sign-in work</hc>', "status?"]);
});

test("the replied task named in the words too gets one tag line; other mentions keep theirs", () => {
  const q = quoteOf({ chat: "p:sp1", text: "is Fix login waiting on Dark mode?", replyTask: "vm:SHOP-2" }, fake([login, other]), null);
  expect(q.tags.match(/<hc task="SHOP-2"/g)?.length).toBe(1);
  expect(q.tags).toContain('<hc task="SHOP-3"');
  expect(q.tags.indexOf("SHOP-2")).toBeLessThan(q.tags.indexOf("SHOP-3"));
});

test("a plain reply to a message is as before; a task that is gone quotes nothing", () => {
  const r = { conv: { items: [{ id: "m1", text: "The build is green" }] } };
  expect(quoteOf({ chat: "p:sp1", text: "great", reply: "m1" }, fake([]), r)).toEqual({ quote: "The build is green", tags: "", quoteTask: null });
  expect(quoteOf({ chat: "p:sp1", text: "status?", replyTask: "vm:GONE-1" }, fake([]), r)).toEqual({ quote: null, tags: "", quoteTask: null });
  expect(messageBody({ text: "great", quote: "The build is green" })).toBe('<hc reply-to="The build is green"/>\ngreat');
});

test("a task is found by its id on any machine, as its tag line wants it", () => {
  const c = new Compat() as any;
  c.rows = [{ ref: "SHOP-2", id: 2, machine: "vm", title: "Fix login", sub: "Working", section: "working", folder: "/srv/shop", prompt: "p" }];
  expect(c.replyTaskOf("vm:SHOP-2")).toMatchObject({ ref: "SHOP-2", title: "Fix login", status_text: "Working", folder: "/srv/shop" });
  expect(c.replyTaskOf("SHOP-2")).toBeNull();
});

test("the log gives the sent message back with its task, not its tag lines", async () => {
  const body = messageBody({ text: "status?", quote: "Fix login", tags: '<hc task="SHOP-2" title="Fix login" state="Working" folder="/srv/shop">p</hc>\n', task: "vm:SHOP-2" });
  const dir = mkdtempSync(join(tmpdir(), "reply-task-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: body }, uuid: "p1", timestamp: "2026-11-23T10:00:00.000Z" }) + "\n");
  const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  rmSync(join(dir, "log.jsonl"));
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  const u = c.items.find((x: any) => x.kind === "user");
  expect(u).toMatchObject({ text: "status?", replyTo: "Fix login", replyTask: "vm:SHOP-2" });
});
