// A space's own folder in the Changes pane (Diff viewer): no base, so only what isn't committed shows.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { worktree } from "./worktree.ts";

const dir = mkdtempSync(join(tmpdir(), "shep-diff-"));
const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { cwd: dir });
git("init", "-q"); writeFileSync(join(dir, "a.txt"), "one\ntwo\n"); git("add", "."); git("commit", "-qm", "first");
writeFileSync(join(dir, "a.txt"), "one\nthree\n"); writeFileSync(join(dir, "new.txt"), "hi\n");

// the hub runs the command here, as herdr-core's machine.exec would on the space's machine
const hub = { call: async (_: string, p: any) => { const r = spawnSync(p.argv[0], p.argv.slice(1), { cwd: p.cwd }); return { code: r.status, stdout: r.stdout.toString("base64"), stderr: r.stderr.toString("base64") }; } } as any;

test("a folder with no base: what isn't committed, file by file", async () => {
  const d: any = await worktree(hub, { folder: dir, machine: null }, "diff");
  expect(d.against).toBeNull();
  expect(d.files.map((f: any) => [f.path, f.status, f.add, f.del])).toEqual([["a.txt", "modified", 1, 1], ["new.txt", "added", 0, 0]]); // a file new to git: its lines are not counted (core/worktree.js)
  const p: any = await worktree(hub, { folder: dir, machine: null }, "patch", "a.txt");
  expect(p.text).toContain("-two\n+three");
  const n: any = await worktree(hub, { folder: dir, machine: null }, "patch", "new.txt");
  expect(n.text).toContain("+hi");
});
