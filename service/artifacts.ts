// Every artifact on this machine for the app (herdr-artifact list --all), kept fresh from its folder, and what an
// artifact is made of: a web page an agent wrote (index.html and the files beside it, of the version asked for) and
// the picture taken of it when it was published. The page is served sandboxed, so it runs its scripts but is no page
// of this app (artifactRoute). What the person does with an artifact (rename, pin, restore, keep, delete, a note on
// the page, an answer from it) runs herdr-artifact where the artifact is kept (artifactAction).
// Another machine's artifacts are read there (every list in its artifacts folder, through herdr-core's machine.exec),
// each marked with its machine; their files come from there too, and an action on one goes through
// `herdr-artifact --on <machine>`.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, watch, realpathSync, statSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { HOME, where } from "./paths.ts";
import { SH } from "../core/paths.js";
import type { Hub } from "./hub.ts";
import { served } from "./media.ts";
import { spawn } from "./spawn.ts";
import { withLinks } from "./artifact-links.ts";
export { LINKS_JS, withLinks } from "./artifact-links.ts";

// Every registry on a machine, each followed by a record separator.
const READ_ARTS = SH + 'cd "$SHEP_ARTIFACTS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true';
const MACHINE = /^[\w.-]{1,64}$/;
const ID = /^\w[\w.-]{0,119}$/;

/** herdr-artifact: $SHEPHERDR_HERDR_ARTIFACT (tests), the installed one, else the PATH's */
export const tool = () => process.env.SHEPHERDR_HERDR_ARTIFACT
  || [join(HOME, ".local", "bin", "herdr-artifact"), join(HOME, ".local", "share", "shepherdr", "mods", "artifacts", "bin", "herdr-artifact")].find(existsSync)
  || "herdr-artifact";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".map": "application/json",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".xml": "application/xml",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".wasm": "application/wasm", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".pdf": "application/pdf" };

/** Every answer under …/page/: the page runs its scripts, forms and links, but with an origin of its own (no
 *  allow-same-origin), so it can't read this app, its storage or its API. */
export const SANDBOX = "sandbox allow-scripts allow-forms allow-popups";
/** A page's own address (what the entry link redirects to, and what its relative links resolve under):
 *  /api/artifacts/<id>/v/<n>/[on/<machine>/]k/<key>/page/<path>. The key is the artifact's own (pageKey), so only a
 *  page the app opened can ask for its files: a sandboxed page's requests come as another site's, with no way to tell
 *  them from one, and the key is what lets them in (service/auth.ts lets a GET of this shape past its cross-site
 *  check). Groups: id, version, machine, key, path. */
export const PAGE_PATH = /^\/api\/artifacts\/(\w[\w.-]{0,119})\/v\/(\d{1,9})\/(?:on\/([\w.-]{1,64})\/)?k\/([\w-]{16,64})\/page\/(.*)$/;
const ENTRY = /^\/api\/artifacts\/(\w[\w.-]{0,119})\/page(?:\/(.*))?$/;
const THUMB = /^\/api\/artifacts\/(\w[\w.-]{0,119})\/thumb$/;
const THUMBS = [".thumb.png", ".thumb-dark.png"];

// the keys' secret: this run's own (a page left open over a restart loads again from its entry link)
const SECRET = randomBytes(32);
/** An artifact's page key: what its page's address carries (PAGE_PATH). */
export function pageKey(id: string, machine: string | null = null): string {
  return createHmac("sha256", SECRET).update(`${id}\0${machine ?? ""}`).digest("base64url").slice(0, 24);
}
const sameKey = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A page's path as the names of a file inside its folder, or null: nothing outside it, no dot files (the pictures
 *  and what a converted version was are kept there), a folder is its index.html. */
export function pageParts(path: string): string[] | null {
  const parts: string[] = [];
  for (const raw of path.split("/")) {
    let p: string;
    try { p = decodeURIComponent(raw); } catch { return null; }
    if (!p || p.startsWith(".") || /[\\/\0]/.test(p)) return null;
    parts.push(p);
  }
  return parts;
}

/** herdr-artifact --json's error as plain words (#1213: the page showed {"error": "{\"error\":{...}}"}): its last line's
 *  "error", unwrapped from any JSON it came in (hc's {"error": {"message"}} too); "" when there's none. */
