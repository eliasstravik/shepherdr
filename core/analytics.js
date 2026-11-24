// Personal analytics' rules (SHEP-453), for the service and the page: which events there are and the only fields an
// event may carry. Events and timings, never content: a field is a number, true/false or a short id-like word, so no
// message text, prompt, title, secret or file content can fit. The same lists are in
// mods/tasks/bin/herdr_task/analytics.py (test/test_analytics.py checks they agree). Nothing here, or in what writes
// and reads the record (service/analytics.ts, herdr-task analytics), sends it anywhere: it stays on the person's own
// machines.
// Shared core: the source is core/analytics.js.

export const EVENTS = {
  "app.opened": "the app opened on a device (device: phone, tablet or desktop)",
  "app.link_lost": "the app lost its link to the service",
  "message.sent": "a message sent to a chat (how: typed, dictated, bubble or talk)",
  "message.failed": "a message that didn't go through",
  "question.answered": "an agent's question answered (how: pick, typed or talk)",
  "task.added": "a task added",
  "task.started": "a task's agent started (waited_ms: from added to started)",
  "task.ready": "a task said it is ready for review (worked_ms: from started)",
  "task.sent_back": "a ready task sent back to work with feedback (wait_ms: how long it sat in Ready)",
  "task.done": "a task marked as done (wait_ms: how long it sat in Ready; merged)",
  "task.reopened": "a done task opened again",
  "task.stopped": "a task's agent stopped (by: you, error or limit)",
  "task.carried_on": "a stopped task's agent carried on (blocked_ms: how long it was stopped)",
  "task.needs_you": "a task needed the person",
  "task.needs_answered": "a task's Needs you cleared (wait_ms: how long it waited)",
  "task.removed": "a task deleted",
  "review.done": "a review round recorded on a task",
  "checks.failed": "a task's merge failed or its checks were red",
  "schedule.ran": "a schedule added its task",
  "schedule.failed": "a schedule's run failed",
  "settings.changed": "a setting changed (key: which one, never its value)",
  "shepherdr.updated": "Shepherdr updated on a machine",
  "analytics.on": "personal analytics switched on",
};

export const FIELDS = [
  "task", "space", "machine", "chat", "agent", "model", "effort", "how", "device", "by", "mode", "key", "kind",
  "merged", "auto", "n", "ms", "wait_ms", "worked_ms", "waited_ms", "blocked_ms", "round", "version",
];

export const CHOICES = {
  how: ["typed", "dictated", "bubble", "talk", "pick"],
  device: ["phone", "tablet", "desktop"],
  by: ["you", "error", "limit"],
};

const WORD = /^[A-Za-z0-9_.:@/\[\]-]{1,80}$/;

/** Only the allowed fields, each a number, true/false or a short id-like word (never text). */
export function clean(fields) {
  /** @type {Record<string, string | number | boolean>} */
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (!FIELDS.includes(k) || v == null) continue;
    if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e15) out[k] = k.endsWith("ms") ? Math.round(v) : v;
    else if (typeof v === "string" && WORD.test(v) && (!(k in CHOICES) || /** @type {any} */ (CHOICES)[k].includes(v))) out[k] = v;
  }
  return out;
}

/** The words Settings and the docs say: the promise. */
export const PROMISE = "Stays on your machines. Never sent to anyone, not to Shepherdr's makers either.";
