// Shared core: the source is core/chat-view.js; bin/sync-shared copies it into mods/chat/core/. Edit it here.
// The chat's rows as the window's chat (mods/chat) draws them and the web app's chat (web/plugins/chat) draws them
// too: their words, a message's time, who sent a message, a launch brief's label, a task's news line, which
// artifact a publish made, how images under a message are sized. Plain JS: no herdr, node or DOM.

// Every fixed word the chat shows, once: both sides read them from here (core/chat-view.test.js checks).
export const WORDS = {
  top: "Start of conversation",
  loading: "Loading earlier…",
  find: "Find in chat",
  noMatches: "No matches",
  searchEarlier: "Search earlier",
  needsYou: "Needs you",
  askingInTerminal: "The agent is asking something in the terminal.",
  openTerminal: "Open terminal",
  replyInstead: "Reply instead…",
  showMore: "Show more",
  showLess: "Show less",
  queued: "Queued · Sends when the agent is free",
  // typed while it works: in its CLI's queue, taken at its next step (Claude Code's own queue)
  inQueue: "Queued · it reads it at its next step",
  sendNow: "Send now",
  ended: "This task's agent has ended.",
  resuming: "Resuming…",
  emptyTitle: "What should the Assistant do?",
  emptyBody: "It plans the work, starts a task for each part and keeps you posted.",
  late: "Not in the conversation. Check the terminal.",
  // an Assistant asked for on a machine that's offline: its first message waits for it
  offline: (machine) => `${machine} is offline. The Assistant starts when it's back.`,
  publishing: "Publishing an artifact…",
  stopping: "Stopping…",
  working: "Working",
  asked: "Asked you",
  askedAnswered: "Asked you · Answered",
  askedClosed: "Asked you · Closed without an answer",
  attach: "Attach files",
  latest: "Latest",
  // A full-size notice instead of the conversation.
  opening: "Opening the conversation…",
  restarting: "Restarting the agent…",
  agentEnded: "This agent has ended",
  taskEnded: "This task's agent has ended",
  unsupported: "No chat for this agent",
  unsupportedBody: "Chat reads Claude Code's and Codex's own session logs. This agent works in its terminal only.",
  notFound: "Can't find this conversation",
  notFoundBody: "Chat reads the agent's own session log, and Herdr can't tell which one this agent writes. Rather than show the wrong one, it shows none.",
  noAgent: "No agent to show",
  noAgentBody: "This chat pane isn't tied to an agent.",
  startingAssistant: "Starting the Assistant…",
  sessionGone: "Earlier session was gone, starting a new one…",
};

// ---- a session that is gone ------------------------------------------------------------------
// Claude Code: "No conversation found with session ID: …". Codex: "ERROR: No saved session found with ID …".
export const LOST = /\bno (?:saved )?(?:conversation|session|rollout)\b.*\bfound\b|\b(?:conversation|session)\b.*\bnot found\b/i;
// What a new agent hears when its earlier session is gone (Shepherdr's words); the chat shows it as one quiet row.
export const FRESH = "Your earlier session is gone, so this is a new one that remembers none of it. Check what is already here and preserve existing work.";
// The new agent's first message: the handover, its task (a worker's), and an Assistant's role again (its template's
// words, after the front matter).
export function lostMessage({ ref = null, template = null } = {}) {
  let msg = `<restart>${FRESH}</restart>`;
  if (ref) msg += `\n\nYou work on task ${ref}: read its brief with \`herdr-task show ${ref}\` and carry on from what is already done.`;
  const body = String(template ?? "").split(/^---[ \t]*$/m).slice(2).join("---").trim();
  if (body) msg = `${msg}\n\n${body}`;
  return msg;
}
// A word for a shell line, quoted when it needs it.
export const shellWord = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'"'"'`)}'`);
export const sessionStarted = "Earlier session was gone, started a new one.";
export const sessionFailed = (why) => `Earlier session was gone, and a new one didn't start: ${why}`;

