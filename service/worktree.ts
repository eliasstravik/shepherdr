// A task's worktree for the web app's side panel (2.1's Files, Diff and Pull request), read only: git and gh on the
// task's machine through herdr-core, with the shared core's rules (core/worktree.js: the fork point, the changed
// files, gh's checks), as the window's Changes and Pull request read them. The task's record names the folder; a
// page names only a view and a path inside it.
import type { Hub } from "./hub.ts";
import { exec } from "./model.ts";
import * as W from "../core/worktree.js";
import type { Diff, DiffFile, FileText, Patch, PullRequest, TreeFiles } from "../web/shared/types.ts";

const { READ, against, changedFiles, PR_FIELDS, prOf, VIEW_WORDS, LIST_DIR, dirEntries, MARK_ARGS, markOf, PER_FOLDER } = W as any;
import { HOME } from "./paths.ts";

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
    // as the window's Pull request (mods/task-pr ask()): { pr }, or { why } there's none, or { error }
    if (!w.pr?.number && !w.branch) return { why: VIEW_WORDS.noBranch };
    const r = w.pr?.number && w.pr.repo ? await sh(["gh", "pr", "view", String(w.pr.number), "--repo", w.pr.repo, "--json", PR_FIELDS])
      : await sh(["gh", "pr", "view", w.branch!, "--json", PR_FIELDS]).catch(() => null);
    if (!r) return { why: VIEW_WORDS.noPr };
    const err = (r.stderr || r.stdout).trim();
    if (r.code !== 0) {
      if (!w.pr && /no pull requests? found|not a git repository|none of the git remotes|no git remotes/i.test(err)) return { why: VIEW_WORDS.noPr };
      return { error: err.split("\n")[0] || "GitHub didn't answer." };
    }
    const p = prOf(JSON.parse(r.stdout));
    const pr: PullRequest = { number: p.number, title: p.title, state: p.state, url: p.url, head: p.head, base: p.base, add: p.add, del: p.del, files: p.files,
      checks: p.checks.map((c: any) => ({ name: c.name, state: c.state, ...(c.url ? { url: c.url } : {}), ...(c.workflow ? { workflow: c.workflow } : {}) })) };
    return { pr };
  }
  if (what === "dir") {
    // one folder of the task's (the window's Files lists them one at a time, as you open them)
    const p = path ? inside(path) : "";
    const r = await sh(["sh", "-c", LIST_DIR, "files", p ? `${w.folder}/${p}` : w.folder], "/").catch(() => null);
    if (!r || r.code !== 0) return { error: VIEW_WORDS.folderGone };
    const all = dirEntries(r.stdout);
    // where it is, as the window's bar says it: home as ~, another machine's as machine:folder
    const root = w.machine ? `${w.machine}:${w.folder}` : w.folder === HOME ? "~" : w.folder.startsWith(HOME + "/") ? `~${w.folder.slice(HOME.length)}` : w.folder;
    return { root, entries: all.slice(0, PER_FOLDER), ...(all.length > PER_FOLDER ? { limited: true } : {}) };
  }
  if (what === "marks") {
    // the letter beside each changed file in Files, by its path inside the task's folder
    const top = await sh(["git", "rev-parse", "--show-prefix"]).catch(() => null);
    if (!top || top.code !== 0) return { marks: {} };
    const prefix = top.stdout.trim();
    const st = await sh(["git", ...MARK_ARGS]);
    const marks: Record<string, string> = {};
    if (st.code === 0) for (const e of st.stdout.split("\0").filter(Boolean).slice(0, 5000)) {
      const p = e.slice(3);
      if (p.startsWith(prefix)) marks[p.slice(prefix.length)] = markOf(e.slice(0, 2));
    }
    return { marks };
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
    const r = await sh(["sh", "-c", 'f="$1"; [ -f "$f" ] || exit 3; wc -c < "$f"; head -c "$2" "$f"', "file", p, String(MAX_TEXT)]).catch(() => null);
    if (!r || r.code !== 0) return { error: VIEW_WORDS.fileGone };
    const nl = r.stdout.indexOf("\n");
    const size = Number(r.stdout.slice(0, nl).trim()) || 0, text = r.stdout.slice(nl + 1);
    const out: FileText = text.includes("\0") ? { path: p, size, binary: true } : { path: p, size, text, ...(size > MAX_TEXT ? { tooBig: true } : {}) };
    return out;
  }
  // as the window's Changes: not a git folder, or gone (a finished task's worktree is removed), said plainly
  const top = await sh(["git", "rev-parse", "--show-toplevel"]).catch(() => null);
  if (top?.code !== 0) return { error: top && (await sh(["test", "-d", w.folder]).catch(() => null))?.code === 0 ? VIEW_WORDS.notGit : VIEW_WORDS.folderGone };
  const vs = await against(git, { base: w.base ?? null, start: w.start ?? null });
  if (!vs) return { error: VIEW_WORDS.noCommits };
  if (what === "diff") {
    const [names, nums, fresh] = await Promise.all([
      git(["diff", vs.rev, "--name-status", "-z", "--no-renames"]),
      git(["diff", vs.rev, "--numstat", "-z", "--no-renames"]),
      git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    if ([names, nums, fresh].some((r) => r.code !== 0)) return { error: "This task's changes can't be read." };
    const files: DiffFile[] = changedFiles(names.stdout, nums.stdout, fresh.stdout).slice(0, 1000)
      .map((f: any) => ({ path: f.path, status: STATUS[f.status] ?? "modified", add: f.add, del: f.del, ...(f.binary ? { binary: true } : {}) }));
    const out: Diff = { base: vs.label ?? "its last commit", against: vs.label ?? null, files, add: files.reduce((n, f) => n + f.add, 0), del: files.reduce((n, f) => n + f.del, 0) };
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
  throw new Error("Ask for dir, marks, files, file, diff, patch or pr.");
}
