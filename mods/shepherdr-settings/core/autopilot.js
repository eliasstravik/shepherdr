// Autopilot's words and picks, the same in the window (Settings › Autopilot: mods/shepherdr-settings/autopilot-section.js;
// the header's switch: mods/pane-chat/autopilot.js) and on the web (service/compat.ts, web/plugins/coordinators).
// Set as Tasks is: Everywhere's heartbeat, schedule and events, and a space's own where it sets one (Shepherdr settings,
// ~/.config/shepherdr/settings.json "autopilot" = { every, events, heartbeat } in "everywhere" and in "spaces"[id], travelling
// to every machine with the rest). A space switches it on or off in its Assistant's header. herdr-task keeps each
// space's switch and how its wakes go (mods/tasks/bin/herdr_task/autopilot.py, ~/.local/share/shepherdr/tasks/.autopilot.json, whose
// "everywhere" {every, events} and the heartbeat file everywhere.md are Everywhere's from before Settings kept them,
// still read where Settings sets none). pilotFor() is herdr-task's resolve(), for the header, which reads the files
// itself, and for a space herdr-task has no record of yet; core/autopilot.cases.json holds the cases both sides are
// tested on (core/autopilot.test.js, test/test_herdr_task.py).
// Shared core: the source is core/autopilot.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const TITLE = "Autopilot";
export const ABOUT = "Turn it on in a space with the switch in its Assistant's header: its Assistant then wakes on a schedule "
  + "or when something happens to its tasks. By default it unblocks and checks what's open, then adds and starts the next "
  + "most useful tasks to push the project forward, toward the space's Direction (none: what the project itself shows). "
  + "It acts on its own and makes the calls itself, never asking you; it only alerts you for something critical "
  + "(money, publishing, deleting data, security, or stuck). It never merges or accepts: that stays yours.";
// The fields a space can set its own of (Shepherdr settings' "autopilot"). direction: one line that steers it (a space's).
export const FIELDS = ["heartbeat", "every", "events", "direction"];

// Each row's label and its line under it.
export const ROWS = {
  direction: { label: "Direction", about: "One line it steers toward in this space. Empty: it works out what matters most from the project itself." },
  heartbeat: { label: "Heartbeat", about: "What it works from: direction, priorities, limits and when to stop." },
  every: { label: "Schedule", about: "When it wakes by itself." },
  events: { label: "Events", about: "These wake a space's Assistant at once when they happen to its tasks." },
};

// The schedule's picks (herdr-task's --every words); anything else is Custom.
export const PRESETS = [["", "Off"], ["every 30 minutes", "Every 30 min"], ["every 60 minutes", "Every hour"], ["weekdays 9:00", "Weekdays 9:00"]];
export const CUSTOM = "Custom…";
export const CUSTOM_PLACEHOLDER = "Every 2 hours on weekdays";
export const CUSTOM_HINT = "Like \"every 2 hours on weekdays from 8:00 to 18:00\". Saved when you leave the box.";
// The task events that wake it (herdr-task's EVENTS, in its order).
export const EVENTS = [["added", "Added"], ["ready", "Ready"], ["failed", "Failed"], ["needs-you", "Needs you"], ["merged", "Merged"], ["stalled", "Stalled"]];

// The heartbeat box: saved a moment after typing stops, and on leaving it; "Saved" shows dim for a moment after.
export const SAVED = "Saved";
// The Direction box: one line, kept when you leave it (herdr-task: DIRECTION_MAX).
export const DIRECTION_PLACEHOLDER = "Like \"get the checkout flow ready to launch\"";
export const DIRECTION_MAX = 300;
export const directionOf = (words) => String(words ?? "").replace(/\s+/g, " ").trim().slice(0, DIRECTION_MAX);
export const SAVE_AFTER_MS = 600;
export const NO_HEARTBEAT = "Couldn't make the heartbeat file.";

// The heartbeat Everywhere has until someone writes one (autopilot.py STARTER, the same words): a real one, ready to use
// as it is in any project; the person edits it, Everywhere's or a space's own, to steer.
export const STARTER = `Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine. Never park on a task waiting for my Accept: go on with work that doesn't need it (step 4), and each wake it still holds tasks back, say in one line what waits on my Accept.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress: facts and your next step, never a limit of your own. Only this heartbeat and I set limits.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before, except what still waits on me. When there's truly nothing worth doing (nothing to unblock, check or start, and no next task worth adding), end with <hc no-reply why="what you checked and what it waits on"/>, never a bare <hc no-reply/>.

Stopping goal: none. Runs until I switch it off.
`;

