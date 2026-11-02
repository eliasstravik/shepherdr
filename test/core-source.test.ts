import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreError } from '../server/core/client.ts'
import { CoreSource } from '../server/core/source.ts'

test('a dropping remote cannot block local startup snapshot or refresh', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-source-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  let finish!: (bytes: Buffer<ArrayBuffer>) => void
  try {
    source.core.call = async <T>(method: string) => (method === 'server.status' ? { core: { id: 'local', name: 'local' } }
      : { machines: [{ id: 'remote', name: 'box', state: 'connected' }] }) as T
    source.store.set('space', 'p:local:~', { id: 'p:local:~', name: '~', home: true, machine: 'local', folder: '/unused', base: 'main', prefix: 'TASK', mode: 'regular', added: 1 })
    source.files.exec = () => new Promise<Buffer<ArrayBuffer>>(resolve => { finish = resolve })
    // Resolves while the remote exec is still pending, rather than holding startup hostage.
    await source.refresh()
    expect(source.snapshot().places.some(place => place.id === 'p:local:~')).toBe(true)
    let failed = false
    source.files.exec = async () => { failed = true; throw new Error('remote dropped') }
    finish(Buffer.from('/remote/home')); await Bun.sleep(0)
    source.store.delete('space', 'p:remote:~')
    await source.refresh(); await Bun.sleep(0)
    expect(failed).toBe(true)
    expect(source.snapshot().places.some(place => place.id === 'p:remote:~')).toBe(false)
    expect(source.snapshot().places.some(place => place.id === 'p:local:~')).toBe(true)
  } finally { source.stop(); await Promise.resolve(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('phone send and direct launch cannot restart a stopped task during deletion; shutdown waits', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-source-delete-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular' as const, added: 1 }
  const task = { id: 'DEMO-1', chat: 'DEMO-1/Agent', name: 'Example', desc: 'Example', place: space.id, machine: space.machine, folder: '/worktree', repo: '/repo', branch: 'work/1-example', base: 'main', kind: 'claude' as const,
    workflow: 'todo' as const, status: 'todo' as const, state: 'To do', mergePolicy: 'ask' as const, review: { on: false, kind: 'codex' as const, rounds: 3, mustFix: 'major' }, age: 'now', created: new Date().toISOString(), on: 'test' }
  source.store.set('space', space.id, space); source.store.set('task', task.id, task)
  source.store.set('agent', task.chat, { chat: task.chat, space: space.id, machine: space.machine, role: 'task', kind: 'claude', launch: 'old', grant: 'old', hook: '/unused', started: 1, state: 'idle' })
  source.core.current.connected = true
  const ended = { address: 't1', state: 'finished', pid: 10, created_ms: 1 } as import('../server/core/protocol.ts').CoreTerminal
  source.core.current.terminals = new Map([['t1', ended]])
  source.agents.terminal = (() => ended) as typeof source.agents.terminal
  source.machineConnected = () => true

  let launches = 0
  source.agents.launch = async () => { launches++; throw Error('Should not launch during deletion') }
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  source.tasks.git.run = async (_repo, args) => {
    if (args[0] === 'worktree' && args[1] === 'list') { entered(); await new Promise<void>(resolve => { release = resolve }); return 'worktree /worktree\nbranch refs/heads/work/1-example\n' }
    return ''
  }
  source.tasks.git.clean = async () => true
  source.tasks.git.head = async () => { throw Error('No branch was created') }
  const removing = source.tasks.remove(task, true)
  await reached
  try {
    await expect(source.act({ type: 'send', chat: task.chat, text: 'Continue' })).rejects.toThrow('finishing another action')
    await expect(source.tasks.launch(task, 'Continue')).rejects.toThrow('finishing another action')
    await expect(source.tasks.deliver(task.id, task.chat, 'Continue')).rejects.toThrow('finishing another action')
    expect(source.store.all('pending-send')).toHaveLength(0)
    let stopped = false
    const draining = source.drain().then(waited => { stopped = true; return waited })
    await Bun.sleep(0)
    expect(stopped).toBe(false)
    release()
    expect(await removing).toMatchObject({ ok: true })
    expect(await draining).toBe(true)
    await Bun.sleep(0)
    expect(launches).toBe(0)
    expect(source.tasks.get(task.id)).toBeUndefined()
  } finally {
    release(); await removing.catch(() => {}); source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true })
  }
})

