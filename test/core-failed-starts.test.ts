import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { ResumeStart } from '../server/core/failed-starts.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'
import type { Message } from '../shared/types.ts'

const CLAUDE = 'No conversation found with session ID: 11111111-2222-4333-8444-555555555555\n'
const CODEX = 'WARNING: proceeding\nERROR: No saved session found with ID 11111111. Run `codex resume` without an ID to choose.\n'

let home: string, source: CoreSource, screen: string, terminal: CoreTerminal, launches: { kind: string; prompt: string; options: Record<string, unknown> }[]
const agent = { chat: 'space', space: 'space', machine: 'machine', role: 'coordinator', kind: 'claude', launch: 'one', grant: 'grant', hook: '/unused', state: 'starting', started: 1, session: 'lost', model: 'small' } satisfies CoreAgent
const saved = () => source.store.get<CoreAgent>('agent', 'space')!
const lines = () => source.store.all<Message>('message:space').map(message => message.text)
/** twice: the first sight leaves the hooks a poll to report */
const settle = async () => { await source.failedStarts.tick(); await source.failedStarts.tick() }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'shep-starts-'))
  source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', base: 'main', prefix: 'EX', mode: 'regular', added: 1 } satisfies CoreSpace)
  source.store.set('agent', 'space', agent)
  screen = CLAUDE; launches = []
  terminal = { address: 'box/t7', labels: {}, argv: [], cwd: '/', state: 'finished', reason: 'exited', exit_code: 1, created_ms: 1, cols: 120, rows: 40 }
  // Terminals go by launch: the start that failed stays finished, a new one runs.
  source.agents.terminal = record => record.launch === 'one' ? terminal : { ...terminal, state: 'live' }
  source.connected = () => true
  source.machineConnected = () => true
  source.core.call = (async (method: string) => method === 'terminal.read' ? { text: screen } : {}) as typeof source.core.call
  source.agents.launch = mock(async (_space, chat, kind, prompt, options = {}) => {
    launches.push({ kind, prompt, options })
    const record = { ...agent, chat, kind, launch: 'two', session: options.resume ? source.agents.get(chat)?.session : undefined }
    source.store.set('agent', chat, record)
    return record
  }) as typeof source.agents.launch
})
afterEach(async () => { source.quiescing = true; source.stop(); await Promise.resolve(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) })

for (const [name, words, kind] of [['Claude Code', CLAUDE, 'claude'], ['Codex', CODEX, 'codex']] as const) {
  test(`${name}: a resume with no session starts anew, keeps what it had to say and says so once`, async () => {
    screen = words
    source.store.set('agent', 'space', { ...agent, kind })
    source.store.set('resume-start', 'one', { chat: 'space', launch: 'one', message: 'What needs me?' } satisfies ResumeStart)
    await settle()
    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({ kind, options: { model: 'small' } })
    expect(launches[0].options.resume).toBeUndefined()
    expect(launches[0].prompt).toEndWith('What needs me?')
    expect(lines()).toEqual(['Earlier session was gone, started a new one.'])
    expect(saved()).toMatchObject({ launch: 'two', state: 'starting' })
    expect(saved().session).toBeUndefined()
    await settle()
    expect(launches).toHaveLength(1)
    expect(source.store.all('resume-start')).toEqual([])
  })
}

test('with no room to start anew, what it had to say waits for that start', async () => {
  source.health.room = () => 'No room yet'
  source.store.set('agent', 'EX-1/Agent', { ...agent, chat: 'EX-1/Agent', role: 'task' })
  source.store.delete('agent', 'space')
  source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', workflow: 'working', review: {} })
  source.store.set('resume-start', 'one', { chat: 'EX-1/Agent', launch: 'one', message: 'Are you done?' } satisfies ResumeStart)
  await settle()
  await Bun.sleep(0) // the idle agent tries the saved message at once, and the machine refuses it
  expect(source.tasks.get('EX-1')).toMatchObject({ workflow: 'queued', capacity: 'No room yet' })
  expect(source.store.get('pending-send', 'session-gone-one')).toMatchObject({ chat: 'EX-1/Agent', text: 'Are you done?', state: 'queued' })
  expect(source.store.get<CoreAgent>('agent', 'EX-1/Agent')).toMatchObject({ state: 'idle' })
  expect(source.store.get<CoreAgent>('agent', 'EX-1/Agent')?.session).toBeUndefined()
  expect(source.store.all<Message>('message:EX-1/Agent').map(row => row.text)).toEqual(['Earlier session was gone, a new one starts when there is room.'])
})

