import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CoreSource } from '../server/core/source.ts'
import { toolHash } from '../server/core/envelope.ts'
import { pilotHook } from '../server/core/pilot-hook.ts'
import { hookEnd, logEnd, NativeEnds } from '../server/core/native-ends.ts'
import { ClaudeReader } from '../server/common/readers/claude.ts'
import { pushPayload } from '../shared/alerts.ts'
import type { PermissionAnswer } from '../server/core/native-asks.ts'
import type { LogEvent } from '../server/common/readers/types.ts'
import type { AgentHook, CoreAgent } from '../server/core/model.ts'
import type { Grant, MailRequest } from '../server/core/mailbox.ts'
import type { Alert } from '../shared/types.ts'

const chat = 'EX-1/Agent', input = { command: 'rm -rf build' }
function fixture(kind: 'claude' | 'codex' = 'claude') {
  const home = mkdtempSync(join(tmpdir(), 'core-native-ends-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.core.current.connected = true
  source.machineConnected = () => true
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', prefix: 'EX', mode: 'regular', added: 1 })
  source.store.set('agent', chat, { chat, space: 'space', machine: 'machine', role: 'task', kind, launch: 'one', grant: 'current', state: 'working', started: 1, hook: '/unused' })
  source.store.set('task', 'EX-1', { id: 'EX-1', chat, place: 'space', machine: 'machine', name: 'Example', folder: '/unused', workflow: 'working', review: { on: false }, age: 'now', created: new Date().toISOString(), kind })
  const agent = () => source.store.get<CoreAgent>('agent', chat)!
  const ask = (args: { tool?: string; input?: unknown; at?: number; agent?: string; turn?: string } = {}) => {
    const id = randomUUID()
    const reply = source.requestPermission(agent(), { id: 'current', chat } as Grant, { args: { id, tool: 'Bash', input, at: Date.now(), ...args }, expires: Date.now() + 60_000 } as unknown as MailRequest, id) as Promise<PermissionAnswer> | PermissionAnswer
    return { id, reply: Promise.resolve(reply) }
  }
  const hook = (event: Omit<AgentHook, 'id' | 'at'> & { at?: number }) => source.agents.hook(agent(), { id: randomUUID(), at: Date.now() + 1, ...event })
  const called = (use: string, value: unknown = input, tool = 'Bash', at = Date.now() - 1) => hook({ event: 'PreToolUse', tool, use, input: toolHash(value), at })
  const log = (event: LogEvent) => (source as unknown as { logs: { apply(agent: CoreAgent, event: LogEvent): void } }).logs.apply(agent(), event)
  const card = (id: string) => source.chat(chat)!.messages.find(message => message.question?.id === id)!.question!
  const forwarded = (id: string) => source.chat('space')?.messages.find(message => message.card?.ask?.questions?.some(question => question.id === id))?.card
  return { source, ask, hook, called, log, card, forwarded, agent, open: () => source.openPermissions(agent()), close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}
type Fixture = ReturnType<typeof fixture>
const closed = async (f: Fixture, id: string, reply: Promise<PermissionAnswer>, reason: string) => {
  expect((await reply).allow).toBe(false)
  expect(f.card(id).closed).toBe(reason)
  expect(f.open()).toHaveLength(0)
}

test('the card goes with its own tool call, whichever record says so first, and a parallel call leaves it waiting', async () => {
  const f = fixture()
  try {
    f.called('call')
    f.called('parallel', { command: 'date' })
    const { id, reply } = f.ask()
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'parallel' })
    f.log({ kind: 'step-end', id: 'parallel', at: Date.now() + 1 })
    expect(f.open()).toHaveLength(1)
    expect(f.source.status(f.agent())).toBe('need')
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'call' })
    await closed(f, id, reply, 'Answered in the terminal')
    expect(f.source.status(f.agent())).toBe('work')
    expect(f.agent()).toMatchObject({ state: 'working', activityAt: expect.any(Number) })
    expect(f.agent().permission).toBeUndefined()
  } finally { f.close() }
})

