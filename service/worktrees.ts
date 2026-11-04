// A space's worktrees from the web, as Herdr's own worktree dialog makes them: New (a branch checked out in
// ~/.herdr/worktrees/<repo>/<branch>, a new one from HEAD when it doesn't exist yet), Open (an existing one as a space),
// Remove (its space closes, then git worktree remove; changes in it go only once the person said so). Each new space
// as New space makes one (service/spaces.ts).
import type { Hub } from "./hub.ts";
import { exec } from "./model.ts";
import { newSpace } from "./spaces.ts";

const slug = (branch: string) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export async function worktreeAct(hub: Hub, space: { id: string; folder: string; machine: string | null }, b: any, store: any, close: () => Promise<unknown>) {
  const git = (args: string[], cwd = space.folder) => exec(hub, ["git", "-C", cwd, ...args], space.machine);
  const top = (await git(["rev-parse", "--show-toplevel"])).stdout.trim();
  const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
  if (!top || !common) throw new Error("This space's folder isn't a git repository.");
  const main = common.replace(/\/\.git$/, "");
  if (b.op === "list") {
    const out = (await git(["worktree", "list", "--porcelain"])).stdout;
    return { linked: top !== main, list: out.split("\n\n").map((blk) => ({ path: /^worktree (.+)$/m.exec(blk)?.[1], branch: /^branch refs\/heads\/(.+)$/m.exec(blk)?.[1] ?? null })).filter((x) => x.path && x.path !== top) };
  }
  if (b.op === "new") {
    const branch = String(b.branch ?? "").trim();
    if (!branch || !/^[\w./-]{1,100}$/.test(branch)) throw new Error("Type a branch name.");
    const home = (await exec(hub, ["sh", "-c", 'printf %s "$HOME"'], space.machine)).stdout;
    const path = `${home}/.herdr/worktrees/${main.split("/").pop()}/${slug(branch)}`;
    const exists = (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], main)).code === 0;
    const r = await git(exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"], top);
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "git worktree add failed.");
    return { place: await newSpace(hub, { machine: space.machine, path, store }) };
  }
  if (b.op === "open") {
    const path = String(b.path ?? "");
    const known = (await git(["worktree", "list", "--porcelain"])).stdout.split("\n").some((l) => l === `worktree ${path}`);
    if (!known) throw new Error("That isn't one of this repo's worktrees.");
    return { place: await newSpace(hub, { machine: space.machine, path, store }) };
  }
  if (b.op === "remove") {
    if (top === main) throw new Error("This is the repo itself, not a worktree.");
    const dirty = (await git(["--no-optional-locks", "status", "--porcelain"])).stdout.trim() !== "";
    if (dirty && !b.force) return { dirty: true };
    // its space first: terminals in the folder would keep it busy
    await close();
    const r = await git(["worktree", "remove", ...(dirty ? ["--force"] : []), top], main);
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "git worktree remove failed.");
    return { ok: true };
  }
  throw new Error("Pick New, Open or Remove.");
}
