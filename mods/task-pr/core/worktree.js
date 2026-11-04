// A task's worktree as its side views read it: what it changed against its base (Changes) and its pull request
// (Pull request), for the window's mods (task-changes, task-pr) and the web app's Diff and Pull request alike. git and
// gh run through a runner the caller gives (the window's exec, the service's herdr-core), on the task's machine.
// Shared core: the source is core/worktree.js; bin/sync-shared copies it into the mods in lib/COPIES.

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie): a folder watch would see it, and
// every refresh would start the next one.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

// Where the task left its base: the fork point with its base branch, unless the base already holds all of it
// (merged), then the commit it started from. Neither: its last commit (only what isn't committed shows, as Herdr's
// Changes). git(args) -> { code, stdout }.
export async function against(git, { base, start }) {
  const head = (await git(["rev-parse", "--verify", "HEAD"])).stdout?.trim();
  if (!head) return null;
  if (base) {
    const mb = await git(["merge-base", "HEAD", base]);
    const at = mb.code === 0 ? mb.stdout.trim() : null;
    if (at && at !== head) return { rev: at, label: base };
  }
  if (start && start !== head && (await git(["cat-file", "-e", `${start}^{commit}`])).code === 0) return { rev: start, label: base ?? start.slice(0, 7) };
  return { rev: "HEAD", label: null };
}

// The changed files from `diff --name-status -z`, `diff --numstat -z` and `ls-files --others -z`, by path:
// [{ path, status: "A" | "M" | "D" | "U", fresh (not in git yet), add, del, binary? }].
export function changedFiles(names, nums, fresh) {
  const stats = {};
  for (const entry of String(nums).split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (parts.length) stats[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  const files = [], parts = String(names).split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const xy = parts[i], path = parts[i + 1];
    const s = xy.startsWith("U") ? "U" : xy.startsWith("D") ? "D" : xy.startsWith("A") ? "A" : "M";
    files.push({ path, status: s, fresh: false, ...(stats[path] ?? { add: 0, del: 0 }) });
  }
  for (const path of String(fresh).split("\0").filter(Boolean)) files.push({ path, status: "A", fresh: true, add: 0, del: 0 });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export const PR_FIELDS = "number,title,state,isDraft,url,headRefName,baseRefName,additions,deletions,changedFiles,statusCheckRollup";

// A check, as Shepherdr sorts them: pass, fail, pending (running or waiting) or skip.
export function checkOf(c) {
  if (c.__typename === "StatusContext") {
    const s = String(c.state ?? "").toUpperCase();
    return { name: c.context ?? "Status", url: c.targetUrl || null,
      state: s === "SUCCESS" ? "pass" : s === "PENDING" || s === "EXPECTED" ? "pending" : "fail" };
  }
  const done = String(c.status ?? "").toUpperCase() === "COMPLETED", end = String(c.conclusion ?? "").toUpperCase();
  return { name: c.name ?? c.workflowName ?? "Check", workflow: c.workflowName || null, url: c.detailsUrl || null,
    state: !done ? "pending" : end === "SUCCESS" ? "pass" : end === "SKIPPED" || end === "NEUTRAL" ? "skip" : "fail" };
}

// "1 failed · 2 running · 3 passed"
export function checksLine(cs) {
  const n = (s) => cs.filter((c) => c.state === s).length;
  return [[n("fail"), "failed"], [n("pending"), "running"], [n("pass"), "passed"], [n("skip"), "skipped"]]
    .filter(([k]) => k).map(([k, w]) => `${k} ${w}`).join(" · ");
}

// Failed first, then running, passed, skipped: what needs a look sits on top.
export const CHECK_ORDER = { fail: 0, pending: 1, pass: 2, skip: 3 };

// gh pr view's JSON as the views show it.
export function prOf(d) {
  const state = d.state === "MERGED" ? "merged" : d.state === "CLOSED" ? "closed" : d.isDraft ? "draft" : "open";
  const checks = (d.statusCheckRollup ?? []).map(checkOf).sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name));
  return { number: d.number, title: d.title, url: d.url, state, head: d.headRefName, base: d.baseRefName,
    add: d.additions ?? 0, del: d.deletions ?? 0, files: d.changedFiles ?? 0, checks };
}
