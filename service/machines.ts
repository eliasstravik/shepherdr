// Every machine's health and plan limits for the web app, read as the window reads them (machine.py on the machine
// itself: here with python3, another machine through herdr-core), health every 45 s and plan limits every 10 minutes;
// what they mean is the shared core's (core/machines.js).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { HOME, settingsFile } from "./paths.ts";
import { exec } from "./model.ts";
import * as MC from "../core/machines.js";

const { holdOf, nextRead, healthMeters } = MC as any;
const SCRIPT = [join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "mods", "tasks", "bin", "herdr_task", "machine.py"),
  join(HOME, ".local", "share", "shepherdr", "mods", "tasks", "bin", "herdr_task", "machine.py")].find(existsSync);

export class Machines {
  stats = new Map<string | null, any>();
  private busy = false;
  onChange: () => void = () => {};

  /** SHEP-128: the ElevenLabs plan's read (core/voice.js readUsage), null when voice isn't set up; main.ts gives it. */
  voiceUsage: () => Promise<any | null> = async () => null;
  /** its last read, shown under this machine's Plan usage (as limits.elevenlabs), and when it was read */
  private voice: any = null;
  private voiceAt = 0;
  private voiceBusy = false;

  constructor(private hub: Hub, private list: () => string[]) {}

  start() {
    void this.poll();
    setInterval(() => void this.poll(), 30_000);
  }

  /** Reads every machine's plan limits again now (the limits list's refresh): those older than a minute. */
  async checkNow() {
    for (const s of this.stats.values()) if (Date.now() - (s.limitsAt ?? 0) > 60_000) s.limitsAt = 0;
    if (Date.now() - this.voiceAt > 60_000) this.voiceAt = 0;
    await this.poll();
  }

  /** ElevenLabs' usage, as often as the plan limits (every 10 minutes, a refresh at most once a minute): one request. */
  private async readVoice(): Promise<boolean> {
    if (this.voiceBusy || Date.now() - this.voiceAt < 10 * 60_000) return false;
    this.voiceBusy = true;
    this.voiceAt = Date.now();
    try {
      const fresh = await this.voiceUsage().catch(() => null);
      this.voice = fresh ? nextRead(this.voice, fresh) : null;
      return true;
    } finally {
      this.voiceBusy = false;
    }
  }

  private async poll() {
    const voice = this.readVoice();
    if (this.busy || !SCRIPT) { if (await voice) this.onChange(); return; }
    this.busy = true;
    try {
      let cfg: any = null;
      try { cfg = JSON.parse(readFileSync(settingsFile(), "utf8")); } catch {}
      const script = readFileSync(SCRIPT, "utf8"), now = Date.now();
      await Promise.all([null, ...this.list()].map(async (m) => {
        const was = this.stats.get(m) ?? {};
        const limits = now - (was.limitsAt ?? 0) > 10 * 60_000;
        if (!limits && now - (was.at ?? 0) < 45_000) return;
        const r = await exec(this.hub, ["python3", "-c", script, ...(limits ? ["--limits"] : [])], m, 90).catch(() => null);
        const line = r?.stdout.split("\n").find((l) => l.startsWith("{"));
        const out: any = { ...was, hold: holdOf(cfg, m), at: Date.now() };
        if (line) {
          const d = JSON.parse(line);
          out.health = d.health;
          delete out.error;
          if (d.limits) { out.limits = Object.fromEntries(Object.entries(d.limits).map(([k, v]) => [k, nextRead(was.limits?.[k], v)])); out.limitsAt = Date.now(); }
        } else {
          // as the window's (lib/machines.js): why it couldn't, its header's red dot; the last numbers stay
          out.error = String(r?.stderr || "No answer").trim().split("\n").pop()!.slice(0, 120) || "No answer";
        }
        this.stats.set(m, out);
      }));
      await voice;
      this.onChange();
    } finally {
      this.busy = false;
    }
  }

  /** The window's own reads (its shared "machines.stats"): the agents installed on each machine, which only it knows. */
  windowStats: () => Record<string, any> | null = () => null;

  /** 2.1's health and limits for a machine (null: here), and `stats`: the reads as the window keeps them, which the web's
   *  machine header and popup read with core/machines.js, as the window's do. */
  of(m: string | null) {
    const got = this.stats.get(m);
    if (!got) return {};
    const s = m === null && this.voice ? { ...got, limits: { ...(got.limits ?? {}), elevenlabs: this.voice } } : got;
    const agents = this.windowStats()?.[m ?? ""]?.agents;
    const stats = { at: s.at, ...(s.error ? { error: s.error } : {}), ...(s.limitsAt ? { limitsAt: s.limitsAt } : {}), hold: s.hold,
      ...(s.health ? { health: s.health } : {}), ...(s.limits ? { limits: s.limits } : {}), ...(Array.isArray(agents) ? { agents } : {}) };
    if (!s.health) return { stats };
    const health = { engine: "core", herdr: true, working: 0, held: 0, at: new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      meters: healthMeters(s).map((x: any) => ({ name: x.name, pct: x.pct, detail: x.detail, level: x.level })) };
    const limits = s.limits ? Object.fromEntries(Object.entries<any>(s.limits).map(([k, v]) => [k, v.state === "ok"
      ? { state: "ok", plan: v.plan, at: v.at ?? s.limitsAt, windows: (v.windows ?? []).map((w: any) => ({ name: w.name, used: w.used, ...(w.resets_at ? { resetsAt: w.resets_at } : {}) })) }
      : { state: v.state ?? "unknown", why: v.why ?? "", at: v.at ?? s.limitsAt }])) : undefined;
    return { health, stats, ...(limits ? { limits } : {}) };
  }
}
