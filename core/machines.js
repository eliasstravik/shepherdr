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