test('a real waiting card stays open whatever else the agent records', async () => {
  const f = fixture()
  try {
    f.called('call')
    const { id } = f.ask({ turn: 'turn-1' })
    f.hook({ event: 'PreToolUse', tool: 'Read', use: 'read', input: toolHash({ file: 'a' }) })
    f.hook({ event: 'Notification' })
    f.hook({ event: 'PostToolUse', tool: 'Read', use: 'read' })
    f.hook({ event: 'UserPromptSubmit', turn: 'turn-1' })
    f.log({ kind: 'turn-start', id: 'start', at: Date.now() + 1 })
    f.log({ kind: 'step', id: 'read', at: Date.now() + 1, step: 'read', tool: 'Read', title: 'Read', doing: 'Read', target: 'a' })
    expect(f.open().map(item => item.id)).toEqual([id])
    expect(f.card(id).sent).toBeUndefined()
  } finally { f.close() }
})

test('two cards of the same command each need their own result, whichever ends first', async () => {
  const f = fixture()
  try {
    f.called('first'); f.called('second')
    const first = f.ask({ at: Date.now() - 1 }), second = f.ask()
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'second' })
    f.log({ kind: 'step-end', id: 'second', at: Date.now() + 1 })
    await second.reply
    expect(f.open().map(item => item.id)).toEqual([first.id])
    f.log({ kind: 'step-end', id: 'first', at: Date.now() + 1 })
    await closed(f, first.id, first.reply, 'Answered in the terminal')
  } finally { f.close() }
})

test('a finished run of the same command does not stand for the card that asks to run it again', () => {
  const f = fixture()
  try {
    const at = Date.now()
    f.called('old', input, 'Bash', at - 3)
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'old', at: at - 2 })
    f.called('new', input, 'Bash', at - 1)
    const { id } = f.ask({ at })
    f.log({ kind: 'step-end', id: 'old', at: at + 1 })
    expect(f.open().map(item => item.id)).toEqual([id])
  } finally { f.close() }
})

test('what the transcript says gives the honest line: timed out, declined, or a turn that went on', async () => {
  for (const [event, reason] of [
    [{ kind: 'step-end', id: 'call', failed: true, refused: 'cli' }, 'Timed out in the CLI and was denied'],
    [{ kind: 'step-end', id: 'call', failed: true, refused: 'you' }, 'Declined or interrupted in the terminal'],
    [{ kind: 'turn-end', id: 'turn', aborted: true }, 'Interrupted in the terminal'],
    [{ kind: 'turn-end', id: 'turn' }, 'The agent moved on in the terminal'],
  ] as [Omit<LogEvent, 'at'>, string][]) {
    const f = fixture()
    try {
      f.called('call')
      const { id, reply } = f.ask({ at: Date.now() - 5 })
      f.log({ ...event, at: Date.now() + 1 } as LogEvent)
      await closed(f, id, reply, reason)
      expect(f.source.status(f.agent())).not.toBe('need')
    } finally { f.close() }
  }
})

test('a turn that ended before the card does not close it', () => {
  const f = fixture()
  try {
    const at = Date.now(), { id } = f.ask({ at })
    f.log({ kind: 'turn-end', id: 'old', at: at - 1 })
    f.hook({ event: 'Stop', at: at - 1 })
    expect(f.open().map(item => item.id)).toEqual([id])
  } finally { f.close() }
})

test('the main turn does not end a helper’s card: its own stop does', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask({ agent: 'helper' })
    f.hook({ event: 'Stop' })
    f.log({ kind: 'turn-end', id: 'turn', at: Date.now() + 1 })
    f.hook({ event: 'SubagentStop', agent: 'other' })
    expect(f.open()).toHaveLength(1)
    f.hook({ event: 'SubagentStop', agent: 'helper' })
    await closed(f, id, reply, 'The agent moved on in the terminal')
  } finally { f.close() }
})

test('a helper’s tool result closes its card though its hook says nothing about the parent', async () => {
  const f = fixture()
  try {
    f.hook({ event: 'PreToolUse', tool: 'Bash', use: 'call', input: toolHash(input), agent: 'helper', at: Date.now() - 1 })
    const { id, reply } = f.ask({ agent: 'helper' })
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'call', agent: 'helper' })
    await closed(f, id, reply, 'Answered in the terminal')
  } finally { f.close() }
})

