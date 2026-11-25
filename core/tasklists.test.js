import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PANEL_WARN, READ_CHANGES, READ_LISTS, READ_PANEL, SLIM_CUT, changedLists, changesArgs, panelArgs, panelLists } from "./tasklists.js";

// #1175: the panels read every list through one exec, which Herdr cuts at 8 MiB (and the window's runtime gave up on
// a 6 MiB string): a busy list of archived tasks with their whole prompts left the Tasks panel empty, saying nothing.
function home() {
  const h = mkdtempSync(join(tmpdir(), "shep-lists-"));
  const dir = join(h, ".herdr", "tasks");
  mkdirSync(dir, { recursive: true });
  return { h, dir };
}
const read = (h, files, path = process.env.PATH) =>
  Bun.spawnSync(["sh", "-c", READ_PANEL, ...panelArgs(files)], { env: { HOME: h, PATH: path } }).stdout.toString();

const prompt = "Сделай это хорошо. ".repeat(400);   // Cyrillic, escaped six bytes a letter by an ASCII writer
const busy = {
  folder: "/x/busy", prefix: "BUSY",
  tasks: Array.from({ length: 300 }, (_, i) => ({
    id: i + 1, title: `Task ${i + 1}`, state: i < 280 ? "done" : "running", prompt, details: "d".repeat(5000),
    reviews: [{ round: 1, text: "r".repeat(2000) }], agents_md: "note", summary: i === 0 ? "s".repeat(3000) : "short",
    agents: [{ address: "t1", at: 1 }], ready_turns: 2, ...(i < 280 ? { archived: 1000 + i } : {}),
  })),
};

test("what the panels never show stays out, compact, every list whole", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "busy.json"), JSON.stringify(busy, null, 2));
  writeFileSync(join(dir, "small.json"), JSON.stringify({ folder: "/x/small", tasks: [{ id: 1, title: "Здравствуй" }] }));
  writeFileSync(join(dir, ".autopilot.json"), JSON.stringify({ version: 2, spaces: {} }));
  writeFileSync(join(dir, ".news.json"), "[]");
  writeFileSync(join(dir, "broken.json"), "{ not json");
  const full = Bun.spawnSync(["sh", "-c", READ_LISTS], { env: { HOME: h, PATH: process.env.PATH } }).stdout.toString();
  const out = read(h);
  expect(out.length).toBeLessThan(full.length / 20);
  const { lists, files, warn } = panelLists(out);
  expect(lists.map((l) => l.slug).sort()).toEqual(["busy", "small"]);
  const b = lists.find((l) => l.slug === "busy");
  expect(b.tasks.length).toBe(300);                                        // archived tasks still listed (Archived view)
  expect(b.prefix).toBe("BUSY");
  for (const k of ["prompt", "details", "reviews", "agents_md"]) expect(b.tasks[5][k]).toBeUndefined();
  expect(b.tasks[5]).toMatchObject({ id: 6, title: "Task 6", state: "done", archived: 1005, agents: [{ address: "t1", at: 1 }], ready_turns: 2 });
  expect(b.tasks[0].summary.length).toBe(SLIM_CUT + 1);                    // other long text cut, marked
  expect(lists.find((l) => l.slug === "small").tasks[0].title).toBe("Здравствуй");
  expect(out).toContain("Здравствуй");                                     // not \u-escaped
  expect(files.get(".autopilot.json").data).toEqual({ version: 2, spaces: {} });
  expect(warn).toBe(null);
});

test("only the lists that changed come again", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", tasks: [{ id: 1, title: "one" }] }));
  writeFileSync(join(dir, "b.json"), JSON.stringify({ folder: "/b", tasks: [{ id: 1, title: "two" }] }));
  const first = panelLists(read(h));
  const again = read(h, first.files);
  expect(again).not.toContain("one");
  expect(again).not.toContain("two");
  const second = panelLists(again, first.files);
  expect(second.lists.map((l) => [l.slug, l.tasks[0].title])).toEqual([["a", "one"], ["b", "two"]]);
  writeFileSync(join(dir, "b.json"), JSON.stringify({ folder: "/b", tasks: [{ id: 1, title: "changed" }] }));
  utimesSync(join(dir, "b.json"), new Date(), new Date(Date.now() + 5000));
  const third = read(h, second.files);
  expect(third).toContain("changed");
  expect(third).not.toContain("one");
  expect(panelLists(third, second.files).lists.map((l) => l.tasks[0].title)).toEqual(["one", "changed"]);
});

