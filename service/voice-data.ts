// SHEP-110: a voice call sees everything the UI shows. One generic reader (look what "data") over the very data the
// web app reads: the whole snapshot (every key of it, whatever is added later: a new panel's data is readable at
// once), and every other source a panel or dialog fetches as it opens (SOURCES: a task's changes and pull request, an
// artifact's page, the model menus, usage insights...). A path drills into any item ("machines/mini/stats/limits/
// codex"), a search finds any value by words. Secret values never: keys and values that look like one are hidden.
// test: voice-data.test.ts checks every data source the web app reads is here (or in NOT_DATA, with why).

/** What a source is read with: which task, space, chat, artifact, machine or role it is about, and a path in it. */
export type SourceArgs = { task?: string; place?: string; chat?: string; artifact?: string; v?: number; machine?: string | null; role?: string; path?: string };

/** Every source the web app fetches beyond the snapshot, by the name a look reads it with. arg: what it is about
 *  (found from the look's id); rest: the path's rest is its own path (a file, a folder) instead of a drill into it.
 *  serves: the web app's reads it covers ("api:<path>" a GET, "action:<type>" a read action). */
export const SOURCES: Record<string, { about: string; arg?: "task" | "task-or-space" | "space" | "chat" | "artifact" | "machine" | "role"; rest?: boolean; serves: string[] }> = {
  insights: { about: "Usage insights: how the person has used Shepherdr (screens and time on them, actions, features, errors, asks), from this machine's private log (the add-on's own file; Settings shows its switch)", serves: ["log:usage.jsonl"] },
  evidence: { about: "a task's Accept card: commits, files, checks, proof", arg: "task", serves: ["action:evidence"] },
  changes: { about: "a task's or space's Changes: files changed, lines added and removed", arg: "task-or-space", serves: ["api:worktree"] },
  patch: { about: "one changed file's diff (path: the file)", arg: "task-or-space", rest: true, serves: ["api:worktree"] },
  pr: { about: "a task's pull request: state, checks, files", arg: "task", serves: ["api:worktree"] },
  files: { about: "a task's or space's Files: a folder's entries (path: the folder)", arg: "task-or-space", rest: true, serves: ["api:worktree"] },
  file: { about: "a file's text in a task's or space's Files (path: the file)", arg: "task-or-space", rest: true, serves: ["api:worktree"] },
  artifact: { about: "an artifact's page content (a recipe's blocks)", arg: "artifact", serves: ["api:artifacts"] },
  activity: { about: "a chat's latest tool calls and background jobs", arg: "chat", serves: ["api:activity"] },
  model: { about: "what a chat's agent runs on (CLI, model, effort, speed) and its choices", arg: "chat", serves: ["action:restart-info", "action:model-menu"] },
  models: { about: "Settings › Agents' model menus: every CLI's models, levels, permission modes, pinned and recent models", serves: ["action:role-info"] },
  template: { about: "a role's instructions (Settings › Agents; id: assistant, worker, reviewer...)", arg: "role", serves: ["action:template"] },
  agents: { about: "the agent CLIs a space can start in a new tab", arg: "space", serves: ["action:tab-agents"] },
  worktree: { about: "a worktree space's state: uncommitted files, unpushed commits", arg: "space", serves: ["action:worktree"] },
  hosts: { about: "machines on the person's network that can be added", serves: ["action:machine-hosts"] },
  folders: { about: "a machine's folders, as New space browses them (path: the folder; id: the machine)", arg: "machine", rest: true, serves: ["api:folders", "api:newspace"] },
  me: { about: "Shepherdr's version, who is signed in, the web app's link, add-ons off", serves: ["api:me"] },
};

