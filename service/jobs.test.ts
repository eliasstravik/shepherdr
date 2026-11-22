import { expect, test } from "bun:test";

// who runs the background work: this service, always (3.2: no window takes it), unless SHEPHERDR_JOBS=off
delete process.env.SHEPHERDR_JOBS;
const { jobsOn, agentMachines } = await import("./jobs.ts");

test("the service runs the background work unless it is told not to", () => {
  expect(jobsOn()).toBe(true);
  process.env.SHEPHERDR_JOBS = "off";
  expect(jobsOn()).toBe(false);
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
