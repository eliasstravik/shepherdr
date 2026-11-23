// Sending the person's words to an agent, the same way from the window's chat and from the web app:
// the tag lines Herdr puts before them (the message it replies to, the tasks it mentions), then hc send. When
// the agent waits on its own dialog in its terminal (a question, a permission), Esc closes it and the words go
// as a message ("Reply instead…"). Claude Code holds a message typed mid-turn until its turn ends: its own
// "send now" (Ctrl+Enter) makes it steer at once, and Esc if that didn't take within ~5 s (steerNow; DECISIONS:
// messages are never held unless asked).
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

// Claude Code's sign that a message waits in its own queue: "⎿  Queued · ctrl+enter to send now" under it (2.1.330 and
// older, at any width) and "Press up to edit queued messages" in its box while any wait. Either one means its Ctrl+Enter
// sends what is queued (never a half-typed draft: the box shows that placeholder only while it is empty).
export const QUEUED = /ctrl\+enter to send now|press up to edit queued messages|^\s*⎿\s+Queued\b/im;
// How long a send waits for that sign (the screen can take a moment to draw it, the more on a slow machine), and how
// long the message may stay queued after Ctrl+Enter before Esc puts it in (SHEP-329): grace looks, every `every` ms.
export const STEER = { looks: 20, every: 250, grace: 20, after: 12 };

// Claude Code at work, as far as a key may be pressed in it: its status says working (never on a dialog of its own,
// "blocked", where a key would answer it), or, its status unknown, its screen still offers "esc to interrupt".
const atWork = (io, screen) => {
  const st = io.status();
  return st === "working" || (st !== "blocked" && st !== "idle" && st !== "done" && /esc to interrupt/i.test(screen));
};
const screenOf = async (io, addr) => (await io.hc(["read", addr, "--lines", "40"]).catch(() => null))?.stdout ?? "";

// The person's message must reach a working Claude Code within seconds, always (SHEP-329: their message wins). Its
// own "send now" (Ctrl+Enter) first: it moves a running shell or tool call to the background and takes the message
// in mid-turn, so nothing is lost. Only while its screen shows a queued message (pressed on an empty prompt or a
// dialog it would do something else). If the message is still queued after a short grace (~5 s), Esc: the turn stops
// (a running command is cut off) and Claude Code sends what is queued at once, so the agent reads the person's
// message first. Also a queued message's own Send now (#662). -> whether it was pressed (true: it went in, or will
// as the turn ends).
// body: the message, when known: a Claude Code that puts it back in its box on Esc (older ones did) gets its Enter.
export async function steerNow(io, addr, opts = STEER, body = null) {
  let seen = false;
  for (let i = 0; i < opts.looks; i++) {
    await io.sleep(i ? opts.every : 150);
    const screen = await screenOf(io, addr);
    if (!atWork(io, screen)) return false;
    if (QUEUED.test(screen)) { seen = true; break; }
  }
  if (!seen) return false;
  await io.hc(["keys", addr, "ctrl+enter"]);
  for (let i = 0; i < opts.grace; i++) {
    await io.sleep(opts.every);
    const screen = await screenOf(io, addr);
    // in, or its turn ended (what is queued goes in by itself), or a dialog came up: never a key on that
    if (!QUEUED.test(screen) || !atWork(io, screen)) return true;
  }
  // still queued behind something Ctrl+Enter didn't move: Esc stops the turn and the queue goes in at once
  await io.hc(["keys", addr, "esc"]);
  for (let i = 0; i < opts.after; i++) {
    await io.sleep(opts.every);
    const screen = await screenOf(io, addr);
    if (QUEUED.test(screen)) continue;
    if (body && holds(inputLine(screen), body, true)) await io.hc(["keys", addr, "enter"]).catch(() => null);
    return true;
  }
  return true;
}

// A picture's path on a line of its own, as a sent file goes after the words.
const PICTURE = /^[/~]\S*\.(png|jpe?g|gif|webp|bmp|heic)$/im;

// Claude Code's input box: the last line of its screen starting with its prompt mark, right under the box's top rule
// (a past message in the conversation has the same mark, never the rule over it; a dialog shows no box at all).
export function inputLine(screen) {
  const lines = String(screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith("❯")) continue;
    return /^\s*─/.test(lines[i - 1] ?? "") ? lines[i].trim() : null;
  }
  return null;
}

