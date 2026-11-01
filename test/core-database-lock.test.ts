import { Database } from 'bun:sqlite'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreAutomations } from '../server/core/automations.ts'
import { guarded } from '../server/core/guarded.ts'
import { Mailbox } from '../server/core/mailbox.ts'
import { CoreStore, LOCK_WAIT } from '../server/core/store.ts'
import type { CoreSource } from '../server/core/source.ts'

const homes: string[] = []
const home = () => { const path = mkdtempSync(join(tmpdir(), 'shep-lock-')); homes.push(path); return path }
afterEach(() => { for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }) })

/** The wait blocks this thread, so only another process can hold a lock that ends during it. */
async function rival(file: string, ms: number, lock = 'BEGIN EXCLUSIVE') {
  const child = Bun.spawn([process.execPath, '-e', `import { Database } from 'bun:sqlite'
    const db = new Database(${JSON.stringify(file)}); db.exec(${JSON.stringify(lock)}); db.query('SELECT * FROM sqlite_master').all(); console.log('held')
    Bun.sleepSync(${ms}); db.exec('ROLLBACK'); db.close()`], { stdout: 'pipe', stderr: 'inherit' })
  const reader = child.stdout.getReader()
  await reader.read()
  reader.releaseLock()
  return child
}
const timed = <T>(run: () => T) => { const began = performance.now(); const value = run(); return { value, ms: performance.now() - began } }

test('a statement waits out a short lock from another connection and succeeds', async () => {
  const dir = home(), store = new CoreStore(dir)
  try {
    const held = await rival(join(dir, 'state.sqlite'), 200)
    const { ms } = timed(() => store.set('meta', 'waited', true))
    expect(ms).toBeGreaterThan(50)
    expect(ms).toBeLessThan(LOCK_WAIT)
    expect(store.get('meta', 'waited')).toBe(true)
    await held.exited
  } finally { store.close() }
})

test('a write commits through a reader still holding the database', async () => {
  const dir = home(), store = new CoreStore(dir)
  try {
    store.set('meta', 'rows', 1)
    const held = await rival(join(dir, 'state.sqlite'), 200, 'BEGIN')
    store.db.transaction(() => store.set('meta', 'waited', true))()
    expect(store.get('meta', 'waited')).toBe(true)
    await held.exited
  } finally { store.close() }
})

test('a lock that outlasts the wait fails the statement within a bounded time, and leaves no transaction open', () => {
  const dir = home(), store = new CoreStore(dir), holder = new Database(join(dir, 'state.sqlite'))
  try {
    holder.exec('BEGIN EXCLUSIVE')
    const { ms } = timed(() => expect(() => store.db.transaction(() => store.set('meta', 'late', true))()).toThrow('database is locked'))
    expect(ms).toBeGreaterThanOrEqual(LOCK_WAIT * 0.9)
    expect(ms).toBeLessThan(LOCK_WAIT * 2.5)
    expect(store.db.inTransaction).toBe(false)
    holder.exec('ROLLBACK')
    store.set('meta', 'late', true)
    expect(store.get('meta', 'late')).toBe(true)
  } finally { holder.close(); store.close() }
})

test('the mailbox waits for locks too', () => {
  const dir = home(), mailbox = new Mailbox(dir, {} as never, async () => undefined, async () => undefined)
  const holder = new Database(join(dir, 'mailbox.sqlite'))
  try {
    holder.exec('BEGIN EXCLUSIVE')
    const { ms } = timed(() => expect(() => mailbox.issue('chat', 'session', 'box', [])).toThrow('database is locked'))
    expect(ms).toBeGreaterThanOrEqual(LOCK_WAIT * 0.9)
    holder.exec('ROLLBACK')
  } finally { holder.close(); mailbox.close() }
})

test('guarded logs a failure, sync or async, once while it repeats, and never rejects', async () => {
  const log = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const name = `Test ${Math.random()}`
    await guarded(name, () => { throw new Error('database is locked') })
    await guarded(name, async () => { throw new Error('database is locked') })
    expect(log).toHaveBeenCalledTimes(1)
    await guarded(name, async () => { throw new Error('other') })
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1]?.[0]).toContain('other')
  } finally { log.mockRestore() }
})

