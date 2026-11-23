// SHEP-325: the snapshot says where each task works (its list's name and folder, whether it is a repo), the space that
// asked for it, and the other spaces whose Tasks hold it (those working in its folder on its machine). Fake data.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { HOME } from "./paths.ts";

const tasksOf = (spaces: any[], rows: any[]) => {
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  return c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows }).tasks;
};
const row = (x: any) => ({ ref: "SHOP-1", slug: "dev-shop", id: 1, title: "A task", section: "working", machine: null, ...x });
const SHOP = `${HOME}/dev/shop`;
const spaces = [
  { id: "home", name: "Home", folder: HOME, machine: null, assistant: null },
  { id: "root", name: "root", folder: "/", machine: null, assistant: null },
  { id: "sp1", name: "shop", folder: SHOP, machine: null, assistant: null },
  // two spaces on one repo
  { id: "sp2", name: "shop-docs", folder: SHOP, machine: null, assistant: null },
  { id: "vm-b/sp3", name: "shop", folder: SHOP, machine: "vm-b", assistant: null },
];

test("a task asked in #root that works in a repo: tagged by the repo, held by the spaces on that folder", () => {
  const [t] = tasksOf(spaces, [row({ folder: SHOP, list: "shop", kind: "repo", space: "root" })]);
  expect(t.work).toEqual({ name: "shop", folder: SHOP, short: "~/dev/shop", repo: true });
  expect(t.place).toBe("root");
  expect(t.asked).toBe("root");
  // both spaces on the folder on this machine, not the one on another machine
  expect(t.also).toEqual(["sp1", "sp2"]);
});

test("a repo no space works in, a plain folder, and a task no space asked for", () => {
  const [a, b, c] = tasksOf(spaces, [
    row({ ref: "VIBE-1", folder: `${HOME}/dev/vibecam`, list: "vibecam", kind: "repo", space: "root" }),
    row({ ref: "HOME-1", folder: HOME, list: "~", kind: "folder", space: null }),
    row({ ref: "SHOP-2", folder: SHOP, list: "shop", kind: "repo", space: "gone" }),
  ]);
  expect([a.work.name, a.work.repo, a.also]).toEqual(["vibecam", true, undefined]);
  expect([b.work.name, b.work.short, b.work.repo, b.asked, b.place]).toEqual(["~", "~", false, undefined, "home"]);
  // its asking space is gone: it falls to the first space on its folder, says no asker, and the other is also
  expect([c.place, c.asked, c.also]).toEqual(["sp1", undefined, ["sp2"]]);
});

test("another machine's task: its folder with that machine's home as ~, held by its space there", () => {
  const [t] = tasksOf(spaces, [row({ machine: "vm-b", folder: SHOP, list: "shop", kind: "repo", space: "vm-b/sp3" })]);
  expect(t.on).toBe("vm-b");
  expect(t.place).toBe("vm-b/sp3");
  expect(t.also).toBeUndefined();
  expect(t.work.folder).toBe(SHOP);
});

test("SHEP-348: its pull request's checks word and closed, and whether it has its own worktree", () => {
  const pr = { number: 12, url: "https://github.com/example/shop/pull/12", repo: "example/shop", watch: { seen: [] } };
  const [a, b, c] = tasksOf(spaces, [
    row({ ref: "SHOP-3", folder: SHOP, list: "shop", kind: "repo", worktree: `${HOME}/wt/shop/task-3`, branch: "task/3", pr: { ...pr, checks: "failed" } }),
    row({ ref: "SHOP-4", folder: SHOP, list: "shop", kind: "repo", worktree: SHOP, pr: { ...pr, checks: "nonsense", closed: true } }),
    row({ ref: "SHOP-5", folder: SHOP, list: "shop", kind: "repo" }),
  ]);
  expect([a.pr, a.worktree, a.branch]).toEqual([{ number: 12, url: pr.url, checks: "failed" }, true, "task/3"]);
  expect([b.pr, b.worktree]).toEqual([{ number: 12, url: pr.url, closed: true }, undefined]);
  expect([c.pr, c.worktree]).toEqual([undefined, undefined]);
});