export function plainError(out: string): string {
  let s: unknown = out.trim().split("\n").pop() ?? "";
  for (let i = 0; i < 6; i++) {
    if (typeof s === "string") {
      if (!s.trim().startsWith("{")) break;
      try { s = JSON.parse(s); } catch { break; }
    } else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      s = "error" in o ? o.error : o.message ?? "";
    } else break;
  }
  return typeof s === "string" ? s.trim() : "";
}

export type Art = { id: string; title: string; version: number; folder: string; publisher?: string; task?: string | null; at: number; files: string[];
  /** a task's proof, on its task until kept; pinned to the top of Artifacts; its newest version has a picture */
  proof?: boolean; pinned?: boolean; thumb?: boolean;
  versions: { v: number; at: number; publisher?: string; note?: string; thumb?: boolean }[]; machine?: string; folderName?: string };

async function run(args: string[]) {
  const p = spawn([tool(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

/** the one the routes and actions below speak for: the service's (main.ts makes it) */
let current: Artifacts | null = null;

export class Artifacts {
  list: Art[] = [];
  private here: Art[] = [];
  private there = new Map<string, Art[]>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** this machine's artifacts folder (a test names its own) */
  readonly store: string;

  /** herdr-core, and the connected other machines (service/model.ts), set by main: other machines' artifacts */
  hub: Hub | null = null;
  machines: () => string[] = () => [];
  /** is a page open (service/live.ts anyone): only pages show artifacts, so with none they aren't read (#1325) */
  watched: () => boolean = () => true;

  constructor(store: string = where().artifacts) {
    this.store = store;
    current = this;
  }

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    if (existsSync(this.store)) watch(this.store, () => { this.timer ??= setTimeout(() => { this.timer = null; void this.read(); }, 300); });
    setInterval(() => { if (this.watched()) void this.read(); }, 15_000);
    setInterval(() => { if (this.watched()) void this.readThere(); }, 15_000);
    void this.read();
    // once the machines are known
    setTimeout(() => void this.readThere(), 3_000);
  }

  private publish() {
    const next = [...this.here, ...[...this.there.values()].flat()];
    if (JSON.stringify(next) === JSON.stringify(this.list)) return;
    this.list = next;
    for (const fn of this.listeners) fn();
  }

  async read() {
    const r = await run(["list", "--all", "--json"]).catch(() => null);
    if (!r || r.code !== 0) return;
    try {
      this.here = (JSON.parse(r.out).artifacts ?? []) as Art[];
      this.publish();
    } catch {}
  }

  /** A command on another machine through herdr-core; its output as bytes. */
  private async exec(machine: string, argv: string[], timeout = 30) {
    if (!this.hub) throw new Error("Not connected.");
    const r = await this.hub.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, on: machine, timeout }, (timeout + 5) * 1000);
    return { code: r.code, out: Buffer.from(r.stdout ?? "", "base64"), err: Buffer.from(r.stderr ?? "", "base64").toString("utf8") };
  }

  /** Every connected other machine's artifacts, each marked with its machine and its folder's name there; one out of
   *  reach keeps what it last listed until it is gone from the machines. */
  async readThere() {
    const now = this.machines();
    for (const m of [...this.there.keys()]) if (!now.includes(m)) this.there.delete(m);
    await Promise.all(now.map(async (m) => {
      try {
        const r = await this.exec(m, ["sh", "-c", READ_ARTS]);
        if (r.code !== 0) return;
        const found: Art[] = [];
        for (const part of r.out.toString("utf8").split("\x1e")) {
          try {
            const reg = JSON.parse(part);
            for (const a of reg.artifacts ?? []) if (a?.id) found.push({ ...a, folder: a.folder ?? reg.folder, folderName: reg.name, machine: m });
          } catch {}
        }
        this.there.set(m, found.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
      } catch {}
    }));
    this.publish();
  }

  /** Where an artifact is kept: null here, else its machine (this machine's own list first). */
  machineOf(id: string): string | null {
    return this.here.some((a) => a.id === id) ? null : this.list.find((a) => a.id === id)?.machine ?? null;
  }

  /** Its newest version, as last listed (0: not known here). */
  latest(id: string, machine: string | null = null): number {
    return this.list.find((a) => a.id === id && (a.machine ?? null) === machine)?.version ?? 0;
  }

  /** A file kept with an artifact's version (names: pageParts, or one of its pictures), inside that version's own
   *  folder only (on its machine, when another). */
  async file(id: string, v: number, parts: string[], machine: string | null, range: string | null, headers: Record<string, string>): Promise<Response> {
    const none = (what: string) => new Response(what, { status: 404, headers: { "cache-control": "no-store", "content-security-policy": SANDBOX } });
    if (!ID.test(id) || !Number.isInteger(v) || v < 1) return none("no such artifact");
    if (machine && !MACHINE.test(machine)) return none("no such machine");
    const type = TYPES[extname(parts[parts.length - 1] ?? "").toLowerCase()] ?? "application/octet-stream";
    const head = { "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600", "referrer-policy": "no-referrer", ...headers };
    if (machine) {
      // there: the same path under its own artifacts/files, read only if it is a file inside the version's folder
      const r = await this.exec(machine, ["sh", "-c", SH + 'd="$SHEP_ARTIFACTS/files/$1/v$2"; f="$d/$3"; [ -f "$f" ] || exit 1; '
        + 'case "$(cd "$(dirname "$f")" && pwd -P)/" in "$(cd "$d" && pwd -P)/"*) exec cat -- "$f";; esac; exit 1', "file", id, String(v), parts.join("/")]).catch(() => null);
      if (!r || r.code !== 0) return none("no such file");
      return served(new Blob([r.out]), type, range, head);
    }
    const base = join(this.store, "files", id, `v${v}`);
    const p = join(base, ...parts);
    let real: string;
    try { real = realpathSync(p); if (!real.startsWith(realpathSync(base) + sep) || !statSync(real).isFile()) return none("no such file"); }
    catch { return none("no such file"); }
    return served(Bun.file(real), type, range, head);
  }

  /** herdr-artifact where the artifact is kept; its --json answer, or an Error in plain words. */
  async tool(args: string[], machine: string | null = null): Promise<Record<string, unknown>> {
    if (machine && !MACHINE.test(machine)) throw new Error("Not a machine.");
    const r = await run([...(machine ? ["--on", machine] : []), ...args]);
    const said = plainError(r.out);
    if (r.code !== 0 || said) throw new Error(said || r.err.trim().split("\n").pop() || "It didn't go through.");
    void (machine ? this.readThere() : this.read());
    try { const o = JSON.parse(r.out.trim().split("\n").pop() ?? "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
  }

  /** The person's words to the agent that keeps it (a note on the page, with its pin "x,y" when there is one); another
   *  machine's through herdr-artifact --on. */
  async say(id: string, v: number, text: string, spot?: string, machine: string | null = null) {
    if (!ID.test(id)) throw new Error("Not an artifact.");
    return this.tool(["note", "--json", `--text=${text}`, "--version", String(v), ...(spot ? [`--spot=${spot}`] : []), "--", id], machine ?? this.machineOf(id));
  }
}

const strip = (path: string) => path.replace(/^\/shepherdr(?=\/)/, "");


/**
 * An artifact's page and its picture:
 *   GET /api/artifacts/<id>/page/[<path>]?v=N[&on=machine]   the link the app frames: answers with a redirect to the
 *       page's own address (PAGE_PATH, with its version, machine and key in the path), so the page's relative links
 *       (its css, scripts, pictures, other pages) resolve there without a query, a cookie or a referrer;
 *   GET /api/artifacts/<id>/v/<n>/[on/<machine>/]k/<key>/page/<path>   the page and its files, sandboxed;
 *   GET /api/artifacts/<id>/thumb?v=N[&dark=1][&on=machine]  the picture taken when that version was published (404: none).
 * null: not an artifact's address.
 */
export async function artifactRoute(req: Request, url: URL): Promise<Response | null> {
  const path = strip(url.pathname);
  const page = PAGE_PATH.exec(path), entry = page ? null : ENTRY.exec(path), thumb = page || entry ? null : THUMB.exec(path);
  if (!page && !entry && !thumb) return null;
  const sandboxed = { "content-security-policy": SANDBOX };
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("read only", { status: 405, headers: sandboxed });
  const arts = current ?? new Artifacts();
  const none = (what: string) => new Response(what, { status: 404, headers: { "cache-control": "no-store", ...sandboxed } });
  const range = req.headers.get("range");

  if (page) {
    const [, id, n, machine = null, key, rest] = page;
    if (!sameKey(key, pageKey(id, machine))) return none("no such page");
    const parts = pageParts(rest === "" || rest.endsWith("/") ? rest + "index.html" : rest);
    if (!parts) return none("no such file");
    // a page's own requests come from its sandbox (no origin): its scripts may read its own files
    const r = await arts.file(id, Number(n), parts, machine, range, { ...sandboxed, "access-control-allow-origin": "*" });
    // a page (whole, never a part of one): with its link catcher first
    if (!/^text\/html/.test(r.headers.get("content-type") ?? "") || (r.status !== 200 && r.status !== 206)) return r;
    const headers = new Headers(r.headers);
    for (const h of ["content-length", "content-range", "accept-ranges"]) headers.delete(h);
    const whole = r.status === 206 ? await arts.file(id, Number(n), parts, machine, null, {}) : r;
    return new Response(req.method === "HEAD" ? null : withLinks(await whole.text()), { status: 200, headers });
  }

  const on = url.searchParams.get("on") || null;
  if (on && !MACHINE.test(on)) return none("no such machine");
  const id = (entry ?? thumb)![1];
  const asked = url.searchParams.get("v");
  const v = asked === null ? arts.latest(id, on) : /^\d{1,9}$/.test(asked) ? Number(asked) : 0;
  if (v < 1) return none("no such artifact");

  if (entry) {
    const rest = entry[2] ?? "";
    if (rest && !pageParts(rest.endsWith("/") ? rest + "index.html" : rest)) return none("no such file");
    // relative, so it holds under whatever prefix the app is served at (/shepherdr)
    const up = "../".repeat(entry[2] === undefined ? 0 : rest.split("/").length);
    const to = `${up}v/${v}/${on ? `on/${on}/` : ""}k/${pageKey(id, on)}/page/${rest}`;
    return new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store", ...sandboxed } });
  }

  const dark = url.searchParams.get("dark") === "1";
  for (const name of dark ? [THUMBS[1], THUMBS[0]] : [THUMBS[0]]) {
    const r = await arts.file(id, v, [name], on, range, { "content-security-policy": "sandbox; default-src 'none'" });
    if (r.status !== 404) return r;
  }
  return none("no picture");
}

/**
 * What the person does with an artifact, by running herdr-artifact where it is kept:
 *   artifact-delete { artifact }, artifact-rename { artifact, name }, artifact-pin { artifact, on },
 *   artifact-restore { artifact, v }, artifact-keep { artifact }, artifact-note { artifact, v, note, spot?: { x, y } },
 *   artifact-say { artifact, v, text }   (each may carry place, and machine when the app knows it).
 * { ok: true } (a note or an answer: with `to`, and `held` + `said` when it waits for the agent's question),
 * { ok: false, error }, or null when it isn't one of these.
 */
export async function artifactAction(body: any): Promise<object | null> {
  const type = typeof body?.type === "string" ? body.type : "";
  if (!["artifact-delete", "artifact-rename", "artifact-pin", "artifact-restore", "artifact-keep", "artifact-note", "artifact-say"].includes(type)) return null;
  try {
    const id = body.artifact;
    if (typeof id !== "string" || !ID.test(id)) throw new Error("Not an artifact.");
    const arts = current ?? new Artifacts();
    const machine: string | null = typeof body.machine === "string" && body.machine ? body.machine : arts.machineOf(id);
    const words = (x: unknown, what: string, max: number) => {
      const s = typeof x === "string" ? x.trim() : "";
      if (!s) throw new Error(what);
      return s.slice(0, max);
    };
    const version = () => {
      const v = Number(body.v);
      if (!Number.isInteger(v) || v < 1) throw new Error("Which version?");
      return String(v);
    };
    let args: string[];
    if (type === "artifact-delete") args = ["rm", "--json", "--", id];
    else if (type === "artifact-rename") args = ["rename", "--json", "--", id, words(body.name, "Give it a name.", 200)];
    else if (type === "artifact-pin") args = [body.on === false ? "unpin" : "pin", "--json", "--", id];
    else if (type === "artifact-restore") args = ["restore", "--json", "--version", version(), "--", id];
    else if (type === "artifact-keep") args = ["keep", "--json", "--", id];
    else if (type === "artifact-note") {
      const s = body.spot, pin = s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y));
      const f = (n: unknown) => Math.min(1, Math.max(0, Number(n))).toFixed(3);
      args = ["note", "--json", `--text=${words(body.note, "Write the note first.", 4000)}`, "--version", version(), ...(pin ? [`--spot=${f(s.x)},${f(s.y)}`] : []), "--", id];
    } else args = ["say", "--json", `--text=${words(body.text, "Nothing to send.", 4000)}`, "--version", version(), "--", id];
    const out = await arts.tool(args, machine);
    const told = type === "artifact-note" || type === "artifact-say";
    return { ok: true, ...(told && typeof out.to === "string" ? { to: out.to } : {}), ...(told && out.held ? { held: true, said: String(out.said ?? "") } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