// "1 image", "3 images": images sent with a message whose files the chat can't show.
export const imagesLine = (n) => (n === 1 ? "1 image" : `${n} images`);
// Scrolled up: cards waiting below what shows ("1 question below"), else Latest.
export const questionsBelow = (n) => (n === 1 ? "1 question below" : n ? `${n} questions below` : WORDS.latest);
// A message that didn't go: why, and that a press sends it again.
export const notSent = (why) => `Not sent: ${String(why ?? "").replace(/\.$/, "")}. Click to try again.`;
// An earlier publish of an artifact, as one quiet line; the latest one's card.
export const published = (title, v) => `Published ${title} v${v}`;
export const artifactLine = (v) => `Artifact · v${v}`;
// m:ss, for the working line, a recording and a call.
export const elapsed = (secs) => `${Math.floor(Math.max(0, secs) / 60)}:${String(Math.floor(Math.max(0, secs)) % 60).padStart(2, "0")}`;

// What the agent's CLI says it does or waits for now (its status report: Claude Code's "Computing build times", a
// question's "answer: …"), from its terminal. The window's terminals() hands it over as `report`; herdr-core's own
// record (the service's) keeps it in `status`, an object while the CLI reports one. "" when it says nothing.
export function reportMsg(t) {
  for (const r of [t?.report, t?.status]) if (r && typeof r === "object" && typeof r.msg === "string" && r.msg.trim()) return r.msg.trim();
  return "";
}
// The working line's words: the call its log has open now, else its status report (not a question), else null
// (the line says Working).
export const doingWords = (conv, report) => conv?.doing ?? (report && !/^answer:/i.test(report) ? report : null);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// The calendar day a time falls on, to tell where a new one starts.
export const dayOf = (at) => dayStart(new Date(at));

