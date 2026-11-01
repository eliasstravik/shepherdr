import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTerminal } from '../server/core/protocol.ts'
import type { Message, Question } from '../shared/types.ts'

const TRUST = `Quick safety check: do you trust this folder?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm\n`
const THEME = `Choose a style\n\n ❯ Dark mode\n   Light mode\n`
const started = 1_000_000

let home: string, source: CoreSource, screen: string, keys: string[][], alerts: unknown[], terminal: CoreTerminal
const agent = { chat: 'space', space: 'space', machine: 'machine', role: 'coordinator', kind: 'claude', launch: 'one', grant: 'grant', hook: '/unused', state: 'starting', started } satisfies CoreAgent
const saved = () => source.store.get<CoreAgent>('agent', 'space')!
const cards = () => source.store.all<Message>('message:space').filter(message => message.question).map(message => message.question!)
const open = (): Question => cards().find(card => card.sent === undefined && !card.closed)!
/** two matching reads, past the first look */
const settle = async (at = started + 10_000) => { await source.screens.tick(at); await source.screens.tick(at + 2000) }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'shep-screens-'))
  source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', base: 'main', prefix: 'EX', mode: 'regular', added: 1 } satisfies CoreSpace)
  source.store.set('agent', 'space', agent)
  screen = TRUST; keys = []; alerts = []
  terminal = { address: 'box/t7', labels: {}, argv: [], cwd: '/', state: 'live', created_ms: 1, cols: 120, rows: 40 }
  source.agents.terminal = () => terminal
  source.connected = () => true
  source.machineConnected = () => true
  source.core.call = (async (method: string, params: { keys?: string[] }) => {
    if (method === 'terminal.read') return { text: screen }
    if (method === 'terminal.keys') keys.push(params.keys!)
    return {}
  }) as typeof source.core.call
  source.on('alert', alert => alerts.push(alert))
})
afterEach(async () => { source.stop(); await Promise.resolve(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) })

test('no card before the agent has had time to start, nor for one with a session', async () => {
  await settle(started + 2000)
  expect(cards()).toEqual([])
  source.store.set('agent', 'space', { ...agent, state: 'idle' })
  await settle()
  expect(cards()).toEqual([])
})

test('a reviewer has no chat to show a card in, and Autopilot answers its own start', async () => {
  source.store.set('agent', 'space', { ...agent, role: 'reviewer' })
  await settle()
  source.store.set('agent', 'space', { ...agent, pilot: { run: 'run', home: '/unused', captures: '/unused' } })
  await settle()
  expect(cards()).toEqual([])
})

test('words with nothing to tap may be a slow start, so they wait longer', async () => {
  screen = 'Starting the servers (3s)\n'
  await settle()
  expect(cards()).toEqual([])
  await settle(started + 30_000)
  expect(open().screen).toContain('Starting the servers')
})

test('words with nothing to tap come at once after a card, as a sign-in link does', async () => {
  await settle()
  await source.act({ type: 'answer', chat: 'space', question: open().id, choice: 1 })
  screen = 'Paste code here if prompted >\n'
  await settle(started + 12_000)
  expect(open().screen).toContain('Paste code here')
})

test('a screen still moving waits; a blank one never shows', async () => {
  screen = 'Loading the project'
  await source.screens.tick(started + 10_000)
  screen = 'Loading the servers'
  await source.screens.tick(started + 12_000)
  expect(cards()).toEqual([])
  screen = ''
  await settle()
  expect(cards()).toEqual([])
})

test('a stuck agent shows its screen, counts as Needs you and stops reading as working', async () => {
  expect(source.status(saved())).toBe('work')
  await settle()
  const card = open()
  expect(card).toMatchObject({ title: 'Claude Code is waiting on its screen', terminal: true, press: true, noNote: true, to: 'Claude Code' })
  expect(card.screen).toContain('do you trust this folder?')
  expect(card.choices.map(choice => choice.label)).toEqual(['No, exit', 'Yes, I trust this folder'])
  expect(source.status(saved())).toBe('need')
  expect(source.snapshot().needs.map(need => need.id)).toEqual([card.id])
  expect(source.chat('space')?.working).toBe(false)
  expect(alerts).toHaveLength(1)
  await settle(started + 20_000)
  expect(cards()).toHaveLength(1) // one screen, one card
})

