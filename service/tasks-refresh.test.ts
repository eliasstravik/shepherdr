// Exercise the desktop mod's real watch and load methods with a controllable runtime.
import { describe, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const deferred = () => { let resolve!: (v?: any) => void, reject!: (v: any) => void; const promise = new Promise<any>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const firstPaths = deferred();
let paths = "/new/tasks", resolvePaths = firstPaths.promise, read = "", watches: { path: string, d: ReturnType<typeof deferred> }[] = [];
let readDisk: string | null = null;
let readOverride: (() => Promise<{ stdout: string }>) | null = null;
let watchImpl = (path: string) => { const d = deferred(); watches.push({ path, d }); return d.promise; };
const answer = () => ({ stdout: JSON.stringify({ home: "/fake-home", config: "/cfg", data: paths.replace(/\/tasks$/, ""), state: "/state", on: true }) });
mock.module("../mods/tasks/dirs.js", () => ({
  dirsReady: async () => ({ tasks: `${JSON.parse((await resolvePaths).stdout).data}/tasks` }),
  dirs: () => ({ tasks: paths }),
}));
mock.module("herdr", () => fakeHerdr({
  home: () => "/fake-home", appHome: () => "/app", machines: () => [], shared: () => null,
  exec: async () => readOverride ? readOverride() : ({ stdout: readDisk ? `demo.json\n${await readFile(readDisk, "utf8")}\n@@herdr-task-list@@\n` : read }),
  watchFolder: (path: string) => watchImpl(path),
}));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {} }));
mock.module("gpui-base", () => fakeGpuiBase({ InputState: class { static new() { return { on() {} }; } } }));
(globalThis as any).localStorage ??= { getItem: () => null, setItem() {} };
const { default: Tasks } = await import("../mods/tasks/main.js");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness() {
  const sleepers: ReturnType<typeof deferred>[] = [], jobs: Promise<any>[] = [];
  const cx: any = {
    spawn(fn: (cx: any) => Promise<any>) { const p = Promise.resolve().then(() => fn(cx)); jobs.push(p); p.catch(() => {}); },
    sleep() { const d = deferred(); sleepers.push(d); return d.promise; }, notify() {},
  };
  const task: any = new Tasks();
  task.reads = new Map(); task.raw = new Map(); task.byMachine = new Map(); task.lists = [];
  task.merge = function () { this.lists = [...this.byMachine.values()].flat(); };
  return { task, cx, sleepers, jobs, async tick() { const s = sleepers.splice(0); for (const d of s) d.resolve(); await flush(); }, async stop() { for (const d of sleepers.splice(0)) d.reject(Error("disposed")); await flush(); } };
}
const list = (text: string) => `demo.json\n${JSON.stringify({ folder: "/demo", tasks: [{ id: 1, state: "running", progress: { text } }] })}\n@@herdr-task-list@@\n`;

describe("desktop task refresh", () => {
  test("waits for migrated paths, retries rejection, follows migration and stops on disposal", async () => {
    let now = 0; const original = Date.now; Date.now = () => now;
    try {
      watches = []; const h = harness(); h.task.watch(h.cx); await flush();
      expect(watches).toHaveLength(0);
      firstPaths.resolve(answer()); await flush();
      expect(watches.map(w => w.path)).toEqual(["/new/tasks"]);
      watches[0].d.reject(Error("missing directory")); await flush();
      expect(watches).toHaveLength(1);
      now += 5000; await h.tick();
      expect(watches.map(w => w.path)).toEqual(["/new/tasks", "/new/tasks"]);
      paths = "/moved/tasks"; resolvePaths = Promise.resolve(answer()); now += 10000; await h.tick();
      expect(watches.map(w => w.path)).toEqual(["/new/tasks", "/new/tasks", "/moved/tasks"]);
      paths = "/third/tasks"; resolvePaths = Promise.resolve(answer()); now += 10000; await h.tick();
      expect(watches).toHaveLength(3); // bounded pending native subscriptions
      watches[1].d.resolve([]); await flush();
      expect(watches[3].path).toBe("/third/tasks");
      await h.stop(); expect(h.task.watching).toBe(false);
    } finally { Date.now = original; }
  });
  test("a later read replaces a missed event's stale report", async () => {
    const h = harness(); read = list("before"); await h.task.load(h.cx, null);
    expect(h.task.lists[0].tasks[0].progress.text).toBe("before");
    read = list("after"); await h.task.load(h.cx, null);
    expect(h.task.lists[0].tasks[0].progress.text).toBe("after");
  });
  test("the panel schedules local reconciliation even without watch events", async () => {
    const h = harness(), timers: { ms: number, fn: (cx: any) => void }[] = [];
    const jobs: ((cx: any) => Promise<any>)[] = [];
    h.cx.spawn = (fn: (cx: any) => Promise<any>) => jobs.push(fn);
    h.cx.timer = { every(ms: number, fn: (cx: any) => void) { timers.push({ ms, fn }); } };
    h.cx.focus_handle = () => ({});
    h.task.watch = () => {}; h.task.loadRemote = () => {};
    h.task.init({}, h.cx);
    read = list("after timer");
    timers.find(t => t.ms === 10000)!.fn(h.cx); await jobs.at(-1)!(h.cx);
    expect(h.task.lists[0].tasks[0].progress.text).toBe("after timer");
  });
  test("a change during a read schedules another read", async () => {
    const h = harness(), slow = deferred(); let count = 0;
    try {
      readOverride = () => ++count === 1 ? slow.promise : Promise.resolve({ stdout: list("new") });
      const first = h.task.load(h.cx, null); await flush();
      await h.task.load(h.cx, null); expect(count).toBe(1);
      slow.resolve({ stdout: list("old") }); await first; await flush();
      expect(count).toBe(2);
      expect(h.task.lists[0].tasks[0].progress.text).toBe("new");
    } finally { readOverride = null; }
  });
  test("directory notification reloads an atomically replaced JSON record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tasks-refresh-")), handles: ReturnType<typeof watch>[] = [];
    const record = join(dir, "demo.json"), h = harness();
    try {
      await writeFile(record, JSON.stringify({ folder: "/demo", tasks: [{ id: 1, progress: { text: "before" } }] }));
      await writeFile(join(dir, "next.tmp"), JSON.stringify({ folder: "/demo", tasks: [{ id: 1, progress: { text: "after" } }] }));
      readDisk = record; resolvePaths = Promise.resolve({ stdout: JSON.stringify({ data: dir }) });
      // Use the real directory watcher, with the same one-shot contract as Herdr's API.
      watchImpl = () => new Promise(resolve => { const w = watch(dir, () => { w.close(); resolve([]); }); handles.push(w); });
      h.task.watch(h.cx); await flush();
      await rename(join(dir, "next.tmp"), record);
      for (let i = 0; i < 100 && h.task.lists[0]?.tasks[0]?.progress.text !== "after"; i++) await new Promise(r => setTimeout(r, 10));
      expect(h.task.lists[0].tasks[0].progress.text).toBe("after");
    } finally {
      await h.stop(); for (const w of handles) w.close(); readDisk = null;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