// A day's line between messages: Today, Yesterday, a weekday this week, else its date (and year, if not this one).
export function dayLabel(at, now = new Date()) {
  const d = new Date(at);
  const days = Math.round((dayStart(now) - dayStart(d)) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return DAYS[d.getDay()];
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}
// A message's time under it: 14:05 today, else 3 Nov 14:05.
export function clock(at, now = new Date()) {
  if (!at) return "";
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

// The actions under a message, in order: reply and copy; then the CLI's rewind on your own (not a /command, not one
// another agent sent), or its fork on the agent's (when the CLI is known).
export function bandActs(side, text, { from = null, fork = true } = {}) {
  if (side === "user") return ["reply", "copy", ...(/^\//.test(String(text ?? "")) || from ? [] : ["rewind"])];
  return ["reply", "copy", ...(fork ? ["fork"] : [])];
}

// The whole band, in order from left to right (DECISIONS, Chat > Message actions): the reaction pills flush under the
// bubble's outer edge with the smiley beside them, each side the other's mirror. Yours: the time, its actions, the
// smiley, then the pills furthest right; the agent's: the pills furthest left, the smiley, its actions reversed and
// the time at the inner end. `acts`: bandActs(); `time` false leaves the time out, `react` false the smiley.
export function bandOrder(side, acts, { time = true, react = true } = {}) {
  const lead = [...(time ? ["time"] : []), ...acts];
  const smiley = react ? ["react"] : [];
  return side === "user" ? [...lead, ...smiley, "pills"] : ["pills", ...smiley, ...lead.reverse()];
}

// A message another agent sent with hc often names its sender in its first words ("From HERD-76 (t12u?): …", "From
// the person's Assistant on m3 (t10v): …"). The
// quiet row already says who, so its preview starts after them; the name stands in when the sender's address is
// unknown.
const SIGNED = /^\s*(?:\*\*)?(?:[Mm]essage\s+)?[Ff]rom\s+(?:the person's\s+|your\s+)?([A-Z][\w.-]*(?:\s+[\w.-]+){0,2}?)\s*(?:\([^)\n]{0,40}\))?\s*:(?:\*\*)?\s*/;
export const signedBy = (text) => SIGNED.exec(String(text ?? ""))?.[1]?.trim() || null;
export const unsigned = (text) => String(text ?? "").replace(SIGNED, "");

// A sender outside any terminal: from="<machine>/ppid:123" (a script, a service, or a window that named its process).
export const outsideTerminal = (from) => /(^|\/)ppid:\d+$/.test(String(from ?? "").trim().split(/\s+/)[0]);

// The person's own words that came wrapped as a message from outside any terminal (a window or service on another
// machine whose send named its process, before SHEP-3): each one the person sent from this chat moments before with the
// same words (matches(u, p): the chat's own test that the log's message u is its pending send p). A message from a
// terminal (an agent) never counts, nor one nobody here just sent. users: the log's user messages; -> their ids.
export function ownWords(users, pending, matches) {
  const ids = [];
  for (const p of pending ?? []) {
    const u = (users ?? []).find((u) => !ids.includes(u.id) && matches(u, p));
    if (u?.from && outsideTerminal(u.from)) ids.push(u.id);
  }
  return ids;
}

// Who sent a message with hc (<hc from="t7 herd-12-fix-login">): its role or task as people know it ("Reviewer",
// "HERD-12", "Assistant on vm-ssa"), never its terminal address. An artifact's form says its title; the person's own
// lines (a kept secret) are "You". A sender outside any terminal (from="<machine>/ppid:123") or one gone goes by the
// name it signed the message with, else "Another agent".
//   find(address): that terminal ({ name, labels, template }), else null; machine: the chat's agent's machine (null:
//   here); taskOf(address): the task ref whose worker that is, else null; here: this machine's own name in
//   herdr-core: another machine's agent writes our terminals as "<here>/t75", our list has them as "t75"; machineName(key):
//   the name people read for a machine ("Mac mini"), else null (its key then).
export function senderName(from, text = null, { find = () => null, machine = null, taskOf = () => null, here = null, machineName = () => null } = {}) {
  const [addr, ...rest] = String(from ?? "").trim().split(/\s+/);
  const signed = signedBy(text);
  if (addr === "person") return "You";
  if (outsideTerminal(addr)) return signed || "Another agent";
  if (!/^([\w.-]+\/)?t\d[0-9a-z]*$/.test(addr ?? "")) return String(from);
  // A bare address is on the machine of the agent it was sent to.
  const full = !addr.includes("/") && machine ? `${machine}/${addr}` : addr;
  const local = here && full.startsWith(`${here}/`) ? full.slice(here.length + 1) : null;
  const k = find(full) ?? (local ? find(local) : null);
  const l = k?.labels ?? {}, name = rest.join(" ") || k?.name || "";
  // Where it runs (null: here), said when that isn't where the chat's agent is.
  const at = local ? null : full.includes("/") ? full.split("/")[0] : null;
  const away = at !== machine && (at ?? here) ? ` on ${machineName(at ?? here) || (at ?? here)}` : "";
  if (l["herdr.role"] === "reviewer" || /\breview/i.test(name)) return "Reviewer";
  if (l["herdr.role"] === "coordinator" || /^(herdr-)?(assistant|coordinator)\b/.test(k?.template ?? "") || /^coord/i.test(name)) return `Assistant${away}`;
  const task = taskOf(full) ?? (local ? taskOf(local) : null) ?? /^([a-z][a-z0-9]*)-(\d+)(?:-|$)/i.exec(name)?.slice(1, 3).join("-").toUpperCase();
  if (task) return `${task}${away}`;
  if (!name && signed && / on /.test(signed)) return signed;
  return `${name || signed || "Another agent"}${away}`;
}

// Agent to agent, as a group chat (SHEP-27). Who sent a user item another agent sent: another Assistant's
// (<herdr-assistant>, x.assistant: { machine, space }) by its machine and space ("Assistant on Mac mini · Home"; its
// machine unsaid when it is this one), else senderName's ("SHEP-4", "Reviewer", "Assistant on m3").
//   sender(from, text): senderName with the chat's lookups; machineName(key): the name people read for a machine
//   key (null: unknown); here: this machine's key in herdr-core.
export function fromName(x, sender = (f) => f, { machineName = (m) => m, here = null } = {}) {
  const a = x?.assistant;
  if (!a) return sender(x?.from, x?.text);
  const m = a.machine && a.machine !== here ? machineName(a.machine) || a.machine : null;
  return `Assistant${m ? ` on ${m}` : ""}${a.space ? ` · ${a.space}` : ""}`;
}

// Whom a message the chat's agent sent went to (a "sent" item: { to, how }): a terminal by senderName ("SHEP-4",
// "Assistant on m3"); tell-assistant's target is an Assistant, by its address or its space's name ("Assistant ·
// Home").
export function sentTo(x, sender = (f) => f) {
  const to = String(x?.to ?? "");
  const address = /^([\w.>-]+\/)?t\d[0-9a-z]*$/.test(to);
  if (x?.how !== "assistant") return address ? sender(to.split(">").pop()) : to;
  if (!address) return `Assistant · ${to}`;
  return String(sender(to.split(">").pop())).replace(/^(Another agent|t\d[0-9a-z]*)\b/, "Assistant");
}

// Who the chat's own agent is in its group chat: "Assistant" for a space's, its task's ref for a task's worker, else
// its CLI's name ("Claude").
export function selfName({ assistant = false, task = null, kind = null } = {}) {
  if (assistant) return "Assistant";
  if (task) return task;
  return { claude: "Claude", codex: "Codex" }[kind] ?? "Agent";
}

// A name's initial for its avatar: a task ref's letters ("SHEP-4" → "S"), else its first letter.
export const initialOf = (name) => (String(name ?? "").trim().match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();

// A user message the person didn't type, in words for its quiet row, else null: the session's first message when the
// agent was started from a template (a coordinator), as a handoff, or for a task (herdr-task); and any message
// another agent sent with hc. i: its place in the conversation; start: the first byte read (0: the log's start).
export function briefLabel(x, i, { start = null, template = null, task = false, sender = (f) => f, machineName = (m) => m, here = null } = {}) {
  if (x.from) return `Message from ${fromName(x, sender, { machineName, here })}`;
  if (i !== 0 || start !== 0) return null;
  if (/^<restart>/.test(x.text ?? "")) return "New session";
  if (/^You are taking over this tab/.test(x.text ?? "") || /^herdr-handoff/.test(template ?? "")) return "Handoff from the previous agent";
  if (template) return "New session";
  if (task) return "Task brief";
  return null;
}

// A task's news line: { mark (its dot), what (happened), text (the rest) }. Herdr's line is "HERD-4 needs you: Needs
// a go (Fix login)", "HERD-4 is ready: Fix login · summary", ...: without the id and the title, split at its first
// ": ". e: { ref, event, text, made } (made: from the task's own record, not a line Herdr sent); x: the task.
export function newsWords(e, x) {
  const mark = { started: "started", "working-again": "started", "needs-you": "needs", failed: "needs", ready: "ready", done: "done" }[e.event] ?? "other";
  const title = x?.title ?? "", one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  if (e.made) return { mark, what: e.event, text: e.event === "ready" ? one(x?.summary) || title : title };
  let s = one(e.text);
  if (s.startsWith(`${e.ref} `)) s = s.slice(e.ref.length + 1);
  // Every line but ready's ends with the title in brackets.
  let named = title;
  if (e.event !== "ready") {
    const m = title && s.endsWith(` (${one(title)})`) ? [null, one(title)] : / \(([^()]*)\)$/.exec(s);
    if (m) { named = m[1]; s = s.slice(0, s.length - m[1].length - 3); }
  }
  const i = s.indexOf(": ");
  const what = (i < 0 ? s : s.slice(0, i)).replace(/^is /, "") || e.event;
  let text = i < 0 ? "" : s.slice(i + 2);
  if (e.event === "ready") {
    text = text.replace(/ · For AGENTS\.md: .*$/, "");
    if (title && text.startsWith(one(title))) text = text.slice(one(title).length).replace(/^ · /, "") || one(title);
  }
  if (e.event === "done") text = named;
  return { mark, what, text };
}

// The lines a space's tasks make in its Assistant's chat, in time order, each { id, at, ref, event, text, made }:
// Herdr's news in the conversation (items of kind "news") as said, and a start, ready or done it never said here
// (before this log's first page, or not sent) from the task's own started / ready_at / done_at. tasks: Map ref -> task.
// Each comes with live (needs you still, red) and accept (the newest ready line of a task still Ready).
export function newsTimeline(items, tasks, { start = null } = {}) {
  const all = [], said = new Set();
  for (const it of items) if (it.kind === "news") { said.add(`${it.ref}:${it.event}`); all.push(it); }
  const first = items.find((x) => x.at)?.at ?? 0;
  for (const [ref, x] of tasks) for (const [event, at] of [["started", x.started], ["ready", x.ready_at], ["done", x.done_at]]) {
    if (!Number.isFinite(at) || said.has(`${ref}:${event}`) || (at < first && start !== 0)) continue;
    all.push({ id: `tn:${ref}:${event}:${at}`, at, ref, event, text: "", made: true });
  }
  all.sort((a, b) => a.at - b.at);
  const last = new Map(), lastReady = new Map();
  for (const e of all) { last.set(e.ref, e); if (e.event === "ready") lastReady.set(e.ref, e); }
  return all.map((e) => {
    const x = tasks.get(e.ref);
    return { ...e, ...newsWords(e, x), live: last.get(e.ref) === e && (e.event === "needs-you" || e.event === "failed") && x?.status === "needs",
      accept: lastReady.get(e.ref) === e && x?.status === "ready" };
  });
}

// Which artifact each publish in the conversation made: the first version this agent published from a few seconds
// before the call to five minutes after, not already taken. items: the conversation's; arts: the registry's
// artifacts ({ id, title, version, versions: [{ v, at, publisher }] }); me: the agent's terminal (no machine).
// -> Map item id -> { id, title, version (its latest), v (this publish's), latest (the last publish of it here) }.
export function resolveArtifacts(items, arts, me) {
  const out = new Map();
  const calls = items.filter((x) => x.kind === "artifact");
  if (!calls.length || !arts?.length) return out;
  const vs = arts.flatMap((a) => (a.versions ?? []).filter((v) => v.publisher === me).map((v) => ({ a, v }))).sort((p, q) => p.v.at - q.v.at);
  const used = new Set();
  for (const x of calls) {
    const at = x.at ?? 0;
    const hit = vs.find(({ a, v }) => !used.has(`${a.id}:${v.v}`) && v.at >= at - 5000 && v.at <= at + 300000);
    if (!hit) continue;
    used.add(`${hit.a.id}:${hit.v.v}`);
    out.set(x.id, { id: hit.a.id, title: hit.a.title, version: hit.a.version, v: hit.v.v });
  }
  const last = new Map();
  for (const [k, r] of out) last.set(r.id, k);
  for (const [k, r] of out) r.latest = last.get(r.id) === k;
  return out;
}

// Image thumbnails under a message: each image whole, its shape kept, fitted in THUMB_ONE (one image) or THUMB_MANY
// (w, h), never above its own size, all shrunk together when the row would pass the column (width). sizes: each
// image's { w, h }, or null until known (a 4:3 box). -> { boxes: [{ w, h }], h: the row's height }.
export const THUMB_ONE = [320, 220], THUMB_MANY = [200, 140], THUMB_GAP = 6;
export function fitThumbs(sizes, width = Infinity) {
  const [mw, mh] = sizes.length > 1 ? THUMB_MANY : THUMB_ONE;
  let boxes = sizes.map((v) => {
    if (!v?.w || !v?.h) return { w: Math.round((mh * 4) / 3), h: mh };
    const k = Math.min(1, mw / v.w, mh / v.h);
    return { w: Math.max(24, Math.round(v.w * k)), h: Math.max(24, Math.round(v.h * k)) };
  });
  const total = boxes.reduce((n, b) => n + b.w, 0) + THUMB_GAP * (boxes.length - 1);
  const k = Math.min(1, width / Math.max(1, total));
  if (k < 1) boxes = boxes.map((b) => ({ w: Math.floor(b.w * k), h: Math.floor(b.h * k) }));
  return { boxes, h: Math.max(24, ...boxes.map((b) => b.h)) };
}
