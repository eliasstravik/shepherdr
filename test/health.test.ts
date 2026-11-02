// Machine health: reading /proc and nvidia-smi, when a limit is told (once, and again once it is back under), what
// holds new tasks, and the numbers each machine's Settings note gives (server/live/health.ts).
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SHEPHERDR_HOME = mkdtempSync(join(tmpdir(), 'shep-health-'))
const H = await import('../server/health.ts')
const { sample } = await import('../helper/core-health.ts')
const { Settings, machineNote } = await import('../server/common/settings.ts')

const limits = () => new Settings().machine()
const at = (load: number, memPct = 40, disk = 50, gpus: { name: string; util: number; memPct: number }[] = []) => ({
  at: 0,
  cores: 16,
  load,
  memTotal: 100 * 2 ** 30,
  memUsed: memPct * 2 ** 30,
  disks: [{ path: '/tmp', pct: disk, freeGb: 100 - disk, dev: 1 }],
  gpus,
})

describe('reading the machine', () => {
  test('/proc/loadavg, /proc/meminfo and nvidia-smi', () => {
    expect(H.parseLoad('27.31 21.63 22.17 29/4304 1205109\n')).toBe(27.31)
    const m = H.parseMem('MemTotal:       32858064 kB\nMemFree:         3661672 kB\nMemAvailable:   20015576 kB\n')
    expect(m.total).toBe(32858064 * 1024)
    expect(m.used).toBe((32858064 - 20015576) * 1024)
    expect(H.parseGpus('NVIDIA A10G, 37, 4096, 23028\n\n')).toEqual([{ name: 'NVIDIA A10G', util: 37, memPct: 18 }])
    expect(H.parseGpus('')).toEqual([])
  })

  test('a real sample of this machine: cores, load, memory, and home and /tmp once each', async () => {
    const s = await sample()
    expect(s.cores).toBeGreaterThan(0)
    expect(s.memTotal).toBeGreaterThan(s.memUsed)
    expect(s.disks.length).toBeGreaterThanOrEqual(1)
    expect(new Set(s.disks.map((d) => d.dev)).size).toBe(s.disks.length)
  })
})

describe('limits', () => {
  test('defaults: 10 at once, start under 1× cores and 80% memory; told at 1.5× cores, 90% memory and disk, herdr', () => {
    expect(limits()).toEqual({ max: 10, startLoad: 1, startMemory: 80, alertLoad: 1.5, alertMemory: 90, alertDisk: 90, alertHerdr: true })
    const s = new Settings()
    // any number in range, not a fixed list
    expect(s.set('machine.maxTasks', '13').ok).toBe(true)
    expect(s.machine().max).toBe(13)
    for (const bad of ['0', '2.5', '201', 'lots']) expect(s.set('machine.maxTasks', bad).ok).toBe(false)
    s.set('machine.maxTasks', null)
    expect(s.set('machine.startLoad', '1.15x').ok).toBe(true)
    expect(s.get('machine.startLoad')).toBe('1.15× cores')
    expect(s.set('machine.startMemory', '77 %').ok).toBe(true)
    expect(s.machine()).toMatchObject({ startLoad: 1.15, startMemory: 77 })
    expect(s.set('machine.startMemory', 'off').ok).toBe(false)
    s.set('machine.startLoad', null)
    s.set('machine.startMemory', null)
    expect(s.set('machine.alertDisk', 'off').ok).toBe(true)
    expect(s.machine().alertDisk).toBeNull()
    s.set('machine.alertDisk', null)
  })

  test('new tasks wait over a start limit, scaled to the cores', () => {
    const l = limits()
    expect(H.busy(at(15.9), l)).toBeUndefined()
    expect(H.busy(at(16.1), l)).toBe('cpu')
    expect(H.busy(at(2, 81), l)).toBe('memory')
    expect(H.busy(undefined, l)).toBeUndefined()
    expect(H.busy(at(40, 99), { ...l, startLoad: null, startMemory: null })).toBeUndefined()
  })

  test('the load is told after 2 minutes over its limit, once; again only when it is back well under', () => {
    const l = limits()
    let w = {}
    const step = (load: number, t: number, herdr = true) => {
      const r = H.judge(w, H.levels(at(load), herdr, l), t)
      w = r.next
      return r.events.map((e) => `${e.kind} ${e.what}`)
    }
    expect(step(30, 0)).toEqual([])
    expect(step(30, 60_000)).toEqual([])
    // a dip resets the 2 minutes
    expect(step(10, 90_000)).toEqual([])
    expect(step(30, 100_000)).toEqual([])
    expect(step(30, 219_000)).toEqual([])
    expect(step(30, 220_000)).toEqual(['cpu over'])
    expect(step(30, 250_000)).toEqual([])
    // just under 24 is not back yet: under 90% of it is
    expect(step(23, 280_000)).toEqual([])
    expect(step(21, 310_000)).toEqual(['cpu back'])
    expect(step(30, 340_000)).toEqual([])
    // herdr: told after 30 seconds without it
    expect(step(1, 400_000, false)).toEqual([])
    expect(step(1, 430_000, false)).toEqual(['herdr over'])
    expect(step(1, 440_000, true)).toEqual(['herdr back'])
  })

  test('memory and disk are told at once', () => {
    const l = limits()
    const r = H.judge({}, H.levels(at(1, 95, 93), true, l), 0)
    expect(r.events.map((e) => e.kind).sort()).toEqual(['disk', 'memory'])
  })

  test('the meters: amber while new tasks wait, red once told; a GPU where there is one', () => {
    const m = H.meters(at(20, 50, 95, [{ name: 'A10G', util: 12, memPct: 3 }]), limits(), { disk: { since: 0, told: true } })
    expect(m.map((x) => [x.name, x.pct, x.level])).toEqual([
      ['CPU', 125, 'busy'],
      ['Memory', 50, 'ok'],
      ['Disk', 95, 'over'],
      ['GPU', 12, 'ok'],
    ])
    expect(m[0].detail).toBe('load 20.0 on 16 cores')
  })


})

test("each machine's note gives the limits in its own numbers", () => {
  const n = machineNote(limits(), 16, 31)
  expect(n.noteTitle).toBe('Why these defaults')
  expect(n.note).toStartWith('This machine has 16 cores and 31 GB of memory. New tasks wait while 10 are at work, or while the load is over 16 or over 25 GB of memory is in use.')
  expect(n.note).toContain('load stays over 24 for 2 minutes, memory passes 28 GB')
})
