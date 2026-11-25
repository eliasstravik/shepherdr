// Sending the person's words to an agent, the same way from the window's chat and from the web app:
// the tag lines Herdr puts before them (the message it replies to, the tasks it mentions), then hc send. When
// the agent waits on its own dialog in its terminal (a question, a permission), Esc closes it and the words go
// as a message ("Reply instead…"). Claude Code holds a message typed mid-turn until its turn ends: its own
// "send now" (Ctrl+Enter) makes it steer at once, and Esc if that didn't take within ~5 s (steerNow; DECISIONS:
// messages are never held unless asked).
// io = { hc(args) -> Promise<{ code, stdout, stderr }>, sleep(ms), status() -> the agent's status now }.
// Shared core: the source is core/send.js; bin/sync-shared copies it into the mods in lib/COPIES.

import { excerpt } from "./chat-log.js";

// SHEP-324: what is in front of an agent's terminal, checked right before anything is typed into it. herdr-core keeps a
// terminal whose program it lost (a core restart, a crash) as a plain shell, and one whose agent exited stays live too:
// a message pasted there runs as a shell command. Only "agent" may be typed into. The same rule is herdr-task's
// agents.front().
export const SHELL = /^(ba|z|fi|da|k|tc|c)?sh$|^nu$|^pwsh$|^powershell$|^xonsh$|^elvish$/;
const RUNTIMES = new Set(["node", "bun", "deno"]); // a CLI run as a script shows its runtime's name

/** A foreground program's own name: its path's last part, and Nix's makeWrapper's ".claude-wrapped" as "claude"
 *  (#1410). The same as herdr-task's agents.prog_name() and core/agents.js liveTaskAgent's. */
export const progName = (name) => String(name ?? "").split("/").pop().replace(/^\.(.+)-wrapped$/, "$1");

/** A shell's argv that runs a command (-c, -ic, -lic, --command), not a plain shell (herdr-task's runs_command()). */
export function runsCommand(argv) {
  if (!Array.isArray(argv)) return true; // unknown: as before, its status decides
  for (const a of argv.slice(1).map(String)) {
    if (a === "--command" || a.startsWith("--command=")) return true;
    if (!a.startsWith("-") || a.startsWith("--")) break;
    if (a.slice(1).includes("c")) return true;
  }
  return false;
}

// k: its hc record (hc get, or the live list with its foreground). -> "agent", "shell" (its agent exited: a plain shell),
// "other" (another program than its agent), "gone" (none, or finished), or null (its foreground isn't known here).
export function inFront(k) {
  if (!k || k.state !== "live") return "gone";
  const fg = k.foreground;
  const name = progName(fg?.name);
  if (!name) return null;
  if (SHELL.test(name)) return runsCommand(fg?.argv) ? "agent" : "shell";
  const kind = k.labels?.["herdr.agent"];
  if ((kind === "claude" || kind === "codex") && !name.startsWith(kind) && !RUNTIMES.has(name) && !/^\d/.test(name)) return "other";
  return "agent";
}

// Claude Code keeps reporting "working" after its turn ended while background work of its own still runs, its message
// only that work ("1 shell still running", "2 shells still running"). That is no turn: nobody is writing, a message goes
// straight in, its task and chat are at rest. The same rule is herdr-task's agents.BG_ONLY.
export const BG_ONLY = /^\d+ [a-z][a-z-]*(?:(?:, | and )\d+ [a-z][a-z-]*)* still running\.?$/i;

/** An hc status as it really is: "working" that is only background work becomes "done", what still runs kept as `bg`
 *  ("1 shell still running") and no longer as its message. Any other status unchanged. */
export function atRest(st) {
  if (!st || typeof st !== "object" || st.state !== "working" || !BG_ONLY.test(String(st.msg ?? "").trim())) return st;
  const { msg, ...rest } = st;
  return { ...rest, state: "done", bg: String(msg).trim() };
}

/** An hc terminal record with its status as it really is (atRest). */
export const restRecord = (k) => (k && typeof k === "object" && k.status && typeof k.status === "object" ? { ...k, status: atRest(k.status) } : k);

// Why nothing was typed, by what is in front (hc's refusal kind "no_agent").
export const NOT_TYPED = {
  shell: "Its agent isn't running: its terminal is a plain shell now, so nothing was typed into it. Restart it, then send this again.",
  other: "Another program than its agent is open in its terminal, so nothing was typed into it. Try again once it's back.",
  gone: "That agent isn't running.",
};

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

