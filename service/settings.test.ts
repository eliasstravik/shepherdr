import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a throwaway settings file, never ~/.herdr/shepherdr.json
const file = join(mkdtempSync(join(tmpdir(), "shep-settings-")), "shepherdr.json");
writeFileSync(file, JSON.stringify({ everywhere: { machine: { start_load: 2 } }, spaces: { sp1: { folder: "/x" } } }));
process.env.HERDR_TASK_SETTINGS = file;
const { Settings } = await import("./settings.ts");

test("the Tasks rows say the window's words, and a change keeps the rest of the file", () => {
  const s = new Settings();
  s.start();
  const tasks = s.sections("https://box/shepherdr/").find((x) => x.name === "Tasks" && x.level === "all")!;
  expect(tasks.rows.find((r) => r.key === "tasks.merge")).toMatchObject({ value: "On Accept", options: ["On Accept", "After checks pass", "Right away"] });
  s.set("tasks.merge", "After checks pass");
  s.set("tasks.max_running", "40");
  s.set("tasks.proof", "Off");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.tasks).toEqual({ merge: "checks", max_running: 10, proof: false });
  expect(f.everywhere.machine).toEqual({ start_load: 2 });
  expect(f.spaces.sp1.folder).toBe("/x");
  expect(() => s.set("tasks.merge", "Whenever")).toThrow();
  expect(() => s.set("secrets.vault", "x")).toThrow();
});

test("a space's own values go in its layer with its folder, and Reset drops them", () => {
  const s = new Settings();
  s.start();
  const scope = { id: "sp2", name: "web", machine: null, folder: "/repo" };
  s.set("tasks.merge", "Right away", "sp2", scope);
  s.set("role.worker", JSON.stringify({ agent: "codex", model: "gpt-5", effort: "high" }), "sp2", scope);
  let f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces.sp2).toEqual({ folder: "/repo", name: "web", tasks: { merge: "auto" }, worker: { agent: "codex", model: "gpt-5", effort: "high", fast: false, perm: null } });
  const tasks = s.sections(null, [scope]).find((x) => x.name === "Tasks" && x.level === "sp2")!;
  expect(tasks.rows.find((r) => r.key === "tasks.merge")).toMatchObject({ value: "Right away", inherits: { from: "Everywhere" } });
  s.set("tasks.merge", null, "sp2", scope);
  f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces.sp2.tasks).toBeUndefined();
  expect(() => s.set("tasks.merge", "Right away", "sp3", null)).toThrow();
});

test("machine limits: percents on the page, the file's own units, and this computer as local", () => {
  const s = new Settings();
  s.start();
  s.sections(null, [], [], "box");
  s.set("machine.start_load", "150", "all");
  s.set("machine.start_memory", "off", "m:box");
  s.set("machine.worker_memory", "4 GB", "m:box");
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.everywhere.machine.start_load).toBe(1.5);
  expect(f.machines.local.machine).toEqual({ start_memory: null, worker_memory: 4 });
  expect(() => s.set("machine.worker_memory", "3 GB", "all")).toThrow();
});

test("another machine's space keeps its machine/id key, and its machine is sent only its own", async () => {
  const { pushBody } = await import("./settings.ts");
  const s = new Settings();
  s.start();
  s.set("tasks.merge", "Right away", "vm/sp9", { id: "vm/sp9", name: "api", machine: "vm", folder: "/srv/api" });
  const f = JSON.parse(readFileSync(file, "utf8"));
  expect(f.spaces["vm/sp9"]).toMatchObject({ machine: "vm", folder: "/srv/api", tasks: { merge: "auto" } });
  const sent = JSON.parse(pushBody(f, "vm"));
  expect(sent).toMatchObject({ pushed_from: "herdr-app", here: "vm", spaces: { sp9: { folder: "/srv/api" } } });
  expect(Object.keys(sent.spaces)).toEqual(["sp9"]);
});