function deliveryFixture() {
  const home = mkdtempSync(join(tmpdir(), 'shep-source-delivery-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular' as const, added: 1 }
  const task = { id: 'DEMO-1', chat: 'DEMO-1/Agent', name: 'Example', desc: 'Example', place: space.id, machine: space.machine, folder: '/worktree', repo: '/repo', branch: 'work/1-example', base: 'main', kind: 'claude' as const,
    workflow: 'working' as const, status: 'work' as const, state: 'Working', mergePolicy: 'ask' as const, review: { on: false, kind: 'codex' as const, rounds: 3, mustFix: 'major' }, age: 'now', created: new Date().toISOString(), on: 'test' }
  source.store.set('space', space.id, space); source.store.set('task', task.id, task)
  for (const [chat, role] of [[task.chat, 'task'], ['DEMO-1/Reviewer-1', 'reviewer']]) source.store.set('agent', chat!, { chat, space: space.id, machine: space.machine, role, kind: 'claude', launch: 'session', grant: 'grant', hook: '/unused', started: 1, state: 'idle' })
  source.core.current.connected = true
  source.agents.terminal = (() => ({ state: 'live' })) as unknown as typeof source.agents.terminal
  const sent: { chat: string; text: string }[] = []
  source.agents.send = async (chat, text) => {
    sent.push({ chat, text })
    for (const item of source.store.all<{ id: string; chat: string; text: string }>('pending-send')) if (item.chat === chat && item.text === text) source.store.delete('pending-send', item.id)
  }
  return { source, task, sent, async close() { source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}

test('a send to an idle reviewer leaves the preparation gate and reaches that reviewer once', async () => {
  const f = deliveryFixture()
  try {
    await f.source.act({ type: 'send', chat: 'DEMO-1/Reviewer-1', text: 'Check again', cid: 'reviewer-send' })
    await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: 'DEMO-1/Reviewer-1', text: 'Check again' }])
    expect(f.source.store.all('pending-send')).toHaveLength(0)
  } finally { await f.close() }
})

test('a typed /model never reaches the CLI, however it is sent, even as a reply to a message that is gone', async () => {
  const f = deliveryFixture()
  try {
    await expect(f.source.act({ type: 'send', chat: f.task.chat, text: '/model sonnet', cid: 'model-send' })).rejects.toThrow('Use Restart agent')
    await expect(f.source.act({ type: 'send', chat: f.task.chat, text: ' /MODEL' })).rejects.toThrow('Use Restart agent')
    await expect(f.source.act({ type: 'send', chat: f.task.chat, text: '/model sonnet', reply: 'gone' })).rejects.toThrow('Use Restart agent')
    await Bun.sleep(0)
    expect(f.sent).toEqual([])
    expect(f.source.store.all('pending-send')).toEqual([])
  } finally { await f.close() }
})

test('an ordinary message never reads as held, idle or mid-turn, while it goes in', async () => {
  const f = deliveryFixture()
  f.source.machineConnected = () => true
  const views: (boolean | undefined)[] = []
  f.source.on('chat', (chat: string) => views.push(...f.source.chat(chat)!.messages.map(message => message.waiting)))
  const deliver = f.source.agents.send
  try {
    for (const state of ['idle', 'working'] as const) {
      const agent = f.source.agents.get(f.task.chat)!
      f.source.store.set('agent', f.task.chat, { ...agent, state })
      let release!: () => void
      const landing = new Promise<void>(resolve => { release = resolve })
      f.source.agents.send = async (chat, text) => { await landing; await deliver(chat, text) }
      const answer = await f.source.act({ type: 'send', chat: f.task.chat, text: `While ${state}`, cid: `ordinary-${state}` })
      expect(answer).toEqual({ ok: true, waiting: false, waitsFor: undefined })
      await Bun.sleep(0) // on its way, not in yet: the terminal hasn't taken it
      expect(f.source.store.get('pending-send', `ordinary-${state}`)).toMatchObject({ state: 'sending' })
      expect(f.source.chat(f.task.chat)!.messages.at(-1)).toMatchObject({ text: `While ${state}`, cid: `ordinary-${state}`, waiting: false })
      release(); await Bun.sleep(0)
    }
    expect(f.sent.map(item => item.text)).toEqual(['While idle', 'While working'])
    expect(views.length).toBeGreaterThan(0)
    expect(views.some(Boolean)).toBe(false)
  } finally { await f.close() }
})

