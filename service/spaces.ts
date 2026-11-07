// New spaces from the web, and spaces without a Herdr window. With the window (Shepherdr's layout installed), a space
// is the window's: it makes it (herdr-app do space.new), names it as New space does, and gives it its Assistant (new
// spaces get one). A web-only install has no window: its spaces are the service's own list (the shared document's
// "spaces"), each with an Assistant started here from the assistant template, labelled as the window labels one.
// Folders for the New space dialog are read on the space's machine (no hidden ones; a repo is a folder with .git); its
// words and rules are core/newspace.js, the window's New space's too.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import { exec } from "./model.ts";
import * as NS from "../core/newspace.js";
import * as SP from "../core/spaces.js";
import { cleanCommand } from "../core/clean-env.js";

export const withWindow = () => existsSync(join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "mods", "spaces-chat"));

async function run(cmd: string[]) {
  // the window's herdr-app: SHEPHERDR_HERDR_APP in tests (as service/actions.ts)
  if (cmd[0] === "herdr-app" && process.env.SHEPHERDR_HERDR_APP) cmd = [process.env.SHEPHERDR_HERDR_APP, ...cmd.slice(1)];
  if (cmd[0] === "hc" && process.env.SHEPHERDR_HC) cmd = [process.env.SHEPHERDR_HC, ...cmd.slice(1)];
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

/** A machine's home folder (null: this computer's), or null when it can't be reached. */
export async function homeOf(hub: Hub, machine: string | null) {
  if (!machine) return HOME;
  const r = await exec(hub, ["sh", "-c", 'printf %s "$HOME"'], machine).catch(() => null);
  return r && r.code === 0 && r.stdout.startsWith("/") ? r.stdout : null;
}

/** What New space opens with on a machine (as coordinator.js newSpace finds it first): its home, its recent folders
 *  (its terminals' folders as their repo's top, newest first, at most 8) and where the field starts (`at`: the
 *  shown space's folder, when it is on that machine). */
export async function newSpaceInfo(hub: Hub, machine: string | null, at: string | null) {
  const home = await homeOf(hub, machine);
  if (!home) throw new Error(`Couldn't reach ${machine}. Try New space again once it's connected.`);
  const there = (a: string) => (machine ? a.startsWith(`${machine}/`) : !a.includes("/"));
  const paths = NS.recentCandidates([...hub.terminals.values()].filter((t) => there(t.address))
    .map((t) => ({ cwd: (t.foreground as { cwd?: string } | undefined)?.cwd ?? t.cwd, at: t.created_ms })));
  const r = paths.length ? await exec(hub, ["sh", "-c", NS.REPO_TOPS, "x", ...paths], machine).catch(() => null) : null;
  const recent = NS.recentFrom(r?.stdout ?? "").filter((p: string) => !NS.scratch(p));
  return { home, recent, start: NS.startFolder(at, recent, home) };
}

/** The template to start an Assistant from on machine (null: here): as the window's chat (mods/chat startAgent), a
 *  one-off copy, removed by done() once it has started, whose command first clears a parent Claude Code session's
 *  markers the holder may carry (SHEP-86, core/clean-env.js), then execs it: hc runs a template's command under sh -c,
 *  and where sh is dash (Debian, Ubuntu) the shell would stay the terminal's program, so no chat would know its CLI.
 *  words: the template's own words (its first message), when read. Unreadable: the template itself. */
export async function execTemplate(hub: Hub, name: string, machine: string | null): Promise<{ name: string; words: string; done: () => void }> {
  const plain = { name, words: "", done: () => {} };
  const DIR = 'dir="$HOME/.config/herdr-core/templates"; ';
  const src = (await exec(hub, ["sh", "-c", DIR + 'cat "$dir/$1.md"', "x", name], machine).catch(() => null))?.stdout ?? "";
  const head = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const cmd = /^command:[ \t]*(.+)$/m.exec(head?.[1] ?? "")?.[1]?.trim();
  if (!head || !cmd) return plain;
  const one = `herdr-${name}-${Date.now().toString(36)}`;
  const file = `---\nname: ${one}\ndescription: A one-off ${name} start that execs its command (Shepherdr's service), removed after use.\ncommand: ${cleanCommand(cmd)}\n---\n${src.slice(head[0].length)}`;
  const w = await exec(hub, ["sh", "-c", DIR + 'printf "%s" "$2" > "$dir/$1.md"', "x", one, file], machine).catch(() => null);
  if (w?.code !== 0) return plain;
  return { name: one, words: src.slice(head[0].length).trim(), done: () => void exec(hub, ["sh", "-c", DIR + 'rm -f "$dir/$1.md"', "x", one], machine).catch(() => null) };
}

/** The web's id for the space the window made: Herdr already answers another machine's as "<machine>/<id>" (its
 *  ids are qualified, as its tabs'); kept as it is, never "<machine>/<machine>/<id>" (SHEP-56: the page then waited
 *  for a space that never came). */
export const placeId = (space: string, machine: string | null) => (!machine || space.startsWith(`${machine}/`) ? space : `${machine}/${space}`);

/** Makes a space at path on machine (null: here), as the window's New space (mods/newspace, coordinator.js
 *  createSpace): a missing folder is made, makeRepo makes a folder outside git a repo (main, an empty first commit), it
 *  is named as Herdr names it ("Home" at home, else its repo's or folder's name; unnamed: left to follow its folder, as
 *  a worktree's), and `icon` is kept as the sidebar's Rename keeps it. */
export async function newSpace(hub: Hub, opts: { machine: string | null; path: string; name?: string; unnamed?: boolean; makeRepo?: boolean; icon?: string | null; store: { value(k: string): any; set(k: string, v: unknown): Promise<unknown> } }) {
  const { machine } = opts;
  if (!opts.path || opts.path.includes("\0")) throw new Error("Pick a folder.");
  const home = (await homeOf(hub, machine)) ?? "";
  const abs = NS.pathOf(opts.path, home);
  if (!abs) throw new Error("Pick a folder.");
  const git = (args: string[]) => exec(hub, ["git", "-C", abs, ...args], machine);
  if ((await exec(hub, ["test", "-d", abs], machine)).code !== 0) {
    const r = await exec(hub, ["mkdir", "-p", "--", abs], machine);
    if (r.code !== 0) throw new Error(r.stderr.trim().split("\n").pop() || NS.WORDS.cantMake(NS.tilde(abs, home)));
  }
  let top = (await git(["rev-parse", "--show-toplevel"]).catch(() => null))?.stdout.trim() || "";
  if (opts.makeRepo && !top && NS.offersRepo(abs, false, home)) {
    for (const args of NS.NEW_REPO) {
      const r = await git(args);
      if (r.code !== 0) throw new Error(NS.WORDS.cantRepo(r.stderr.trim().split("\n").pop()));
    }
    top = abs;
  }
  const name = (opts.name || NS.placeName(abs, top, home)).slice(0, 80);
  const iconOf = (id: string) => (opts.icon ? opts.store.set("spaces-chat", SP.withIcon(opts.store.value("spaces-chat"), id, opts.icon)) : null);
  if (withWindow()) {
    const r = await run(["herdr-app", "do", "space.new", "--folder", abs, ...(opts.unnamed ? [] : ["--name", name]), ...(machine ? ["--machine", machine] : [])]);
    let out: any = {};
    try { out = JSON.parse(r.out || "{}"); } catch {}
    if (out.error) throw new Error(`Herdr couldn't make it: ${out.error}`);
    if (r.code !== 0 || !out.space) throw new Error("A new space opens in the Herdr window: it needs the window open.");
    const place = placeId(String(out.space), machine);
    await iconOf(place);
    return place;
  }
  // no window: the service's own space, and its Assistant from the assistant template
  const id = `sp${crypto.randomUUID().replace(/-/g, "")}`;
  const list = Array.isArray(opts.store.value("spaces")) ? opts.store.value("spaces") : [];
  await opts.store.set("spaces", [...list, { id, name, folder: abs, machine, at: Date.now() }]);
  await iconOf(machine ? `${machine}/${id}` : id);
  // Settings › Window › Assistant in new spaces off: it opens without one
  if (opts.store.value("coordinator.auto") === false) return machine ? `${machine}/${id}` : id;
  const t = await execTemplate(hub, "assistant", machine);
  await run(["hc", "run", "--bg", "--keep", "--no-parent", ...(machine ? ["--on", machine] : []), "--cwd", abs,
    "--label", "herdr.role=coordinator", "--label", `herdr.coordinator.space=${id}`, "--label", `herdr.space=${id}`, t.name]);
  t.done();
  return machine ? `${machine}/${id}` : id;
}