// The words a message shows in Claude Code's box by: its first line that isn't a sent file's path or a tag line (a
// picture becomes "[Image #1]", a long paste "[Pasted text #1 +12 lines]").
function wordsLine(body) {
  const lines = String(body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  // files alone (no words): its first file's path, as typed (a picture shows as its marker instead)
  return lines.find((l) => !/^[/~]\S+$/.test(l) && !/^<hc\b/.test(l)) ?? lines.find((l) => !/^<hc\b/.test(l) && !PICTURE_LINE.test(l)) ?? "";
}
const PICTURE_LINE = /^[/~]\S*\.(png|jpe?g|gif|webp|bmp|heic)$/i;
const MARKS = /\[(Image|Pasted text) #\d+[^\]]*\]/g;

// Claude Code's box still holds this message, not taken in: its first words in it, or a picture or paste marker (just
// typed by this send, so the box is its own). exact: only this very message (its words line and markers, nothing
// else), for one sent again after it stayed in the box.
export function holds(box, body, exact = false) {
  const rest = String(box ?? "").replace(/^❯\s?/, "").trim();
  if (!rest) return false;
  const words = wordsLine(body);
  if (exact) {
    const bare = rest.replace(MARKS, " ").replace(/\s+/g, " ").trim();
    return bare === words.replace(/\s+/g, " ") || (!bare && /\[(Image|Pasted text) #\d+/.test(rest));
  }
  if (words && rest.includes(words.slice(0, 24))) return true;
  return /\[(Image|Pasted text) #\d+/.test(rest);
}

// Claude Code's box: its line (null: no box on screen, a dialog), or undefined when the screen couldn't be read
async function boxOf(io, addr) {
  const r = await io.hc(["read", addr, "--lines", "0"]).catch(() => null);
  if (!r || r.code !== 0) return undefined;
  return inputLine(r.stdout);
}

// How long a message may sit in Claude Code's box after hc send before it counts as stuck, and how many Enters it gets.
export const SETTLE = { looks: 40, every: 400, enters: 4 };

// After hc send: Claude Code reads the pictures (or a long paste) a message names before it takes Enter, and an Enter
// that comes meanwhile is lost, so the message can sit in its box for good. While the box holds it, the same on two
// looks, it gets its Enter again (a few times at most); once the box is clear it went in. A screen that can't be read
// proves nothing: it keeps looking (none read at all: hc send's word stands). -> true: in; false: stuck.
export async function settleBox(io, addr, body, opts = SETTLE) {
  let last = null, enters = 0, seen = false;
  for (let i = 0; i < opts.looks; i++) {
    const box = await boxOf(io, addr);
    if (box !== undefined) {
      seen = true;
      if (box === null || !holds(box, body)) return true;
      if (box === last && enters < opts.enters) { await io.hc(["keys", addr, "enter"]).catch(() => null); enters++; last = null; }
      else last = box;
    }
    await io.sleep(opts.every);
  }
  const box = await boxOf(io, addr);
  if (box === undefined) return !seen;
  return box === null || !holds(box, body);
}

// hc send for one CLI. Claude Code reads the pictures a pasted message names before it takes
// Enter: an Enter that comes meanwhile is lost, and the message sits in its box ("[Image #1]
// words") until the next one pushes it in (hc send says so only ~5 s later). While hc send is on
// its way, a box still holding the pictures, the same on two looks, gets its Enter; after it, the
// box is watched until it is clear (settleBox). again: its last send stayed in the box; if the box
// holds exactly it still, it gets Enter, never typed twice. -> hc's result; stuck: still in the box.
export async function sendTyped(io, addr, kind, body, opts = SETTLE, again = false) {
  if (kind !== "claude") return io.hc(["send", addr, body]);
  if (again) {
    const box = await boxOf(io, addr);
    if (holds(box, body, true)) {
      await io.hc(["keys", addr, "enter"]).catch(() => null);
      const ok = await settleBox(io, addr, body, opts);
      return ok ? { code: 0, stdout: "{}", stderr: "" } : { code: 1, stdout: "", stderr: STUCK, stuck: true };
    }
    // the box let it go since (Claude Code took it in late): typed again it would go twice
    if (box !== undefined && !holds(box, body)) return { code: 0, stdout: "{}", stderr: "" };
  }
  const going = io.hc(["send", addr, body]);
  let back = false, last = null;
  const sent = going.finally(() => { back = true; });
  if (PICTURE.test(body)) {
    for (let i = 0; i < 20 && !back; i++) {
      await Promise.race([io.sleep(100), sent.catch(() => null)]);
      if (back) break;
      const box = await boxOf(io, addr);
      if (box && /\[Image #\d+\]/.test(box) && box === last) { await io.hc(["keys", addr, "enter"]).catch(() => null); break; }
      last = box;
    }
  }
  const r = await sent;
  if (r.code !== 0) return r;
  let started = false;
  try { started = JSON.parse(r.stdout || "{}").started === true; } catch {}
  if (started || (await settleBox(io, addr, body, opts))) return r;
  return { code: 1, stdout: r.stdout, stderr: STUCK, stuck: true };
}

// A message that stays in Claude Code's box: sending it again presses its Enter (never types it twice).
export const STUCK = "It's still in the agent's message box: its Enter didn't take.";

// The person's reaction to a message, as the agent reads it (on: added, else removed).
export const reactionLine = (emoji, text, on = true) => `<hc from="person" ${on ? "reaction" : "reaction-removed"}="${emoji}" to="${excerpt(text)}"/>`;

// Sends the body. kind: "claude", "codex" or another CLI. -> hc's result (code 0: it's in the agent's terminal).
// again: its last send stayed in Claude Code's box (sendTyped).
export async function sendBody(io, addr, kind, body, again = false) {
  let r = await sendTyped(io, addr, kind, body, SETTLE, again);
  if (r.code !== 0 && refusal(r).kind === "blocked" && (kind === "claude" || kind === "codex")) r = await replyInstead(io, addr, body);
  if (r.code === 0 && kind === "claude") await steerNow(io, addr, STEER, body);
  return r;
}