test('a truly held message says why, and its note goes when it goes in', async () => {
  const f = deliveryFixture()
  f.source.machineConnected = () => true
  const view = () => f.source.chat(f.task.chat)!.messages.at(-1)
  const agent = f.source.agents.get(f.task.chat)!
  const live = f.source.agents.terminal
  try {
    // still starting
    f.source.store.set('agent', f.task.chat, { ...agent, state: 'starting' })
    expect(await f.source.act({ type: 'send', chat: f.task.chat, text: 'Starting', cid: 'held-start' })).toEqual({ ok: true, waiting: true, waitsFor: 'start' })
    await Bun.sleep(0)
    expect(f.sent).toEqual([])
    expect(view()).toMatchObject({ waiting: true, waitsFor: 'start' })
    // a menu: an open permission, and the CLI's own that core refuses text on
    f.source.store.set('agent', f.task.chat, { ...agent, state: 'blocked' })
    f.source.store.set('permission', 'open', { id: 'open', chat: f.task.chat, grant: 'grant', expires: Date.now() + 60_000, settled: false, question: { id: 'open', title: 'Allow?', choices: [] } })
    expect(view()).toMatchObject({ waiting: true, waitsFor: 'menu' })
    f.source.store.delete('permission', 'open')
    f.source.agents.terminal = (() => ({ state: 'live', status: { state: 'blocked' } })) as unknown as typeof f.source.agents.terminal
    expect(view()).toMatchObject({ waiting: true, waitsFor: 'menu' })
    f.source.agents.terminal = live
    // no room on its machine yet
    f.source.store.set('agent', f.task.chat, { ...agent, state: 'idle' })
    f.source.store.set('task', f.task.id, { ...f.task, capacity: 'its machine is full' })
    expect(view()).toMatchObject({ waiting: true, waitsFor: 'start' })
    f.source.store.set('task', f.task.id, f.task)
    // its machine out of reach: no reason to name but that
    f.source.machineConnected = () => false
    expect(view()).toMatchObject({ waiting: true })
    expect(view()!.waitsFor).toBeUndefined()
    f.source.machineConnected = () => true
    // nothing holds it now: it goes in, and the chat hears
    let pushed: unknown
    f.source.on('chat', (chat: string) => { pushed = f.source.chat(chat)!.messages.at(-1) })
    f.source.retry(f.task.chat); await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: f.task.chat, text: 'Starting' }])
    expect(pushed).toMatchObject({ text: 'Starting', waiting: false })
  } finally { await f.close() }
})

test('a message to a machine out of reach waits for it instead of failing, and goes in once it is back', async () => {
  const f = deliveryFixture()
  let state = 'reconnecting'
  f.source.core.call = async <T>(method: string) => (method === 'server.status' ? { core: { id: 'local', name: 'local' } }
    : { machines: [{ id: 'machine', name: 'box', state }] }) as T
  f.source.files.exec = async () => Buffer.from('/home/box')
  try {
    await f.source.refresh()
    expect(await f.source.act({ type: 'send', chat: f.task.chat, text: 'Out of reach', cid: 'held-machine' })).toEqual({ ok: true, waiting: true })
    await Bun.sleep(0)
    expect(f.sent).toEqual([])
    expect(f.source.store.get('pending-send', 'held-machine')).toMatchObject({ state: 'queued' })
    expect(f.source.chat(f.task.chat)!.messages.at(-1)).toMatchObject({ text: 'Out of reach', waiting: true })
    state = 'connected'
    await f.source.refresh(); await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: f.task.chat, text: 'Out of reach' }])
    expect(f.source.chat(f.task.chat)!.messages.at(-1)).toMatchObject({ text: 'Out of reach', waiting: false })
  } finally { await f.close() }
})