test('a helper finishing the same command leaves the parent’s card open, and the other way round', async () => {
  const f = fixture()
  try {
    f.called('parent')
    f.hook({ event: 'PreToolUse', tool: 'Bash', use: 'helper', input: toolHash(input), agent: 'one', at: Date.now() - 1 })
    const { id, reply } = f.ask()
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'helper', agent: 'one' })
    expect(f.open().map(item => item.id)).toEqual([id])
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'parent' })
    await closed(f, id, reply, 'Answered in the terminal')
  } finally { f.close() }
})

test('an isolated agent’s hooks keep what ties a result to its card', () => {
  expect(pilotHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'call', turn_id: 'turn', tool_hash: toolHash(input) }, randomUUID(), 'codex', '/home', '/captures'))
    .toMatchObject({ use: 'call', turn: 'turn', input: toolHash(input), tool: 'Bash' })
  expect(pilotHook({ hook_event_name: 'PermissionRequest', prompt_id: 'prompt', tool_input: input }, randomUUID(), 'claude', '/home', '/captures')).toMatchObject({ turn: 'prompt', input: toolHash(input) })
})

test('a Codex turn that ends by itself leaves its card waiting, until something typed or an Esc says otherwise', async () => {
  for (const [ending, reason] of [
    [f => { f.hook({ event: 'UserPromptSubmit', turn: 'turn-1' }); f.hook({ event: 'Stop' }) }, 'The agent moved on in the terminal'],
    [f => f.log({ kind: 'turn-end', id: 'turn', aborted: true, at: Date.now() + 1 }), 'Interrupted in the terminal'],
  ] as [(f: Fixture) => void, string][]) {
    const f = fixture('codex')
    try {
      f.called('call')
      const { id, reply } = f.ask({ at: Date.now() - 5, turn: 'turn-1' })
      f.hook({ event: 'Stop' })
      f.log({ kind: 'turn-end', id: 'turn', at: Date.now() + 1 })
      expect(f.open().map(item => item.id)).toEqual([id])
      expect(f.source.status(f.agent())).toBe('need')
      ending(f)
      await closed(f, id, reply, reason)
    } finally { f.close() }
  }
})

test('text typed after a Codex turn ended by itself does not reach back to that end', () => {
  const f = fixture('codex'), at = Date.now()
  try {
    const { id } = f.ask({ at, turn: 'turn-1' })
    f.hook({ event: 'Stop', at: at + 1 })
    f.hook({ event: 'UserPromptSubmit', turn: 'turn-1', at: at + 2 })
    expect(f.open().map(item => item.id)).toEqual([id])
  } finally { f.close() }
})

test('a new prompt ends the turn the card was in, on Codex too', async () => {
  const f = fixture('codex')
  try {
    const { id, reply } = f.ask({ turn: 'turn-1' })
    f.hook({ event: 'UserPromptSubmit', turn: 'turn-2' })
    await closed(f, id, reply, 'The agent moved on in the terminal')
  } finally { f.close() }
})

test('a hook the CLI stopped closes the card and clears everything with it', async () => {
  const f = fixture()
  try {
    const alerts: Alert[] = []
    f.source.on('alert', alert => alerts.push(alert))
    const { id, reply } = f.ask()
    expect(f.source.snapshot().needs.filter(need => need.chat === chat).map(need => need.id)).toEqual([id])
    expect(f.forwarded(id)?.ask?.open).toBe(true)
    f.source.agents.terminal = (() => ({ state: 'live' })) as unknown as typeof f.source.agents.terminal
    await (f.source as unknown as { mail(grant: Grant, request: MailRequest, id: string): Promise<unknown> }).mail({ id: 'current', chat, session: 'one', machine: 'machine', actions: ['permission'] } as Grant, { action: 'permission', args: { cancel: id } } as unknown as MailRequest, randomUUID())
    await closed(f, id, reply, 'Declined or interrupted in the terminal')
    expect(f.source.snapshot().needs.filter(need => need.chat === chat)).toEqual([])
    expect(f.source.snapshot().asks[chat]).toBeUndefined()
    expect(f.forwarded(id)).toMatchObject({ text: 'No longer waiting', ask: { open: false } })
    expect(f.source.tasks.view(f.source.tasks.get('EX-1')!).status).toBe('work')
    expect(alerts.find(alert => alert.clear)).toMatchObject({ tag: chat, body: 'Declined or interrupted in the terminal' })
  } finally { f.close() }
})

