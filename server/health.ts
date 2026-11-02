// Pure health parsing, limits and hysteresis, shared by legacy and core.
import { homedir } from 'node:os'
import type { HealthLevel, HealthMeter } from '../shared/types.ts'
export interface MachineLimits {
  /** tasks at work at once */
  max: number | null
  /** new tasks wait while the 1-minute load is over this many times the cores, or this much memory is in use (%);
   *  none: not limited by load */
  startLoad: number | null
  startMemory: number | null
  /** the coordinator is told when the load stays over this many times the cores for 2 minutes, memory or a disk is
   *  fuller than this (%), or herdr stops answering; null: that one is off */
  alertLoad: number | null
  alertMemory: number | null
  alertDisk: number | null
  alertHerdr: boolean
}

export const SAMPLE_MS = 30_000
/** the load must stay over its limit this long before the coordinator hears of it: one test run's spike is no news */
export const LOAD_FOR = 120_000
/** herdr must stay silent this long: a restart of it takes a few seconds */
export const HERDR_FOR = 30_000
/** back under: below this share of its limit, so a value hovering at the limit is told once */
export const BACK_UNDER = 0.9

export interface Disk {
  path: string
  /** % full, as df counts it: used over what an ordinary user could have */
  pct: number
  freeGb: number
  dev: number
}

export interface Gpu {
  name: string
  util: number
  memPct: number
}

export interface Sample {
  at: number
  cores: number
  /** 1-minute load average */
  load: number
  memTotal: number
  memUsed: number
  disks: Disk[]
  gpus: Gpu[]
}

/** 1-minute load from /proc/loadavg */
export const parseLoad = (text: string) => Number.parseFloat(text.split(/\s+/)[0]) || 0

/** total and in-use memory (bytes) from /proc/meminfo: in use is what is not available */
export function parseMem(text: string) {
  const kb = (name: string) => Number(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024
  const total = kb('MemTotal')
  const avail = kb('MemAvailable') || kb('MemFree')
  return { total, used: Math.max(0, total - avail) }
}

/** nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits */
export function parseGpus(text: string): Gpu[] {
  return text
    .split('\n')
    .map((l) => l.split(',').map((x) => x.trim()))
    .filter((f) => f.length >= 4 && f[0])
    .map(([name, util, used, total]) => ({ name, util: Number(util) || 0, memPct: Number(total) ? Math.round((Number(used) / Number(total)) * 100) : 0 }))
}

export const cpuPct = (s: Sample) => Math.round((s.load / s.cores) * 100)
export const memPct = (s: Sample) => (s.memTotal ? Math.round((s.memUsed / s.memTotal) * 100) : 0)
const gb = (b: number) => `${Math.round(b / 2 ** 30)} GB`
const tilde = (p: string) => (p === homedir() ? 'home' : p)

/* ---------- limits ---------- */

/** new tasks wait: the load or memory is over its start limit (nothing when the limit is by number only) */
export function busy(s: Sample | undefined, l: MachineLimits): 'cpu' | 'memory' | undefined {
  if (!s) return undefined
  if (l.startLoad !== null && s.load > l.startLoad * s.cores) return 'cpu'
  if (l.startMemory !== null && memPct(s) > l.startMemory) return 'memory'
  return undefined
}

export type Kind = 'cpu' | 'memory' | 'disk' | 'herdr'

/** what is past its alert limit now (over), and what is well back under it (back) */
export function levels(s: Sample, herdr: boolean, l: MachineLimits): Record<Kind, { over: boolean; back: boolean }> {
  const disk = Math.max(0, ...s.disks.map((d) => d.pct))
  const vs = (v: number, limit: number | null) => ({ over: limit !== null && v > limit, back: limit === null || v < limit * BACK_UNDER })
  return {
    cpu: vs(s.load, l.alertLoad === null ? null : l.alertLoad * s.cores),
    memory: vs(memPct(s), l.alertMemory),
    disk: vs(disk, l.alertDisk),
    herdr: { over: l.alertHerdr && !herdr, back: herdr || !l.alertHerdr },
  }
}

/** one kind's watch: over since when, and whether the coordinator was told */
export interface Watch {
  since?: number
  told?: boolean
}

/**
 * Each kind, from what it was and what it is now: told once when it has been over its limit long enough, and again
 * (that it is back) once it is well under. In between, nothing.
 */
export function judge(was: Partial<Record<Kind, Watch>>, now: Record<Kind, { over: boolean; back: boolean }>, at: number) {
  const hold: Record<Kind, number> = { cpu: LOAD_FOR, memory: 0, disk: 0, herdr: HERDR_FOR }
  const next: Partial<Record<Kind, Watch>> = {}
  const events: { kind: Kind; what: 'over' | 'back' }[] = []
  for (const kind of Object.keys(now) as Kind[]) {
    const w = { ...was[kind] }
    const { over, back } = now[kind]
    if (w.told) {
      if (back) events.push({ kind, what: 'back' })
      else next[kind] = w
      continue
    }
    if (!over) continue
    w.since ??= at
    if (at - w.since >= hold[kind]) {
      w.told = true
      events.push({ kind, what: 'over' })
    }
    next[kind] = w
  }
  return { next, events }
}

/** each meter for the screen: CPU, Memory, Disk, and each GPU */
export function meters(s: Sample, l: MachineLimits, told: Partial<Record<Kind, Watch>>): HealthMeter[] {
  const level = (kind: Kind, start: boolean): HealthLevel => (told[kind]?.told ? 'over' : start ? 'busy' : 'ok')
  const disk = s.disks.reduce<Disk | undefined>((a, d) => (!a || d.pct > a.pct ? d : a), undefined)
  return [
    { name: 'CPU', pct: cpuPct(s), detail: `load ${s.load.toFixed(1)} on ${s.cores} cores`, level: level('cpu', l.startLoad !== null && s.load > l.startLoad * s.cores) },
    { name: 'Memory', pct: memPct(s), detail: `${gb(s.memUsed)} of ${gb(s.memTotal)}`, level: level('memory', l.startMemory !== null && memPct(s) > l.startMemory) },
    ...(disk ? [{ name: 'Disk', pct: disk.pct, detail: s.disks.map((d) => `${tilde(d.path)} ${d.pct}%`).join(' · '), level: level('disk', false) }] : []),
    ...s.gpus.map((g, i) => ({ name: s.gpus.length > 1 ? `GPU ${i + 1}` : 'GPU', pct: g.util, detail: `${g.name} · memory ${g.memPct}%`, level: 'ok' as const })),
  ]
}

