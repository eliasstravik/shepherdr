// SHEP-330: a task's page is never blank. Its brief is its chat's first message from the moment the task exists:
// waiting while no agent runs, sent once its agent started, read once its agent's log has it; the prompt as the
// Assistant wrote it (whole, not the row's first 500 characters), its Settings block's lines apart.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import * as CL from "../core/chat-log.js";
const { LOG, Conversation, records } = CL as any;

const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 9, 0, s)).toISOString();
const user = (id: string, content: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at(s) });
const said = (id: string, words: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "assistant", uuid: id, timestamp: at(s),
  message: { model: "claude-opus-5-5", id: `m${id}`, type: "message", role: "assistant", content: [{ type: "text", text: words }], stop_reason: "end_turn" } });

async function conv(lines: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "task-brief-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}

const LONG = `Make the card bigger.\n\nDo:\n${Array.from({ length: 40 }, (_, i) => `- step ${i + 1} of the work, said in plain words`).join("\n")}`;
const LAUNCH = [
  "You work on one Herdr task. Stay within the task's scope and folder.\n- Commit as you go.",
  `Your task, SHOP-3:\n${LONG}`,
  "You work in /work/shop on branch task/3-bigger-card, from main, which it merges into.",
  "When the work is finished and committed, run `herdr-task ready SHOP-3 --folder /work/shop --summary \"…\"`.",
  "Settings: (from herdr-task show; where the brief above says otherwise, it wins)\n- Review: off\n- Merge: after checks: Herdr merges it when its checks pass",
].join("\n\n");

function compat(section = "working", worker: string | null = "t9") {
  const c = new Compat() as any;
  c.rows = [{ ref: "SHOP-3", title: "Bigger card", key: "shop#3", slug: "shop", id: 3, prompt: LONG.slice(0, 500), machine: null, section, worker, folder: "/work/shop" }];
  c.promptOf = (k: string) => (k === "shop#3" ? LONG : null);
  return c;
}
const term = { state: "live", labels: { "herdr.task": "shop#3" }, status: { state: "working" } };

test("its agent took the brief in: the first message is the brief, read, with the whole prompt and its Settings", async () => {
  const c = await conv([user("b1", LAUNCH, 0), said("a1", "Starting on the card.", 1)]);
  const chat = compat().chat("SHOP-3/worker", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, term);
  const first = chat.messages[0];
  expect(first.taskBrief).toEqual({ title: "Bigger card", text: LONG, settings: ["Review: off", "Merge: after checks: Herdr merges it when its checks pass"], from: "Assistant", state: "read" });
  // no quiet "Task brief" row as well, and the agent's words after it
  expect(chat.messages.filter((m: any) => m.brief)).toEqual([]);
  expect(chat.messages[1]).toMatchObject({ who: "agent", text: "Starting on the card." });
});

test("its agent started but its log has nothing yet: the brief, sent", () => {
  const chat = compat().chat("SHOP-3/worker", { conv: new Conversation("claude"), start: 0, machine: null, addr: "t9", kind: "claude", state: "pending" }, term);
  expect(chat.messages.map((m: any) => m.taskBrief?.state)).toEqual(["sent"]);
  expect(chat.messages[0].taskBrief.text).toBe(LONG);
});

test("its log not found yet (no conversation read): the brief, sent", () => {
  const chat = compat().chat("SHOP-3/worker", { conv: null, start: null, machine: null, addr: "t9", kind: null, state: "finding" }, term);
  expect(chat.messages.map((m: any) => m.taskBrief?.state)).toEqual(["sent"]);
});

test("a log read from a later page (start > 0) gets no brief on top: scrolling up reaches the real one", async () => {
  const c = await conv([said("a1", "Still on the card.", 1)]);
  const chat = compat().chat("SHOP-3/worker", { conv: c, start: 4096, machine: null, addr: "t9", kind: "claude" }, term);
  expect(chat.messages.some((m: any) => m.taskBrief)).toBe(false);
});

test("a finished task's log (no terminal) still shows its brief, not a bubble of the whole launch text", async () => {
  const c = await conv([user("b1", LAUNCH, 0), said("a1", "Done.", 1)]);
  const chat = compat("done", null).chat("SHOP-3/worker", { conv: c, start: 0, machine: null, addr: "log", kind: "claude", pinned: true }, undefined);
  expect(chat.messages[0].taskBrief?.state).toBe("read");
  expect(chat.messages.some((m: any) => m.who === "you" && !m.taskBrief)).toBe(false);
});

test("no agent yet (queued, to do, starting): its chat is the brief, waiting", () => {
  for (const section of ["queued", "todo", "scheduled"]) {
    const chat = compat(section, null).freshChat("SHOP-3/worker");
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].taskBrief).toEqual({ title: "Bigger card", text: LONG, from: "Assistant", state: "waiting" });
  }
  // a space's chat is not a task's
  expect(compat().freshChat("p:local:nope")).toBeNull();
});
