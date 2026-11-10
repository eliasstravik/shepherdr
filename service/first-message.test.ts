// SHEP-69 (#589, #591): an Assistant started from its chat, its log through the shared core into the web's chat. Its
// first message keeps the role template (with example <herdr-news> lines) in the agent's context, while chat shows
// only the person's words as typed, and no news row comes of the examples.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { execTemplate } from "./spaces.ts";
import { briefLabel } from "../core/chat-view.js";
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

test("the template stays in context but only the person's first words are shown, no news from its examples", async () => {
  const c = await conv([user("p0", `${tpl}\n\n${asked}`, 0), said("a0", "Got it.", 1), user("p1", "Name it <project> please", 2)]);
  expect(c.items.find((x: any) => x.kind === "user")?.text).toContain(tpl);
  const compat = new Compat() as any;
  // what data/chat-first/<slot>.txt holds (the file itself: core/chat-view.test.js firstKeys)
  compat.firstTask = () => asked;
  const chat = compat.chat("p:local:s1", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, { template: "herdr-assistant", labels: { "herdr.chat.slot": "s1" } });
  const rows = chat.messages.map((m: any) => (m.news ? `news ${m.news.ref}` : m.brief ? `brief ${m.brief.label}` : `${m.who}: ${m.text}`));
  expect(rows).toEqual([`you: ${asked}`, "agent: Got it.", "you: Name it <project> please"]);
});


test("an Assistant opened before a request hides its setup and keeps later user messages", async () => {
  const c = await conv([user("setup", tpl, 0), user("p1", "Pull the latest changes", 1), said("a1", "Done.", 2)]);
  const compat = new Compat() as any;
  compat.firstTask = () => null;
  const chat = compat.chat("p:local:s1", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, { template: "assistant" });
  expect(chat.messages.map((m: any) => m.text)).toEqual(["Pull the latest changes", "Done."]);
  expect(c.items.find((x: any) => x.kind === "user")?.text).toBe(tpl);
});

test("restart instructions stay hidden, while task briefs and handoffs remain available", async () => {
  const compat = new Compat() as any;
  compat.firstTask = () => null;
  for (const [text, terminal, label] of [
    ["<restart>Continue with these internal instructions.</restart>", {}, null],
    ["Implement the requested change", { labels: { "herdr.task": "HAT-1" } }, "Task brief"],
    ["You are taking over this tab. Keep the work already done.", { template: "herdr-handoff-1" }, "Handoff from the previous agent"],
  ] as const) {
    const c = await conv([user("p0", text, 0), said("a0", "Ready.", 1)]);
    const chat = compat.chat("p:local:s1", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, terminal);
    expect(chat.messages.filter((m: any) => m.brief).map((m: any) => m.brief.label)).toEqual(label ? [label] : []);
    expect(chat.messages.at(-1).text).toBe("Ready.");
  }
});

test("a later history page never hides its first user message as startup instructions", async () => {
  const c = await conv([user("p7", "New session: investigate this error", 0), said("a7", "Checking.", 1)]);
  const compat = new Compat() as any;
  compat.firstTask = () => asked;
  const chat = compat.chat("p:local:s1", { conv: c, start: 900, machine: null, addr: "t9", kind: "claude" }, { template: "assistant" });
  expect(chat.messages.map((m: any) => m.text)).toEqual(["New session: investigate this error", "Checking."]);
});


test("background Assistant context never hides the first real request, including a Terminal-first start", async () => {
  const c = await conv([user("p0", asked, 0), said("a0", "Got it.", 1)]);
  for (const identity of [
    { labels: { "herdr.assistant.context": "background" } },
    { foreground: { argv: ["claude", "--append-system-prompt-file", "/fixture/.config/herdr-core/assistant-context/role.txt"] } },
    { argv: ["claude", "--append-system-prompt-file", "/fixture/.config/herdr-core/assistant-context/role.txt"] },
  ]) {
    const compat = new Compat() as any;
    compat.firstTask = () => null;
    const chat = compat.chat("p:local:s1", { conv: c, start: 0, machine: null, addr: "t9", kind: "claude" }, { template: "herdr-assistant", ...identity });
    expect(chat.messages.map((m: any) => m.text)).toEqual([asked, "Got it."]);
    expect(chat.messages.some((m: any) => m.brief)).toBe(false);
  }
});

test("background context changes only the template brief, keeping task and handoff meaning", () => {
  const background: any = { start: 0, background: true, template: "herdr-assistant" };
  expect(briefLabel({ text: asked }, 0, background)).toBeNull();
  expect(briefLabel({ text: "Implement this task" }, 0, { ...background, task: true })).toBe("Task brief");
  expect(briefLabel({ text: "You are taking over this tab. Preserve the work." }, 0, background)).toBe("Handoff from the previous agent");
  expect(briefLabel({ text: "<restart>Resume the work.</restart>" }, 0, background)).toBe("New session");
});

test("Claude Assistant launch puts role instructions in background context, preserving other agent templates", async () => {
  for (const [name, command, background] of [
    ["assistant", "claude --model sonnet", true],
    ["coordinator", "claude --model sonnet", true],
    ["assistant", "cursor-agent --model auto", false],
    ["worker", "claude --model sonnet", false],
  ] as const) {
    const source = `---\nname: ${name}\ncommand: ${command}\n---\nKeep this customized role instruction.\n`;
    let written = "";
    const hub: any = { call: async (method: string, { argv, on }: any) => {
      expect(method).toBe("machine.exec");
      expect(on).toBe("vm");
      const reading = argv[2].includes('cat "$dir/$1.md"');
      if (argv[2].includes('printf "%s"')) written = argv[5];
      return { code: 0, stdout: Buffer.from(reading ? source : "").toString("base64"), stderr: "" };
    } };
    const launch = await execTemplate(hub, name, "vm");
    expect(launch.background).toBe(background);
    expect(written).toContain("CLAUDE_CODE_");
    expect(launch.words).toBe(background ? "" : "Keep this customized role instruction.");
    const body = written.split(/^---$/m).slice(2).join("---").trim();
    expect(body).toBe(launch.words);
    if (background) expect(written).toContain("herdr-assistant-context");
    else expect(written).toContain(`exec ${command}`);
    launch.done();
  }
});


test("a failed background-context launch never falls back to sending the role as a user message", async () => {
  const source = "---\nname: assistant\ncommand: claude --model sonnet\n---\nCustom role instructions.\n";
  const hub: any = { call: async (_method: string, { argv }: any) => {
    const reading = argv[2].includes('cat "$dir/$1.md"');
    return { code: reading ? 0 : 1, stdout: Buffer.from(reading ? source : "").toString("base64"), stderr: "" };
  } };
  await expect(execTemplate(hub, "assistant", null)).rejects.toThrow("Couldn't prepare the Assistant's instructions");
});
