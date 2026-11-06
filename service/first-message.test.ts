// SHEP-69 (#589, #591): an Assistant started from its chat, its log through the shared core into the web's chat. Its
// first message is the role template (with example <herdr-news> lines) and the person's words: the template folds
// into one "New session" row, the person's words are their own bubble as typed, and no news row comes of the examples.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import * as CL from "../core/chat-log.js";
const { LOG, Conversation, records } = CL as any;

const ROOT = join(import.meta.dir, "..");
const tpl = readFileSync(join(ROOT, "templates/assistant.md"), "utf8").split(/^---[ \t]*$/m).slice(2).join("---").trim();
const asked = "Decisions: B1 = <yours>, B3 = <yours>.";
const at = (s: number) => new Date(Date.UTC(2026, 10, 6, 9, 0, s)).toISOString();
const user = (id: string, content: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at(s) });
const said = (id: string, words: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "assistant", uuid: id, timestamp: at(s),
  message: { model: "claude-opus-5-5", id: `m${id}`, type: "message", role: "assistant", content: [{ type: "text", text: words }], stop_reason: "end_turn" } });

async function conv(lines: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "first-message-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}

test("the template folds, the person's first words are their own bubble, no news from its examples", async () => {
  const c = await conv([user("p0", `${tpl}\n\n${asked}`, 0), said("a0", "Got it.", 1), user("p1", "Name it <project> please", 2)]);
  const compat = new Compat() as any;
  // what data/chat-first/<slot>.txt holds (the file itself: core/chat-view.test.js firstKeys)
  compat.firstTask = () => asked;
  const chat = compat.chat("p:local:s1", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, { template: "herdr-assistant", labels: { "herdr.chat.slot": "s1" } });
  const rows = chat.messages.map((m: any) => (m.news ? `news ${m.news.ref}` : m.brief ? `brief ${m.brief.label}` : `${m.who}: ${m.text}`));
  expect(rows).toEqual(["brief New session", `you: ${asked}`, "agent: Got it.", "you: Name it <project> please"]);
});