// The tasks a message mentions (SHEP-322): by its title as written (a title of two words or more, or of ten letters or
// more, so "Fix" never names one; case and spaces aside), or by its key: HAT-1 as written (or #HAT-1, @HAT-1 and a
// picked [@…](task:HAT-1), core/mentions.js); a task without a prefix only as #4, never a bare number.
// tasks: [{ ref, id, title, ... }] (the chat's folder's).
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const words = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export function mentionedIn(text, tasks) {
  const t = String(text ?? ""), low = t.toLowerCase(), flat = words(t).toLowerCase();
  return (tasks ?? []).filter((x) => {
    const title = words(x.title).toLowerCase();
    if (title && (title.includes(" ") || title.length >= 10) && flat.includes(title) &&
        new RegExp(`(^|[^\\p{L}\\p{N}])${esc(title).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(t)) return true;
    if (x.ref && new RegExp(`\\]\\(task:([^)\\s/]*/)?${esc(x.ref)}(\\?|\\))`, "i").test(t)) return true;
    if (!low.includes(String(x.ref ? x.ref : `#${x.id}`).toLowerCase())) return false;
    const ref = x.ref ? `[#@]?${esc(x.ref)}` : `#${x.id}`;
    return new RegExp(`(^|[\\s([])${ref}\\b`, "i").test(t);
  });
}

/** Words that run as a command in the agent's own shell (Claude Code's bash mode, Codex's `!`): they start with `!`. */
export const isCommand = (text) => /^\s*!/.test(String(text ?? "")) && String(text).trim().length > 1;

// The words as the agent gets them: the reply tag, the task tags, then the person's text. task: a reply to a task
// (the chat's Reply on a task row): its id on the reply tag, so the chat shows the quoted task; its tag line is in tags.
/** @param {{ text: string, quote?: string | null, tags?: string, task?: string | null }} m */
export function messageBody({ text, quote = null, tags = "", task = null }) {
  // a `!` command runs in the agent's shell only when the `!` comes first: nothing goes before it
  if (isCommand(text)) return String(text).trim();
  const reply = quote ? `<hc reply-to="${excerpt(quote, 80)}"${task ? ` task="${attr(task)}"` : ""}/>\n` : "";
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
  // Claude Code's box still holds an earlier message of ours (put back by an Esc, or its Enter not taken yet): hc send
  // pastes after it, so the two would go as one, glued ("…thenWhat's…"). A blank line keeps them apart.
  const before = await boxOf(io, addr);
  if (before && heldBefore(addr, before, body)) body = "\n\n" + body;
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

// What was sent to each terminal lately (its words line, when): one still in Claude Code's box is ours, not the person's
// own draft there (heldBefore).
const lately = new Map();
const LATELY = 10 * 60_000;
function noteLately(addr, body) {
  const now = Date.now();
  lately.set(addr, [...(lately.get(addr) ?? []).filter((x) => now - x.at < LATELY), { words: wordsLine(body), at: now }].slice(-10));
}
// The box holds an earlier message sent here (its first words), not the one about to go.
function heldBefore(addr, box, body) {
  const rest = String(box ?? "").replace(/^❯\s?/, "").trim();
  if (!rest) return false;
  const mine = wordsLine(body);
  return (lately.get(addr) ?? []).some((x) => x.words && x.words !== mine && rest.includes(x.words.slice(0, 24)));
}

// One send at a time per terminal: two typed at once land in its box together and go as one glued message (the
// person sent two in a row while it worked). Each waits for the one before it, its steer included.
const typing = new Map();
function inTurn(addr, run) {
  const prev = typing.get(addr) ?? Promise.resolve();
  const mine = prev.catch(() => null).then(run);
  const tail = mine.catch(() => null);
  typing.set(addr, tail);
  tail.then(() => { if (typing.get(addr) === tail) typing.delete(addr); });
  return mine;
}

// Sends the body. kind: "claude", "codex" or another CLI. -> hc's result (code 0: it's in the agent's terminal).
// again: its last send stayed in Claude Code's box (sendTyped).
export function sendBody(io, addr, kind, body, again = false) {
  return inTurn(addr, async () => {
    let r = await sendTyped(io, addr, kind, body, SETTLE, again);
    if (r.code !== 0 && refusal(r).kind === "blocked" && (kind === "claude" || kind === "codex")) r = await replyInstead(io, addr, body);
    if (r.code === 0) noteLately(addr, body);
    if (r.code === 0 && kind === "claude") await steerNow(io, addr, STEER, body);
    return r;
  });
}
