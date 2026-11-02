// Agent-side secret use. Values exist only in memory and the invoked child environment.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
const MASKED_MIN = 1
const MASK = '********'

export async function secretRun(command: string[], secrets: Record<string, string>) {
  let c: Bun.Subprocess<'inherit', 'pipe', 'pipe'>
  try {
    c = Bun.spawn(command, { stdin: 'inherit', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...secrets } })
  } catch (e) {
    process.stderr.write(`Couldn't run ${command[0]}: ${(e as Error).message}\n`)
    return 127
  }
  const values = Object.values(secrets).filter((v) => v.length >= MASKED_MIN)
  await Promise.all([masked(c.stdout, process.stdout, values), masked(c.stderr, process.stderr, values)])
  const code = await c.exited
  return c.signalCode ? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }) as Record<string, number>)[c.signalCode] || 1 : code
}

/** a stream as it comes, each value masked; what may be the start of one waits for what follows */
async function masked(from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream, values: string[]) {
  const dec = new TextDecoder()
  const all = [...values].sort((a, b) => b.length - a.length)
  const mask = (s: string) => all.reduce((x, v) => x.split(v).join(MASK), s)
  // how much of the end could begin a value
  const held = (s: string) => {
    for (let k = Math.min((all[0]?.length ?? 1) - 1, s.length); k > 0; k--) if (all.some((v) => v.length > k && s.endsWith(v.slice(0, k)))) return k
    return 0
  }
  const reader = from.getReader()
  let buf = ''
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf = mask(buf + dec.decode(r.value, { stream: true }))
    const keep = held(buf)
    to.write(buf.slice(0, buf.length - keep))
    buf = buf.slice(buf.length - keep)
  }
  to.write(mask(buf + dec.decode()))
}

/** shepherdr secret env: each NAME=value in the file (--file, .env by default), in place of its old line, the file
 *  readable by you only; refused where git would keep it (the helper's shepherdr does the same) */
export function secretEnv(args: string[], secrets: Record<string, string>) {
  const i = args.findIndex((a) => a === '--file' || a.startsWith('--file='))
  const name = i < 0 ? '.env' : args[i].startsWith('--file=') ? args[i].slice(7) : args[i + 1]
  if (!name) return { out: 'shepherdr secret env NAME [NAME …] [--file .env]\n', code: 1 }
  const file = resolve(name)
  const git = (...a: string[]) => spawnSync('git', ['-C', dirname(file), ...a], { stdio: 'ignore' })
  const repo = git('rev-parse', '--is-inside-work-tree')
  if (repo.error) return { out: `git isn't here to check that it ignores ${name}: nothing written.\n`, code: 1 }
  if (repo.status !== 0 || git('check-ignore', '-q', file).status !== 0)
    return { out: `${name} is not ignored by git: add it to .gitignore first, so the secret never lands in git.\n`, code: 1 }
  // a link (or a second name of another file) would carry it into that file
  if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).nlink > 1)) return { out: `${name} is not a plain file: name a plain file, so the secret lands nowhere else.\n`, code: 1 }
  const names = Object.keys(secrets)
  const old = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l, n, a) => !(n === a.length - 1 && !l) && !names.some((k) => new RegExp(`^\\s*(export\\s+)?${k}\\s*=`).test(l))) : []
  // readable by you only before a value goes in: a new file from the start, an old one first
  const text = [...old, ...names.map((k) => `${k}=${envValue(secrets[k])}`)].join('\n') + '\n'
  if (existsSync(file)) {
    chmodSync(file, 0o600)
    writeFileSync(file, text)
  } else writeFileSync(file, text, { mode: 0o600, flag: 'wx' })
  return { out: `Wrote ${names.join(', ')} to ${name} (readable by you only; git ignores it). Never print or commit it.\n`, code: 0 }
}

/** a value as a .env file holds it: as it is, in single quotes (nothing in it is read), or in double quotes */
function envValue(v: string) {
  if (/^[\w@%+:,./-]*$/.test(v)) return v
  if (!/['\n\r]/.test(v)) return `'${v}'`
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`
}