// Everywhere's until set (herdr-task: everywhere_default).
export const DEFAULT = { every: "every 60 minutes", events: [] };
// Starters earlier versions wrote (herdr-task: OLD_STARTERS): one never edited stands for today's.
export const OLD_STARTERS = [`Direction: push this project forward on your own, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

You decide, I steer later: make every call yourself, taste and product choices too. Pick the best option, act on it, and tell me in one line what you chose and why, so I can redirect you. Never ask me a question on a wake; only a take-over (below) stops for me.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why and unblock it yourself (nudge, resume, fix). A worker's question or choice: answer it yourself with the best option. Only a take-over waits for me.
2. Ready: check the work (diff, checks, proof). A clear defect: send it back saying what's wrong. Looks right: say so in one line; Accepting stays mine.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Pick the most valuable next tasks yourself, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Take over: the only time you stop for me. Something irreversible or outside this space that can't wait (spending money, deploying or publishing outside this space, pushes to main, emails or posts, deleting data, credentials, a security problem), or you're stuck on the same thing after retrying twice. Then don't do it: send one herdr-task alert "<what>" --body "<why>", say it in one line, and carry on with other work.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Never do a take-over thing yourself: alert me instead.
- Work only through herdr-task tasks; never write the code yourself.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines on what you did and chose, never a question; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding.

Stopping goal: none. Runs until I switch it off.
`, `Direction: push this project forward, without wasting my time or money. Follow this space's Direction when it has one; with none, work out what matters most from the project itself.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. Push the project forward: look at the project itself (README, docs and goals, recent commits and merged tasks, open GitHub issues and PRs, TODOs, failing or missing tests, your saved progress and what I asked for lately). Add the most valuable next tasks, each with a full brief (what, why, how to check it's done), and start them within the queue. At most 2 a wake; never one that repeats an open or recent task or an old ask I dropped. Tell me in one line what you started and why.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: add and start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Reply only <hc no-reply/> when there's truly nothing worth doing: nothing to unblock, check or start, and no next task worth adding. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
`, `Direction: keep this space's tasks moving to done, without wasting my time or money. Don't invent work or redo old asks from past chats.

Each wake: first what woke you, then in order:
1. Needs you, failed or stalled: look why. Unblock what you can (nudge, resume, fix); what only I can answer, ask me once, in one clear question.
2. Ready: check the work (diff, checks, proof). Tell me in a line if it looks right to Accept; a clear defect, send it back saying what's wrong.
3. To do: start the ones with a clear brief that nothing blocks; the queue limits how many run. Leave a task that's working fine alone.
4. New tasks: only follow-ups I asked for or a finished task named. At most 2 a wake, each with a full brief.
5. End by saving progress and your next step.

Limits:
- Never merge, Accept, mark done, delete or stop work: that's mine.
- Ask before anything risky, costly or outside this space (deploys, pushes to main, emails, posts, payments, sign-ups).
- Work only through herdr-task tasks; never write the code yourself.
- Same thing failed twice: stop retrying and tell me.
- 3 or more tasks waiting on me: start nothing new.
- Keep a wake short: a few minutes of your own work.

Reporting: one or two short plain lines, only what's new that I must know or decide; never repeat what you told me before. Nothing new: reply only <hc no-reply/>, never with other words. Alert me only for what can't wait (something down, work at risk).

Stopping goal: none. Runs until I switch it off.
`, `Direction: what Autopilot works toward in this space.

Priorities:
-

Constraints: what it must not do (e.g. never merge; ask before anything risky).

Reporting: what to tell me after a wake, and when to alert me.

Stopping goal (optional): a finite goal; when it's proven, Autopilot turns itself off.
`];
// A heartbeat's words, an earlier version's starter as today's (herdr-task: current).
export const currentBeat = (words) => (OLD_STARTERS.some((x) => x.trim() === String(words ?? "").trim()) ? STARTER : words);
// A heartbeat nobody wrote: empty (the starter is a real one; herdr-task: blank).
export const blankBeat = (words) => !String(currentBeat(words) ?? "").trim();