test('an answer tapped on a closed card fails with why, and one tapped just before reads the records first', async () => {
  const f = fixture()
  try {
    f.called('call')
    const { id, reply } = f.ask()
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'call' })
    await reply
    await expect(f.source.act({ type: 'answer', chat, question: id, choice: 0 })).rejects.toThrow('This card has closed: Answered in the terminal')
    expect(f.source.store.get<{ allow: boolean }>('permission', id)?.allow).toBe(false)

    const late = f.ask()
    f.source.logs.catchUp = async () => { f.hook({ event: 'Stop' }) }
    await expect(f.source.act({ type: 'answer', chat, question: late.id, choice: 0 })).rejects.toThrow('This card has closed')
    expect((await late.reply).allow).toBe(false)
  } finally { f.close() }
})

test('what ended a card before it arrived still closes it, after a reconnect', async () => {
  const f = fixture()
  try {
    const at = Date.now()
    f.called('call', input, 'Bash', at - 2)
    f.hook({ event: 'PostToolUse', tool: 'Bash', use: 'call', at: at + 1 })
    const { id, reply } = f.ask({ at })
    await closed(f, id, reply, 'Answered in the terminal')
  } finally { f.close() }
})

test('a card of several questions whose end came first closes whole, and nothing says it waits', async () => {
  const f = fixture()
  try {
    const alerts: Alert[] = [], at = Date.now(), asked = { questions: [{ question: 'One?', options: [{ label: 'A' }] }, { question: 'Two?', options: [{ label: 'B' }] }] }
    f.source.on('alert', alert => alerts.push(alert))
    f.called('call', asked, 'AskUserQuestion', at - 2)
    f.hook({ event: 'PostToolUse', tool: 'AskUserQuestion', use: 'call', at: at + 1 })
    const { id, reply } = f.ask({ at, tool: 'AskUserQuestion', input: asked })
    await reply
    for (const card of [id, `${id}-1`]) {
      expect(f.card(card).closed).toBe('Answered in the terminal')
      expect(f.forwarded(card)?.ask?.open).toBe(false)
    }
    expect(f.open()).toHaveLength(0)
    expect(f.agent().state).toBe('working')
    expect(alerts.filter(alert => !alert.clear)).toHaveLength(0)
  } finally { f.close() }
})

test('reading the hook line after its card closed leaves no wait behind, and a stopped turn stays stopped', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask()
    f.source.cancelPermission({ id: 'current', chat } as Grant, id)
    await reply
    f.hook({ event: 'PermissionRequest', tool: 'Bash' })
    expect(f.agent().state).toBe('working')
    expect(f.source.status(f.agent())).toBe('work')
    const second = f.ask()
    f.hook({ event: 'Stop' })
    await second.reply
    expect(f.agent().state).toBe('idle')
    expect(f.source.status(f.agent())).toBe('idle')
  } finally { f.close() }
})

test('a killed agent’s card closes', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask()
    f.source.agents.terminal = (() => ({ state: 'finished' })) as unknown as typeof f.source.agents.terminal
    f.hook({ event: 'Notification' })
    await closed(f, id, reply, 'Agent stopped; ask again after restarting it')
    expect(f.source.status(f.agent())).toBe('idle')
  } finally { f.close() }
})