test("without python3 there, every file whole as before", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", tasks: [{ id: 1, title: "one", prompt: "p" }] }));
  const bin = mkdtempSync(join(tmpdir(), "shep-bin-"));
  for (const t of ["sh", "cat", "cut"]) symlinkSync(Bun.which(t), join(bin, t));
  const { lists } = panelLists(read(h, null, bin));
  expect(lists.map((l) => [l.slug, l.tasks[0].prompt])).toEqual([["a", "p"]]);
});

test("a read near what Herdr passes back says so", () => {
  expect(panelLists("x".repeat(PANEL_WARN + 1)).warn).toContain("very big");
  expect(panelLists("").warn).toBe(null);
});

// #1468: the service read every list whole every 10 s, megabytes over a home connection. It reads only what changed.
const readChanges = (h, files, path = process.env.PATH) =>
  Bun.spawnSync(["sh", "-c", READ_CHANGES, ...changesArgs(files)], { env: { HOME: h, PATH: path } }).stdout.toString();

test("the service's read: an unchanged list is one line, a changed one sends only its changed tasks", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "busy.json"), JSON.stringify(busy));
  writeFileSync(join(dir, ".news.json"), JSON.stringify([1, 2]));
  const out1 = readChanges(h);
  const first = changedLists(out1);
  expect(first.stale).toBe(false);
  expect(first.lists.map((l) => [l.slug, l.tasks.length])).toEqual([["busy", 300]]);
  // what the service never uses stays out; what it shows stays whole (the brief's first message)
  expect(first.lists[0].tasks[0].agents_md).toBeUndefined();
  expect(first.lists[0].tasks[0].prompt).toBe(prompt);
  expect(first.lists[0].tasks[0]["#"]).toBeUndefined();
  const same = readChanges(h, first.files);
  expect(same.length).toBeLessThan(100);
  expect(changedLists(same, first.files).lists).toEqual(first.lists);
  // one task's status changes: that task comes, the other 299 as their hashes
  const next = { ...busy, tasks: busy.tasks.map((t, i) => (i === 290 ? { ...t, progress: { text: "step 2" } } : t)) };
  writeFileSync(join(dir, "busy.json"), JSON.stringify(next));
  utimesSync(join(dir, "busy.json"), new Date(), new Date(Date.now() + 5000));
  const out3 = readChanges(h, first.files);
  expect(out3.length).toBeLessThan(out1.length / 20);
  const third = changedLists(out3, first.files);
  const { agents_md: _, ...want } = next.tasks[290];
  expect(third.lists[0].tasks[290]).toEqual(want);
  expect(third.lists[0].tasks[0]).toBe(first.lists[0].tasks[0]);
  expect(third.lists[0].tasks.length).toBe(300);
});

test("the service's read: a hash it doesn't have says read again; without python3, every list whole", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", tasks: [{ id: 1, title: "one" }, { id: 2, title: "two" }] }));
  const first = changedLists(readChanges(h));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", tasks: [{ id: 1, title: "one" }, { id: 2, title: "2" }] }));
  utimesSync(join(dir, "a.json"), new Date(), new Date(Date.now() + 5000));
  const lost = new Map([...first.files].map(([n, f]) => [n, { ...f, byHash: new Map() }]));
  expect(changedLists(readChanges(h, first.files), lost).stale).toBe(true);
  const bin = mkdtempSync(join(tmpdir(), "shep-bin-"));
  for (const t of ["sh", "cat"]) symlinkSync(Bun.which(t), join(bin, t));
  const plain = changedLists(readChanges(h, first.files, bin), first.files);
  expect(plain.stale).toBe(false);
  expect(plain.lists.map((l) => l.tasks.map((t) => t.title))).toEqual([["one", "2"]]);
});