/** The web app's reads that are not data to see, each with why (the guard test needs every one in SOURCES or here). */
export const NOT_DATA: Record<string, string> = {
  "api:ws": "the live snapshot and chats: look data reads the snapshot, look chat the chats",
  "api:action": "the actions themselves (act; their read ones are SOURCES)",
  "api:dictate": "dictation turns speech into text, nothing shown",
  "api:upload": "uploads a file to send",
  "api:spaces": "makes a new space (a change, the space's Assistant or screen does it)",
  "api:file": "a picture or file sent in a chat, as bytes",
  "api:terminal": "a live terminal's raw screen: its agent's chat is look chat, and screen reads what the page shows",
  "api:browser": "a task's live browser video: screen reads what the page shows",
  "api:voice": "the call itself",
  "api:push": "this device's own notification subscription (the notification settings are in the snapshot's settings)",
  "api:commands": "the / picker's command list above the message box",
  "api:reach": "the # picker's spaces above the message box (the same spaces as the snapshot's places)",
  "action:earlier": "a chat's older messages: look chat reads further back itself",
};

/** The web app's actions that change something (act, send or screen do them), not data to read. */
export const WRITES = ["plugin", "limits-check", "send", "react", "secret", "secret-saved", "answer", "page-send", "page-note", "artifact-send",
  "artifact-note", "artifact-say", "artifact-delete", "browser-notes", "mode", "autopilot-run", "setting", "accept", "close", "delete", "archive",
  "reopen", "task-resume", "schedule", "stop", "stop-job", "steer", "pin", "rename", "order", "move", "section", "space-remove", "space-commit",
  "assistant-close", "tab-new", "tab-close", "tab-rename", "tab-switch", "tab-move", "restart", "model-pin", "rewind", "fork", "handback", "held-drop",
  "held-now", "read", "keys", "text", "dictation", "call", "machine-add", "machine-mac-open", "secrets-move", "serve-from", "pause", "usage",
  "automation", "effort", "model"];

// ---- keeping secrets out ------------------------------------------------------------------

const SECRET_KEY = /(pass(word|wd|phrase)?|token|secret_?value|api_?key|apikey|private_?key|credential|cookie|authorization|^auth$|endpoint|p256dh)$/i;
const SECRET_TEXT = /^(sk-|sk_|pk_live|rk_live|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|AKIA|AIza|eyJ[\w-]{10,}\.)[\w.-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY/;
const HIDDEN = "(hidden: a secret)";
/** a key whose value is never read out */
export const secretKey = (k: string) => SECRET_KEY.test(k);
/** a value that looks like a key or token */
export const secretText = (v: unknown) => typeof v === "string" && SECRET_TEXT.test(v.trim());
/** a copy with every secret-looking key's value and every key-like text hidden */
export function scrub(v: unknown, depth = 0): unknown {
  if (depth > 40) return "…";
  if (secretText(v)) return HIDDEN;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = secretKey(k) && x != null && x !== "" && typeof x !== "boolean" ? HIDDEN : scrub(x, depth + 1);
    return out;
  }
  return v;
}

// ---- reading a tree in words --------------------------------------------------------------

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const words = (s: unknown) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const LABELS = ["id", "name", "title", "label", "machine", "key", "chat", "cli", "path"];
/** what an item in a list goes by: its id, name, title... */
function labelOf(x: unknown, i: number): string {
  if (x && typeof x === "object" && !Array.isArray(x)) for (const k of LABELS) { const v = (x as any)[k]; if (typeof v === "string" && v) return v; }
  return String(i);
}