test('a due automation whose claim fails stays due and is not left busy', async () => {
  const dir = home(), store = new CoreStore(dir), holder = new Database(join(dir, 'state.sqlite'))
  const space = { id: 'p:box:demo', name: 'demo', machine: 'box', folder: '/repo', prefix: 'DEMO', base: 'main' }, launches: string[] = []
  const source = { store, places: { removing: () => false }, connected: () => true, machineConnected: () => true, agents: { get: () => undefined, terminal: () => undefined }, emit() {}, on() {}, settings: { get: () => 'UTC' }, spaces: () => [space], space: () => space, tasks: {
    all: () => [], busy: () => false,
    addInSpace: async () => { launches.push(space.id); return { id: 'DEMO-1' } },
  } } as unknown as CoreSource
  const scheduler = new CoreAutomations(source)
  try {
    const automation = scheduler.model.add({ place: space.id, name: 'once', trigger: { time: 'once 2020-01-01 00:00' }, task: { title: 'Check' } }, 0)
    holder.exec('BEGIN EXCLUSIVE')
    await expect(scheduler.fire(automation, true)).rejects.toThrow('database is locked')
    holder.exec('ROLLBACK')
    expect(automation.on).toBe(true)
    expect(automation.runs).toBeUndefined()
    await scheduler.fire(automation, true)
    await scheduler.drain()
    expect(launches).toEqual([space.id])
  } finally { scheduler.stop(); await scheduler.drain(); holder.close(); store.close() }
})

test('due automations under a lasting reader share one wait, not one each', async () => {
  const dir = home(), store = new CoreStore(dir), holder = new Database(join(dir, 'state.sqlite'))
  const space = { id: 'p:box:demo', name: 'demo', machine: 'box' }
  const source = { store, places: { removing: () => false }, connected: () => true, machineConnected: () => true, agents: { get: () => undefined, terminal: () => undefined }, emit() {}, on() {}, settings: { get: () => 'UTC' }, spaces: () => [space], space: () => space, tasks: { all: () => [], busy: () => false } } as unknown as CoreSource
  const scheduler = new CoreAutomations(source)
  try {
    for (const name of ['one', 'two', 'three', 'four']) scheduler.model.add({ place: space.id, name, trigger: { time: 'once 2020-01-01 00:00' }, task: { title: 'Check' } }, 0)
    holder.exec('BEGIN'); holder.query('SELECT * FROM records').all()
    const began = performance.now()
    await expect(scheduler.scan()).rejects.toThrow('database is locked')
    expect(performance.now() - began).toBeLessThan(LOCK_WAIT * 2.5)
    expect(scheduler.model.list.every(automation => automation.on && !automation.runs)).toBe(true)
  } finally { holder.exec('ROLLBACK'); scheduler.stop(); await scheduler.drain(); holder.close(); store.close() }
})

test('a timer scan under a lock that outlasts the wait fails, logs, and the app lives on to its next tick', async () => {
  // Timers only, as in the running app: a top-level await would keep Bun going past an unhandled failure.
  const dir = home(), root = join(import.meta.dir, '..')
  const app = Bun.spawn([process.execPath, '-e', `import { Database } from 'bun:sqlite'
    import { CoreAutomations } from ${JSON.stringify(join(root, 'server/core/automations.ts'))}
    import { CoreStore } from ${JSON.stringify(join(root, 'server/core/store.ts'))}
    const store = new CoreStore(${JSON.stringify(dir)})
    const space = { id: 'p', name: 'demo', machine: 'box' }, tasks = [{ id: 'DEMO-1', chat: 'c', name: 'Task', place: 'p', workflow: 'working', status: 'work' }]
    const source = { store, places: { removing: () => false }, connected: () => true, machineConnected: () => true, agents: { get: () => undefined, terminal: () => undefined }, emit() {}, on() {}, settings: { get: () => 'UTC' }, spaces: () => [space], space: () => space, tasks: { all: () => tasks, busy: () => false, view: task => ({ status: task.status }) } }
    const scheduler = new CoreAutomations(source)
    let holder
    scheduler.start()
    setTimeout(() => {
      store.delete('automation-seen', 'DEMO-1')
      holder = new Database(${JSON.stringify(join(dir, 'state.sqlite'))})
      holder.exec('BEGIN EXCLUSIVE')
      setTimeout(() => { // one interval tick failed in here
        console.log('lived')
        holder.exec('ROLLBACK')
        setTimeout(() => { // and the next one saves what it saw
          console.log('seen:', store.get('automation-seen', 'DEMO-1')?.id)
          scheduler.stop(); holder.close(); store.close(); process.exit(0)
        }, 5500)
      }, 6000)
    }, 100)`], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(app.stdout).text(), new Response(app.stderr).text(), app.exited])
  expect(err).toContain('Automation scan failed; it tries again on its next tick: database is locked')
  expect(out).toContain('lived')
  expect(out).toContain('seen: DEMO-1')
  expect(code).toBe(0)
}, 30_000)