test('core refusing a message for a menu leaves it held, and the chat hears', async () => {
  const f = deliveryFixture()
  f.source.machineConnected = () => true
  let blocked = true
  f.source.agents.terminal = (() => ({ state: 'live', status: { state: blocked ? 'blocked' : 'idle' } })) as unknown as typeof f.source.agents.terminal
  const deliver = f.source.agents.send
  f.source.agents.send = async (chat, text) => { if (blocked) throw new CoreError('blocked', 'A menu is open'); await deliver(chat, text) }
  let pushed: unknown
  f.source.on('chat', (chat: string) => { pushed = f.source.chat(chat)!.messages.at(-1) })
  try {
    await f.source.act({ type: 'send', chat: f.task.chat, text: 'Menu up', cid: 'held-menu' }); await Bun.sleep(0)
    expect(f.source.store.get('pending-send', 'held-menu')).toMatchObject({ state: 'queued' })
    expect(pushed).toMatchObject({ text: 'Menu up', waiting: true, waitsFor: 'menu' })
    blocked = false
    f.source.retry(f.task.chat); await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: f.task.chat, text: 'Menu up' }])
    expect(pushed).toMatchObject({ text: 'Menu up', waiting: false })
  } finally { await f.close() }
})

test('shutdown retains a message prepared during drain without launching delivery', async () => {
  const f = deliveryFixture()
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  f.source.chats.text = async () => { entered(); await new Promise<void>(resolve => { release = resolve }); return 'Keep queued' }
  try {
    const preparing = f.source.act({ type: 'send', chat: f.task.chat, text: 'Keep queued', cid: 'stopping-send' })
    await reached
    const draining = f.source.drain()
    release()
    await preparing; await draining; await Bun.sleep(0)
    expect(f.sent).toEqual([])
    expect(f.source.store.get('pending-send', 'stopping-send')).toMatchObject({ state: 'queued' })
    f.source.quiescing = false
    f.source.retry(f.task.chat)
    await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: f.task.chat, text: 'Keep queued' }])
  } finally { release?.(); await f.close() }
})

test('shutdown finishes the current delivery but leaves the next queued message untouched', async () => {
  const f = deliveryFixture()
  let release!: () => void, entered!: () => void
  const reached = new Promise<void>(resolve => { entered = resolve })
  const send = f.source.agents.send
  f.source.agents.send = async (chat, text) => { entered(); await new Promise<void>(resolve => { release = resolve }); await send(chat, text) }
  try {
    for (const id of ['first', 'second']) f.source.store.set('pending-send', id, { id, chat: f.task.chat, text: id, state: 'queued' })
    f.source.retry(f.task.chat)
    await reached
    const draining = f.source.drain()
    release()
    await draining; await Bun.sleep(0)
    expect(f.sent).toEqual([{ chat: f.task.chat, text: 'first' }])
    expect(f.source.store.get('pending-send', 'second')).toMatchObject({ state: 'queued' })
  } finally { release?.(); await f.close() }
})

test('shutdown prevents queued tasks from receiving go even after their dependencies finish', async () => {
  const f = deliveryFixture()
  try {
    f.source.store.set('task', f.task.id, { ...f.task, workflow: 'queued', after: [] })
    await f.source.drain()
    await f.source.tasks.tick()
    await expect(f.source.tasks.change(f.task.id, async () => {})).rejects.toThrow('stopping')
    expect(f.source.tasks.get(f.task.id)?.workflow).toBe('queued')
    expect(f.sent).toEqual([])
  } finally { await f.close() }
})

