// Machine health and plan limits (HERD-40), as Shepherdr's health and limits plugins: each
// machine's CPU, memory and disk, and what is left of each agent CLI's plan there, read on the
// machine itself by mods/tasks/bin/herdr_task/machine.py (sent with `hc exec --on`, nothing
// installed). Health every 45 s, plan limits every 10 min (or when asked), never per render.
// Shared: the source is lib/machines.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/machines.js, never a mod's copy, then run bin/sync-shared.
//   startPolling(cx)                 from init (the sidebar): keeps every machine's numbers fresh
//   pollNow({ limitsOlder, only })   read again now (a details view opening)
//   statsOf(machine)                 { health, limits, agents, hold, at, limitsAt, error } or null
//   healthMeters(stats) / healthLevel(stats)    CPU, Memory, Disk with ok | busy | over
//   planRows(stats) / planLevel(stats)          each installed agent CLI's plan (or "No usage info")
//   bars(t, items, h)               thin upright bars, one per meter or plan
//   machineDetails(t, machine)      the full block: health, then plan usage per CLI
// Shared state "machines.stats" = { [machine name, "" for this computer]: stats }, written once
// per round. Start limits (Settings > Machines) live in Shepherdr's settings file:
// everywhere.machine and machines[name or "local"].machine, each { start_load (× cores),
// start_memory, start_disk } (herdr-task's tick holds new tasks by them).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared, appHome, home, machines, knownAgents, readTextFile } from "herdr";
import { heading } from "./ui.js";
import { dirs } from "./dirs.js";
// The meters, their levels and the start limits: core/machines.js, shared with the web app.
// What they say (the details' words, plan rows) too: the web's machine popup reads the same.
import { HOLD, ALERT, settingsKey, holdOf, nextRead, healthMeters, healthLevel, healthWords, planLevelOf, planRows, planLevel, span,
  meterSub, healthReadWords, noHealthWords, noPlanWords, cliTitle, readOld, windowWords, failedWords, whyWords, ago, NO_USAGE,
  READING_MACHINE } from "./core/machines.js";
export { HOLD, ALERT, settingsKey, holdOf, healthMeters, healthLevel, healthWords, planLevelOf, planRows, planLevel, span };

const KEY = "machines.stats";
const HEALTH_EVERY = 45000, LIMITS_EVERY = 10 * 60000, ROUND = 30000;

const SCRIPT = () => `${appHome()}/mods/tasks/bin/herdr_task/machine.py`;
const SETTINGS = () => dirs().settings;
const mkey = (m) => m ?? "";
let script = null;
let running = false;

export const allStats = () => { const v = shared(KEY); return v && typeof v === "object" ? v : {}; };
export const statsOf = (machine) => allStats()[mkey(machine)] ?? null;

// Run the reader on one machine. Rejects when it can't.
async function read(machine, withLimits) {
  script ??= await readTextFile(SCRIPT());
  const args = withLimits ? ["--limits"] : [];
  const r = machine
    ? await exec("hc", ["exec", "--on", machine, "--", "python3", "-c", script, ...args])
    : await exec("python3", [SCRIPT(), ...args]);
  const line = String(r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error((r.stderr || "No answer").trim().split("\n").pop().slice(0, 120));
  return JSON.parse(line);
}

// One round over every machine that's due (or all of them, `force`), side by side; one write.
// `only`: just that machine (null: this computer). `limitsOlder`: read plan limits that are older
// than this many ms (a details view opening: a minute).
export async function pollNow({ limits = false, force = false, only, limitsOlder } = {}) {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const old = allStats();
    let cfg = null;
    try { cfg = JSON.parse((await readTextFile(SETTINGS())) ?? "null"); } catch {}
    const list = [null, ...machines().filter((m) => m.name && m.layout !== "unavailable").map((m) => m.name)];
    const next = { ...old };
    await Promise.all(list.filter((m) => only === undefined || m === only).map(async (m) => {
      const was = old[mkey(m)] ?? {};
      const wantLimits = limits || force || now - (was.limitsAt ?? 0) > (limitsOlder ?? LIMITS_EVERY);
      if (!force && !wantLimits && now - (was.at ?? 0) < HEALTH_EVERY) return;
      const out = { ...was, hold: holdOf(cfg, m) };
      try {
        const d = await read(m, wantLimits);
        out.health = d.health;
        out.at = Date.now();
        delete out.error;
        if (d.limits) {
          const lim = {};
          for (const [cli, fresh] of Object.entries(d.limits)) lim[cli] = nextRead(was.limits?.[cli], fresh);
          out.limits = lim;
          out.limitsAt = Date.now();
          // The agents people can start there, to say "No usage info" for those without a source.
          const known = await knownAgents({ on: m }).catch(() => null);
          // With what starts each (`run`), and the first two that aren't installed ("others"): the web app's + menu and
          // Switch agent offer what the window's do (knownAgents is the window's own; the service can't ask Herdr).
          if (known) {
            out.agents = known.filter((a) => a.installed).map((a) => ({ key: a.key, name: a.name, run: a.run }));
            out.others = known.filter((a) => !a.installed).slice(0, 2).map((a) => ({ key: a.key, name: a.name }));
          }
        }
      } catch (e) {
        out.error = String(e?.message ?? e).slice(0, 120);
        out.at = Date.now(); // tried: wait a round before trying again
      }
      next[mkey(m)] = out;
    }));
    // Machines no longer known go.
    const known = new Set(list.map(mkey));
    for (const k of Object.keys(next)) if (!known.has(k) && !machines().some((m) => m.name === k)) delete next[k];
    setShared(KEY, next);
  } finally {
    running = false;
  }
}