test('a restart closes open cards and says in the chat and to the agent what was denied, and that nobody refused it', async () => {
  const f = fixture()
  try {
    const sent: string[] = []
    f.source.agents.terminal = (() => ({ state: 'live' })) as unknown as typeof f.source.agents.terminal
    f.source.tasks.deliver = (async (_id: string, _chat: string, text: string) => { sent.push(text) }) as unknown as typeof f.source.tasks.deliver
    const first = f.ask({ input: { command: 'git   push\n origin', description: 'Push' } }), second = f.ask({ tool: 'Write', input: { file_path: 'notes.txt', content: 'x' } })
    f.source.store.set('permission', 'gone', { id: 'gone', chat, grant: 'older', tool: 'Bash', expires: Date.now() + 60_000, question: { id: 'gone', title: 'Old session', kind: 'Question', choices: [] } })
    ;(f.source as unknown as { closeInterrupted(): void }).closeInterrupted()
    await closed(f, first.id, first.reply, 'Shepherdr restarted; ask again')
    await closed(f, second.id, second.reply, 'Shepherdr restarted; ask again')
    const lines = f.source.chat(chat)!.messages.filter(message => message.id.startsWith('restart-denied-'))
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('Run: git push origin; Write: notes.txt')
    expect(lines[0].text).toContain('nobody refused it')
    expect(lines[0].text).not.toContain('Old session')
    await Bun.sleep(0)
    expect(sent).toEqual([`<restart>${lines[0].text}</restart>`])
    expect(f.source.chat(chat)!.messages.filter(message => message.id.startsWith('delivery-'))).toHaveLength(0)
  } finally { f.close() }
})

test('a restart names a tool call once, even with its first question answered already', async () => {
  const f = fixture()
  try {
    const sent: string[] = []
    f.source.agents.terminal = (() => ({ state: 'live' })) as unknown as typeof f.source.agents.terminal
    f.source.tasks.deliver = (async (_id: string, _chat: string, text: string) => { sent.push(text) }) as unknown as typeof f.source.tasks.deliver
    const options = [{ label: 'One' }, { label: 'Two' }]
    const { id, reply } = f.ask({ tool: 'AskUserQuestion', input: { questions: [{ question: 'First?', options }, { question: 'Second?', options }, { question: 'Third?', options }] } })
    await f.source.act({ type: 'answer', chat, question: id, choice: 0 })
    ;(f.source as unknown as { closeInterrupted(): void }).closeInterrupted()
    expect((await reply).allow).toBe(false)
    const lines = f.source.chat(chat)!.messages.filter(message => message.id.startsWith('restart-denied-'))
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('Second?')
    expect(lines[0].text).not.toContain('Third?')
    await Bun.sleep(0)
    expect(sent).toEqual([`<restart>${lines[0].text}</restart>`])
  } finally { f.close() }
})

test('a change in core closes a card of every kind at once', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask()
    const question = f.source.questions.create({ id: 'current', chat } as Grant, ['ask', 'Which?', '--choice', 'A'])
    f.source.store.set('secret-request', 'secret', { id: 'secret', chat, grant: 'current', ask: { id: 'secret', name: 'API_KEY', levels: [{ id: 'all', label: 'Everywhere' }] } })
    f.source.store.set('screen-card', 'screen', { id: 'screen', chat, launch: 'one', screen: 'seen', question: { id: 'screen', title: 'On its screen', kind: 'Question', choices: [] }, state: 'open', at: 1 })
    f.source.store.set('agent', chat, { ...f.agent(), state: 'starting' })
    f.source.store.set('task', 'EX-1', { ...f.source.tasks.get('EX-1')!, workflow: 'merged' })
    f.source.agents.terminal = (() => ({ state: 'finished' })) as unknown as typeof f.source.agents.terminal
    ;(f.source.core as unknown as { publish(): void }).publish()
    await closed(f, id, reply, 'Agent stopped; ask again after restarting it')
    expect(f.card(question).closed).toBe('The task is done')
    expect(f.card('screen').closed).toBe('The agent stopped')
    expect(f.source.secrets.open(chat)).toHaveLength(0)
  } finally { f.close() }
})

