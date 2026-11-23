import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configOf, reposOf, setConfig, spaceRepo } from "./next.ts";
import { relocateSettings } from "../core/host.js";

// SHEP-335: the settings that shape a task are the repo's it works in, not the space's that started it. The app lists the
// repos (with tasks or a space, per machine), sets their rows, and a space keeps only its Assistant's.
const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
const codex = { agent: "codex", model: "gpt-5", effort: null, fast: false, perm: null };

function withFile(d: any, fn: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "shep-335-"));
  const was = process.env.HERDR_TASK_SETTINGS;
  const path = join(dir, "settings.json");
  process.env.HERDR_TASK_SETTINGS = path;
  try {
    writeFileSync(path, JSON.stringify(d));
    fn(path);
  } finally {
    process.env.HERDR_TASK_SETTINGS = was;
    rmSync(dir, { recursive: true, force: true });
  }
}

const spaces = [
  { id: "sproot", folder: "/", machine: null },
  { id: "spshop", folder: "/home/u/dev/shop/web", machine: null, git: { repo: "/home/u/dev/shop/.git" } },
  { id: "vm/sp9", folder: "/srv/api", machine: "vm" },
];
const tasks = [
  { on: "box", taskFolder: "/home/u/dev/shop" }, { on: "box", taskFolder: "/home/u/dev/shop" },
  { on: "vm", taskFolder: "/srv/api" }, { on: "box", taskFolder: "/home/u/dev/blog" },
];

test("the repos: where tasks work or a space sits, per machine, a subfolder on its repo, most tasks first", () => {
  const r = reposOf(spaces, tasks, "box");
  expect(r.map((x) => [x.key, x.spaces, x.tasks])).toEqual([
    ["/home/u/dev/shop", ["spshop"], 2], ["/home/u/dev/blog", [], 1], ["vm:/srv/api", ["vm/sp9"], 1], ["/", ["sproot"], 0]]);
  expect(spaceRepo(spaces[1])).toBe("/home/u/dev/shop");
  expect(spaceRepo(spaces[2])).toBe("vm:/srv/api");
});

test("a repo's rows: its own or Everywhere's; a space shows only its Assistant's as its own", () => {
  withFile({ everywhere: { tasks: { merge: "checks" } },
    repos: { "/home/u/dev/shop": { tasks: { merge: "auto" }, worker: codex }, "/old/gone": { tasks: { proof: false } } },
    spaces: { sproot: { folder: "/", coordinator: codex, tasks: { merge: "ask" } } } }, () => {
    const c = configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick } as any, spaces: ["sproot", "spshop"], secrets: [], plans: [], repos: reposOf(spaces, tasks, "box") });
    const shop = c.repos!.find((x) => x.key === "/home/u/dev/shop")!;
    expect([shop.merge, shop.agents.Tasks.agent, shop.own.sort()]).toEqual(["now", "codex", ["agents.Tasks", "merge"]]);
    const blog = c.repos!.find((x) => x.key === "/home/u/dev/blog")!;
    expect([blog.merge, blog.own]).toEqual(["checks", []]);
    // a repo in the file with no task or space now still shows, so it can be reset
    expect(c.repos!.find((x) => x.key === "/old/gone")).toMatchObject({ name: "gone", proof: false, own: ["proof"], tasks: 0 });
    // root: its own Assistant only; a task value it still holds isn't its own row any more
    expect(c.spaces.sproot.own).toEqual(["agents.Chats"]);
    // a file not moved yet: the space sitting on the folder still gives it its task settings
    expect(c.repos!.find((x) => x.key === "/")).toMatchObject({ merge: "done", own: ["merge"] });
  });
});

test("set a repo's row, a space's task row goes to its repo, Reset; a space's Assistant stays the space's", () => {
  withFile({ everywhere: { tasks: { merge: "checks" } }, spaces: { spshop: { folder: "/home/u/dev/shop", worker: codex, tasks: { proof: false } } } }, (path) => {
    const read = () => JSON.parse(readFileSync(path, "utf8"));
    // the first change to a repo takes along what the space on it still kept (a file not moved yet): nothing lost
    setConfig("repo:/home/u/dev/shop", "merge", "now", { id: "spshop", name: "shop", machine: null, repo: "/home/u/dev/shop" });
    expect(read().repos["/home/u/dev/shop"]).toEqual({ worker: codex, tasks: { proof: false, merge: "auto" } });
    expect(read().spaces.spshop).toEqual({ folder: "/home/u/dev/shop" });
    // a voice call's "merge right away for root": root's repo (its folder), never the space
    setConfig("sproot", "merge", "now", { id: "sproot", name: "root", machine: null, folder: "/", repo: "/" });
    expect(read().repos["/"]).toEqual({ tasks: { merge: "auto" } });
    expect(read().spaces.sproot).toBeUndefined();
    setConfig("sproot", "agents.Chats", codex, { id: "sproot", name: "root", machine: null, folder: "/", repo: "/" });
    expect(read().spaces.sproot).toMatchObject({ name: "root", coordinator: codex });
    expect(() => setConfig("repo:/home/u/dev/shop", "agents.Chats", codex)).toThrow("set per space");
    expect(() => setConfig("repo:__proto__", "merge", "now")).toThrow("isn't here any more");
    setConfig("repo:vm:/srv/api", "review", true);
    expect(read().repos["vm:/srv/api"]).toEqual({ tasks: { review_rounds: 1 } });
    setConfig("repo:/home/u/dev/shop", "merge", null);
    expect(read().repos["/home/u/dev/shop"].tasks).toEqual({ proof: false });
  });
});

test("moving the serving machine renames the repos' machines, as the spaces' ids", () => {
  const file = { repos: { "/home/u/shop": { tasks: { merge: "auto" } }, "vm:/srv/api": { tasks: { proof: false } }, "gone:/x": {} } };
  const toVm = (m: string | null) => (m === null ? "box" : m === "vm" ? null : m === "gone" ? undefined : m);
  expect(relocateSettings(file, toVm).repos).toEqual({ "box:/home/u/shop": { tasks: { merge: "auto" } }, "/srv/api": { tasks: { proof: false } } });
});
