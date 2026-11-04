// Shepherdr settings' Everywhere rows as data: each row's key in ~/.herdr/shepherdr.json, its words and its choices,
// the same as the window's settings (mods/shepherdr-settings), for the web app's Settings. herdr-task reads the file
// (herdr_task/settings.py: settings_for); its defaults are DEFAULTS there and here.
// Shared core: the source is core/settings.js.

export const MERGE = [["ask", "On Accept"], ["checks", "After checks pass"], ["auto", "Right away"]];
export const MUST_FIX = [["blocker", "Blockers"], ["major", "Major and up"], ["minor", "Everything"]];
export const ROUNDS = [[0, "Off"], [1, "1 round"], [2, "2 rounds"], [3, "3 rounds"]];
export const ARCHIVE = [[0, "Off"], [1, "1 day"], [3, "3 days"], [7, "1 week"], [30, "1 month"]];
export const ONOFF = [[true, "On"], [false, "Off"]];

export const DEFAULTS = { tasks: { merge: "ask", review_rounds: 0, must_fix: "major", max_running: 10, worktrees: true, archive_after: 7, proof: true }, automations: { enabled: true } };

// [section, field, label, choices | { min, max }]
export const TASK_ROWS = [
  ["tasks", "merge", "Merge", MERGE],
  ["tasks", "review_rounds", "Review", ROUNDS],
  ["tasks", "must_fix", "Must fix", MUST_FIX],
  ["tasks", "proof", "Proof", ONOFF],
  ["tasks", "max_running", "Tasks at once", { min: 1, max: 10 }],
  ["tasks", "archive_after", "Archive Done after", ARCHIVE],
  ["tasks", "worktrees", "Worktrees", ONOFF],
  ["automations", "enabled", "Run automations", ONOFF],
];

// A row's value now, Everywhere's (the file's "everywhere" layer, else the default).
export function valueOf(file, section, field) {
  const v = file?.everywhere?.[section]?.[field];
  return v ?? DEFAULTS[section]?.[field] ?? null;
}

// The file with one Everywhere value changed (null: back to the default).
export function withValue(file, section, field, value) {
  const f = JSON.parse(JSON.stringify(file ?? {}));
  f.everywhere ??= {};
  f.everywhere[section] ??= {};
  if (value === null) delete f.everywhere[section][field]; else f.everywhere[section][field] = value;
  return f;
}

// A choice's words for its value, and back.
export const wordFor = (choices, v) => (Array.isArray(choices) ? choices.find(([x]) => x === v)?.[1] ?? String(v) : String(v));
export const valueFor = (choices, word) => (Array.isArray(choices) ? choices.find(([, w]) => w === word)?.[0] : Number(word));
