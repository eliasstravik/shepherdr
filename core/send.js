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

// The tasks a message mentions: HAT-1 as written (or #HAT-1, @HAT-1 and a picked [@HAT-1](task:…), core/mentions.js); a
// task without a prefix only as #4, never a bare number.
// tasks: [{ ref, id, ... }] (the chat's folder's).
export function mentionedIn(text, tasks) {
  const t = String(text ?? ""), low = t.toLowerCase();
  return (tasks ?? []).filter((x) => {
    if (!low.includes(String(x.ref ? x.ref : `#${x.id}`).toLowerCase())) return false;
    const ref = x.ref ? `[#@]?${String(x.ref).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : `#${x.id}`;
    return new RegExp(`(^|[\\s([])${ref}\\b`, "i").test(t);
  });
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

// A picture's path on a line of its own, as a sent file goes after the words.
const PICTURE = /^[/~]\S*\.(png|jpe?g|gif|webp|bmp|heic)$/im;

// Claude Code's input box: the last line of its screen starting with its prompt mark.
export function inputLine(screen) {
  const lines = String(screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith("❯")) return lines[i].trim();
  return null;
}

// hc send for one CLI. Claude Code reads the pictures a pasted message names before it takes
// Enter: an Enter that comes meanwhile is lost, and the message sits in its box ("[Image #1]
// words") until the next one pushes it in (hc send says so only ~5 s later). While hc send is on
// its way, a box still holding the pictures, the same on two looks, gets its Enter.
export async function sendTyped(io, addr, kind, body) {
  const going = io.hc(["send", addr, body]);
  if (kind !== "claude" || !PICTURE.test(body)) return going;
  let back = false, last = null;
  const sent = going.finally(() => { back = true; });
  for (let i = 0; i < 20 && !back; i++) {
    await Promise.race([io.sleep(100), sent.catch(() => null)]);
    if (back) break;
    const box = inputLine((await io.hc(["read", addr, "--lines", "0"]).catch(() => null))?.stdout);
    if (box && /\[Image #\d+\]/.test(box) && box === last) { await io.hc(["keys", addr, "enter"]).catch(() => null); break; }
    last = box;
  }
  return sent;
}

// The person's reaction to a message, as the agent reads it (on: added, else removed).
export const reactionLine = (emoji, text, on = true) => `<hc from="person" ${on ? "reaction" : "reaction-removed"}="${emoji}" to="${excerpt(text)}"/>`;

// Sends the body. kind: "claude", "codex" or another CLI. -> hc's result (code 0: it's in the agent's terminal).
export async function sendBody(io, addr, kind, body) {
  let r = await sendTyped(io, addr, kind, body);
  if (r.code !== 0 && refusal(r).kind === "blocked" && (kind === "claude" || kind === "codex")) r = await replyInstead(io, addr, body);
  if (r.code === 0 && kind === "claude") await steerNow(io, addr);
  return r;
}
