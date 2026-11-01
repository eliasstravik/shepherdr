import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { CoreSource } from '../server/core/source.ts'
import { nativeAnswer, nativeCards, permissionChoices, permissionWords, type PermissionAnswer } from '../server/core/native-asks.ts'
import { toolHash } from '../server/core/envelope.ts'
import type { AgentHook, CoreAgent } from '../server/core/model.ts'
import type { LogEvent } from '../server/common/readers/types.ts'
import { words } from '../shared/activity.ts'
import type { Grant, MailRequest } from '../server/core/mailbox.ts'

const chat = 'EX-1/Agent'
function fixture(kind: 'claude' | 'codex' = 'claude', permissionMode?: string) {
  const home = mkdtempSync(join(tmpdir(), 'core-native-asks-'))
  const source = new CoreSource({ home, port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  source.store.set('space', 'space', { id: 'space', name: 'Example', machine: 'machine', folder: '/unused', prefix: 'EX', mode: 'regular', added: 1 })
  source.store.set('agent', chat, { chat, space: 'space', machine: 'machine', role: 'task', kind, launch: 'one', grant: 'current', state: 'working', started: 1, hook: '/unused', permissionMode })
  source.store.set('task', 'EX-1', { id: 'EX-1', chat, place: 'space', machine: 'machine', name: 'Example', folder: '/unused', workflow: 'todo', review: { on: false }, age: 'now', created: new Date().toISOString(), kind })
  const ask = (tool: string, input: unknown, at = Date.now(), suggestions?: unknown) => {
    const id = randomUUID(), agent = source.store.get<CoreAgent>('agent', chat)!
    const reply = source.requestPermission(agent, { id: 'current', chat } as Grant, { args: { id, tool, input, at, suggestions }, expires: Date.now() + 60_000 } as unknown as MailRequest, id) as Promise<PermissionAnswer> | PermissionAnswer
    return { id, reply: Promise.resolve(reply) }
  }
  return { source, ask, close() { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) } }
}
const fruit = { questions: [{ question: 'Which fruit?', options: [{ label: 'Pear', description: 'Green' }, { label: 'Plum' }], multiSelect: false }] }
const answer = (question: string, choice: number, extra = {}) => ({ type: 'answer' as const, chat, question, choice, ...extra })
const plan = { plan: '# Add a file\n\n1. Write it' }
const open = (f: ReturnType<typeof fixture>) => f.source.openPermissions(f.source.store.get<CoreAgent>('agent', chat)!)

test('a Claude question is a normal choice card and its pick goes back as the tool answer', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask('AskUserQuestion', fruit)
    const card = f.source.chat(chat)!.messages.find(message => message.question)!.question!
    expect(card).toMatchObject({ title: 'Which fruit?', kind: 'Question', other: true, choices: [{ label: 'Pear', description: 'Green' }, { label: 'Plum' }] })
    expect(card.screen).toBeUndefined()
    await f.source.act(answer(id, 0))
    expect(await reply).toEqual({ allow: true, updatedInput: { ...fruit, answers: { 'Which fruit?': 'Pear' } } })
    expect(open(f)).toHaveLength(0)
  } finally { f.close() }
})

test('every question of a call is answered before Claude hears, several picks joined and a typed answer kept', async () => {
  const f = fixture()
  try {
    const input = { questions: [fruit.questions[0], { question: 'Which sides?', options: [{ label: 'Salad' }, { label: 'Soup' }, { label: 'Rice' }], multiSelect: true }, { question: 'Why?', options: [{ label: 'Hunger' }] }] }
    const { id, reply } = f.ask('AskUserQuestion', input)
    let done = false
    void reply.then(() => { done = true })
    await f.source.act(answer(`${id}-1`, 0, { choices: [0, 2] }))
    await f.source.act(answer(id, 1))
    await Bun.sleep(1)
    expect(done).toBe(false)
    expect(open(f)).toHaveLength(1)
    await f.source.act(answer(`${id}-2`, -1, { other: 'Lunch' }))
    expect((await reply).updatedInput?.answers).toEqual({ 'Which fruit?': 'Plum', 'Which sides?': 'Salad, Rice', 'Why?': 'Lunch' })
    const card = f.source.chat(chat)!.messages.find(message => message.question?.id === `${id}-2`)!.question!
    expect(card).toMatchObject({ sent: -1, said: 'Lunch' })
    expect(card.closed).toBeUndefined()
  } finally { f.close() }
})

