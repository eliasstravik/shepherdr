// Autopilot's words, picks and inherit rule, the same in the window (Settings › Autopilot:
// mods/shepherdr-settings/autopilot-section.js; the header's switch: mods/pane-chat/autopilot.js) and on the web
// (service/compat.ts, web/plugins/coordinators). herdr-task keeps the data (mods/tasks/bin/herdr_task/autopilot.py,
// ~/.herdr/tasks/.autopilot.json): Everywhere's switch, schedule and events ("everywhere"), and each space's own
// where it sets them ("spaces": a key there is that space's own; missing, it follows Everywhere). The heartbeat is a
// file: Everywhere's, or a space's own once it has words. pilotFor() is herdr-task's resolve(), for a space it has
// no record of yet and for the header, which reads the file itself; core/autopilot.cases.json holds the cases both
// sides are tested on (core/autopilot.test.js, test/test_herdr_task.py).
// Shared core: the source is core/autopilot.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const TITLE = "Autopilot";
export const ABOUT = "Its Assistant wakes on a schedule or when something happens to its tasks, and works from the heartbeat.";
export const EVERYWHERE_ABOUT = `For every space on this computer, unless one sets its own. ${ABOUT}`;

// Each row's label, and its line on Everywhere's page (all) and in a space's (space).
export const ROWS = {
  on: { label: "Autopilot", all: "On in every space that doesn't set its own.", space: "On for this space's Assistant." },
  heartbeat: { label: "Heartbeat", all: "What it works from: direction, priorities, limits and when to stop.", space: "What it works from: direction, priorities, limits and when to stop." },
  every: { label: "Schedule", all: "When it wakes by itself.", space: "When it wakes by itself." },
  events: { label: "Events", all: "These wake a space's Assistant at once when they happen to its tasks.", space: "These wake it at once when they happen to this space's tasks." },
  run: { label: "Run now", on: "Wakes it now, or as soon as it's idle.", off: "Turn Autopilot on first." },
};
// The fields a space follows Everywhere for, until it sets its own (herdr-task: OWN_FIELDS, and the heartbeat file).
export const FIELDS = ["on", "every", "events", "heartbeat"];
export const FIELD_WORDS = { on: "On or off", every: "Schedule", events: "Events", heartbeat: "Heartbeat" };

// The schedule's picks (herdr-task's --every words); anything else is Custom.
export const PRESETS = [["", "Off"], ["every 30 minutes", "Every 30 min"], ["every 60 minutes", "Every hour"], ["weekdays 9:00", "Weekdays 9:00"]];
export const CUSTOM = "Custom…";
export const CUSTOM_PLACEHOLDER = "Every 2 hours on weekdays";
export const CUSTOM_HINT = "Like \"every 2 hours on weekdays from 8:00 to 18:00\". Saved when you leave the box.";
// The task events that wake it (herdr-task's EVENTS, in its order).
export const EVENTS = [["added", "Added"], ["ready", "Ready"], ["failed", "Failed"], ["needs-you", "Needs you"], ["merged", "Merged"], ["stalled", "Stalled"]];

export const HEARTBEAT_EDIT = "Edit";
export const SET_OWN = "Set its own";
export const SPACES = "Spaces";
export const SPACES_HINT = "Each space on this computer. Open one to give it its own.";
export const NO_SPACES = "No spaces on this computer yet.";
export const SAME = "Same as everywhere";
export const NO_HEARTBEAT = "Couldn't make the heartbeat file.";

// The heartbeat as herdr-task first writes it (autopilot.py STARTER): unchanged, it counts as not written.
export const STARTER = `Direction: what Autopilot works toward in this space.

Priorities:
-

Constraints: what it must not do (e.g. never merge; ask before anything risky).

Reporting: what to tell me after a wake, and when to alert me.

Stopping goal (optional): a finite goal; when it's proven, Autopilot turns itself off.
`;

// Everywhere's own until set (herdr-task: EVERYWHERE_DEFAULT).
export const DEFAULT = { on: false, every: "every 60 minutes", events: [] };

const textOf = (e) => (e && typeof e === "object" ? e.text ?? null : e || null);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o ?? {}, k) && o[k] !== undefined;
// Events in herdr-task's order, each once.
export const eventsIn = (list) => EVENTS.map(([v]) => v).filter((v) => (list ?? []).includes(v));