test('a stopped start is no news until it has been settled', async () => {
  expect(source.failedStarts.pending(agent)).toBe(true)
  await settle()
  expect(source.failedStarts.pending(saved())).toBe(false)
})

test('a chat stuck before this fix comes back too, with nothing it had to say', async () => {
  await settle()
  expect(launches.map(launch => launch.prompt)).toEqual([''])
})

test('a task starts anew through its own start, with its brief', async () => {
  const launchNow = mock(async () => { source.store.set('agent', 'EX-1/Agent', { ...saved(), chat: 'EX-1/Agent', launch: 'two' }) })
  Object.assign(source.tasks, { launchNow })
  source.store.set('agent', 'EX-1/Agent', { ...agent, chat: 'EX-1/Agent', role: 'task' })
  source.store.delete('agent', 'space')
  source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', workflow: 'working', review: {} })
  source.store.set('resume-start', 'one', { chat: 'EX-1/Agent', launch: 'one', message: 'Are you done?' } satisfies ResumeStart)
  await settle()
  const [task, message] = launchNow.mock.calls[0] as unknown as [{ id: string }, string]
  expect(task.id).toBe('EX-1')
  expect(message).toContain('earlier session is gone')
  expect(message).toEndWith('Are you done?')
  expect(source.store.all<Message>('message:EX-1/Agent').map(row => row.text)).toEqual(['Earlier session was gone, started a new one.'])
})

test('any other failed start is an error in the chat, and frees it for the next message', async () => {
  screen = 'Starting\n\nError: Invalid API key\nPlease run /login\n'
  await settle()
  expect(launches).toEqual([])
  expect(lines()).toEqual(['Claude Code couldn’t start. Starting Error: Invalid API key Please run /login'])
  expect(saved().state).toBe('idle')
  await settle()
  expect(lines()).toHaveLength(1)
})

test('a failed task start shows as needing the human', async () => {
  screen = 'Error: broken\n'
  source.store.set('agent', 'EX-1/Agent', { ...agent, chat: 'EX-1/Agent', role: 'task', session: undefined })
  source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', workflow: 'working', review: {} })
  await settle()
  expect(source.tasks.get('EX-1')?.startError).toBe('Claude Code couldn’t start. Error: broken')
})

test('an empty screen still says how it ended', async () => {
  screen = ''
  await settle()
  expect(lines()).toEqual(['Claude Code couldn’t start. It exited with code 1.'])
})

test('the same words without a session to lose are only a failed start', async () => {
  source.store.set('agent', 'space', { ...agent, session: undefined })
  await settle()
  expect(launches).toEqual([])
  expect(lines()[0]).toContain('couldn’t start')
})

test('a stopped start is no failure, and no longer holds the chat', async () => {
  terminal = { ...terminal, reason: 'killed', exit_code: null, signal: 1 }
  await settle()
  expect(lines()).toEqual([])
  expect(launches).toEqual([])
  expect(saved().state).toBe('idle')
})

test('a reviewer that fails to start says so in its own chat, and leaves the task alone', async () => {
  screen = 'Error: broken\n'
  source.store.set('agent', 'EX-1/Reviewer-1', { ...agent, chat: 'EX-1/Reviewer-1', role: 'reviewer', session: undefined })
  source.store.set('task', 'EX-1', { id: 'EX-1', chat: 'EX-1/Agent', place: 'space', machine: 'machine', workflow: 'working', review: {} })
  await settle()
  expect(source.store.all<Message>('message:EX-1/Reviewer-1').map(row => row.text)).toEqual(['Claude Code couldn’t start. Error: broken'])
  expect(source.tasks.get('EX-1')?.startError).toBeUndefined()
})

test('a start its hooks report in time, one still running or Autopilot is left alone', async () => {
  await source.failedStarts.tick()
  source.store.set('agent', 'space', { ...agent, state: 'idle' })
  await source.failedStarts.tick()
  source.store.set('agent', 'space', { ...agent, pilot: { run: 'run', home: '/unused', captures: '/unused' } })
  await settle()
  source.store.set('agent', 'space', agent)
  terminal = { ...terminal, state: 'live' }
  await settle()
  expect(lines()).toEqual([])
  expect(launches).toEqual([])
})
