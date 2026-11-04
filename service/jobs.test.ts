import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// who runs the background work: never both. A throwaway app home stands in for ~/.config/herdr-app.
const home = mkdtempSync(join(tmpdir(), "shep-jobs-"));
process.env.HERDR_APP_HOME = home;
delete process.env.SHEPHERDR_JOBS;
const { windowLeavesIt, agentMachines } = await import("./jobs.ts");

test("no window installed: the service does it", () => {
  expect(windowLeavesIt()).toBe(true);
});
test("Herdr with its own mods only (no Shepherdr layout, as an always-on box): the service does it", () => {
  mkdirSync(join(home, "mods", "changes"), { recursive: true });
  expect(windowLeavesIt()).toBe(true);
});
test("a 3.0 window (its tab bar never asks the service): the window keeps it", () => {
  mkdirSync(join(home, "mods", "tabs-tasks"), { recursive: true });
  mkdirSync(join(home, "data", "shepherdr"), { recursive: true });
  writeFileSync(join(home, "data", "shepherdr", "installed.json"), "{}");
  expect(windowLeavesIt()).toBe(false);
});
test("a 3.1 window (lib/service.js in its tab bar): it leaves the work to the service", () => {
  writeFileSync(join(home, "mods", "tabs-tasks", "service.js"), "");
  expect(windowLeavesIt()).toBe(true);
  process.env.SHEPHERDR_JOBS = "off";
  expect(windowLeavesIt()).toBe(false);
  delete process.env.SHEPHERDR_JOBS;
});

test("other machines running an Assistant or a revivable agent get ticked (it comes back after a crash)", () => {
  expect(agentMachines([
    { address: "t1", state: "live", labels: { "herdr.role": "coordinator" } },
    { address: "vm/t2", state: "live", labels: { "herdr.role": "coordinator" } },
    { address: "box/t3", state: "live", labels: { "herdr.resume": "{}" } },
    { address: "old/t4", state: "finished", labels: { "herdr.role": "coordinator" } },
    { address: "plain/t5", state: "live", labels: {} },
  ]).sort()).toEqual(["box", "vm"]);
});
