// The spaces: the service's own list, the shared document's "spaces" ([{ id, name, folder, machine, at }], machine
// null: the machine that keeps the document). A new one is added here and gets its Assistant, started from the
// assistant template and labelled for its space; rename, remove and reorder change the same list (service/actions.ts).
// Folders for the New space dialog are read on the space's machine (no hidden ones; a repo is a folder with .git); its
// words and rules are core/newspace.js.
import { existsSync } from "node:fs";
import type { Hub } from "./hub.ts";
import { HOME } from "./paths.ts";
import { exec } from "./model.ts";
import * as NS from "../core/newspace.js";
import * as SP from "../core/spaces.js";
import { AGENT_PATH, cleanCommand, wrappedCommand } from "../core/clean-env.js";
import { TEMPLATES_SH } from "../core/paths.js";
import { argvFor, NAMES, CHOICE_KEY, choiceOf, withChoice } from "../core/agents.js";
import { spawn } from "./spawn.ts";

/** A space's id as the app names it: another machine's is "<machine>/<id>". */
export const ownId = (x: { id: string; machine?: string | null }) => (x.machine ? `${x.machine}/${x.id}` : x.id);

/** The sidebar's own data (shared "spaces-chat") without a removed space: out of its group, its icon and its place in
 *  its machine's order. Unchanged: the same object. */
export function withoutSpace(bar: any, id: string) {
  if (!bar || typeof bar !== "object") return bar;
  const ordered = Object.values(bar.order ?? {}).some((l: any) => Array.isArray(l) && l.includes(id));
  const has = (bar.pinned ?? []).includes(id) || (bar.icons && id in bar.icons) || (bar.sections ?? []).some((s: any) => (s.spaces ?? []).includes(id)) || ordered;
  if (!has) return bar;
  const icons = { ...(bar.icons ?? {}) };
  delete icons[id];
  return {
    ...bar, icons,
    ...(Array.isArray(bar.pinned) ? { pinned: bar.pinned.filter((x: string) => x !== id) } : {}),
    ...(Array.isArray(bar.sections) ? { sections: bar.sections.map((s: any) => (s.spaces ?? []).includes(id) ? { ...s, spaces: s.spaces.filter((x: string) => x !== id) } : s) } : {}),
    ...(ordered ? { order: Object.fromEntries(Object.entries(bar.order).map(([k, l]: [string, any]) => [k, Array.isArray(l) ? l.filter((x: string) => x !== id) : l])) } : {}),
  };
}

async function run(cmd: string[]) {
  if (cmd[0] === "hc" && process.env.SHEPHERDR_HC) cmd = [process.env.SHEPHERDR_HC, ...cmd.slice(1)];
  const p = spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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

/** The template to start an Assistant from on machine (null: here): a
 *  one-off copy, removed by done() once it has started, whose command first clears a parent Claude Code session's
 *  markers the holder may carry (SHEP-86, core/clean-env.js), then execs it: hc runs a template's command under sh -c,
 *  and where sh is dash (Debian, Ubuntu) the shell would stay the terminal's program, so no chat would know its CLI.
 *  pick: the agent Shepherdr settings choose for it ({ agent, model, effort, fast, perm }, as the window's chat starts
 *  it): its command in place of the template's own (#1051: the web started the stock `claude`), unless that agent
 *  isn't installed there (then the template's own, as the window). Neither installed: refused in plain words, never a
 *  start that ends at once ("exec: claude: not found") and leaves the chat on Starting.
 *  words: the template's own words (its first message), when read. Unreadable: the template itself. */
export async function execTemplate(hub: Hub, name: string, machine: string | null, pick: any = null): Promise<{ name: string; words: string; done: () => void }> {
  const plain = { name, words: "", done: () => {} };
  const DIR = TEMPLATES_SH + 'dir="$SHEP_TEMPLATES"; ';   // where herdr-core reads them there (#1182)
  const src = (await exec(hub, ["sh", "-c", DIR + 'cat "$dir/$1.md"', "x", name], machine).catch(() => null))?.stdout ?? "";
  const head = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const own = /^command:[ \t]*(.+)$/m.exec(head?.[1] ?? "")?.[1]?.trim();
  if (!head || !own) return plain;
  const has = async (prog: string) => (await exec(hub, ["sh", "-c", `${AGENT_PATH} command -v "$1" >/dev/null 2>&1`, "x", prog], machine).catch(() => null))?.code === 0;
  let cmd = own;
  if (pick?.agent === "claude" || pick?.agent === "codex") {
    if (await has(pick.agent)) cmd = argvFor(pick, { agent: null, argv: [] }).argv.map(shellWord).join(" ");
    else if (!(await has(own.split(/\s+/)[0]))) {
      throw new Error(`${(NAMES as Record<string, string>)[pick.agent] ?? pick.agent} isn't installed on ${machine ?? "this computer"}. Install it, or pick another agent for the Assistant in Settings › Agents.`);
    }
  }
  const one = `herdr-${name}-${Date.now().toString(36)}`;
  const file = `---\nname: ${one}\ndescription: A one-off ${name} start that execs its command (Shepherdr's service), removed after use.\ncommand: ${startCommand(cmd)}\n---\n${src.slice(head[0].length)}`;
  const w = await exec(hub, ["sh", "-c", DIR + 'printf "%s" "$2" > "$dir/$1.md"', "x", one, file], machine).catch(() => null);
  if (w?.code !== 0) return plain;
  return { name: one, words: src.slice(head[0].length).trim(), done: () => void exec(hub, ["sh", "-c", DIR + 'rm -f "$dir/$1.md"', "x", one], machine).catch(() => null) };
}

/** A template's command as it starts: an agent's own (claude, codex) with its MCP servers behind herdr-mcp (MCP Apps,
 *  core/clean-env.js MCP_WRAP; herdr-mcp there decides whether it is on), anything else as it was. */
export const startCommand = (cmd: string) =>
  (/^(exec\s+)?(\S*\/)?(claude|codex)(\s|$)/.test(cmd.trim()) ? wrappedCommand(cmd) : cleanCommand(cmd));

/** One word of a command line for sh, quoted only when it needs it (as mods/chat's). */
export const shellWord = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);

