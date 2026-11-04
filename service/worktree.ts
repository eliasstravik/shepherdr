// A task's worktree for the web app's side panel (2.1's Files, Diff and Pull request), read only: git and gh on the
// task's machine through herdr-core, with the shared core's rules (core/worktree.js: the fork point, the changed
// files, gh's checks), as the window's Changes and Pull request read them. The task's record names the folder; a
// page names only a view and a path inside it.
import type { Hub } from "./hub.ts";
import { exec } from "./model.ts";
import * as W from "../core/worktree.js";
import type { Diff, DiffFile, FileText, Patch, PullRequest, TreeFiles } from "../web/shared/types.ts";

const { READ, against, changedFiles, PR_FIELDS, prOf } = W as any;

export type Where = { folder: string; machine: string | null; base?: string | null; start?: string | null; branch?: string | null; pr?: { number: number; repo?: string } | null };

const MAX_FILES = 5000, MAX_TEXT = 400_000;
const STATUS: Record<string, DiffFile["status"]> = { A: "added", M: "modified", D: "deleted", U: "modified" };

/** A path inside the worktree: relative, no way out of it. */
function inside(path: unknown) {
  const p = String(path ?? "");
  if (!p || p.length > 4096 || p.startsWith("/") || p.split("/").some((x) => x === ".." || x === "") || p.includes("\0")) throw new Error("Not a file of this task.");
  return p;
}

export async function worktree(hub: Hub, w: Where, what: string, path?: string): Promise<unknown> {
  const sh = (argv: string[], cwd = w.folder) => hub.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, cwd, ...(w.machine ? { on: w.machine } : {}), timeout: 60 }, 70_000)
    .then((r) => ({ code: r.code, stdout: Buffer.from(r.stdout ?? "", "base64").toString("utf8"), stderr: Buffer.from(r.stderr ?? "", "base64").toString("utf8") }));
  const git = (args: string[]) => sh(["git", ...READ, ...args]);

  if (what === "pr") {
    const r = w.pr?.number && w.pr.repo ? await sh(["gh", "pr", "view", String(w.pr.number), "--repo", w.pr.repo, "--json", PR_FIELDS])
      : w.branch ? await sh(["gh", "pr", "view", w.branch, "--json", PR_FIELDS]) : null;
    const err = r ? (r.stderr || r.stdout).trim() : "";
    // as the window's Pull request: no PR is said plainly, not as an error from gh
    if (!r || (!w.pr && /no pull requests? found|not a git repository|none of the git remotes|no git remotes/i.test(err))) return { error: "This task has no pull request." };
    if (r.code !== 0) return { error: err.split("\n")[0] || "GitHub didn't answer." };
    const p = prOf(JSON.parse(r.stdout));
    const pr: PullRequest = { number: p.number, title: p.title, state: p.state, url: p.url, checks: p.checks.map((c: any) => ({ name: c.name, state: c.state, ...(c.url ? { url: c.url } : {}) })) };
    return pr;
  }
  if (what === "files") {
    const r = await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
    if (r.code !== 0) return { error: "This task's folder can't be read." };
    const all = r.stdout.split("\0").filter(Boolean).sort();
    const out: TreeFiles = { files: all.slice(0, MAX_FILES), ...(all.length > MAX_FILES ? { more: true } : {}) };
    return out;
  }
  if (what === "file") {
    const p = inside(path);
    const r = await sh(["sh", "-c", 'f="$1"; [ -f "$f" ] || exit 3; wc -c < "$f"; head -c "$2" "$f"', "file", p, String(MAX_TEXT)]);
    if (r.code !== 0) return { error: "That file isn't there." };
    const nl = r.stdout.indexOf("\n");
    const size = Number(r.stdout.slice(0, nl).trim()) || 0, text = r.stdout.slice(nl + 1);
    const out: FileText = text.includes("\0") ? { path: p, size, binary: true } : { path: p, size, text, ...(size > MAX_TEXT ? { tooBig: true } : {}) };
    return out;
  }
  const vs = await against(git, { base: w.base ?? null, start: w.start ?? null });
  if (!vs) return { error: "This repository has no commits." };
  if (what === "diff") {
    const [names, nums, fresh] = await Promise.all([
      git(["diff", vs.rev, "--name-status", "-z", "--no-renames"]),
      git(["diff", vs.rev, "--numstat", "-z", "--no-renames"]),
      git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    if ([names, nums, fresh].some((r) => r.code !== 0)) return { error: "This task's changes can't be read." };
    const files: DiffFile[] = changedFiles(names.stdout, nums.stdout, fresh.stdout).slice(0, 1000)
      .map((f: any) => ({ path: f.path, status: STATUS[f.status] ?? "modified", add: f.add, del: f.del, ...(f.binary ? { binary: true } : {}) }));
    const out: Diff = { base: vs.label ?? "its last commit", files, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
    return out;
  }
  if (what === "patch") {
    const p = inside(path);
    let r = await git(["diff", vs.rev, "--no-ext-diff", "--no-textconv", "--no-color", "--", p]);
    // a file new to git: all of it is added
    if (r.code === 0 && !r.stdout) r = await git(["diff", "--no-index", "--no-color", "--", "/dev/null", p]);
    const text = r.stdout;
    const out: Patch = { path: p, text: text.slice(0, MAX_TEXT), ...(text.length > MAX_TEXT ? { tooBig: true } : {}), ...(/^Binary files/m.test(text) ? { binary: true } : {}) };
    return out;
  }
  throw new Error("Ask for files, file, diff, patch or pr.");
}
