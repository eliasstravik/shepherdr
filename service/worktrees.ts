// A space's worktrees from the web, as the window's worktree dialog (Herdr's mods/worktree) does them: New (a branch
// checked out in ~/.herdr/worktrees/<repo>/<branch>, a new one from HEAD when it doesn't exist yet), Open (a checkout
// of the repo: the space showing it, else a new one there), Remove (its space closes, then git worktree remove; changes
// and unpushed submodule commits are said up front, and anything new since the dialog opened asks once more).
// "info" is what the dialog shows before anything is done. New spaces are left unnamed, so they follow the checkout
// folder and nest under the repo.
import type { Hub } from "./hub.ts";
import { exec } from "./model.ts";
import { homeOf, newSpace } from "./spaces.ts";

type Spot = { id: string; folder: string; machine: string | null };
const slug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const inside = (p: string, dir: string) => p === dir || p.startsWith(dir + "/");

export async function worktreeAct(hub: Hub, space: Spot, b: any, store: any, close: () => Promise<unknown>, all: Spot[] = []) {
  const on = space.machine;
  const git = async (cwd: string, args: string[]) => {
    const r = await exec(hub, ["git", "-C", cwd, ...args], on);
    return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
  };
  const home = (await homeOf(hub, on)) ?? "";
  // Herdr's own place for them (its worktree dialog's: ~/.herdr is Herdr's folder), not Shepherdr's task worktrees
  const root = `${home}/.herdr/worktrees`;
  // the repo the space's folder belongs to: its main checkout and name, and whether the folder is a linked worktree
  const top = await git(space.folder, ["rev-parse", "--show-toplevel"]);
  const common = await git(space.folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repo = top.ok && common.ok ? (() => {
    const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
    return { top: top.out, main, name: main.split("/").pop() ?? main, linked: main !== top.out };
  })() : null;

  // every checkout of the repo, the main one first, then the most recently committed, with the space showing it
  const checkouts = async () => {
    if (!repo) return [];
    const list = await git(repo.main, ["worktree", "list", "--porcelain"]);
    if (!list.ok) return [];
    const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"]);
    const when = new Map(refs.out.split("\n").map((l) => l.split("\t")).map(([br, at]) => [br, Number(at) || 0] as const));
    const out: { path: string; branch: string | null; main: boolean; at: number; place?: string }[] = [];
    for (const block of list.out.split(/\n\n+/)) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
      const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
      out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
    }
    // the space showing a checkout: its folder is in it (the deepest checkout wins)
    for (const c of out) {
      const s = all.find((x) => (x.machine ?? null) === (on ?? null) && inside(x.folder, c.path) && !out.some((o) => o.path !== c.path && o.path.length > c.path.length && inside(x.folder, o.path)));
      if (s) c.place = s.id;
    }
    return out.sort((x, y) => Number(y.main) - Number(x.main) || y.at - x.at);
  };

  // the submodule repos git keeps for the checkout (nested ones too), and those with commits that exist nowhere else
  const submodules = async (at: string) => {
    const gitDir = await git(at, ["rev-parse", "--absolute-git-dir"]);
    if (!gitDir.ok) throw new Error(gitDir.err || "git rev-parse failed.");
    const mods: { name: string; dir: string; pinned: string }[] = [];
    const walk = async (dirOf: string, config: string[], parent = ""): Promise<void> => {
      const keys = await git(dirOf, ["--git-dir", dirOf, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"]);
      if (!keys.ok) return;
      for (const record of keys.out.split("\0").filter(Boolean)) {
        const cut = record.indexOf("\n");
        const name = record.slice("submodule.".length, cut - ".path".length);
        const dir = `${dirOf}/modules/${name}`;
        if (!(await git(dirOf, ["--git-dir", dir, "rev-parse", "--git-dir"])).ok) continue;
        const pinned = await git(dirOf, ["--git-dir", dirOf, "rev-parse", `HEAD:${record.slice(cut + 1)}`]);
        mods.push({ name: parent + name, dir, pinned: pinned.ok ? pinned.out : "" });
        if ((await git(dirOf, ["--git-dir", dir, "cat-file", "-e", "HEAD:.gitmodules"])).ok) await walk(dir, ["--blob", "HEAD:.gitmodules"], `${parent + name}/`);
      }
    };
    await walk(gitDir.out, ["--file", `${at}/.gitmodules`]);
    const unpushed: string[] = [];
    for (const m of mods) {
      const local = await git(gitDir.out, ["--git-dir", m.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(m.pinned ? [m.pinned] : [])]);
      if (!local.ok) throw new Error(local.err || `Couldn't check submodule ${m.name}.`);
      if (local.out) unpushed.push(m.name);
    }
    return { mods, unpushed };
  };
  const status = () => git(repo!.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"]);

  if (b.op === "info") {
    const base = { home, root, folder: space.folder, repo: repo ? { name: repo.name, linked: repo.linked, top: repo.top } : null };
    if (repo && b.for === "remove") return { ...base, dirty: (await status()).out !== "", unpushed: (await submodules(repo.top)).unpushed };
    if (repo && b.for === "open") return { ...base, list: await checkouts() };
    return base;
  }
  if (!repo) throw new Error(`${space.folder} is not in a git repository.`);
  if (b.op === "new") {
    const branch = String(b.branch ?? "").trim();
    if (!branch || branch.startsWith("-")) return { error: "Type a branch name." };
    const path = `${root}/${repo.name}/${slug(branch)}`;
    const exists = (await git(repo.main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
    const r = await git(repo.top, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
    if (!r.ok) return { error: r.err || "git worktree add failed." };
    return { place: await newSpace(hub, { machine: on, path, unnamed: true, store }) };
  }
  if (b.op === "open") {
    const c = (await checkouts()).find((x) => x.path === String(b.path ?? ""));
    if (!c) throw new Error("That isn't one of this repo's worktrees.");
    return { place: c.place ?? (await newSpace(hub, { machine: on, path: c.path, unnamed: true, store })) };
  }
  if (b.op === "remove") {
    if (!repo.linked) throw new Error("This is the repository's main checkout, not a worktree.");
    const st = await status();
    if (!st.ok) return { error: st.err || "git status failed." };
    // git refuses a worktree with submodules unless forced; only risk that appeared since the dialog opened warns again
    const { mods, unpushed } = await submodules(repo.top);
    const seen: string[] = Array.isArray(b.unpushed) ? b.unpushed : [];
    const dirty = !!b.dirty || st.out !== "";
    const all = [...new Set([...seen, ...unpushed])];
    if ((st.out && !b.dirty) || unpushed.some((n) => !seen.includes(n)))
      return { error: "It changed since this opened. Enter again removes it anyway.", dirty, unpushed: all };
    // its space first: terminals in the folder would keep it busy
    await close();
    const r = await git(repo.main, ["worktree", "remove", ...(dirty || mods.length ? ["--force"] : []), repo.top]);
    if (!r.ok) return { error: r.err || "git worktree remove failed." };
    return { ok: true };
  }
  throw new Error("Pick New, Open or Remove.");
}