const textOf = (e) => (e && typeof e === "object" ? e.text ?? null : e || null);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k) && o[k] !== undefined;
// Events in herdr-task's order, each once.
export const eventsIn = (list) => EVENTS.map(([v]) => v).filter((v) => (list ?? []).includes(v));

// Everywhere's schedule (its words as written) and events, from the file's "everywhere" (or herdr-task's view of it).
export function everywhereOf(file) {
  const e = file?.everywhere ?? {};
  return { every: has(e, "every") ? textOf(e.every) : DEFAULT.every, events: eventsIn(has(e, "events") ? e.events : DEFAULT.events),
    ...(e.trigger ? { trigger: e.trigger } : {}) };
}

// A level's Autopilot in Shepherdr settings (null: Everywhere's), only what it sets: { every, events, heartbeat }.
export function levelOf(settings, space = null) {
  const a = (space ? settings?.spaces?.[space] : settings?.everywhere)?.autopilot;
  if (!a || typeof a !== "object") return {};
  return Object.fromEntries(FIELDS.filter((k) => a[k] !== undefined && a[k] !== null).map((k) => [k, a[k]]));
}
const ruleText = (x) => { const t = String(x ?? "").trim(); return !t || /^(off|none|never)$/i.test(t) ? null : t; };

// What applies in a space: its own on/off (off until switched on); the schedule and events it sets in Shepherdr
// settings, else Everywhere's there, else Everywhere's from before (file.everywhere), else the defaults; own: what it
// sets itself. Everything else its record holds (next_run, pending, last_wake, progress…) comes along as it is.
// file.spaces: the file's map, or herdr-task's list of views (already what applies: taken as they are).
export function pilotFor(file, space, settings = null) {
  const list = file?.spaces;
  if (Array.isArray(list)) {
    const v = list.find((x) => x.space === space);
    if (v) return v;
  }
  const a = (Array.isArray(list) ? null : list?.[space]) ?? {};
  const e = everywhereOf(file);
  const own = [];
  for (const [layer, mine] of [[levelOf(settings), false], [levelOf(settings, space), true]]) {
    if (typeof layer.every === "string") { e.every = ruleText(layer.every); if (mine) own.push("every"); }
    if (Array.isArray(layer.events)) { e.events = eventsIn(layer.events); if (mine) own.push("events"); }
    if (mine && typeof layer.heartbeat === "string") own.push("heartbeat");
    if (mine && typeof layer.direction === "string" && layer.direction.trim()) own.push("direction");
  }
  return { ...a, space, on: Boolean(a.on), every: e.every, events: e.events, own, ...(e.trigger && !a.trigger ? { trigger: e.trigger } : {}) };
}

// A schedule's pick: its preset's value, else null (Custom).
export const presetOf = (every) => {
  const v = String(every ?? "").trim().toLowerCase();
  return PRESETS.find(([x]) => x === v)?.[0] ?? null;
};

export function when(ms, today = new Date()) {
  if (!ms) return "";
  const d = new Date(ms);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  return `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} ${hm}`;
}

// What follows "Autopilot" in an Assistant's header while on: waking (a wake's turn runs), queued (waits for an idle
// Assistant), the next scheduled wake ("Next in 7 min" within the hour, "Next 14:30" within a day, else "Next Fri"),
// else what wakes it ("On events"; neither: "No schedule", it wakes only on Run now). Nothing while off. A screen
// showing it looks again each half minute or so.
export function headerDetail(a, now = Date.now()) {
  if (!a?.on) return "";
  if (a.inflight) return "Waking";
  if (a.pending) return "Queued";
  if (a.next_run) {
    const d = new Date(a.next_run), left = a.next_run - now;
    if (left < 60000) return "Next in 1 min";
    if (left < 3600000) return `Next in ${Math.ceil(left / 60000)} min`;
    return left < 86400000 ? `Next ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : `Next ${d.toLocaleDateString("en", { weekday: "short" })}`;
  }
  return a.events?.length ? "On events" : "No schedule";
}

// What a header shows the moment its switch is flipped, until herdr-task's answer comes (SHEP-52): switched on, it
// wakes at once (herdr-task queues its first wake), so "Waking" rather than the off record's empty schedule; switched
// off, nothing waits.
export function flipped(a, on) {
  return on ? { ...a, on: true, inflight: a?.inflight || { reason: "switched on" } }
    : { ...a, on: false, next_run: null, pending: null, inflight: null };
}
