import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";

// A Claude Code log as LOG reads it, fed to a Conversation.
async function read(lines) {
  const dir = mkdtempSync(join(tmpdir(), "chat-log-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}
const said = (c) => c.items.filter((x) => x.kind === "agent").map((x) => x.text);

// Lines as Claude Code 2.1.314 writes them (from real logs: their keys in its order, the signatures' real starts).
const at = "2026-11-04T15:50:49.652Z";
let n = 0;
const reply = (id, content, more = {}) => ({ parentUuid: null, isSidechain: false,
  message: { model: "claude-opus-5-5", id, type: "message", role: "assistant", content, stop_reason: "tool_use" },
  ...more, type: "assistant", uuid: `u${n++}`, timestamp: at });
const THINKING = "CAQSjA4KEAgTGAI4AUIIdGhpbmtpbmcSDM9K0ZnYDV50j17EHBoM";   // decodes to ...B\bthinking
const NARRATION = "CAQSpQkKEQgTGAI4AUIJbmFycmF0aW9uEgz6cN5kl8wh1Z7YUzIa"; // decodes to ...B\tnarration
const thinking = (words, signature = THINKING) => ({ type: "thinking", thinking: words, signature });
const text = (words) => ({ type: "text", text: words });
const call = { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" }, caller: { type: "direct" } };
const person = { parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: "Test bubble for reactions" }, uuid: "p1", timestamp: at };

test("a message Claude Code shows as an update (its long words cut short) is the agent's message", async () => {
  // the terminal shows this update in place of what the agent wrote: the chat shows it too
  const update = "The web \"before\" shot shows the pills floating mid-row, so I'm writing a long test message to react to.\n\n";
  const c = await read([
    person,
    reply("m1", [thinking("")], { thinkingDisplay: "updates", apiBlockIndex: 0 }),
    reply("m1", [thinking(update, NARRATION)], { thinkingDisplay: "updates", apiBlockIndex: 1 }),
    reply("m1", [call], { apiBlockIndex: 2 }),
  ]);
  expect(said(c)).toEqual([update.trim()]);
});

test("an update on one line with the call it comes before: its signature says so", async () => {
  // a real case: no thinkingDisplay on the line; only the signature tells the update from thinking
  const c = await read([reply("m2", [thinking(""), thinking("Claude found a separate bug in the web chat.\n\n", NARRATION), call])]);
  expect(said(c)).toEqual(["Claude found a separate bug in the web chat."]);
});

test("thinking stays hidden: empty, or summarized", async () => {
  const c = await read([
    reply("m3", [thinking("")], { thinkingDisplay: "updates" }),
    reply("m4", [thinking("Just a simple greeting, so I'll keep my reply short.\n\n")], { thinkingDisplay: "summarized" }),
    reply("m5", [thinking("A thought in a line of its own.")]),
  ]);
  expect(said(c)).toEqual([]);
  expect(c.doing).toBe("Thinking");
});

test("an update and the words after it in one reply are one message", async () => {
  const c = await read([
    reply("m6", [thinking("Checking the log first.\n\n", NARRATION)], { thinkingDisplay: "updates" }),
    reply("m6", [text("Found it: the update is a thinking block.")]),
  ]);
  expect(said(c)).toEqual(["Checking the log first.\n\nFound it: the update is a thinking block."]);
});

test("a reply's react lines land on the person's message, at its start, middle or end", async () => {
  const long = [
    '<hc react="👀" to="Test bubble for reactions"/>',
    "First paragraph of a long reply.",
    "",
    "- a list item with `code`",
    "- another",
    '<hc react="🔥" to="Test bubble"/>',
    "```js",
    "const a = 1;",
    "```",
    "",
    "Last paragraph.",
    '<hc react="✅" to="Test bubble for reactions"/>',
  ].join("\n");
  const c = await read([person, reply("m7", [text(long)])]);
  expect(said(c)).toEqual(["First paragraph of a long reply.\n\n- a list item with `code`\n- another\n```js\nconst a = 1;\n```\n\nLast paragraph."]);
  expect(c.reactions.get(c.items[0].id).map((r) => r.emoji)).toEqual(["👀", "🔥", "✅"]);
});
