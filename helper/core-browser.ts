import { readFileSync, lstatSync, realpathSync, existsSync, writeFileSync, renameSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute } from 'node:path'
import { browserOpen, browserPacket, BROWSER_OSC } from '../server/core/browser-protocol.ts'
import { Browsers, type BrowserBridge } from './core-browser-session.ts'
import type { BrowserUp } from '../shared/browser.ts'

interface Config { key: string; session: string; namespace: string; profile: string; bin: string; host: string }

/** One core-owned browser child; no listener, tunnel, service or general command runner. */
export async function browserChild(path: string) {
  const privatePath = (file: string, directory = false) => {
    const stat = lstatSync(file)
    if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() || !directory && stat.nlink !== 1 || stat.uid !== process.getuid!() || (stat.mode & 0o077) || realpathSync(file) !== file) throw Error('Browser launch file must be private')
  }
  privatePath(dirname(path), true); privatePath(path)
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config
  if (!/^[a-f0-9]{64}$/.test(config.key) || !/^[a-f0-9]{16}$/.test(config.session) || !/^sc-[a-f0-9]{12}$/.test(config.namespace) || !isAbsolute(config.bin) || !isAbsolute(config.profile)) throw Error('Invalid browser launch configuration')
  for (const name of Object.keys(process.env)) if (name.startsWith('AGENT_BROWSER_') || name.startsWith('SHEPHERDR_')) delete process.env[name]
  let bridge: BrowserBridge | undefined, epoch = '', seen = 0, user = 'You', working = false, idle: number | null = 15 * 60_000
  const newsPath = path + '.news.json'
  const news = new Map<string, string>()
  if (existsSync(newsPath)) {
    privatePath(newsPath)
    const stored = JSON.parse(readFileSync(newsPath, 'utf8'))
    if (!Array.isArray(stored) || stored.length > 64 || stored.some(row => !Array.isArray(row) || !/^[a-f0-9-]{36}$/.test(row[0]) || typeof row[1] !== 'string' || row[1].length > 10000)) throw Error('Invalid browser news journal')
    for (const [id, text] of stored) news.set(id, text)
  }
  const saveNews = () => {
    if (existsSync(newsPath)) privatePath(newsPath)
    const temporary = newsPath + '.' + randomUUID()
    writeFileSync(temporary, JSON.stringify([...news]), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, newsPath)
  }
  let closing = false, pending = 0, queue = Promise.resolve()
  const completed = new Map<string, { ok: boolean; error?: string; hash: string }>()
  const send = (value: unknown, frame = false) => {
    if (process.stdout.writableLength > (frame ? 2 : 4) * 1024 * 1024) {
      if (frame) return
      throw Error('Browser relay output is full')
    }
    let packet: string
    try { packet = browserPacket(config.key, 'down', value) } catch (error) { if (frame) return; throw error }
    process.stdout.write(Buffer.concat([BROWSER_OSC, Buffer.from(packet), Buffer.from([7])]))
  }
  const browsers = new Browsers({ bin: config.bin, owns: task => task === config.session,
    env: () => ({ AGENT_BROWSER_NAMESPACE: config.namespace, AGENT_BROWSER_SESSION: config.session, AGENT_BROWSER_PROFILE: config.profile, AGENT_BROWSER_ARGS: '--force-prefers-reduced-motion' }),
    tell: (_task, text) => { if (news.size >= 64) throw Error('Browser handoff messages are waiting for Shepherdr to reconnect'); const id = randomUUID(); news.set(id, text); saveNews(); send({ type: 'tell', id, text }) }, working: () => working, idleClose: () => idle, user: () => user, host: config.host })
  const attach = () => browsers.attach(config.session, {
    send: raw => { const message = JSON.parse(raw); send({ type: 'down', message }, message.type === 'frame') },
    close: () => { bridge = undefined }, buffered: () => process.stdout.writableLength,
  })
  const timer = setInterval(() => {
    if (bridge && Date.now() - seen > 15_000) { bridge.end(); bridge = undefined }
    if (!closing) void browsers.closeIdle().catch(() => {})
  }, 5000)
  const perform = async (input: { type: string; epoch?: string; user?: string; working?: boolean; idle?: number | null; message?: BrowserUp; forget?: boolean; news?: string }) => {
    if (input.type === 'watch' || input.type === 'configure') {
      if (input.type === 'configure') { bridge?.end(); bridge = undefined }
      seen = input.type === 'watch' ? Date.now() : 0; user = String(input.user || 'You').slice(0, 100); working = !!input.working
      if (input.idle === null || typeof input.idle === 'number' && Number.isFinite(input.idle) && input.idle >= 60_000) idle = input.idle
      if (input.type === 'watch' && (!bridge || input.epoch !== epoch)) { bridge?.end(); epoch = String(input.epoch || ''); bridge = attach() }
      for (const [id, text] of news) send({ type: 'tell', id, text })
    } else if (input.type === 'received-news') { if (typeof input.news === 'string' && news.delete(input.news)) saveNews() }
    else if (input.type === 'unwatch') { bridge?.end(); bridge = undefined }
    else if (input.type === 'input') {
      if (!bridge || Date.now() - seen > 15_000) throw Error('Browser view disconnected; open it again')
      if (!input.message || typeof input.message.type !== 'string') throw Error('Invalid browser control')
      await bridge.message(JSON.stringify(input.message))
    } else if (input.type === 'close') {
      browsers.release(config.session)
      closing = true; bridge?.end(); bridge = undefined
      await browsers.close(config.session, !!input.forget)
    } else throw Error('Unknown browser relay command')
  }
  try {
    let carry = Buffer.alloc(0)
    for await (const bytes of process.stdin) {
      carry = Buffer.concat([carry, Buffer.from(bytes)])
      if (carry.length > 256 * 1024) throw Error('Browser command buffer is full')
      let end: number
      while ((end = carry.indexOf(10)) >= 0) {
        const raw = carry.subarray(0, end).toString('utf8'); carry = Buffer.from(carry.subarray(end + 1))
        const command = browserOpen(config.key, 'up', raw) as { id: string; input: Parameters<typeof perform>[0] }
        if (!/^[a-zA-Z0-9-]{8,100}$/.test(command.id) || !command.input || closing) continue
        const hash = createHash('sha256').update(JSON.stringify(command.input)).digest('hex')
        const old = completed.get(command.id)
        if (old) { send({ type: 'ack', id: command.id, ...(old.hash === hash ? old : { ok: false, error: 'Browser command id belongs to a different action' }) }); continue }
        if (pending >= 64) { send({ type: 'ack', id: command.id, ok: false, error: 'Browser controls are busy; retry the action' }); continue }
        pending++
        queue = queue.then(async () => {
          let result: { ok: boolean; error?: string; hash: string }
          const old = completed.get(command.id)
          if (old) result = old.hash === hash ? old : { ok: false, hash, error: 'Browser command id belongs to a different action' }
          else {
            try { await perform(command.input); result = { ok: true, hash } }
            catch (error) { result = { ok: false, hash, error: (error as Error).message.slice(0, 1000) } }
            completed.set(command.id, result)
            while (completed.size > 256) completed.delete(completed.keys().next().value!)
          }
          send({ type: 'ack', id: command.id, ...result }); pending--
          if (closing) { clearInterval(timer); setTimeout(() => process.exit(0), 50) }
        }).catch(() => { process.exitCode = 1; clearInterval(timer); process.exit(1) })
      }
    }
    await queue
  } finally { clearInterval(timer); bridge?.end() }
}
if (import.meta.main) browserChild(process.argv[2]!).catch(() => { console.error('Browser relay stopped; reopen its panel to reconnect'); process.exit(1) })