// From one copy's init: a light check every 30 s, each machine read only when it's due.
export function startPolling(cx) {
  cx.spawn(async () => pollNow());
  cx.timer.every(ROUND, (cx) => cx.spawn(async () => pollNow()));
}

// ---- what the numbers mean ------------------------------------------------------------------

// The levels, plan rows and words: core/machines.js (imported above).

export const colorOf = (t, level) => (level === "over" ? t.blocked : level === "busy" ? t.working : t.dim);

// ---- drawing ---------------------------------------------------------------------------------

// Thin upright bars, filled to each item's share: items = [{ pct, level }] (pct: how full).
export function bars(t, items, h = 12, id = "bars") {
  return h_flex().id(id).h(h).flex_none().items_end().gap(2)
    .children(items.map((m, i) => div().id(`${id}-${i}`).relative().w(3).h(h).rounded(2).bg(t.border).overflow_hidden()
      .child(div().absolute().left(0).bottom(0).w(3).h(Math.max(2, Math.round(h * Math.min(100, Math.max(0, m.pct)) / 100))).rounded(2)
        .bg(m.level === "ok" ? t.muted : colorOf(t, m.level)))));
}

// A horizontal meter with its label and number: one row of the details.
function meterRow(t, id, name, pct, fill, level, words, sub) {
  return v_flex().id(id).gap(4)
    .child(h_flex().gap(10).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_none().text_size(12.5).text_color(level === "ok" ? t.muted : colorOf(t, level)).child(words)))
    .child(div().relative().h(5).w_full().rounded(3).bg(t.border).overflow_hidden()
      .child(div().absolute().left(0).top(0).h(5).rounded(3).w(`${Math.max(2, Math.min(100, fill))}%`).bg(level === "ok" ? t.muted : colorOf(t, level))))
    .when(Boolean(sub), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(sub)));
}

function cliBlock(t, mid, r, now) {
  const head = (extra) => h_flex().gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground)
      .child(cliTitle(r)))
    .child(div().flex_none().text_size(11.5).text_color(extra?.old ? t.working : t.dim).child(extra?.text ?? ""));
  if (r.none) return v_flex().id(`${mid}-${r.cli}`).gap(4).child(head()).child(div().text_size(12).text_color(t.dim).child(NO_USAGE));
  const read = r.read;
  const old = readOld(read, now);
  const box = v_flex().id(`${mid}-${r.cli}`).gap(8).child(v_flex().gap(2).child(head({ text: `Read ${ago(read.at, now)}`, old }))
    .when(Boolean(read.account), (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(read.account))));
  if (read.state === "ok") {
    return box.children(read.windows.map((w, i) => {
      const x = windowWords(w, now);
      if (x.dead) return div().id(`${mid}-${r.cli}-${i}`).text_size(12).text_color(t.dim).child(x.dead);
      return meterRow(t, `${mid}-${r.cli}-${i}`, x.name, x.pct, x.pct, x.level, x.words, x.refill);
    })).when(Boolean(read.failed), (el) => el.child(div().text_size(11.5).text_color(t.working).child(failedWords(read))));
  }
  return box.child(div().text_size(12).text_color(t.muted).child(whyWords(read)));
}

// The whole block for one machine: its health meters, then each agent CLI's plan.
export function machineDetails(t, machine, opts = {}) {
  const s = statsOf(machine), now = Date.now();
  const mid = `md-${mkey(machine) || "local"}`;
  const out = v_flex().id(mid).gap(12);
  if (!s) return out.child(div().text_size(12.5).text_color(t.dim).child(READING_MACHINE));
  const hm = healthMeters(s);
  const healthBox = v_flex().gap(10)
    // Sentence-case headings (ui.js heading), never uppercase.
    .when(opts.titles !== false, (el) => el.child(heading("Health",
      div().font_normal().text_color(s.error ? t.working : t.dim).child(healthReadWords(s, now)))))
    .children(hm.map((m) => meterRow(t, `${mid}-h-${m.name}`, m.name, m.pct, m.pct, m.level, `${m.pct}%`, meterSub(m))));
  if (!hm.length) healthBox.child(div().text_size(12).text_color(t.dim).child(noHealthWords(s)));
  const rows = planRows(s, now);
  const planBox = v_flex().gap(14)
    .when(opts.titles !== false, (el) => el.child(heading("Plan usage")))
    .children(rows.map((r) => cliBlock(t, mid, r, now)))
    .when(!rows.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(noPlanWords(s))));
  return out.when(opts.health !== false, (el) => el.child(healthBox))
    .when(opts.health !== false && opts.plan !== false, (el) => el.child(div().h(1).bg(t.border)))
    .when(opts.plan !== false, (el) => el.child(planBox));
}