test('a plan is the Plan to approve card with Claude’s real choices, and each answers through the hook', async () => {
  const f = fixture('claude', 'auto')
  try {
    const first = f.ask('ExitPlanMode', plan)
    expect(f.source.chat(chat)!.messages.find(message => message.question)!.question).toMatchObject({ title: 'Plan to approve', kind: 'Plan', plan: plan.plan, noteRequiredFor: 2,
      choices: [{ label: 'Approve, stop asking' }, { label: 'Approve, keep asking' }, { label: 'Change the plan' }] })
    await expect(f.source.act(answer(first.id, 2))).rejects.toThrow('note')
    await f.source.act(answer(first.id, 2, { note: 'Use a table' }))
    const changed = await first.reply
    expect(changed.allow).toBe(false)
    expect(changed.message).toContain('Use a table')
    expect(changed.updatedInput).toBeUndefined()

    const second = f.ask('ExitPlanMode', plan)
    await f.source.act(answer(second.id, 0, { note: 'Keep it short' }))
    const approved = await second.reply
    expect(approved.updatedInput?.plan).toStartWith(plan.plan)
    expect(approved.updatedInput?.plan).toContain('Keep it short')
    expect(approved.updatedPermissions).toEqual([{ type: 'setMode', mode: 'auto', destination: 'session' }])

    const third = f.ask('ExitPlanMode', plan)
    await f.source.act(answer(third.id, 1))
    expect(await third.reply).toEqual({ allow: true, updatedInput: plan, updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }] })
  } finally { f.close() }
})

test('stop asking keeps the mode the agent ran on, or edits for a device that asks', () => {
  const stop = (mode?: string) => nativeCards('ExitPlanMode', plan, 'id', mode)!.native.stop
  expect([stop('auto'), stop('bypassPermissions'), stop('default'), stop(undefined)]).toEqual(['auto', 'bypassPermissions', 'acceptEdits', 'acceptEdits'])
})

test('a question without options still takes a typed answer', () => {
  const [question] = nativeCards('AskUserQuestion', { questions: [{ question: 'Which colour?' }] }, 'id')!.questions
  expect(question.choices).toEqual([])
  expect(nativeAnswer(question, answer('id', -1, { other: 'Blue' })).said).toBe('Blue')
})

test('a card only takes an answer it offered', () => {
  const question = nativeCards('AskUserQuestion', fruit, 'id')!.questions[0]
  expect(() => nativeAnswer(question, answer('id', 5))).toThrow('Choose one')
  expect(() => nativeAnswer(question, answer('id', 0, { choices: [0, 1] }))).toThrow('Choose one')
  expect(nativeAnswer(question, answer('id', -1, { other: ' Quince ' }))).toEqual({ allow: true, sent: -1, said: 'Quince' })
})

test('other tools and other CLIs stay permissions, and an unreadable question reaches no one', async () => {
  expect(nativeCards('Bash', { command: 'ls' }, 'id')).toBeUndefined()
  const f = fixture()
  try {
    const { reply } = f.ask('AskUserQuestion', { questions: [{ options: [{ label: 'No question' }] }] })
    expect((await reply).allow).toBe(false)
    expect(f.source.store.all('permission')).toHaveLength(0)
  } finally { f.close() }
  const codex = fixture('codex')
  try {
    const { id, reply } = codex.ask('AskUserQuestion', fruit)
    expect(codex.source.chat(chat)!.messages.find(message => message.question)!.question!.choices.map(choice => choice.label)).toEqual(['Allow once', 'Deny'])
    await codex.source.act(answer(id, 0))
    expect(await reply).toEqual({ allow: true })
  } finally { codex.close() }
})

