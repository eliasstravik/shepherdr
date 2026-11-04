// Sending the person's words to an agent, the same way from the window's chat and from the web app:
// the tag lines Herdr puts before them (the message it replies to, the tasks it mentions), then hc send. When
// the agent waits on its own dialog in its terminal (a question, a permission), Esc closes it and the words go
// as a message ("Reply instead…"). Claude Code holds a message typed mid-turn until its turn ends: its own
// "send now" (Ctrl+Enter) makes it steer at once (DECISIONS: messages are never held unless asked).
// io = { hc(args) -> Promise<{ code, stdout, stderr }>, sleep(ms), status() -> the agent's status now }.
// Shared core: the source is core/send.js; bin/sync-shared copies it into the mods in lib/COPIES.

import { excerpt } from "./chat-log.js";

// hc's refusal, in words: { kind ("blocked": its own dialog is open), message }.
export function refusal(r) {
  const text = String(r?.stderr || r?.stdout || "").trim();
  try { const e = JSON.parse(text).error; if (e?.message) return { kind: e.kind ?? null, message: e.message }; } catch {}
  return { kind: /"kind":"blocked"/.test(text) ? "blocked" : null, message: text || "It didn't go through." };
}

const attr = (v) => String(v ?? "").replace(/\s*\n\s*/g, " ").replace(/"/g, "”");

// A mentioned task's tag line: <hc task=… title=… state=… folder=…>its prompt</hc>.
export function taskTag(x, ref) {
  return `<hc task="${attr(ref.replace(/^#/, ""))}" title="${attr(x.title)}" state="${attr(x.status_text ?? x.state)}"${x.why ? ` why="${attr(x.why)}"` : ""} folder="${attr(x.folder)}">${String(x.prompt ?? "").slice(0, 500)}</hc>\n`;
}

// The words as the agent gets them: the reply tag, the task tags, then the person's text.
export function messageBody({ text, quote = null, tags = "" }) {
  const reply = quote ? `<hc reply-to="${excerpt(quote, 80)}"/>\n` : "";
  return reply + tags + text;
}

// The agent waits on its own dialog: Esc closes it, then the words go once it takes typing again.
export async function replyInstead(io, addr, text) {
  await io.hc(["keys", addr, "esc"]);
  let r;
  for (let i = 0; i < 10; i++) {
    await io.sleep(300);
    r = await io.hc(["send", addr, text]);
    if (r.code === 0 || refusal(r).kind !== "blocked") break;
  }
  return r;
}

// Claude Code's "send now" for a message it queued while working: Ctrl+Enter, only when its screen offers it
// (pressed on an empty prompt it would do something else).
export async function steerNow(io, addr) {
  for (let i = 0; i < 4; i++) {
    await io.sleep(i ? 300 : 150);
    const r = await io.hc(["read", addr, "--lines", "40"]).catch(() => null);
    if (/ctrl\+enter to send now/i.test(r?.stdout ?? "")) { await io.hc(["keys", addr, "ctrl+enter"]); return; }
    if (io.status() !== "working") return;
  }
}

// The person's reaction to a message, as the agent reads it (on: added, else removed).
export const reactionLine = (emoji, text, on = true) => `<hc from="person" ${on ? "reaction" : "reaction-removed"}="${emoji}" to="${excerpt(text)}"/>`;

// Sends the body. kind: "claude", "codex" or another CLI. -> hc's result (code 0: it's in the agent's terminal).
export async function sendBody(io, addr, kind, body) {
  let r = await io.hc(["send", addr, body]);
  if (r.code !== 0 && refusal(r).kind === "blocked" && (kind === "claude" || kind === "codex")) r = await replyInstead(io, addr, body);
  if (r.code === 0 && kind === "claude") await steerNow(io, addr);
  return r;
}