/** Makes a space at path on machine (null: here): a missing folder is made, makeRepo makes a folder outside git a repo
 *  (main, an empty first commit), it is named after where it is ("Home" at home, else its repo's or folder's name;
 *  unnamed: left to follow its folder), and `icon` is kept as the sidebar's Rename keeps it. It joins the list of
 *  spaces (shared "spaces") and its Assistant starts from the assistant template. Returns its id (place), with error
 *  when its Assistant didn't start: the space is kept, and its first message starts one. */
export async function newSpace(hub: Hub, opts: { machine: string | null; path: string; name?: string; unnamed?: boolean; others?: boolean; makeRepo?: boolean; icon?: string | null; pick?: ((space: string) => any) | null; keepPick?: boolean; store: { value(k: string): any; set(k: string, v: unknown): Promise<unknown> } }) {
  const { machine } = opts;
  if (!opts.path || opts.path.includes("\0")) throw new Error("Pick a folder.");
  const home = (await homeOf(hub, machine)) ?? "";
  const abs = NS.pathOf(opts.path, home);
  if (!abs) throw new Error("Pick a folder.");
  // one space per folder: a folder that has its space already opens that one instead of a second (SHEP-296). Another
  // machine's home folder is its home space, listed first under it as ~. This computer's is Everything's, and where
  // there are other machines its own ~ space's too (3.2.8): that one opens, else it is made again (never Everything).
  const had = (Array.isArray(opts.store.value("spaces")) ? opts.store.value("spaces") : []) as any[];
  const atHome = !!home && SP.sameFolder(abs, home, home);
  const tilde = atHome && !machine && !!opts.others;
  const there = atHome && !machine ? (tilde ? SP.tildeOf(had, home) : SP.everythingOf(had, home)) : had.find((x) => x && (x.machine ?? null) === machine && SP.sameFolder(x.folder, abs, home));
  if (there) return { place: ownId(there), existed: true as const, home: atHome, ...(tilde ? { tilde: true } : {}), name: String(there.name ?? "") };
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
  const id = `sp${crypto.randomUUID().replace(/-/g, "")}`;
  const list = Array.isArray(opts.store.value("spaces")) ? opts.store.value("spaces") : [];
  // this computer's ~ space made again: unnamed (it shows as ~), unless a name was typed
  const entry = { id, name: opts.unnamed || (tilde && !opts.name) ? "" : name, folder: abs, machine, at: Date.now() };
  const after = tilde ? list.indexOf(SP.everythingOf(list, home)) + 1 : list.length;   // the ~ space: right after Everything
  await opts.store.set("spaces", [...list.slice(0, after), entry, ...list.slice(after)]);
  await iconOf(machine ? `${machine}/${id}` : id);
  const place = machine ? `${machine}/${id}` : id;
  const chosen = opts.pick?.(place) ?? null;
  // the agent picked in the New space dialog, its Assistant not started: kept as the space's choice (core/agents.js
  // CHOICE_KEY), so its chat's model button says it and its first message starts on it, not Settings' (SHEP-298)
  const keep = async () => {
    if (opts.keepPick && chosen && choiceOf({ x: chosen }, "x")) await opts.store.set(CHOICE_KEY, withChoice(opts.store.value(CHOICE_KEY), place, chosen)).catch(() => null);
  };
  let t: Awaited<ReturnType<typeof execTemplate>>;
  try { t = await execTemplate(hub, "assistant", machine, chosen); } catch (e) { await keep(); throw e; }
  const r = await run(["hc", "run", "--bg", "--keep", "--no-parent", ...(machine ? ["--on", machine] : []), "--cwd", abs,
    "--label", "herdr.role=coordinator", "--label", `herdr.coordinator.space=${id}`, "--label", `herdr.space=${id}`, t.name]).catch((e) => ({ code: 127, out: "", err: String(e) }));
  t.done();
  // its Assistant didn't start (SHEP-294): the space stays, and its chat starts one with its first message (actions.ts)
  if (r.code !== 0) await keep();
  return r.code === 0 ? { place } : { place, error: notStarted(r) };
}

/** What New space says when the folder has its space already, and it opened that one instead */
export function existedWords(made: { place?: string; home?: boolean; tilde?: boolean; name?: string }, machine: string | null) {
  if (made.tilde) return "This computer's home space (~) already works in your home folder, so it's open now.";
  if (made.home && !machine) return "Everything already works in your home folder, so it's open now.";
  if (made.home) return `${machine}'s home space (~) already works in that folder, so it's open now.`;
  return `#${made.name || "that space"} already works in that folder, so it's open now.`;
}

/** Why a new space's Assistant didn't start, in plain words: hc's own message (its JSON error, else its last line). */
export function notStarted(r: { code: number; out: string; err: string }) {
  const text = `${r.err}\n${r.out}`.trim();
  let why = "";
  for (const line of text.split("\n").reverse()) {
    try { why = JSON.parse(line)?.error?.message ?? ""; } catch {}
    if (why) break;
  }
  why ||= text.split("\n").pop()?.replace(/^(hc|error): /i, "") || `hc ended with code ${r.code}`;
  return `The space is made, but its agent didn't start: ${why.replace(/\.$/, "")}. Send a message in the space to start it.`;
}
