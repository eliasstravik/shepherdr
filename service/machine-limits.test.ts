import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// #1547: Settings › Machines changes a machine's start limits with the rows' own keys (machine.<field>@<machine>)
const file = join(mkdtempSync(join(tmpdir(), "shep-limits-")), "shepherdr.json");
writeFileSync(file, JSON.stringify({}));
process.env.HERDR_TASK_SETTINGS = file;
const { Settings } = await import("./settings.ts");
const { Machines } = await import("./machines.ts");

const rows = (s: any) => s.sections(null, [], ["vm"], "box").find((x: any) => x.name === "Machines").rows;
const row = (s: any, key: string) => rows(s).find((r: any) => r.key === key);

test("a machine card's limits: what each is, set here or default, off, and Reset", () => {
  const s = new Settings();
  s.start();
  expect(row(s, "machine.start_memory@local")).toMatchObject({ value: "80%", stepFrom: "80%", from: "all machines" });
  expect(row(s, "machine.start_load@vm")).toMatchObject({ value: "100%" });
  s.set("machine.start_memory@local", "70%");
  s.set("machine.start_disk@vm", "Off");
  expect(row(s, "machine.start_memory@local")).toMatchObject({ value: "70%", inherits: { value: "80%" } });
  expect(row(s, "machine.start_disk@vm").value).toBe("Off");
  expect(row(s, "machine.start_disk@local").value).toBe("90%");
  s.set("machine.start_memory@local", null);
  expect(row(s, "machine.start_memory@local").value).toBe("80%");
  expect(() => s.set("machine.start_load@elsewhere", "50%")).toThrow();
});

test("the meters' limits follow a change at once", () => {
  const s = new Settings();
  s.start();
  const m = new Machines({} as any, () => ["vm"]);
  m.stats.set("vm", { at: Date.now(), hold: { start_load: 1, start_memory: 80, start_disk: 90 } });
  s.sections(null, [], ["vm"], "box");
  s.set("machine.start_memory@vm", "60%");
  m.rehold();
  expect(m.stats.get("vm").hold.start_memory).toBe(60);
});
