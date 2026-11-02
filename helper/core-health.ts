// A stateless sample invoked through machine.exec. No service or listener.
import { readFileSync, statfsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { cpus, freemem, totalmem, loadavg, homedir, tmpdir } from 'node:os'

/** macOS keeps reusable pages outside freemem(); do not count that cache as pressure. */
export function darwinAvailableMemory(text: string, total: number): number {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1])
  const pages = ['free', 'inactive', 'speculative'].map(name => {
    const value = text.match(new RegExp(`^Pages ${name}:\\s+(\\d+)\\.`, 'm'))?.[1]
    if (value === undefined) throw new Error('macOS memory sample is incomplete')
    return Number(value)
  })
  if (!Number.isSafeInteger(pageSize) || pageSize < 1024 || !Number.isFinite(total) || total <= 0 || pages.some(value => !Number.isSafeInteger(value))) throw new Error('macOS memory sample is invalid')
  return Math.min(total, pages.reduce((sum, value) => sum + value, 0) * pageSize)
}

export async function sample() {
  let available = freemem(), total = totalmem()
  if (process.platform === 'linux') {
    const text = readFileSync('/proc/meminfo', 'utf8')
    const kb = (name: string) => Number(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024
    total = kb('MemTotal'); available = kb('MemAvailable') || kb('MemFree')
  }
  if (process.platform === 'darwin') available = darwinAvailableMemory(execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 }), total)
  const disks: { path: string; pct: number; freeGb: number; dev: number }[] = []
  for (const path of [homedir(), tmpdir()]) {
    try {
      const s = statfsSync(path), used = s.blocks - s.bfree, dev = statSync(path).dev
      if (!disks.some(disk => disk.dev === dev)) disks.push({ path: path === homedir() ? 'home' : path, pct: used + s.bavail ? Math.round(100 * used / (used + s.bavail)) : 0, freeGb: s.bavail * s.bsize / 2 ** 30, dev })
    } catch {}
  }
  const gpus: { name: string; util: number; memPct: number }[] = []
  const smi = Bun.which('nvidia-smi')
  if (smi) {
    const p = Bun.spawn([smi, '--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { stdout: 'pipe', stderr: 'ignore' })
    const timeout = setTimeout(() => p.kill(), 5000)
    try {
      const reader = p.stdout.getReader(), chunks: Uint8Array[] = []; let bytes = 0
      while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 64 * 1024) { p.kill(); throw Error('GPU sample exceeds limit') }; chunks.push(next.value) }
      if (await p.exited === 0) for (const line of Buffer.concat(chunks).toString().split('\n')) {
        const [name, util, used, total] = line.split(',').map(word => word.trim())
        if (name && total) gpus.push({ name, util: Number(util) || 0, memPct: Number(total) ? Math.round(100 * Number(used) / Number(total)) : 0 })
      }
    } finally { clearTimeout(timeout) }
  }
  return { at: Date.now(), cores: cpus().length || 1, load: loadavg()[0], memTotal: total, memUsed: Math.max(0, total - available), disks, gpus }
}