test('a question closed unanswered tells Claude so, and one card closing closes the call', async () => {
  const f = fixture()
  try {
    const { id, reply } = f.ask('AskUserQuestion', { questions: [fruit.questions[0], { question: 'Why?', options: [{ label: 'Hunger' }] }] })
    await f.source.act(answer(id, 0))
    f.source.denyPermissions(f.source.store.get<CoreAgent>('agent', chat)!, 'Task restarted')
    const closed = await reply
    expect(closed.allow).toBe(false)
    expect(closed.message).toContain('Task restarted')
    expect(open(f)).toHaveLength(0)
  } finally { f.close() }
})

test('an answer in the terminal closes the card, and earlier hooks do not', async () => {
  const f = fixture()
  try {
    const at = Date.now()
    const { reply } = f.ask('ExitPlanMode', plan, at)
    const hook = (event: AgentHook) => f.source.agents.hook(f.source.store.get<CoreAgent>('agent', chat)!, event)
    hook({ id: 'called', event: 'PreToolUse', tool: 'ExitPlanMode', use: 'plan-call', input: toolHash(plan), at: at - 2 })
    hook({ id: 'old', event: 'PostToolUse', tool: 'ExitPlanMode', use: 'plan-call', at: at - 1 })
    hook({ id: 'other', event: 'PostToolUse', tool: 'Bash', use: 'other-call', at: at + 1 })
    expect(open(f)).toHaveLength(1)
    hook({ id: 'done', event: 'PostToolUse', tool: 'ExitPlanMode', use: 'plan-call', at: at + 2 })
    expect((await reply).allow).toBe(false)
    const card = f.source.chat(chat)!.messages.find(message => message.question)!.question!
    expect(card.closed).toBe('Answered in the terminal')
  } finally { f.close() }
})

const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'curl -sI https://example.com' }], behavior: 'allow', destination: 'localSettings' }

test('a permission card says what it would do in words, whole, never as code', () => {
  expect(permissionWords('Bash', { command: 'touch hello.txt', description: 'Create empty hello.txt' })).toEqual({ title: 'Run: touch hello.txt', screen: 'Create empty hello.txt' })
  const long = `printf one\n${'x'.repeat(200)}`, cut = permissionWords('Bash', { command: long })
  expect(cut.title.length).toBeLessThan(130)
  expect(cut.screen).toBe(long)
  expect(permissionWords('Write', { file_path: '/w/a/b.txt', content: 'hi' })).toEqual({ title: 'Write: b.txt', screen: '/w/a/b.txt\n\nhi' })
  expect(permissionWords('Edit', { file_path: '/w/b.txt', old_string: 'a', new_string: 'b' })).toEqual({ title: 'Edit: b.txt', screen: '/w/b.txt\n\n- a\n+ b' })
  expect(permissionWords('WebFetch', { url: 'https://example.com/', prompt: 'Sum it up' })).toEqual({ title: 'Open: https://example.com/', screen: 'Sum it up' })
  expect(permissionWords('mcp__github__create_pull_request', { repo: 'a/b', draft: true, labels: ['x'] })).toEqual({ title: 'Use create pull request', screen: 'repo: a/b\ndraft: true\nlabels: ["x"]' })
  expect(permissionWords(undefined, undefined)).toEqual({ title: 'Use a tool', screen: undefined })
})

test('the CLI\'s own grants become one choice between Allow once and Deny, each said in words', () => {
  expect(permissionChoices(undefined)).toEqual({ choices: [{ label: 'Allow once' }, { label: 'Deny' }] })
  expect(permissionChoices([rule]).choices.map(choice => choice.description ?? choice.label)).toEqual(['Allow once', 'Run curl -sI https://example.com in this project', 'Deny'])
  const said = (grant: unknown) => permissionChoices([grant]).choices[1].description
  expect(said({ type: 'addRules', rules: [{ toolName: 'WebFetch', ruleContent: 'domain:example.com' }], behavior: 'allow', destination: 'localSettings' })).toBe('example.com in this project')
  expect(said({ type: 'addRules', rules: [{ toolName: 'Read', ruleContent: '//etc/**' }], behavior: 'allow', destination: 'session' })).toBe('Read /etc this session')
  expect(said({ type: 'setMode', mode: 'acceptEdits', destination: 'session' })).toBe('All edits this session')
  expect(said({ type: 'addDirectories', directories: ['/w'], destination: 'session' })).toBe('Files in /w this session')
  // What the card can't say it doesn't offer.
  for (const grant of [{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }, { ...rule, behavior: 'deny' }, { ...rule, destination: 'elsewhere' }, { type: 'removeRules' }, 'text', { ...rule, rules: [{ toolName: 'Bash', ruleContent: 'x'.repeat(2000) }] }])
    expect(permissionChoices([grant]).choices).toHaveLength(2)
})

