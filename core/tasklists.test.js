import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PANEL_WARN, READ_LISTS, READ_PANEL, SLIM_CUT, panelArgs, panelLists } from "./tasklists.js";

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