test('a tap presses the choice from where the cursor is, once, on the screen the card shows', async () => {
  await settle()
  await source.act({ type: 'answer', chat: 'space', question: open().id, choice: 1 })
  expect(keys).toEqual([['down', 'enter']])
  expect(cards()[0].sent).toBe(1)
  await expect(source.act({ type: 'answer', chat: 'space', question: cards()[0].id, choice: 1 })).rejects.toThrow('no longer waiting')
  expect(keys).toHaveLength(1)
})

test('nothing is pressed once the screen has changed under the card', async () => {
  await settle()
  const card = open()
  screen = THEME
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 1 })).rejects.toThrow('changed')
  expect(keys).toEqual([])
  expect(open().id).toBe(card.id)
})

test('nothing is pressed once a number in a choice has changed under the card', async () => {
  screen = 'Which?\n\n ❯ Plan 1\n   Plan 2\n'
  await settle()
  const card = open()
  screen = 'Which?\n\n ❯ Plan 3\n   Plan 4\n'
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 1 })).rejects.toThrow('changed')
  expect(keys).toEqual([])
})

test('nothing is pressed once a number in its words has changed under the card', async () => {
  screen = 'Trust /repo/project-1?\n\n ❯ Yes\n   No\n'
  await settle()
  const card = open()
  screen = 'Trust /repo/project-2?\n\n ❯ Yes\n   No\n'
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 0 })).rejects.toThrow('changed')
  expect(keys).toEqual([])
})

test('nothing is pressed once words too far up for the card have changed under it', async () => {
  const below = 'Is this right?\n'.repeat(8) + '\n ❯ Yes\n   No\n'
  screen = `Trust /repo/project-1\n${below}`
  await settle()
  const card = open()
  screen = `Trust /repo/project-2\n${below}`
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 0 })).rejects.toThrow('changed')
  expect(keys).toEqual([])
  await settle(started + 20_000) // the new words have held still, so a new card goes with them
  await source.act({ type: 'answer', chat: 'space', question: open().id, choice: 0 })
  expect(keys).toEqual([['enter']])
})

test('words changed for good make a new card: a late tap on the old one presses nothing, one on the new does', async () => {
  screen = 'Trust /repo/project-1?\n\n ❯ Yes\n   No\n'
  await settle()
  const card = open()
  screen = 'Trust /repo/project-2?\n\n ❯ Yes\n   No\n'
  await settle(started + 20_000)
  expect(open().id).not.toBe(card.id)
  expect(open().screen).toContain('project-2')
  expect(cards().find(({ id }) => id === card.id)?.closed).toBe('The screen changed')
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 0 })).rejects.toThrow('no longer waiting')
  expect(keys).toEqual([])
  await source.act({ type: 'answer', chat: 'space', question: open().id, choice: 0 })
  expect(keys).toEqual([['enter']])
})

test('nothing is pressed once a mark that is no letter or number has changed under the card', async () => {
  screen = 'Trust /repo/🔒?\n\n ❯ Yes\n   No\n'
  await settle()
  const card = open()
  screen = 'Trust /repo/🚀?\n\n ❯ Yes\n   No\n'
  await expect(source.act({ type: 'answer', chat: 'space', question: card.id, choice: 0 })).rejects.toThrow('changed')
  expect(keys).toEqual([])
})

test('a spinner above the menu and a moved cursor keep the card, and the tap still lands', async () => {
  screen = '⠋ Loading the project\n\n ❯ Yes\n   No\n'
  await settle()
  const card = open()
  screen = '⠙ Loading the project\n\n   Yes\n ❯ No\n'
  await settle(started + 20_000)
  expect(open().id).toBe(card.id)
  await source.act({ type: 'answer', chat: 'space', question: card.id, choice: 0 })
  expect(keys).toEqual([['up', 'enter']])
})

