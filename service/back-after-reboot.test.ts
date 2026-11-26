// #1545: the alert listing the Assistants a restart of their machine left stopped (herdr-task revive.py
// cut_alert_pass), its Restart all button, and the action it sends.
import { expect, test } from "bun:test";
import { agentAlerts, alertsOf } from "./push.ts";
import { restartAll } from "./actions.ts";

const shell = (address: string) => ({ address, state: "live", labels: { "herdr.role": "coordinator" }, foreground: { name: "bash", argv: ["/bin/bash"] } });
const alert = { id: "a1", at: 1, title: "Not back after the restart", body: "The machine's restart stopped shop, docs. Restart all, or write to each to start it again.", about: true, task: "vm-a", restart: ["t1", "t2"] };
const sched = (address = "herdr-automations") => ({ address, state: "live", labels: { "herdr.alert": JSON.stringify(alert) } });

test("the alert says which machine and gets a Restart all button", () => {
  const snap: any = { tasks: [], places: [] };
  const out = agentAlerts([sched()], snap, () => null, "/nonexistent");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ id: "a1", title: "vm-a · Not back after the restart", notify: true, restart: true });
  const push = [...alertsOf({ ...snap, alerts: out }).values()].find((x: any) => x.tag === "alert:a1") as any;
  expect(push.actions).toEqual([{ action: "restart-all", title: "Restart all" }]);
  expect(push.restart).toEqual({ alert: "a1" });
});

test("another agent's alert has no Restart all", () => {
  const k = { address: "t5", state: "live", labels: { "herdr.alert": JSON.stringify({ id: "b", at: 1, title: "x", body: "y" }) } };
  const out = agentAlerts([k], { tasks: [], places: [] }, () => null, "/nonexistent");
  expect(out[0].restart).toBeUndefined();
});

test("Restart all starts each one still stopped, on its machine", async () => {
  const revived: string[] = [];
  const terms = [sched("vmb/herdr-automations"), shell("vmb/t1"), { ...shell("vmb/t2"), foreground: { name: "claude", argv: ["claude"] } }];
  const hub: any = { terminals: new Map(terms.map((t) => [t.address, t])) };
  const compat: any = { agents: { revive: async (a: string) => { revived.push(a); return "vmb/t9"; } }, reader: () => null };
  expect(await restartAll(hub, "a1", compat)).toEqual({ ok: true, started: 1 });
  expect(revived).toEqual(["vmb/t1"]); // t2 runs again already
});

test("Restart all also starts one that ended right after the restart", async () => {
  const revived: string[] = [];
  const hub: any = { terminals: new Map([sched(), { address: "t1", state: "finished", labels: {} }].map((t) => [t.address, t])) };
  const compat: any = { agents: { revive: async (a: string) => { revived.push(a); return "t9"; } } };
  expect(await restartAll(hub, "a1", compat)).toEqual({ ok: true, started: 1 });
  expect(revived).toEqual(["t1"]);
});

test("Restart all on an alert that has gone says it's handled", async () => {
  const hub: any = { terminals: new Map() };
  expect(restartAll(hub, "a1", { agents: { revive: async () => "t9" } } as any)).rejects.toThrow("isn't here any more");
});

test("one that can't start says so", async () => {
  const hub: any = { terminals: new Map([sched(), shell("t1")].map((t) => [t.address, t])) };
  const compat: any = { agents: { revive: async () => { throw new Error("no"); } } };
  expect(restartAll(hub, "a1", compat)).rejects.toThrow("1 didn't start again");
});
