// Every artifact on this machine for the web app (herdr-artifact list --all), kept fresh from its folder, and the
// files a recipe artifact is made of (its recipe.json and pictures, of the version asked for). A recipe draws natively
// on the web (web/src/screens/Recipe.tsx); an older GPUI-only one says to open it in the window. A note or an answer
// from the web goes to the agent that keeps it with herdr-artifact note, as the window's Mark up sends it.
import { existsSync, watch, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { HOME } from "./paths.ts";

const STORE = join(HOME, ".herdr", "artifacts");
const FILES = join(STORE, "files");
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
export const TOOL = [join(APP, "mods", "artifacts", "bin", "herdr-artifact"), join(HOME, ".local", "bin", "herdr-artifact")].find(existsSync) ?? "herdr-artifact";
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8" };

export type Art = { id: string; title: string; version: number; folder: string; publisher?: string; task?: string | null; at: number; files: string[]; versions: { v: number; at: number; publisher?: string; note?: string }[] };

async function run(args: string[]) {
  const p = Bun.spawn([TOOL, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Artifacts {
  list: Art[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    if (existsSync(STORE)) watch(STORE, () => { this.timer ??= setTimeout(() => { this.timer = null; void this.read(); }, 300); });
    setInterval(() => void this.read(), 15_000);
    void this.read();
  }

  private async read() {
    const r = await run(["list", "--all", "--json"]).catch(() => null);
    if (!r || r.code !== 0) return;
    try {
      const next = (JSON.parse(r.out).artifacts ?? []) as Art[];
      if (JSON.stringify(next) === JSON.stringify(this.list)) return;
      this.list = next;
      for (const fn of this.listeners) fn();
    } catch {}
  }

  /** A file of an artifact's version, inside its own folder only. */
  file(id: string, v: number, path: string): Response {
    if (!/^[\w.-]+$/.test(id) || !Number.isInteger(v) || v < 1) return new Response("no such artifact", { status: 404 });
    const rel = normalize(path).replace(/^\/+/, "");
    if (!rel || rel.startsWith("..") || rel.includes("/../")) return new Response("no such file", { status: 404 });
    const p = join(FILES, id, `v${v}`, rel);
    if (!p.startsWith(join(FILES, id, `v${v}`) + "/") || !existsSync(p) || !statSync(p).isFile()) return new Response("no such file", { status: 404 });
    const type = TYPES[extname(p).toLowerCase()];
    if (!type) return new Response("not shown here", { status: 415 });
    return new Response(Bun.file(p), { headers: { "content-type": type, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", "cache-control": "private, max-age=3600" } });
  }

  recipe(id: string, v: number): unknown {
    const p = join(FILES, id, `v${v}`, "recipe.json");
    if (!/^[\w.-]+$/.test(id) || !existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  }

  /** The person's words to the agent that keeps it (a note on a block, or an answer). */
  async say(id: string, v: number, text: string, spot?: string) {
    if (!/^\w[\w.-]{0,119}$/.test(id)) throw new Error("Not an artifact.");
    const args = ["note", id, "--text", text, "--version", String(v), "--json", ...(spot ? ["--spot", spot] : [])];
    const r = await run(args);
    if (r.code !== 0) throw new Error((r.err || r.out).trim().split("\n").pop() || "It didn't go through.");
    try { return JSON.parse(r.out.trim().split("\n").pop() ?? "{}"); } catch { return {}; }
  }
}