test('oversized native records produce a persistent visible chat notice and later replies still load', async () => {
  const f = deliveryFixture()
  const { MAX_NATIVE_RECORD } = await import('../server/core/native-file.ts')
  const record = f.source.agents.get(f.task.chat)!
  record.transcript = '/native'; record.hook = '/hooks'; record.kind = 'codex'
  f.source.store.set('agent', f.task.chat, record)
  f.source.store.delete('agent', 'DEMO-1/Reviewer-1')
  f.source.agents.bun = async () => process.execPath
  const huge = Buffer.alloc(1048576, 'x').toString('base64')
  const reply = JSON.stringify({ timestamp: '2026-10-29T12:00:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'AFTER_OVERSIZED_RECORD' }] } }) + '\n'
  let chunks = 0
  f.source.files.exec = async (_machine, _argv, _cwd, input) => {
    const request = JSON.parse(Buffer.from(input!).toString())
    const data = request.path === '/hooks' ? '' : chunks++ <= MAX_NATIVE_RECORD / 1048576 ? huge : chunks === MAX_NATIVE_RECORD / 1048576 + 2 ? Buffer.from('\n' + reply).toString('base64') : ''
    return Buffer.from(JSON.stringify({ data, from: request.from, size: request.path === '/hooks' ? 0 : MAX_NATIVE_RECORD + 1048576 + Buffer.byteLength('\n' + reply), identity: request.path, anchor: 'anchor', modified: 'same' }))
  }
  try {
    for (let i = 0; i < 18; i++) await f.source.logs.poll()
    const texts = f.source.chat(f.task.chat)!.messages.map(message => message.text)
    expect(texts.some(text => text?.includes('64 MiB display limit') && text.includes('skipped'))).toBe(true)
    expect(texts).toContain('AFTER_OVERSIZED_RECORD')
  } finally { await f.close() }
})

test('durable GitHub work intents activate follow-up delivery while check reminders remain internal', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-source-github-work-')), source = new CoreSource({ home, port: 0, socket: '/unused', session: 'test', binary: 'hc' })
  const machine = source.localMachineId(), chat = 'DEMO-1/Agent'
  source.store.set('space', 'space', { id: 'space', name: 'Demo', machine, folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular', added: 1 })
  source.store.set('task', 'DEMO-1', { id: 'DEMO-1', chat, place: 'space', machine, workflow: 'ready' })
  source.store.set('agent', chat, { chat, launch: 'launch', grant: 'grant', machine, space: 'space', kind: 'claude', role: 'task', state: 'idle', started: 1, hook: '/unused' })
  source.core.current.connected = true
  source.agents.terminal = (() => ({ state: 'live', pid: 1 })) as unknown as typeof source.agents.terminal
  const internal: boolean[] = []
  source.tasks.deliver = async (_id, _chat, _text, quiet) => { internal.push(!!quiet) }
  try {
    source.saveAndDeliver(chat, 'github-work', '<github>Comment</github>', () => {}, true, true)
    await Bun.sleep(0)
    source.saveAndDeliver(chat, 'github-checks', '<github>Checks passed</github>', () => {}, true)
    await Bun.sleep(0)
    expect(internal).toEqual([false, true])
    expect(source.store.get('pending-send', 'github-work')).toMatchObject({ work: true, launch: 'launch' })
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})


test('main-home identity uses the stable core machine key independently of display order or rename', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-main-identity-'))
  const source = new CoreSource({ home, port: 0, socket: '/unused', session: 'test', binary: 'hc' })
  try {
    source.core.current.connected = true
    source.core.call = async <T>(method: string) => {
      if (method === 'server.status') return { core: { id: 'main-stable-id', name: 'Z main box' } } as T
      if (method === 'machine.list') return { machines: [{ id: 'remote-stable-id', name: 'A remote box', state: 'connected' }] } as T
      throw Error('Unexpected core method')
    }
    source.files.exec = async () => Buffer.from(home)
    source.settings.probe = () => {}
    await source.refresh(); await Bun.sleep(0)
    const snapshot = source.snapshot()
    expect(snapshot.host).toBe('main-stable-id')
    expect(snapshot.places.find(place => place.home && place.machine === snapshot.host)?.id).toBe('p:main-stable-id:~')
    expect(snapshot.machines.find(machine => machine.machine === snapshot.host)?.name).toBe('Z main box')
    source.store.set('name', 'm:main-stable-id', 'Renamed main')
    expect(source.snapshot().host).toBe('main-stable-id')
    expect(source.voices.tools('p:main-stable-id:~').name).toBe('Renamed main:home')
    source.settings.set('task.agent', 'Codex', 'm:main-stable-id')
    expect(source.snapshot().settings!.find(section => section.name === 'Agents' && section.level === 'p:main-stable-id:~')?.rows.find(row => row.key === 'task.agent')?.from).toBe('Renamed main')
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('a folder outside home is refused in plain words, also when it does not exist yet', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-source-folders-'))
  const source = new CoreSource({ home: join(root, 'state'), port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const userHome = join(root, 'me')
  mkdirSync(join(userHome, 'dev'), { recursive: true })
  source.agents.bun = async () => process.execPath
  source.files.exec = async (_machine, argv) => {
    const run = Bun.spawnSync(argv, { env: { ...process.env, HOME: userHome } })
    if (run.exitCode) throw Error(run.stderr.toString())
    return Buffer.from(run.stdout)
  }
  try {
    expect((await source.folders('m', '~/dev')).exists).toBe(true)
    expect((await source.folders('m', '~/not-yet/deeper')).exists).toBe(false)
    for (const outside of [root, join(root, 'not-yet/deeper')]) await expect(source.folders('m', outside)).rejects.toThrow(/^Choose a folder in your home\.$/)
  } finally { source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('before an agent starts its chat says what Settings will use, and a task\'s own pick stays asked for', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-source-planned-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const space = { id: 'p:machine:demo', name: 'demo', machine: 'machine', folder: '/repo', base: 'main', prefix: 'DEMO', mode: 'regular' as const, added: 1 }
  source.store.set('space', space.id, space)
  source.settings.agent = (() => ({ kind: 'codex', model: 'small', effort: 'medium' })) as typeof source.settings.agent
  source.settings.findModel = ((_kind: string, value: string) => (value === 'small' ? { id: 'small', label: 'Small 1' } : undefined)) as typeof source.settings.findModel
  const task = { id: 'DEMO-1', chat: 'DEMO-1/Agent', place: space.id, kind: 'codex', model: 'small', effort: 'medium' }
  try {
    expect(source.chat(space.id)).toMatchObject({ cli: 'Codex', agent: { kind: 'codex', planned: { model: 'small', modelLabel: 'Small 1', effort: 'medium' } } })
    expect(source.chat(space.id)?.agent?.model).toBeUndefined()
    // an open chat follows Settings: nothing else would send it again
    const sent: string[] = []
    source.on('chat', (key: string) => sent.push(key))
    source.settings.set('coordinator.effort', 'default', space.id)
    expect(sent).toContain(space.id)
    source.tasks.forChat = (() => task) as unknown as typeof source.tasks.forChat
    expect(source.chat(task.chat)?.agent?.planned).toBeDefined()
    task.effort = 'high'
    const own = source.chat(task.chat)?.agent
    expect(own?.planned).toBeUndefined()
    expect(own).toMatchObject({ kind: 'codex', model: 'small', modelLabel: 'Small 1', effort: 'high' })
    // a reviewer starts on what its task saved, not on today's Settings
    const reviewer = { ...task, review: { kind: 'claude' }, reviewerModel: 'small', reviewerEffort: 'low' }
    source.tasks.forChat = (() => reviewer) as unknown as typeof source.tasks.forChat
    expect(source.chat('DEMO-1/Reviewer')?.agent).toMatchObject({ kind: 'claude', model: 'small', effort: 'low' })
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})