test('a question and a secret stay open while the human can still answer, and close once the task is done', () => {
  const f = fixture()
  try {
    const grant = { id: 'current', chat } as Grant
    const question = f.source.questions.create(grant, ['ask', 'Which?', '--choice', 'A'])
    f.source.store.set('secret-request', 'secret', { id: 'secret', chat, grant: 'current', ask: { id: 'secret', name: 'API_KEY', levels: [{ id: 'all', label: 'Everywhere' }] } })
    f.source.questions.reconcile(chat); f.source.secrets.reconcile(chat)
    expect(f.source.status(f.agent())).toBe('need')
    f.source.store.set('task', 'EX-1', { ...f.source.tasks.get('EX-1')!, workflow: 'merged' })
    f.source.questions.reconcile(chat); f.source.secrets.reconcile(chat)
    expect(f.card(question).closed).toBe('The task is done')
    expect(f.source.secrets.open(chat)).toHaveLength(0)
    expect(f.source.snapshot().needs.filter(need => need.chat === chat)).toEqual([])
  } finally { f.close() }
})

test('a secret given in Settings answers its open card', async () => {
  const f = fixture()
  try {
    f.source.saveAndDeliver = ((_chat: string, _id: string, _text: string, save: () => void) => { save() }) as typeof f.source.saveAndDeliver
    f.source.store.set('secret-request', 'secret', { id: 'secret', chat, grant: 'current', ask: { id: 'secret', name: 'API_KEY', levels: [{ id: 'all', label: 'Everywhere' }] } })
    await f.source.secrets.act({ type: 'secret', level: 'all', name: 'API_KEY', value: 'value' })
    expect(f.source.secrets.open(chat)).toHaveLength(0)
  } finally { f.close() }
})

test('the evidence helpers read Claude’s and Codex’s own words', () => {
  const reader = new ClaudeReader(), file = '/log.jsonl', stamp = '2026-10-31T10:00:00.000Z'
  const line = (value: unknown, offset: number) => ({ text: JSON.stringify(value), offset })
  const parse = (content: string, id: string, is_error: boolean, offset: number) => reader.parse([
    line({ type: 'assistant', uuid: `a${id}`, sessionId: 's', timestamp: stamp, message: { role: 'assistant', model: 'claude', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'rm -rf ~/' } }] } }, offset),
    line({ type: 'user', uuid: `u${id}`, sessionId: 's', timestamp: stamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] } }, offset + 1),
  ], file).find(event => event.kind === 'step-end')!
  expect(logEnd(parse('Permission for this command was denied by a built-in Claude Code safety check, not by the user.', 'x', true, 0))?.reason).toBe('Timed out in the CLI and was denied')
  expect(logEnd(parse("The user doesn't want to proceed with this tool use.", 'y', true, 2))?.reason).toBe('Declined or interrupted in the terminal')
  expect(logEnd(parse('done', 'z', false, 4))?.reason).toBe('Answered in the terminal')
  expect(hookEnd({ id: 'a', event: 'PreToolUse', at: 1, use: 'x' })).toBeUndefined()
  expect(hookEnd({ id: 'a', event: 'PostToolUse', at: 1 })).toBeUndefined()
  expect(hookEnd({ id: 'a', event: 'Notification', at: 1 })).toBeUndefined()
})

test('kept evidence is bounded and a call matches only its own tool and input', () => {
  const ends = new NativeEnds()
  for (let index = 0; index < 200; index++) { ends.called('launch', `use-${index}`, { tool: 'Bash', hash: 'h' }); ends.ended('launch', { at: 2, use: `use-${index}`, reason: 'old' }) }
  ends.called('launch', 'mine', { tool: 'Bash', hash: 'mine' }); ends.ended('launch', { at: 3, use: 'mine', reason: 'mine' })
  expect(ends.over('launch', { id: 'a', at: 1, tool: 'Bash', hash: 'other' })).toBeUndefined()
  expect(ends.over('other-launch', { id: 'a', at: 1, tool: 'Bash', hash: 'mine' })).toBeUndefined()
  expect(ends.over('launch', { id: 'a', at: 1, tool: 'Bash', hash: 'mine' })).toBe('mine')
  expect(ends.over('launch', { id: 'b', at: 1, tool: 'Bash', hash: 'mine' })).toBeUndefined()
})

test('a clearing alert says so to the service worker, with what still waits', () => {
  const payload = pushPayload({ id: 'a', from: 'Shepherdr', title: 'No longer waiting', body: 'Why', go: { place: 'space' }, tag: chat, clear: true }, { count: 0, tags: [] })
  expect(payload).toMatchObject({ clear: true, badge: 0, open: [], tag: chat })
})
