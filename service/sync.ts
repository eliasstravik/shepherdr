// Settings in step with the machine that serves the web app (Serve from, core/host.js). The host holds the truth:
// the settings file (~/.config/shepherdr/settings.json) and the role instructions (~/.config/herdr-core/templates/*.md). This machine's window and
// herdr-task go on reading and writing their own copies here, so every 5 s, while the host can be reached, this
// service merges the two: each side's own changes since they were last the same go to the other (the host's when both
// changed one). The file is moved between the two machines' names (core/host.js relocateSettings); what they were
// last is kept in host-base.json in the service's folder. The host itself, or no host set: nothing to do.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { Hub } from "./hub.ts";
import type { Host } from "./host.ts";
import { DATA, HOME, settingsFile, underTest, writableSettings } from "./paths.ts";
import * as HC from "../core/host.js";
import { SH } from "../core/paths.js";

const { relocateSettings, merge3 } = HC as any;
const REL = ".herdr/shepherdr.json";   // the settings file: its old place, as a name (read and written through SH)
const TEMPLATES = ["assistant.md", "worker.md", "reviewer.md"];
const TPL_REL = ".config/herdr-core/templates";
const BASE = join(DATA, "host-base.json");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (e: any) { return e?.code === "ENOENT" ? null : undefined; }
}
function writeAtomic(path: string, text: string) {
  // a test writes only throwaway files, never the person's home (their templates, their settings)
  if (underTest() && resolve(path).startsWith(`${resolve(HOME)}/`)) throw new Error("A test may not write the real home folder.");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.host-tmp`, text, { mode: 0o600 });
  renameSync(`${path}.host-tmp`, path);
}
// a settings file as it reads here, without what only a pushed copy has
const own = (f: any) => { const { pushed_from: _p, here: _h, ...rest } = f ?? {}; return rest; };

export class Sync {
  private busy = false;
  /** what the last round did, for doctor and the log */
  last: { at: number; error: string | null } = { at: 0, error: null };

  constructor(private hub: Hub, private host: Host) {}

  start() { setInterval(() => void this.round(), 5000); }

  /** A file on the host (its home), or null when there is none; throws when it can't be read now. */
  private async read(on: string, rel: string): Promise<string | null> {
    if (rel === REL) {
      // the settings file wherever the host keeps it (its Shepherdr folders, or ~/.herdr on an older one)
      const r = await this.hub.call<{ code: number; stdout: string; stderr: string }>("machine.exec", { on, argv: ["sh", "-c", SH + '[ -e "$SHEP_SETTINGS" ] || exit 3; cat "$SHEP_SETTINGS"'], timeout: 20 }, 25_000);
      if (r.code === 3) return null;
      if (r.code !== 0) throw new Error("couldn't read the settings there");
      return Buffer.from(r.stdout ?? "", "base64").toString("utf8");
    }
    try { return (await this.hub.call<{ text: string }>("file.read", { path: rel, on }, 10_000)).text; }
    catch (err) { if ((err as any).kind === "not_found") return null; throw err; }
  }

  /** Writes a file on the host whole (a temporary file, then renamed: never half-written). */
  private async write(on: string, rel: string, text: string) {
    // a test never writes another machine's settings or templates
    if (underTest()) throw new Error("A test may not write another machine's files.");
    const to = rel === REL ? SH + 'f="$SHEP_SETTINGS"; ' : 'f="$1"; ';
    const r = await this.hub.call<{ code: number }>("machine.exec", { on, argv: ["sh", "-c", to + 'mkdir -p "$(dirname "$f")" && umask 077 && cat > "$f.host-tmp" && mv "$f.host-tmp" "$f"', "sh", rel],
      input: Buffer.from(text).toString("base64"), timeout: 20 }, 25_000);
    if (r.code !== 0) throw new Error(`couldn't write ${rel} there`);
  }

  async round() {
    if (this.busy || this.host.serving() || !this.host.reachable()) return;
    const on = this.host.hubName();
    if (typeof on !== "string" || !this.host.hostNode) return;
    this.busy = true;
    try {
      const base = readJson(BASE) ?? {};
      const was = JSON.stringify(base);
      // the settings file
      const mine = readJson(settingsFile());
      const text = await this.read(on, REL);
      let theirsRaw: any = null;
      try { theirsRaw = text === null ? {} : JSON.parse(text); } catch { theirsRaw = undefined; }
      // either side half-written or broken: wait for the next round, never merge over it
      if (mine !== undefined && theirsRaw !== undefined) {
        const theirs = relocateSettings(theirsRaw, this.host.fromHost());
        const here = own(mine ?? {});
        // the first round after a move: the host's own copy wins where both say something; a pushed copy there (no move
        // yet) is no truth, so this machine's goes in
        const merged = merge3(base.settings ?? ("pushed_from" in theirsRaw ? {} : theirs), here, theirs);
        if (!same(merged, here)) writeAtomic(writableSettings(), JSON.stringify({ ...merged, version: 1 }, null, 2) + "\n");
        const out = relocateSettings(merged, this.host.toHost());
        if (!same(out, own(theirsRaw)) || "pushed_from" in theirsRaw) await this.write(on, REL, JSON.stringify({ ...out, version: 1 }, null, 2) + "\n");
        base.settings = merged;
      }
      // the role instructions, each file whole
      base.templates ??= {};
      for (const f of TEMPLATES) {
        const path = join(HOME, TPL_REL, f);
        const mineT = existsSync(path) ? readFileSync(path, "utf8") : null;
        const theirsT = await this.read(on, `${TPL_REL}/${f}`);
        const b = f in base.templates ? base.templates[f] : theirsT;
        let next = theirsT;
        if (mineT !== b && theirsT === b) next = mineT;
        if (next === null) { base.templates[f] = null; continue; }
        if (next !== mineT) writeAtomic(path, next);
        if (next !== theirsT) await this.write(on, `${TPL_REL}/${f}`, next);
        base.templates[f] = next;
      }
      if (JSON.stringify(base) !== was) writeAtomic(BASE, JSON.stringify(base) + "\n");
      this.last = { at: Date.now(), error: null };
    } catch (err) {
      this.last = { at: Date.now(), error: (err as Error).message };
    } finally {
      this.busy = false;
    }
  }

  /** A move starts over: the host's copy is the truth for the first round. */
  static forget() { try { writeFileSync(BASE, "{}\n"); } catch {} }
}
