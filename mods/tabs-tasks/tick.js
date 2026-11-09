// Tasks' watcher (herdr-task tick), run from the tab bar because it is always loaded: starts
// queued tasks once they can go and marks merged ones done. Every 15 s, and a moment after a
// task's agent changes state; and it keeps the automations scheduler (herdr-automations) running,
// which does the same while the window is closed. Here, and on each other machine that has tasks (the ones
// `herdr-task --on` installed itself on). Owned by mods/tasks; the tick itself is cheap when
// nothing waits, and only one runs at a time.

import { exec, appHome, run } from "herdr";
import { terminals, spaces } from "./live.js";
import { coordinatorTab } from "./coordinator.js";
import { serviceRuns } from "./service.js";
import { SH } from "./core/paths.js";

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
let running = false, soon = false, seen = null, rounds = 0;

async function tick() {
  // Shepherdr's service ticks while it runs (lib/service.js).
  if (running || serviceRuns()) return;
  running = true;
  try {
    // About once a minute: the automations scheduler (herdr-automations) runs where automations are.
    const ensure = rounds++ % 4 === 0;
    await exec(CLI(), ["tick", "--json"]).catch(() => {});
    if (ensure) await exec(CLI(), ["scheduler", "--ensure", "--json"]).catch(() => {});
    const r = await exec("sh", ["-c", SH + 'ls "$SHEP_TASKS/.remote" 2>/dev/null; true']).catch(() => null);
    // And each machine running an Assistant: its tick brings it back after a crash (herdr-task revive.py).
    const assisted = terminals().filter((k) => k.state === "live" && k.address.includes("/") && (k.labels?.["herdr.role"] === "coordinator" || k.labels?.["herdr.resume"]))
      .map((k) => k.address.split("/")[0]);
    for (const machine of new Set([...(r?.stdout ?? "").split("\n").filter((x) => x && !x.endsWith(".secret")), ...assisted])) {
      await exec(CLI(), ["--on", machine, "tick", "--json"]).catch(() => {});
      if (ensure) await exec(CLI(), ["--on", machine, "scheduler", "--ensure", "--json"]).catch(() => {});
    }
  } finally {
    running = false;
  }
}

export function startTick(cx) {
  cx.timer.every(15000, (cx) => cx.spawn(async () => tick()));
  cx.spawn(async () => tick());
}

// From render: a task agent that finishes, stops or ends gets a tick two seconds later.
export function tickOnChange(cx) {
  keepNames();
  const now = terminals().filter((k) => k.labels?.["herdr.task"]).map((k) => `${k.address}:${k.state}:${k.status}`).join(",");
  if (now === seen) return;
  const first = seen === null;
  seen = now;
  if (first || soon) return;
  soon = true;
  cx.timer.after(2000, (cx) => { soon = false; cx.spawn(async () => tick()); });
}

// An unnamed space is called after its first terminal and follows it. In a space with a
// coordinator (often parked in a chat, so without a pane) that first terminal can be a task's
// worker in its worktree, and the space would turn into "task-3-...". So such a space keeps the
// name it has: given once, as Herdr's own name for it (its folder's, when a worker has already
// taken over, or when Herdr's is "~": "Home" at home, else the folder's).
const pinned = new Set();
function keepNames() {
  for (const s of spaces()) {
    if (s.named || pinned.has(s.id) || !s.tabs?.length) continue;
    const m = s.machine ?? null;
    const local = (id) => (m && String(id).startsWith(`${m}/`) ? String(id).slice(m.length + 1) : id);
    const tasks = terminals().some((k) => k.state === "live" && k.labels?.["herdr.task"] && k.labels?.["herdr.space"] === local(s.id)
      && (k.address.includes("/") ? k.address.split("/")[0] : null) === m);
    if (!tasks && !coordinatorTab(s)) continue;
    const parts = String(s.folder ?? "").split("/").filter(Boolean);
    const atHome = /^(home\/[^/]+|Users\/[^/]+|root)$/.test(parts.join("/"));
    const base = atHome ? "Home" : parts.pop();
    const name = (tasks || s.name === "~") && base ? base : s.name;
    if (!name) continue;
    pinned.add(s.id);
    run("space.rename", { id: s.id, name });
  }
}
