// Machine health as the person reads it (CPU, memory, disk, each ok, busy or over), a machine's start limits, and a
// failed read keeping the last good numbers: the rules the window's sidebar (lib/machines.js) and the web app share.
// The numbers come from mods/tasks/bin/herdr_task/machine.py, run on each machine.
// Shared core: the source is core/machines.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const HOLD = { start_load: 1, start_memory: 80, start_disk: 90 };
export const ALERT = { load: 1.5, memory: 90, disk: 90 };
// A machine's start limits: Everywhere's, then its own (as herdr-task's machine_limits). Settings
// keys machines by name, "local" for this computer.
export const settingsKey = (machine) => machine ?? "local";
export function holdOf(cfg, machine) {
  return { ...HOLD, ...(cfg?.everywhere?.machine ?? {}), ...(cfg?.machines?.[settingsKey(machine)]?.machine ?? {}) };
}

// A read that didn't work keeps the last good numbers, marked as failed: never a guess.
export function nextRead(prev, fresh) {
  if (fresh.state === "unknown" && prev?.state === "ok") return { ...prev, failed: fresh.why };
  return fresh;
}

export function healthMeters(s) {
  const h = s?.health;
  if (!h) return [];
  const hold = { ...HOLD, ...(s.hold ?? {}) };
  const lv = (v, start, alert) => (v > alert ? "over" : start !== null && start !== undefined && v > start ? "busy" : "ok");
  const gb = (b) => `${Math.round(b / 2 ** 30)} GB`;
  return [
    { name: "CPU", pct: h.cpu, level: lv(h.load, hold.start_load === null ? null : hold.start_load * h.cores, ALERT.load * h.cores),
      detail: `Load ${Number(h.load).toFixed(1)} on ${h.cores} cores` },
    { name: "Memory", pct: h.memory, level: lv(h.memory, hold.start_memory, ALERT.memory), detail: `${gb(h.mem_used)} of ${gb(h.mem_total)}` },
    ...(h.disks?.length ? [{ name: "Disk", pct: h.disk, level: lv(h.disk, hold.start_disk, ALERT.disk),
      detail: h.disks.map((d) => `${d.path} ${d.pct}% · ${d.free_gb} GB free`).join(" · ") }] : []),
  ];
}

// ---- what the numbers say: the machine details' words (the window's popup and Settings > Machines, the web's popup) --

// ok: quiet; busy: over its start limit (new tasks wait); over: past its alert limit.
const RANK = { ok: 0, busy: 1, over: 2 };
export const worst = (levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
export const healthLevel = (s) => worst(healthMeters(s).map((m) => m.level));
// "CPU 12% · Memory 40% · Disk 22%"
export const healthWords = (s) => healthMeters(s).map((m) => `${m.name} ${m.pct}%`).join(" · ");
// A meter's line under its bar: its numbers, and what its level means.
export const meterSub = (m) => m.detail + (m.level === "over" ? " · Over its alert limit" : m.level === "busy" ? " · New tasks wait" : "");

// The CLIs with a usage source; any other installed agent says "No usage info".
export const READS = { claude: "Claude Code", codex: "Codex" };
// A number older than this says how old it is.
export const OLD = 15 * 60000;
export const leftOf = (w) => Math.max(0, Math.round(100 - w.used));
export const liveWindow = (w, now) => !w.resets_at || w.resets_at > now;
// Plan left: amber at a quarter, red at a tenth (Shepherdr's).
export const planLevelOf = (pct) => (pct <= 10 ? "over" : pct <= 25 ? "busy" : "ok");

// Each installed agent CLI: { cli, name, read, pct (least left now), level }. One without a
// usage source: { cli, name, none: true }.
export function planRows(s, now = Date.now()) {
  if (!s) return [];
  const rows = Object.entries(s.limits ?? {}).map(([cli, read]) => {
    const windows = read.state === "ok" ? (read.windows ?? []).filter((w) => liveWindow(w, now)) : [];
    const pct = windows.length ? Math.min(...windows.map(leftOf)) : null;
    return { cli, name: READS[cli] ?? cli, read, pct, level: pct === null ? "ok" : planLevelOf(pct) };
  });
  for (const a of s.agents ?? []) {
    if (!(a.key in READS) && !rows.some((r) => r.cli === a.key)) rows.push({ cli: a.key, name: a.name, none: true });
  }
  return rows;
}
export const planLevel = (s) => worst(planRows(s).filter((r) => typeof r.pct === "number").map((r) => r.level));
// The meter's words (the web's label for it): its health, then each plan's least left.
export const meterWords = (s) => [healthWords(s), ...planRows(s).filter((r) => typeof r.pct === "number").map((r) => `${r.name} ${r.pct}% left`)].join(" · ");

// 2m, 3h 10m, 5d 4h
export function span(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
}
export const ago = (at, now) => (now - at < 60000 ? "just now" : `${span(now - at)} ago`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "Mon 3:05pm", in this clock's time.
export function when(at) {
  const d = new Date(at);
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  return `${DAYS[d.getDay()]} ${hh % 12 || 12}:${mm}${hh < 12 ? "am" : "pm"}`;
}

// The details' header: how fresh its numbers are.
export const freshWords = (at, reading, now = Date.now()) =>
  reading ? "Updating…" : at ? (now - at < 60000 ? "Updated just now" : `Updated ${span(now - at)} ago`) : "";
// Beside the Health heading.
export const healthReadWords = (s, now = Date.now()) => (s.error ? "Couldn't read it now" : s.at ? `Read ${ago(s.at, now)}` : "");
// Under it, while there are no meters.
export const noHealthWords = (s) => (s.error ? `Couldn't read it: ${s.error}` : "Reading…");
// The plan block, while there are no CLIs.
export const noPlanWords = (s) => (s.limitsAt ? "No agent CLIs here." : "Reading plan usage…");
// A CLI's heading: its name and plan ("Claude Code · Max").
export const cliTitle = (r) => r.name + (r.read?.plan ? ` · ${r.read.plan[0].toUpperCase()}${r.read.plan.slice(1)}` : "");
// A read older than OLD, or one that failed since, shows amber.
export const readOld = (read, now = Date.now()) => now - read.at > OLD || Boolean(read.failed);
// One window of a plan: dead (refilled since it was read) says so; else its numbers and when it refills.
export function windowWords(w, now = Date.now()) {
  if (!liveWindow(w, now)) return { dead: `${w.name}: refilled ${when(w.resets_at)}, not read since.` };
  const pct = leftOf(w);
  const refill = w.resets_at ? `Refills ${when(w.resets_at)} · in ${span(w.resets_at - now)}` : w.resets ? `Refills ${w.resets}` : "No refill time reported";
  return { name: w.name, pct, level: planLevelOf(pct), words: `${pct}% left · ${Math.round(w.used)}% used`, refill };
}
export const failedWords = (read) => `Last read failed: ${read.failed}`;
// A CLI with no numbers: why.
export const whyWords = (read) =>
  read.state === "signed-out" ? "Not signed in on this machine." : read.state === "no-plan" ? "No plan limits: not signed in to a subscription." : `Unknown. ${read.why ?? ""}`;
export const NO_USAGE = "No usage info.";
export const READING_MACHINE = "Reading this machine…";
// A machine header's red dot: its health couldn't be read.
export const healthErrorWords = (error) => `Couldn't read its health: ${error}`;