/** a number as a moment, when its key says it is one (ms, or seconds for a *_at/next_run) */
function moment(key: string, v: number, now: number): string | null {
  if (!/(^at$|At$|_at$|^since$|Since$|^started$|^created$|^next_run$|^last_run$|^when$|resets)/.test(key)) return null;
  const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : 0;
  if (!ms) return null;
  const s = Math.round((ms - now) / 1000), a = Math.abs(s);
  const span = a < 90 ? "a minute" : a < 5400 ? `${Math.round(a / 60)} minutes` : a < 86400 * 2 ? `${Math.round(a / 3600)} hours` : `${Math.round(a / 86400)} days`;
  const d = new Date(ms);
  return `${s < 0 ? `${span} ago` : `in ${span}`} (${d.toISOString().slice(0, 16).replace("T", " ")} UTC)`;
}
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
function scalar(key: string, v: unknown, now: number, n = 160): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "number") return moment(key, v, now) ?? String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v === "" ? "(empty)" : JSON.stringify(clip(v, n));
  return String(v);
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function brief(key: string, v: unknown, now: number): string {
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? "" : "s"}${v.length <= 8 && v.every((x) => !isObj(x) && !Array.isArray(x)) ? `: ${v.map((x) => scalar(key, x, now, 40)).join(", ")}` : ""}` : "empty list";
  if (isObj(v)) { const ks = Object.keys(v); return ks.length ? `{${ks.slice(0, 10).join(", ")}${ks.length > 10 ? `, +${ks.length - 10}` : ""}}` : "{}"; }
  return scalar(key, v, now);
}
/** one item of a list on one line: its label and its plain fields */
function row(x: unknown, i: number, now: number): string {
  if (!isObj(x)) return `- ${brief(String(i), x, now)}`;
  const lab = labelOf(x, i);
  const bits = Object.entries(x).filter(([k, v]) => v !== undefined && v !== null && v !== "" && !(LABELS.includes(k) && v === lab))
    .slice(0, 12).map(([k, v]) => `${k}: ${isObj(v) || Array.isArray(v) ? brief(k, v, now) : scalar(k, v, now, 80)}`);
  return `- [${lab}] ${bits.join("; ")}`;
}

/** A node in words: a scalar whole; an object's keys with their values; a list's items one a line. */
export function render(v: unknown, key = "", max = 3300, now = Date.now()): string {
  let out: string;
  if (Array.isArray(v)) out = v.length ? `${v.length} item${v.length === 1 ? "" : "s"} (add an id, name or number to the path for one):\n${v.map((x, i) => row(x, i, now)).join("\n")}` : "Empty.";
  else if (isObj(v)) out = Object.keys(v).length ? Object.entries(v).map(([k, x]) => `${k}: ${isObj(x) || Array.isArray(x) ? brief(k, x, now) : scalar(k, x, now, 400)}`).join("\n") : "Empty.";
  else if (typeof v === "string") out = v.length > max ? `${v.slice(0, max - 40)}… (${v.length} characters in all)` : v || "(empty)";
  else out = scalar(key, v, now);
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** One step down a path: an object's key (exact, then loosely), a list's item by number or by its id, name or title. */
function step(v: unknown, seg: string): { ok: true; v: unknown; key: string } | { ok: false } {
  const want = norm(seg);
  if (Array.isArray(v)) {
    if (/^\d+$/.test(seg) && Number(seg) < v.length) return { ok: true, v: v[Number(seg)], key: seg };
    const lab = (x: unknown) => (isObj(x) ? LABELS.map((k) => (x as any)[k]).filter((s) => typeof s === "string") : []) as string[];
    const hit = v.find((x) => lab(x).some((s) => s === seg || norm(s) === want || norm(s.split(/[:/]/).pop()) === want))
      ?? v.find((x) => lab(x).some((s) => want.length > 1 && norm(s).includes(want)));
    return hit === undefined ? { ok: false } : { ok: true, v: hit, key: seg };
  }
  if (isObj(v)) {
    if (seg in v) return { ok: true, v: v[seg], key: seg };
    const ks = Object.keys(v);
    const k = ks.find((x) => norm(x) === want) ?? (want ? ks.filter((x) => norm(x).startsWith(want)).sort((a, b) => a.length - b.length)[0] : undefined);
    return k === undefined ? { ok: false } : { ok: true, v: v[k], key: k };
  }
  return { ok: false };
}
export const segments = (path: string) => path.split(/[/>›]/).map((s) => s.trim()).filter(Boolean);

/** The node at a path, or why not (what is there instead). */
export function at(root: unknown, path: string[]): { v: unknown; key: string; trail: string } | { error: string } {
  let v = root, key = "", trail: string[] = [];
  for (const seg of path) {
    const s = step(v, seg);
    if (!s.ok) {
      const here = trail.join("/") || "the top";
      const has = Array.isArray(v) ? v.slice(0, 20).map((x, i) => labelOf(x, i)) : isObj(v) ? Object.keys(v).slice(0, 30) : [];
      return { error: `No "${seg}" in ${here}.${has.length ? ` It has: ${has.join(", ")}.` : ""}` };
    }
    v = s.v; key = s.key; trail.push(Array.isArray(v) ? s.key : s.key);
  }
  return { v, key, trail: trail.join("/") };
}

/** Every value whose path or text has the words, the best first: "codex" finds the Codex plan's every number. */
export function search(root: unknown, query: string, n = 30, now = Date.now()): string[] {
  const STOP = new Set(["the", "a", "an", "my", "of", "in", "on", "is", "what", "whats", "how", "much", "many", "for", "show", "me", "and", "to", "it", "its"]);
  const ws = words(query).filter((w) => !STOP.has(w));
  if (!ws.length) return [];
  const hits: { score: number; line: string; depth: number }[] = [];
  const walk = (v: unknown, trail: string[], depth: number) => {
    if (depth > 12 || hits.length > 4000) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, [...trail, labelOf(x, i)], depth + 1)); return; }
    if (isObj(v)) { for (const [k, x] of Object.entries(v)) walk(x, [...trail, k], depth + 1); return; }
    const text = `${trail.join(" ")} ${typeof v === "string" ? v : ""}`.toLowerCase();
    const score = ws.filter((w) => text.includes(w)).length;
    if (score) hits.push({ score, depth, line: `${trail.join("/")}: ${scalar(trail[trail.length - 1] ?? "", v, now, 140)}` });
  };
  walk(root, [], 0);
  const best = Math.max(0, ...hits.map((h) => h.score));
  return hits.filter((h) => h.score === best).sort((a, b) => a.depth - b.depth).slice(0, n).map((h) => h.line);
}

// ---- usage insights, summed up ------------------------------------------------------------

/** The usage log's lines (core/usage.js), summed up as the person would ask about them: since when, how much of each,
 *  where time went, which controls and features, errors, how long asks waited. Kinds, ids, counts and times only. */
export function insightsSummary(lines: string[], on: boolean, days = 30, now = Date.now()) {
  const since = now - days * 86400_000;
  const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && typeof e.at === "number" && e.at >= since);
  const count = (xs: string[]) => Object.fromEntries(Object.entries(xs.reduce((m: Record<string, number>, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 15));
  const minutes = (pairs: [string, number][]) => Object.fromEntries(Object.entries(pairs.reduce((m: Record<string, number>, [k, ms]) => ((m[k] = (m[k] ?? 0) + ms), m), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => [k, `${Math.round(ms / 60000)} min`]));
  const of = (k: string) => ev.filter((e) => e.kind === k);
  const asks = of("ask").map((e) => e.ms).filter((x) => typeof x === "number").sort((a, b) => a - b);
  return {
    on,
    days,
    events: ev.length,
    first: ev.length ? Math.min(...ev.map((e) => e.at)) : null,
    last: ev.length ? Math.max(...ev.map((e) => e.at)) : null,
    kinds: count(ev.map((e) => e.kind)),
    from: count(ev.map((e) => e.from ?? "unknown")),
    time_on_screens: minutes(of("view").filter((e) => typeof e.ms === "number").map((e) => [`${e.view ?? "?"}${e.tab ? ` ${e.tab}` : ""}${e.section ? ` ${e.section}` : ""}`, e.ms])),
    actions: count(of("act").map((e) => e.type ?? "?")),
    features: count(of("feature").map((e) => e.type ?? "?")),
    errors: count(of("error").map((e) => `${e.type ?? "?"}${e.status ? ` ${e.status}` : ""}`)),
    messages_sent: of("send").length,
    asks: { closed: asks.length, median_wait: asks.length ? `${Math.round(asks[Math.floor(asks.length / 2)] / 60000)} min` : null, by_type: count(of("ask").map((e) => e.type ?? "?")) },
  };
}
