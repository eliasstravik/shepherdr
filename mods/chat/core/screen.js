// A voice call's screen (SHEP-51): the voice agent's fallback for whatever its Shepherdr tools (look, open, send, act)
// can't do. The app that started the call (the web page, or the Herdr window) reads what it shows as a short list of
// numbered things, as a screen reader would ("e7 tab "Artifacts" selected"), and does one action on one of them (click,
// type, select, scroll, a key, back, close), then reads its screen again: the voice agent hears the new list. Refs
// stay with their element for the whole call, so a ref heard a moment ago still means the same button.
// Plain data and words here; the page (web/plugins/voice/screen.ts) and the window (mods/chat) read and act.
// Shared core: the source is core/screen.js.

/** what the screen tool can do */
export const DOS = ["look", "click", "type", "select", "scroll", "key", "back", "close"];
/** the keys it may press */
export const KEYS = ["Enter", "Escape", "Tab", "Space", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];
/** at most this many characters go back to the voice agent (ElevenLabs' tool answers stay small) */
export const MAX = 2800;

const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** A key as said ("enter", "escape", "esc", "down", "page down", "space"): its DOM name, else null. */
export function keyOf(text) {
  const w = String(text ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const said = { esc: "Escape", return: "Enter", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", spacebar: "Space", delete: "Backspace", pgup: "PageUp", pgdown: "PageDown" };
  if (said[w]) return said[w];
  return KEYS.find((k) => k.toLowerCase() === w) ?? null;
}

/** A ref as said ("e12", "E 12", "12", "@e12"): "e12", else "". */
export function refOf(v) {
  const m = /^@?\s*e?\s*(\d{1,5})$/i.exec(String(v ?? "").trim());
  return m ? `e${Number(m[1])}` : "";
}

/**
 * The screen tool's parameters, checked: { do, ref, text, direction, submit, find, confirmed }, or { error } in words
 * for the voice agent. look and back/close need nothing; click, type and select a ref; scroll a direction (a ref: that
 * part of the screen; none: the main one); key a key.
 */
export function screenParams(p) {
  const x = p && typeof p === "object" ? p : {};
  const d = String(x.do ?? x.action ?? "look").toLowerCase().trim();
  if (!DOS.includes(d)) return { error: `screen can: ${DOS.join(", ")}.` };
  const ref = refOf(x.ref);
  const text = typeof x.text === "string" ? x.text.slice(0, 2000) : typeof x.text === "number" ? String(x.text) : "";
  const find = typeof x.find === "string" ? x.find.slice(0, 100).trim() : "";
  const out = { do: d, ref, text, find, submit: x.submit === true, confirmed: x.confirmed === true, direction: "" };
  if (["click", "type", "select"].includes(d) && !ref) return { error: `${d} needs a ref from the screen's list (like e12): look at the screen first.` };
  if (d === "type" && !text && x.text !== "") return { error: "type needs the text to put in the field." };
  if (d === "select" && !text) return { error: "select needs the choice to pick, as the list says it." };
  if (d === "scroll") {
    const dir = String(x.direction ?? x.text ?? "down").toLowerCase().trim();
    const hit = ["down", "up", "top", "bottom"].find((w) => dir.includes(w)) ?? (/end|last|newest/.test(dir) ? "bottom" : /start|first|oldest|begin/.test(dir) ? "top" : "");
    if (!hit) return { error: "scroll goes down, up, top or bottom." };
    out.direction = hit;
  }
  if (d === "key") {
    const k = keyOf(text);
    if (!k) return { error: `key presses one of: ${KEYS.join(", ")}.` };
    out.text = k;
  }
  return out;
}

/** Words on a button that do something that can't be taken back, or end the call: asked out loud first. */
const RISKY = /\b(delete|remove|forget|discard|accept|merge|stop|end call|hang up|archive|reset|sign out|log out|uninstall|revoke|kill|reject|deny|close task|mark done|restart|overwrite|cancel task)\b/i;
export function risky(name) { return RISKY.test(String(name ?? "")); }

/** One thing on screen as a line: `e7 tab "Artifacts" selected`, `e9 textbox "Filter" value "abc"`. */
export function nodeLine(n) {
  const bits = [n.ref, n.role].filter(Boolean);
  if (n.name) bits.push(JSON.stringify(clip(n.name, 80)));
  for (const s of STATES) if (n[s]) bits.push(s);
  if (n.level) bits.push(`level ${n.level}`);
  if (n.value != null && n.value !== "") bits.push(`value ${JSON.stringify(clip(n.value, 60))}`);
  if (n.options?.length) bits.push(`options ${clip(n.options.slice(0, 8).join(", "), 120)}`);
  if (n.scroll) bits.push(n.scroll);
  return `${"  ".repeat(Math.max(0, Math.min(4, n.depth ?? 0)))}${bits.join(" ")}`;
}

/** A node matches find's words when each is in its role, name or value. */
const STATES = ["selected", "checked", "pressed", "expanded", "collapsed", "disabled", "focused", "current"];
const matches = (n, ws) => ws.every((w) => `${n.role} ${n.name ?? ""} ${n.value ?? ""} ${STATES.filter((x) => n[x]).join(" ")}`.toLowerCase().includes(w));

/**
 * The screen as the voice agent reads it: a head line (what the app shows, a dialog over it), then a line per thing,
 * cut to max characters with how many more there are. find: only the things whose words match (and their headings).
 *   head    { app: "web on a phone", shows: "Settings › Secrets", dialog?: "Delete task?", size?: "390×844" }
 *   nodes   [{ ref, role, name, depth?, selected?, checked?, …, value?, scroll? }] in screen order
 *   hidden  how many things are off screen (scroll to reach them)
 * @param {{ head?: any, nodes?: any[], hidden?: number, find?: string, max?: number }} [o]
 */
export function screenText({ head = {}, nodes = [], hidden = 0, find = "", max = MAX } = {}) {
  const top = [`Screen: ${head.app ?? "the app"}${head.size ? ` (${head.size})` : ""}${head.shows ? `, showing ${clip(head.shows, 200)}` : ""}.`];
  if (head.dialog) top.push(`A dialog is open over it: ${JSON.stringify(clip(head.dialog, 100))}. Only the dialog is listed; close it to reach the rest.`);
  const ws = words(find);
  let list = ws.length ? nodes.filter((n) => matches(n, ws)) : nodes;
  if (ws.length && !list.length) top.push(`Nothing on screen matches "${clip(find, 60)}"; everything shown instead.`);
  if (ws.length && !list.length) list = nodes;
  const out = [...top];
  let used = out.join("\n").length, i = 0;
  for (; i < list.length; i++) {
    const line = nodeLine(list[i]);
    if (used + line.length + 1 > max - 80) break;
    out.push(line);
    used += line.length + 1;
  }
  const rest = list.length - i;
  const tail = [rest ? `${rest} more not listed: look with find (words of what you want).` : "", hidden ? `${hidden} more off screen: scroll to reach them.` : ""].filter(Boolean);
  if (!list.length) out.push("Nothing to act on is on screen.");
  return [...out, ...tail].join("\n");
}

/**
 * What the app said once it tried a screen action, in words for the voice agent. ack (from the page or window):
 * { ok, did?, why?, ask?, screen? }; null: it didn't answer in time. ask: a risky click it held back, to say out loud.
 * did: what was asked (screen's do). Moving around (back, close, scroll) answers only that it worked, so the agent says
 * "Done." and doesn't read the screen out (SHEP-83); other actions add the new screen, for its next step only.
 */
export const MOVES = ["back", "close", "scroll"];
export function screenWords(ack, did = "") {
  if (!ack) return { result: "The person's app didn't answer: it may be closed or asleep. Say so; reloading the app can fix it.", error: true };
  const screen = typeof ack.screen === "string" ? ack.screen.slice(0, MAX + 400) : "";
  if (ack.ask) return { result: `Nothing done yet. Ask the person first: "${clip(ack.ask, 200)}" Only after a clear yes, do it again with confirmed true.${screen ? `\n${screen}` : ""}` };
  if (!ack.ok) return { result: `It didn't work: ${clip(ack.why || "the app couldn't do it", 200)}.${screen ? `\n${screen}` : ""}`, error: true };
  if (MOVES.includes(did)) return { result: JSON.stringify({ ok: true, did: clip(ack.did || did, 120) }) };
  if (did === "look") return { result: screen || "Nothing to act on is on screen." };
  return { result: `${ack.did ? `${clip(ack.did, 200)}. ` : "Done. "}${screen ? `The screen now, for your next step only (don't read it out):\n${screen}` : ""}`.trim() };
}
