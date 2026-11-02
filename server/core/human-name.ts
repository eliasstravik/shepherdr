import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
const name = (value: unknown) => typeof value === 'string' && value.trim().length <= 160 && value.trim() && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined

/** Preserve the optional profile in this installation only; never consult a legacy home. */
export async function humanName(home: string, gitName: () => Promise<string>, account = process.env.USER || 'You') {
  let fd: number | undefined
  try {
    fd = openSync(join(home, 'config.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (stat.isFile() && stat.nlink === 1 && stat.size <= 16_384 && stat.uid === process.getuid?.()) {
      const bytes = Buffer.alloc(16_385), count = readSync(fd, bytes, 0, bytes.length, 0)
      if (count <= 16_384) {
        const configured = name(JSON.parse(bytes.subarray(0, count).toString('utf8')).user)
        if (configured) return configured
      }
    }
  } catch { /* optional profile is absent or invalid */ }
  finally { if (fd !== undefined) closeSync(fd) }
  try { const first = name((await gitName()).trim().split(/\s+/)[0]); if (first) return first } catch { /* Git need not be configured */ }
  const fallback = name(account) || 'You'
  return fallback[0].toUpperCase() + fallback.slice(1)
}
