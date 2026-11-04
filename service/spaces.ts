// New spaces from the web, and spaces without a Herdr window. With the window (Shepherdr's layout installed), a space
// is the window's: it makes it (herdr-app do space.new), names it as New space does, and gives it its Assistant (new
// spaces get one). A web-only install has no window: its spaces are the service's own list (the shared document's
// "spaces"), each with an Assistant started here from the assistant template, labelled as the window labels one.
// Folders for the New space dialog are read on the space's machine (no hidden ones; a repo is a folder with .git).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import { exec } from "./model.ts";

const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
export const withWindow = () => existsSync(join(APP, "mods", "spaces-chat"));

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

// a folder's subfolders, repos marked: "name<TAB>repo(0|1)" lines; first line: the path, whether it is a folder, its repo
const LIST = `p="$1"; case "$p" in "~"*) p="$HOME\${p#\\~}";; esac
if [ -d "$p" ]; then top=$(git -C "$p" rev-parse --show-toplevel 2>/dev/null); printf '%s\\t1\\t%s\\n' "$p" "$top"
  for d in "$p"/*/; do [ -d "$d" ] || continue; n=\${d%/}; n=\${n##*/}; [ -e "$d/.git" ] && r=1 || r=0; printf '%s\\t%s\\n' "$n" "$r"; done | head -300
else printf '%s\\t0\\t\\n' "$p"; fi`;

export async function folders(hub: Hub, machine: string | null, path: string, home: string) {
  const r = await exec(hub, ["sh", "-c", LIST, "list", path || "~"], machine);
  const [head, ...rows] = r.stdout.split("\n").filter(Boolean);
  const [abs, dir, repo] = (head ?? "").split("\t");
  const tilde = (p: string) => (home && (p === home || p.startsWith(home + "/")) ? `~${p.slice(home.length)}` : p);
  const entries = rows.map((l) => { const [name, r] = l.split("\t"); return { name, path: tilde(`${abs}/${name}`), repo: r === "1" }; });
  return { path: tilde(abs ?? path), exists: !!abs && (dir === "1" || existsSync(abs)), dir: dir === "1", repo: repo ? tilde(repo) : null, entries: entries.slice(0, 300), ...(rows.length > 300 ? { more: true } : {}) };
}

/** Makes a space at path on machine (null: here); create: a new folder made a git repo first, as New space's toggle. */
export async function newSpace(hub: Hub, opts: { machine: string | null; path: string; name?: string; create?: boolean; store: { value(k: string): any; set(k: string, v: unknown): Promise<unknown> } }) {
  const { machine, path, create } = opts;
  if (!path || path.includes("\0")) throw new Error("Pick a folder.");
  if (create) {
    const r = await exec(hub, ["sh", "-c", 'p="$1"; case "$p" in "~"*) p="$HOME${p#\\~}";; esac; mkdir -p "$p" && cd "$p" && { [ -e .git ] || { git init -q && git commit -q --allow-empty -m "Start"; }; } && pwd', "new", path], machine);
    if (r.code !== 0) throw new Error("That folder couldn't be made.");
  }
  const abs = (await exec(hub, ["sh", "-c", 'p="$1"; case "$p" in "~"*) p="$HOME${p#\\~}";; esac; cd "$p" 2>/dev/null && pwd', "abs", path], machine)).stdout.trim();
  if (!abs) throw new Error("That folder isn't there.");
  const name = (opts.name || abs.split("/").filter(Boolean).pop() || "home").slice(0, 60);
  if (withWindow()) {
    const r = await run(["herdr-app", "do", "space.new", "--folder", abs, "--name", name, ...(machine ? ["--machine", machine] : [])]);
    let out: any = {};
    try { out = JSON.parse(r.out || "{}"); } catch {}
    if (r.code !== 0 || !out.space) throw new Error("A new space opens in the Herdr window: it needs the window open.");
    return machine ? `${machine}/${out.space}` : out.space as string;
  }
  // no window: the service's own space, and its Assistant from the assistant template
  const id = `sp${crypto.randomUUID().replace(/-/g, "")}`;
  const list = Array.isArray(opts.store.value("spaces")) ? opts.store.value("spaces") : [];
  await opts.store.set("spaces", [...list, { id, name, folder: abs, machine, at: Date.now() }]);
  // Settings › Window › Assistant in new spaces off: it opens without one
  if (opts.store.value("coordinator.auto") === false) return machine ? `${machine}/${id}` : id;
  await run(["hc", "run", "--bg", "--keep", "--no-parent", ...(machine ? ["--on", machine] : []), "--cwd", abs,
    "--label", "herdr.role=coordinator", "--label", `herdr.coordinator.space=${id}`, "--label", `herdr.space=${id}`, "assistant"]);
  return machine ? `${machine}/${id}` : id;
}
