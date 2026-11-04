// Toasts, as the window's (mods/toasts): the last three, each a dot in its level's color, its title on one line, its
// body wrapped to at most 3 lines, an X on hover; a click runs its action and closes it; each goes after its level's
// time, never while the pointer is on them. mods/toasts draws them in the window, web/plugins/alerts in the web app;
// both read these rules and words from here.
// Shared core: the source is core/toasts.js; bin/sync-shared copies it into the mods in lib/COPIES. Edit it here, never
// a copy.

import { REASONS } from "./needs.js";

// How many show at once, how wide they are, and how many lines a body gets.
export const SHOWN = 3;
export const WIDTH = 360;
export const LINES = 3;
// A body is cut to this many characters (3 lines at the toast's width).
export const BODY_MAX = 140;
// How long each level stays (ms); the rest stay 6 s.
export const TIMEOUT = { alert: 20000, error: 12000, warning: 10000 };
export const TIMEOUT_DEFAULT = 6000;
export const timeoutOf = (n) => n.timeout ?? TIMEOUT[n.level] ?? TIMEOUT_DEFAULT;
// Kept at most this long, and at most this many besides a new one.
export const KEEP_MS = 120000;
export const KEEP = 4;

// A toast's dot: red for an alert or an error, amber a warning, green done, the accent otherwise.
export const tone = (level) => (level === "alert" || level === "error" ? "red" : level === "warning" ? "amber" : level === "success" ? "green" : "accent");

export const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// One title format for what an agent says: "HERD-4 · Needs you", "~ Assistant · Finished".
export const NEEDS_YOU = "Needs you";
export const FINISHED = "Finished";
export const toastTitle = (who, what) => `${who} · ${what}`;
// Who an Assistant is, by its space's name ("tt-repo Assistant"); a task's agent is its task's ref ("HERD-4"), on
// another machine with that machine's name, as the chat names an agent there (core/chat-view.js): "HERD-4 on vm".
export const assistantWho = (spaceName) => (spaceName ? `${spaceName} Assistant` : "Assistant");
export const taskWho = (ref, machine) => (machine ? `${ref} on ${machine}` : ref);

// Several toasts at once, in one line (a phone shows one toast): "2 tasks need you" when each is a task needing
// you, "2 need you" when an Assistant is among them, else "3 updates".
export function together(list) {
  const n = list.length;
  if (list.every((x) => x.need)) return `${n} ${list.every((x) => x.task) ? "tasks " : ""}need you`;
  return `${n} updates`;
}

// Why an agent needs the person, as a Needs you toast's body says it (the web app's and the service's need: { question?:
// { kind, title }, secret?: { name }, text? }): its question, a plan to approve, the secret it asks for, or what it
// last said; else the standard reason (core/needs.js).
export function needReason(n) {
  if (n?.question) return n.question.kind === "Plan" ? REASONS.plan : n.question.title || REASONS.question;
  if (n?.secret) return `Asks for ${n.secret.name}`;
  return n?.text || REASONS.question;
}

// The list with a new toast added (newest last): older than KEEP_MS go, and only the last KEEP stay beside it. One with
// the same key (one event: an agent needing you, told twice as it learns more) takes the old one's place and id.
export function withToast(list, n, at = Date.now(), id = `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`) {
  const same = n.key ? (list ?? []).find((x) => x.key === n.key) : null;
  const kept = (list ?? []).filter((x) => x !== same && at - x.at < KEEP_MS).slice(-KEEP);
  return [...kept, { ...n, level: n.level ?? "info", id: same?.id ?? id, at }];
}

// The toasts left at `now`: each goes after its time.
export const unexpired = (list, now = Date.now()) => (list ?? []).filter((n) => now - n.at < timeoutOf(n));