test('Don\'t ask again hands the CLI its own grants, for that reply alone; the alert offers only Allow once and Deny', async () => {
  const f = fixture()
  try {
    const alerts: { card?: { choices: { label: string }[] } }[] = []
    f.source.on('alert', alert => alerts.push(alert as typeof alerts[number]))
    const again = f.ask('Bash', { command: 'curl -sI https://example.com' }, Date.now(), [rule, { type: 'somethingNew' }])
    expect(f.source.chat(chat)!.messages.find(message => message.question)!.question).toMatchObject({ title: 'Run: curl -sI https://example.com', always: 1, kind: 'Question', noNote: true })
    expect(alerts[0].card!.choices.map(choice => choice.label)).toEqual(['Allow once', 'Deny'])
    await f.source.act(answer(again.id, 1))
    expect(await again.reply).toEqual({ allow: true, updatedPermissions: [rule] })
    // The same call again, after a dropped reply, gets the same answer.
    const agent = f.source.store.get<CoreAgent>('agent', chat)!
    expect(await f.source.requestPermission(agent, { id: 'current', chat } as Grant, { args: { id: again.id }, expires: Date.now() + 60_000 } as unknown as MailRequest, again.id)).toEqual({ allow: true, updatedPermissions: [rule] })
    const once = f.ask('Bash', { command: 'ls' }, Date.now(), [rule])
    await f.source.act(answer(once.id, 0))
    expect(await once.reply).toEqual({ allow: true })
    const no = f.ask('Bash', { command: 'ls' }, Date.now(), [rule])
    await f.source.act(answer(no.id, 2))
    expect(await no.reply).toEqual({ allow: false })
    const off = f.ask('Bash', { command: 'ls' })
    await expect(f.source.act(answer(off.id, 2))).rejects.toThrow('Choose one')
    await f.source.act(answer(off.id, 1))
    expect(await off.reply).toEqual({ allow: false })
  } finally { f.close() }
})

test('a step held at its card says Wants to above the card, and in the turn opened', async () => {
  const f = fixture()
  try {
    const log = (event: LogEvent) => f.source.store.set(`event:${chat}`, `${event.id}${event.kind}`, event)
    log({ kind: 'turn-start', id: 'turn', at: 1 })
    log({ kind: 'user', id: 'asked', at: 1, text: 'Make the file' })
    log({ kind: 'step', id: 'touch', at: 2, step: 'run', tool: 'Bash', ...words('Create empty hello.txt') })
    const messages = [{ id: 'asked', who: 'you' as const, text: 'Make the file', at: 1 }]
    const { id, reply } = f.ask('Bash', { command: 'touch hello.txt' })
    const row = f.source.activities.chat(chat, messages, false).messages.find(message => message.activity)!.activity!
    expect(row.rows.map(item => item.text)).toEqual(['Wants to create empty hello.txt'])
    expect(await f.source.activity({ chat, what: 'turn', id: 'turn' })).toMatchObject({ steps: [{ id: 'touch', title: 'Wants to create empty hello.txt', unrun: true }] })
    await f.source.act(answer(id, 0))
    await reply
    expect(f.source.activities.chat(chat, messages, true).live!.rows.map(item => item.text)).toEqual(['Creating empty hello.txt'])
  } finally { f.close() }
})

test('Codex can\'t take a grant from a hook, so its card stays Allow once and Deny', () => {
  const f = fixture('codex')
  try {
    const { id } = f.ask('Bash', { command: 'touch a', description: 'Allow creating a?' }, Date.now(), [rule])
    expect(f.source.chat(chat)!.messages.find(message => message.question?.id === id)!.question).toMatchObject({ title: 'Run: touch a', screen: 'Allow creating a?', choices: [{ label: 'Allow once' }, { label: 'Deny' }] })
  } finally { f.close() }
})