// Everywhere's switch, schedule (its words as written) and events, from the file's "everywhere" (or herdr-task's
// view of it).
export function everywhereOf(file) {
  const e = file?.everywhere ?? {};
  return { on: Boolean(has(e, "on") ? e.on : DEFAULT.on), every: has(e, "every") ? textOf(e.every) : DEFAULT.every,
    events: eventsIn(has(e, "events") ? e.events : DEFAULT.events), ...(e.trigger ? { trigger: e.trigger } : {}) };
}

// What applies in a space: its own where it sets one, else Everywhere's; own: which it sets itself. Everything else
// its record holds (next_run, pending, last_wake, progress…) comes along as it is. A record herdr-task already resolved
// (its view, with `own`) is taken as it is.
export function pilotFor(file, space) {
  const a = file?.spaces?.[space] ?? (Array.isArray(file?.spaces) ? file.spaces.find((v) => v.space === space) : null) ?? {};
  if (a.own) return { ...a, space, every: textOf(a.every), events: eventsIn(a.events) };
  const e = everywhereOf(file);
  const own = { on: has(a, "on"), every: has(a, "every"), events: has(a, "events"), heartbeat: false };
  return { ...a, space, own, on: own.on ? Boolean(a.on) : e.on, every: own.every ? textOf(a.every) : e.every,
    events: own.events ? eventsIn(a.events) : e.events, ...(!own.every && !own.events && e.trigger ? { trigger: e.trigger } : {}) };
}

// The spaces that set their own for a field: [{ id, name }] (names: as the caller calls them).
export const ownIn = (list, field, nameOf = (v) => v.name ?? v.space) =>
  (list ?? []).filter((v) => v.own?.[field]).map((v) => ({ id: v.space, name: nameOf(v) }));

// A schedule's pick: its preset's words, else Custom.
export const presetOf = (every) => {
  const v = String(every ?? "").trim().toLowerCase();
  return PRESETS.find(([x]) => x === v)?.[0] ?? null;
};

// ---- how a space's wakes go -----------------------------------------------------------------
export function when(ms, today = new Date()) {
  if (!ms) return "";
  const d = new Date(ms);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  return `${d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })} ${hm}`;
}
export const reasonWords = (r) => (r === "schedule" ? "Schedule" : r === "run now" ? "Run now" : String(r ?? "").replace(/^event:(\S+)/, (_m, e) => `Event: ${e}`));

// Under a space's settings: [label, words] for its next wake, its last and its saved progress.
export function facts(a) {
  const on = Boolean(a?.on), last = a?.last_wake, pending = a?.pending;
  return [
    ["Next wake", !on ? "Off." : pending ? `Waiting: ${pending.note ?? "goes when its Assistant is idle"}.`
      : a.next_run ? `${when(a.next_run)} · Schedule` : a.events?.length ? "On events only." : "Only on Run now."],
    ["Last wake", last ? `${when(last.at)} · ${reasonWords(last.reason)} · ${last.outcome}` : "Never."],
    ["Progress", a?.progress ? `${a.progress.text} (${when(a.progress.at)})` : "None. The Assistant saves it after each wake."],
  ];
}

// A space's line in Everywhere's list: "On · Every hour · Next Today 10:00", or "Off".
export const summary = (a) => (a?.on ? ["On", a.trigger, a.next_run ? `Next ${when(a.next_run)}` : null].filter(Boolean).join(" · ") : "Off");

// What it sets itself, after its line in that list: "Same as everywhere", or "Its own: Schedule, Events".
export function ownWords(a) {
  const mine = FIELDS.filter((f) => a?.own?.[f]);
  return mine.length ? `Its own: ${mine.map((f) => FIELD_WORDS[f]).join(", ")}` : SAME;
}

// What follows "Autopilot" in an Assistant's header while on: waking (a wake's turn runs), queued (waits for an idle
// Assistant), the next scheduled wake, else what wakes it. Nothing while off.
export function headerDetail(a, now = Date.now()) {
  if (!a?.on) return "";
  if (a.inflight) return "Waking";
  if (a.pending) return "Queued";
  if (a.next_run) {
    const d = new Date(a.next_run);
    return a.next_run - now < 86400000 ? `Next ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : `Next ${d.toLocaleDateString("en", { weekday: "short" })}`;
  }
  return a.events?.length ? "On events" : "Run now only";
}
