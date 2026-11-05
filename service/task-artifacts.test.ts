import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a throwaway app home
process.env.HERDR_APP_HOME = mkdtempSync(join(tmpdir(), "shep-task-arts-"));
const { Compat } = await import("./compat.ts");
const { TaskLogs } = await import("./task-logs.ts");

const art = (id: string, more: any = {}) => ({ id, title: id, version: 1, folder: "/srv/shop", at: 100, files: ["recipe.json"], versions: [{ v: 1, at: 100, publisher: "t1" }], ...more });

test("a task's artifacts (SHEP-60): its proof first, then newest first; its chat log finds an older one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-task-log-"));
  const log = join(dir, "log.jsonl");
  writeFileSync(log, JSON.stringify({ content: "Published from-log-0003 v1: Old one" }) + "\n");
  const logs = new TaskLogs();
  let changed = 0;
  logs.onChange = () => changed++;
  const c = new Compat() as any;
  c.taskLogs = logs;
  const row = { section: "ready", ref: "SHOP-4", machine: null, folder: "/srv/shop", slug: "shop", id: 4, title: "Coverage", proof: "proof-0001",
    agents: [{ address: "t5", at: 1000, ended: null }], logs: [log] };
  const arts = [art("proof-0001", { task: "SHOP-4", at: 50 }), art("newer-0002", { at: 3000, versions: [{ v: 1, at: 3000, publisher: "t5" }] }),
    art("from-log-0003", { at: 20 }), art("other-0004", { task: "SHOP-5", at: 4000 })];
  const snap = () => c.snapshot({ host: "mini", user: "me", machines: [], spaces: [], sections: [], rows: [row], artifacts: arts }).tasks[0];
  expect(snap().artifacts).toEqual(["proof-0001", "newer-0002"]);
  expect(snap().proof).toBe("proof-0001");
  // the log is read in the background; it found one, so the snapshot is built again
  for (let i = 0; i < 50 && !changed; i++) await Bun.sleep(10);
  expect(changed).toBe(1);
  expect(snap().artifacts).toEqual(["proof-0001", "newer-0002", "from-log-0003"]);
  // only what was added is read next
  appendFileSync(log, "nothing new\n");
  logs.ids(log);
  await Bun.sleep(30);
  expect(changed).toBe(1);
  expect(logs.ids(log)).toEqual(["from-log-0003"]);
});

test("a task with none has no list", () => {
  const c = new Compat() as any;
  const row = { section: "working", ref: "SHOP-9", machine: null, folder: "/srv/shop", slug: "shop", id: 9, title: "Empty", agents: [], logs: [] };
  expect(c.snapshot({ host: "mini", user: "me", machines: [], spaces: [], sections: [], rows: [row], artifacts: [art("x-0001", { task: "SHOP-4" })] }).tasks[0].artifacts).toBeUndefined();
});