test('the next screen is the next card, and the one before it says it went in the terminal', async () => {
  await settle()
  const first = open().id
  screen = THEME
  await settle(started + 20_000)
  expect(cards().find(card => card.id === first)).toMatchObject({ sent: -1, via: 'terminal' })
  expect(open().choices.map(choice => choice.label)).toEqual(['Dark mode', 'Light mode'])
  expect(cards()).toHaveLength(2)
})

test('a press that changed nothing is asked again, after a while', async () => {
  await settle()
  await source.act({ type: 'answer', chat: 'space', question: open().id, choice: 1 })
  await settle(Date.now())
  expect(cards()).toHaveLength(1)
  await settle(Date.now() + 20_000)
  expect(cards()).toHaveLength(2)
})

test('the session starting closes the card, and messages wait for it meanwhile', async () => {
  await settle()
  const id = open().id
  expect(source.status(saved())).toBe('need')
  source.store.set('agent', 'space', { ...agent, state: 'idle' })
  source.screens.reconcile('space')
  expect(cards().find(card => card.id === id)).toMatchObject({ sent: -1, via: 'terminal' })
  expect(source.screens.open('space')).toEqual([])
})

test('an agent gone, or replaced, ends its card honestly', async () => {
  await settle()
  const stopped = open().id
  terminal = { ...terminal, state: 'finished' }
  source.screens.reconcile('space')
  expect(cards().find(card => card.id === stopped)?.closed).toBe('The agent stopped')
  terminal = { ...terminal, state: 'live' }
  screen = THEME
  await settle(started + 40_000)
  const replaced = open().id
  source.store.set('agent', 'space', { ...agent, launch: 'two' })
  source.screens.reconcile('space')
  expect(cards().find(card => card.id === replaced)?.closed).toBe('Session replaced')
  await expect(source.act({ type: 'answer', chat: 'space', question: replaced, choice: 0 })).rejects.toThrow('no longer waiting')
})

test('a new code on the same screen comes as a new card; a running timer does not', async () => {
  screen = 'Enter this code: 1234\n'
  await settle(started + 30_000)
  const id = open().id
  screen = 'Enter this code: 5678\n'
  await settle(started + 40_000)
  expect(cards()).toHaveLength(2)
  expect(cards().find(card => card.id === id)?.closed).toBe('The screen changed')
  expect(open().screen).toBe('Enter this code: 5678')
  screen = 'Enter this code: 5678 · 11\n'
  await source.screens.tick(started + 50_000)
  screen = 'Enter this code: 5678 · 13\n'
  await source.screens.tick(started + 52_000)
  expect(open().screen).toBe('Enter this code: 5678')
})

test('one machine that doesn\'t answer holds up no other agent', async () => {
  source.store.set('agent', 'other', { ...agent, chat: 'other', launch: 'other' })
  const read = source.core.call as (method: string, params: { terminal: string }) => Promise<unknown>
  source.core.call = ((method: string, params: { terminal: string }) => params.terminal === 'late' ? new Promise(() => {}) : read(method, params)) as typeof source.core.call
  source.agents.terminal = found => found.chat === 'space' ? { ...terminal, address: 'late' } : terminal
  void source.screens.tick(started + 10_000)
  await Bun.sleep(5)
  void source.screens.tick(started + 12_000)
  await Bun.sleep(5)
  expect(source.store.all<Message>('message:other').filter(message => message.question)).toHaveLength(1)
})

test('an open card closes on the next poll when its terminal has ended', async () => {
  await settle()
  const id = open().id
  terminal = { ...terminal, state: 'finished' }
  await source.screens.tick(started + 20_000)
  expect(cards().find(card => card.id === id)?.closed).toBe('The agent stopped')
})

test('with no choices to read it is still a card, for the terminal', async () => {
  screen = 'Paste code here if prompted >\n'
  await settle(started + 30_000)
  expect(open()).toMatchObject({ choices: [], terminal: true })
  await expect(source.act({ type: 'answer', chat: 'space', question: open().id, choice: 0 })).rejects.toThrow('answers')
})
