// Every artifact on this machine for the web app (herdr-artifact list --all), kept fresh from its folder, and the
// files a recipe artifact is made of (its recipe.json and pictures, of the version asked for). A recipe draws natively
// on the web (web/src/screens/Recipe.tsx); an older GPUI-only one says to open it in the window. A note or an answer
// from the web goes to the agent that keeps it with herdr-artifact note, as the window's Mark up sends it.
// Another machine's artifacts are read there as the window's chat and Jump read them (every registry in its
// ~/.local/share/shepherdr/artifacts, through herdr-core's machine.exec), each marked with its machine; their files come from there
// too, and a note to one goes through `herdr-artifact --on <machine>`, as the window's Artifacts panel reaches it.
import { existsSync, watch, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { HOME, where } from "./paths.ts";
import { SH } from "../core/paths.js";
import type { Hub } from "./hub.ts";

// Every registry on a machine, each followed by a record separator (mods/jump, mods/chat read them the same way).
const READ_ARTS = SH + 'cd "$SHEP_ARTIFACTS" 2>/dev/null || exit 0; for f in *.json .*.json; do [ -f "$f" ] && cat "$f" && printf "\\n\\036\\n"; done; true';
const MACHINE = /^[\w.-]{1,64}$/;

const STORE = where().artifacts;
const FILES = join(STORE, "files");
const APP = process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app");
export const TOOL = [join(APP, "mods", "artifacts", "bin", "herdr-artifact"), join(HOME, ".local", "bin", "herdr-artifact")].find(existsSync) ?? "herdr-artifact";
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8" };

export type Art = { id: string; title: string; version: number; folder: string; publisher?: string; task?: string | null; at: number; files: string[]; versions: { v: number; at: number; publisher?: string; note?: string }[]; machine?: string; folderName?: string };

async function run(args: string[]) {
  const p = Bun.spawn([TOOL, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

export class Artifacts {
  list: Art[] = [];
  private here: Art[] = [];
  private there = new Map<string, Art[]>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** herdr-core, and the connected other machines (service/model.ts), set by main: other machines' artifacts */
  hub: Hub | null = null;
  machines: () => string[] = () => [];

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    if (existsSync(STORE)) watch(STORE, () => { this.timer ??= setTimeout(() => { this.timer = null; void this.read(); }, 300); });
    setInterval(() => void this.read(), 15_000);
    setInterval(() => void this.readThere(), 15_000);
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

  private async read() {
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
  private async readThere() {
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

  /** A file of an artifact's version, inside its own folder only (on its machine, when another). */
  async file(id: string, v: number, path: string, machine: string | null = null): Promise<Response> {
    if (!/^[\w.-]+$/.test(id) || !Number.isInteger(v) || v < 1) return new Response("no such artifact", { status: 404 });
    if (machine && !MACHINE.test(machine)) return new Response("no such machine", { status: 404 });
    const rel = normalize(path).replace(/^\/+/, "");
    if (!rel || rel.startsWith("..") || rel.includes("/../")) return new Response("no such file", { status: 404 });
    const type = TYPES[extname(rel).toLowerCase()];
    if (!type) return new Response("not shown here", { status: 415 });
    const headers = { "content-type": type, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", "cache-control": "private, max-age=3600" };
    if (machine) {
      // there: the same path under its own artifacts/files (new or old layout), read only if it is a file
      const r = await this.exec(machine, ["sh", "-c", SH + 'f="$SHEP_ARTIFACTS/files/$1/v$2/$3"; [ -f "$f" ] && exec cat -- "$f"; exit 1', "file", id, String(v), rel]).catch(() => null);
      if (!r || r.code !== 0) return new Response("no such file", { status: 404 });
      return new Response(r.out, { headers });
    }
    const p = join(FILES, id, `v${v}`, rel);
    if (!p.startsWith(join(FILES, id, `v${v}`) + "/") || !existsSync(p) || !statSync(p).isFile()) return new Response("no such file", { status: 404 });
    return new Response(Bun.file(p), { headers });
  }

  async recipe(id: string, v: number, machine: string | null = null): Promise<unknown> {
    if (!/^[\w.-]+$/.test(id) || !Number.isInteger(v) || v < 1) return null;
    if (machine) {
      if (!MACHINE.test(machine)) return null;
      const r = await (await this.file(id, v, "recipe.json", machine)).text().catch(() => "");
      try { return r ? JSON.parse(r) : null; } catch { return null; }
    }
    const p = join(FILES, id, `v${v}`, "recipe.json");
    if (!existsSync(p)) return null;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
  }

  /** The person's words to the agent that keeps it (a note on a block, or an answer); another machine's through
   *  herdr-artifact --on, as the window's panel reaches it. */
  async say(id: string, v: number, text: string, spot?: string, machine: string | null = null) {
    if (!/^\w[\w.-]{0,119}$/.test(id)) throw new Error("Not an artifact.");
    // where it is kept: this machine's own list first, else another's
    machine ??= this.here.some((a) => a.id === id) ? null : this.list.find((a) => a.id === id)?.machine ?? null;
    if (machine && !MACHINE.test(machine)) throw new Error("Not a machine.");
    const args = [...(machine ? ["--on", machine] : []), "note", id, "--text", text, "--version", String(v), "--json", ...(spot ? ["--spot", spot] : [])];
    const r = await run(args);
    if (r.code !== 0) throw new Error((r.err || r.out).trim().split("\n").pop() || "It didn't go through.");
    try { return JSON.parse(r.out.trim().split("\n").pop() ?? "{}"); } catch { return {}; }
  }
}
