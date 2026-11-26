// Recaps in the chat: Claude Code's own recap and heads-up lines, and the answer to Shepherdr's Recap ask (any agent),
// are recap items; the ask itself never shows.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";
import { RECAP_ASK } from "../service/recap.ts";

async function read(kind, lines) {
  const dir = mkdtempSync(join(tmpdir(), "recap-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation(kind);
  c.feed(records(out).records);
  return c;
}
const at = "2026-11-26T09:00:00.000Z";
const kinds = (c) => c.items.map((x) => [x.kind, x.text]);
let n = 0;
// as Claude Code 2.1.310 writes them (keys in its order)
const user = (content) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: `p${n++}`, timestamp: at });
const reply = (words) => ({ parentUuid: null, isSidechain: false, message: { model: "claude-opus-5-5", id: `m${n++}`, type: "message", role: "assistant", content: [{ type: "text", text: words }] }, type: "assistant", uuid: `u${n++}`, timestamp: at });
const sys = (subtype, content) => ({ parentUuid: null, isSidechain: false, type: "system", subtype, content, timestamp: at, uuid: `s${n++}`, isMeta: false, level: "notice" });

test("Claude Code's own recap and heads-up show as their own items, without its settings hint", async () => {
  const c = await read("claude", [
    user("Fix the login page"), reply("Done: the login page works."),
    sys("away_summary", "The login page is fixed and merged. Nothing needs you. (disable recaps in /config)"),
    sys("informational", "Compacted while idle, before the prompt cache expired · turn off with \"idleCompaction\": false in settings.json"),
    sys("turn_duration", "ignored"),
  ]);
  expect(kinds(c)).toEqual([
    ["user", "Fix the login page"], ["agent", "Done: the login page works."],
    ["recap", "The login page is fixed and merged. Nothing needs you."],
    ["heads", "Compacted while idle, before the prompt cache expired"],
  ]);
  expect(c.items.find((x) => x.kind === "recap").own).toBe(true);
});

test("Claude: the Recap ask never shows, its answer is a recap, and the next message is a message again", async () => {
  const c = await read("claude", [
    user("Fix the login page"), reply("On it."),
    user(RECAP_ASK), reply("The login page is fixed. Waiting for your review.\n<hc suggest=\"Merge it\"/>"),
    user("Thanks"), reply("You're welcome."),
  ]);
  expect(kinds(c)).toEqual([
    ["user", "Fix the login page"], ["agent", "On it."],
    ["recap", "The login page is fixed. Waiting for your review."],
    ["user", "Thanks"], ["agent", "You're welcome."],
  ]);
  expect(c.items.find((x) => x.kind === "recap").suggests).toBeUndefined();
});

test("Codex: the same ask gives a recap, and its turn's end closes it", async () => {
  const msg = (role, words) => ({ timestamp: at, type: "response_item", payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text: words }] } });
  const done = { timestamp: at, type: "event_msg", payload: { type: "task_complete" } };
  const c = await read("codex", [
    msg("user", "Add a dark mode"), msg("assistant", "Added."), done,
    msg("user", RECAP_ASK), msg("assistant", "Dark mode is in. Nothing needs you."), done,
    msg("assistant", "A check failed; fixing it."),
  ]);
  expect(kinds(c)).toEqual([
    ["user", "Add a dark mode"], ["agent", "Added."],
    ["recap", "Dark mode is in. Nothing needs you."],
    ["agent", "A check failed; fixing it."],
  ]);
});
