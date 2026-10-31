import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreStore } from '../server/core/store.ts'
import { CoreSettings } from '../server/core/settings.ts'
import type { CoreFiles } from '../server/core/files.ts'
import type { CoreSpace } from '../server/core/model.ts'
import { MACHINE_CHECK, parseMachineCheck, type MachineCheck } from '../server/core/machine-check.ts'

function fixture(run: (settings: CoreSettings) => void) {
  const home = mkdtempSync(join(tmpdir(), 'shep-settings-')), store = new CoreStore(home)
  const spaces = [{ id: 'p:box:one', machine: 'box', name: 'one' }, { id: 'p:box:two', machine: 'box', name: 'two' }, { id: 'p:other:one', machine: 'other', name: 'one' }] as CoreSpace[]
  try { run(new CoreSettings(store, {} as CoreFiles, () => spaces, id => id, () => {})) }
  finally { store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('settings follow stable machine and space identities, including an explicit empty private override', () => fixture(settings => {
  settings.set('task.instructions', 'Everywhere rule')
  settings.set('task.instructions', 'Machine rule', 'm:box')
  settings.set('task.instructions', '', 'p:box:one')
  expect(settings.get('task.instructions', 'p:box:one')).toBe('')
  expect(settings.get('task.instructions', 'p:box:two')).toBe('Machine rule')
  expect(settings.get('task.instructions', 'p:other:one')).toBe('Everywhere rule')
  settings.set('task.instructions', null, 'p:box:one')
  expect(settings.get('task.instructions', 'p:box:one')).toBe('Machine rule')
  expect(settings.sections().find(section => section.level === 'p:box:two' && section.name === 'Private instructions')?.rows[1]).toMatchObject({ value: 'Machine rule', from: 'box' })
}))

test('restart defaults save only the chosen role and scope; invalid changes roll back atomically', () => fixture(settings => {
  settings.saveAgent('task', 'p:box:one', { kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  expect(settings.agent('task', 'p:box:one')).toEqual({ kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  expect(settings.launch('task', 'p:box:one', 'claude')).toEqual({ kind: 'claude', model: undefined, effort: undefined })
  expect(settings.agent('coordinator', 'p:box:one').kind).toBe('claude')
  expect(settings.agent('task', 'p:box:two').kind).toBe('claude')
  expect(() => settings.saveAgent('task', 'p:box:one', { kind: 'claude', model: 'other', effort: 'nonsense' })).toThrow()
  expect(settings.agent('task', 'p:box:one').kind).toBe('codex')
}))

test('private rules are role-scoped and excluded from ordinary command output', () => fixture(settings => {
  settings.set('reviewer.instructions', 'Private reviewer rule', 'p:box:one')
  expect(settings.instructions('reviewer', 'p:box:one')).toContain('Private reviewer rule')
  expect(settings.instructions('task', 'p:box:one')).not.toContain('Private reviewer rule')
  expect(settings.describe('p:box:one')).not.toContain('Private reviewer rule')
  expect(() => settings.set('review.rounds', '11 rounds')).toThrow()
  expect(() => settings.set('not.a.setting', 'value')).toThrow()
  expect(() => settings.set('task.agent', 'pi')).toThrow()
}))


test('a changed CLI never inherits a foreign model, including from another scope', () => fixture(settings => {
  settings.set('task.agent', 'Codex')
  settings.set('task.model', 'gpt-6.1-sol')
  settings.set('task.agent', 'Claude Code', 'm:box')
  expect(settings.agent('task', 'p:box:one')).toMatchObject({ kind: 'claude', model: undefined })
  expect(settings.sections().find(section => section.level === 'p:box:one' && section.name === 'Agents')?.rows.find(row => row.key === 'task.model')?.warn).toBeTruthy()
  settings.set('task.agent', 'Claude Code')
  expect(settings.agent('task', 'p:other:one').model).toBeUndefined()
  expect(() => settings.set('task.model', 'gpt-6.1-sol')).toThrow('model offered')
}))


test('browser idle settings keep minute units, bounds and off across scopes', () => fixture(settings => {
  settings.set('browser.idleClose', '1 min', 'p:box:one')
  expect(settings.get('browser.idleClose', 'p:box:one')).toBe('1 min')
  settings.set('browser.idleClose', 'off', 'm:box')
  expect(settings.get('browser.idleClose', 'p:box:two')).toBe('off')
  expect(settings.get('browser.idleClose', 'p:other:one')).toBe('10 min')
  expect(() => settings.set('browser.idleClose', '0 min')).toThrow()
  expect(() => settings.set('browser.idleClose', '1441 min')).toThrow()
  expect(() => settings.set('browser.idleClose', '2 rounds')).toThrow()
  settings.set('review.rounds', '1 round')
  expect(settings.get('review.rounds')).toBe('1 round')
}))

test('machine limits support fractional cores and percentages only at machine or Everywhere scope', () => fixture(settings => {
  settings.set('machine.startLoad', '1.15x cores', 'm:box')
  settings.set('machine.startMemory', '77 %', 'm:box')
  settings.set('machine.alertDisk', 'off', 'm:box')
  expect(settings.machineLimits('box')).toMatchObject({ max: 10, startLoad: 1.15, startMemory: 77, alertDisk: null })
  expect(() => settings.set('machine.maxTasks', '2.5')).toThrow()
  expect(() => settings.set('machine.startLoad', '1.12× cores')).toThrow()
  expect(() => settings.set('machine.startMemory', 'off')).toThrow()
  expect(() => settings.set('machine.maxTasks', '2', 'p:box:one')).toThrow()
  expect(settings.sections().some(section => section.name === 'Machine' && section.level === 'p:box:one')).toBe(false)
}))

test('Done archiving keeps familiar scoped defaults, off and inherited reset', () => fixture(settings => {
  expect(settings.get('tasks.archiveAfter', 'p:box:one')).toBe('7 days')
  settings.set('tasks.archiveAfter', '1 day', 'm:box')
  settings.set('tasks.archiveAfter', 'off', 'p:box:one')
  expect(settings.get('tasks.archiveAfter', 'p:box:one')).toBe('off')
  expect(settings.get('tasks.archiveAfter', 'p:box:two')).toBe('1 day')
  settings.set('tasks.archiveAfter', null, 'p:box:one')
  expect(settings.get('tasks.archiveAfter', 'p:box:one')).toBe('1 day')
}))

test('Autopilot access and limits snapshot scoped choices without widening normal agent defaults', () => fixture(settings => {
  settings.saveAgent('coordinator', 'p:box:one', { kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  settings.set('autopilot.hosts', 'API.OPENAI.COM, chatgpt.com', 'm:box')
  settings.set('autopilot.secrets', 'SYNTHETIC_KEY', 'p:box:one')
  settings.set('autopilot.traffic', '2 MiB', 'p:box:one')
  settings.set('autopilot.runtime', '3 min', 'p:box:one')
  settings.set('autopilot.tokens', '1234', 'p:box:one')
  settings.set('autopilot.model', 'gpt-6.1-sol', 'p:box:one')
  const config = settings.pilot('p:box:one')
  expect(config).toMatchObject({ harness: { kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' }, hosts: ['api.openai.com', 'chatgpt.com'], secrets: ['SYNTHETIC_KEY'], traffic: 2 * 1048576, runtime: 180000, tokens: 1234, parallel: 3 })
  settings.set('autopilot.hosts', 'api.anthropic.com', 'm:box')
  expect(config.hosts).toEqual(['api.openai.com', 'chatgpt.com'])
  expect(settings.agent('coordinator', 'p:box:one').kind).toBe('codex')
  expect(settings.pilot('p:box:two').secrets).toEqual([])
  expect(() => settings.set('autopilot.hosts', 'localhost', 'p:box:one')).toThrow()
  expect(() => settings.set('autopilot.secrets', 'NOT-A-NAME', 'p:box:one')).toThrow()
  expect(() => settings.set('heartbeat.when', 'every five minutes', 'p:box:one')).toThrow()
  settings.set('heartbeat.on', 'none', 'p:box:one')
  const page = settings.sections().find(section => section.name === 'Autopilot' && section.level === 'p:box:one')!
  expect(page.rows.find(row => row.key === 'heartbeat.on')?.trigger?.presets.map(preset => preset.label)).toEqual(['All news', 'None: it waits'])
  expect(page.rows.find(row => row.key === 'autopilot.model')?.options?.[0]).toBe('inherit')
}))

test('Autopilot restart choices validate before effects and save atomically', () => fixture(settings => {
  const level = 'p:box:one'
  expect(() => settings.checkedAgent(level, { kind: 'codex', model: 'not-a-model' })).toThrow()
  expect(settings.get('autopilot.agent', level)).toBe('inherit')
  settings.saveAgent('autopilot', level, { kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  expect(settings.agent('autopilot', level)).toMatchObject({ kind: 'codex', model: 'gpt-6.1-sol', effort: 'high' })
  expect(() => settings.saveAgent('autopilot', level, { kind: 'claude', model: 'invalid', effort: 'wrong' })).toThrow()
  expect(settings.agent('autopilot', level).kind).toBe('codex')
}))

test('fresh devices can enroll alerts Everywhere, while device names and delivery failures remain visible from every scope', () => fixture(settings => {
  const fresh = settings.sections().filter(section => section.name === 'Alerts and voice')
  expect(fresh).toHaveLength(1)
  expect(fresh[0]).toMatchObject({ level: 'all', global: true })
  expect(fresh[0].rows.find(row => row.key === 'alerts')).toMatchObject({ value: 'No device yet', options: ['Add this device'] })
  const configured = settings.sections(['a phone', 'a Mac'], ['Device 1 (a phone): Could not reach the push service.']).find(section => section.name === 'Alerts and voice')!
  expect(configured.rows.find(row => row.key === 'alerts')).toMatchObject({ value: 'a phone, a Mac', warn: expect.stringContaining('Could not reach the push service.') })
  expect(configured.rows.find(row => row.key === 'voice.service')).toMatchObject({ value: 'ElevenLabs' })
  expect(() => settings.set('alerts', 'Add this device')).toThrow('Add this device')
  expect(() => settings.set('voice.service', 'ElevenLabs', 'p:box:one')).toThrow('Everywhere')
}))


test('global scheduling remains visible from every scope and familiar Browser and private-rule pages remain', () => fixture(settings => {
  const sections = settings.sections()
  const agents = sections.find(section => section.name === 'Agents' && section.level === 'p:box:one')!
  expect([...new Set(agents.rows.map(row => row.group))]).toEqual(['Tasks', 'Coordinators', 'Backup'])
  expect(agents.about).toContain('Backup takes a task over')
  expect(sections.filter(section => section.name === 'Time zone')).toHaveLength(1)
  expect(sections.find(section => section.name === 'Time zone')).toMatchObject({ global: true, level: 'all' })
  expect(sections.find(section => section.name === 'Browser' && section.level === 'p:box:one')).toBeDefined()
  expect(sections.find(section => section.name === 'Private instructions' && section.level === 'p:box:one')?.told).toBe(true)
}))

const check = (settings: CoreSettings, machine: string, cli: MachineCheck['cli'], rest: Partial<MachineCheck> = {}) => (settings as unknown as { store: CoreStore }).store.set('machine-check', machine, { at: Date.now(), cli, ...rest })
const warning = (settings: CoreSettings, level: string, key: string) => settings.sections().find(section => section.level === level && section.rows.some(row => row.key === key))!.rows.find(row => row.key === key)!.warn

test('reviewer and backup default to a CLI that is installed and signed in, not to Codex', () => fixture(settings => {
  // before any check: the other CLI, as ever
  expect(settings.get('reviewer.agent', 'p:box:one')).toBe('Codex')
  expect(settings.get('task.fallback', 'p:box:one')).toBe('Codex')
  check(settings, 'box', { claude: 'ready', codex: 'signed-out' })
  check(settings, 'other', { claude: 'ready', codex: 'ready' })
  expect(settings.agent('reviewer', 'p:box:one').kind).toBe('claude')
  // a task never fails over to its own CLI, so a same-CLI backup would look set and do nothing
  expect(settings.get('task.fallback', 'p:box:one')).toBe('off')
  expect(warning(settings, 'p:box:one', 'task.fallback')).toContain('no backup')
  // How tasks work says so too, though Backup's row is under Agents
  const tasks = settings.sections().find(section => section.level === 'p:box:one' && section.name === 'How tasks work')!
  expect(tasks.rows.at(-1)).toMatchObject({ group: 'Backup', value: 'off', fixed: true })
  expect(tasks.rows.at(-1)!.warn).toContain('no backup')
  expect(warning(settings, 'p:box:one', 'reviewer.agent')).toBeUndefined()
  // each machine by its own check
  expect(settings.get('reviewer.agent', 'p:other:one')).toBe('Codex')
  expect(settings.get('task.fallback', 'p:other:one')).toBe('Codex')
  // Codex on the task, Claude as the fresh eyes
  settings.set('task.agent', 'Codex', 'p:other:one')
  expect(settings.get('reviewer.agent', 'p:other:one')).toBe('Claude Code')
  expect(settings.get('task.fallback', 'p:other:one')).toBe('Claude Code')
}))

test('Everywhere warns only of the machines without a backup: each space follows its own', () => fixture(settings => {
  check(settings, 'box', { claude: 'ready', codex: 'signed-out' })
  check(settings, 'other', { claude: 'ready', codex: 'ready' })
  expect(settings.get('task.fallback')).toBe('Codex')
  expect(settings.get('task.fallback', 'p:box:one')).toBe('off')
  expect(settings.get('task.fallback', 'p:other:one')).toBe('Codex')
  expect(warning(settings, 'all', 'task.fallback')).toBe('No other signed-in CLI on box, so tasks there have no backup.')
  expect(warning(settings, 'all', 'reviewer.agent')).toBeUndefined()
  expect(warning(settings, 'p:other:one', 'task.fallback')).toBeUndefined()
  // a space on Codex has Claude Code as its backup, whatever its machine's other spaces lack
  settings.set('task.agent', 'Codex', 'p:box:one')
  expect(settings.get('task.fallback', 'p:box:one')).toBe('Claude Code')
  expect(warning(settings, 'p:box:one', 'task.fallback')).toBeUndefined()
}))

test('a running task keeps a real backup when its space default changes after it started', () => fixture(settings => {
  check(settings, 'box', { claude: 'ready', codex: 'ready' })
  settings.set('task.agent', 'Codex', 'p:box:one')
  expect(settings.get('task.fallback', 'p:box:one')).toBe('Claude Code')
  expect(settings.backupFor('p:box:one', 'claude')?.kind).toBe('codex')
  expect(settings.backupFor('p:box:one', 'codex')?.kind).toBe('claude')
  check(settings, 'box', { claude: 'ready', codex: 'signed-out' })
  expect(settings.backupFor('p:box:one', 'claude')).toBeUndefined()
  // saved choices are as they were
  settings.set('task.fallback', 'off', 'p:box:one')
  expect(settings.backupFor('p:box:one', 'codex')).toBeUndefined()
  settings.set('task.fallback', 'Claude Code', 'p:box:one')
  expect(settings.backupFor('p:box:one', 'claude')?.kind).toBe('claude')
}))

test('Everywhere warns when neither CLI works, by what each machine would use', () => fixture(settings => {
  check(settings, 'box', { claude: 'signed-out', codex: 'signed-out' })
  check(settings, 'other', { claude: 'ready', codex: 'ready' })
  expect(warning(settings, 'all', 'reviewer.agent')).toContain('Claude Code is not signed in on box.')
}))

test('a check that fails says so on the row, and goes quiet once one succeeds', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-settings-')), store = new CoreStore(home)
  let answer = ''
  const spaces = [{ id: 'p:box:one', machine: 'box', name: 'one' }] as CoreSpace[], files = { exec: async () => { if (!answer) throw Error('out of reach'); return Buffer.from(answer) } } as unknown as CoreFiles
  const settings = new CoreSettings(store, files, () => spaces, id => id, () => {})
  try {
    settings.probe('box')
    await Bun.sleep(0)
    expect(settings.get('reviewer.agent', 'p:box:one')).toBe('Codex')
    expect(warning(settings, 'p:box:one', 'reviewer.agent')).toBe('Codex is not checked on box.\nReviews may not run there: the check failed.')
    answer = 'platform=Linux\nclaude="loggedIn": true\ncodex=Logged in using ChatGPT'
    ;(settings as unknown as { tried: Map<string, number> }).tried.clear()
    settings.probe('box')
    await Bun.sleep(0)
    expect(warning(settings, 'p:box:one', 'reviewer.agent')).toBeUndefined()
  } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
})

test('a saved reviewer or backup stays, and its row says where that CLI is unusable', () => fixture(settings => {
  check(settings, 'box', { claude: 'ready', codex: 'signed-out' })
  check(settings, 'other', { claude: 'ready', codex: 'missing' })
  settings.set('reviewer.agent', 'Codex')
  settings.set('task.fallback', 'Codex')
  expect(settings.get('reviewer.agent', 'p:box:one')).toBe('Codex')
  expect(warning(settings, 'all', 'reviewer.agent')).toBe("Codex is not signed in on box.\nCodex is not installed on other.\nReviews can't run there until that is fixed, or you choose another agent.")
  expect(warning(settings, 'p:other:one', 'task.fallback')).toBe("Codex is not installed on other.\nA backup can't run there until that is fixed, or you choose another agent.")
  settings.set('task.fallback', 'off')
  expect(warning(settings, 'all', 'task.fallback')).toBeUndefined()
}))

test('an answer it cannot read proves nothing: never picked, never warned about, never blocking', () => fixture(settings => {
  check(settings, 'box', {})
  expect(settings.get('reviewer.agent', 'p:box:one')).toBe('Claude Code')
  expect(settings.get('task.fallback', 'p:box:one')).toBe('off')
  expect(warning(settings, 'p:box:one', 'reviewer.agent')).toBeUndefined()
  expect(settings.pilotBlock('p:box:one')).toBeUndefined()
  // only a machine never checked keeps the plain order
  expect(settings.get('reviewer.agent', 'p:other:one')).toBe('Codex')
  expect(parseMachineCheck('/home/someone')).toBeUndefined()
  expect(parseMachineCheck('platform=Linux\nsandbox=ok\nclaude=\ncodex=error: unknown command', 5)).toEqual({ at: 5, platform: 'Linux', sandbox: 'ok', cli: { claude: undefined, codex: undefined } })
  expect(parseMachineCheck('platform=Linux\nclaude="loggedIn": false\ncodex=Logged in using ChatGPT')?.cli).toEqual({ claude: 'signed-out', codex: 'ready' })
  expect(parseMachineCheck('platform=Linux\nclaude="loggedIn": true\ncodex=Not logged in')?.cli).toEqual({ claude: 'ready', codex: 'signed-out' })
  expect(parseMachineCheck('platform=Linux\nclaude=missing\ncodex=missing')?.cli).toEqual({ claude: 'missing', codex: 'missing' })
}))

test('Autopilot says why it cannot run: home space, wrong profile for the system, no sandbox, or its CLI unusable', () => fixture(settings => {
  const ready = { claude: 'ready', codex: 'ready' } as const
  expect(settings.pilotBlock('p:box:one')).toBeUndefined()
  check(settings, 'box', ready, { platform: 'Darwin', sandbox: 'missing' })
  expect(settings.pilotBlock('p:box:one')).toBe('Isolated workspace needs Linux. box runs macOS: choose the Mac sandbox permission profile.')
  settings.set('autopilot.access', 'Mac sandbox', 'p:box:one')
  expect(settings.pilotBlock('p:box:one')).toContain("Codex can't run commands") // The default reviewer, where it's signed in.
  settings.set('reviewer.agent', 'Claude Code', 'p:box:one')
  expect(settings.pilotBlock('p:box:one')).toBeUndefined() // bubblewrap is missing on every Mac, and the Mac profile doesn't use it.
  settings.set('autopilot.agent', 'Codex', 'p:box:one')
  expect(settings.pilotBlock('p:box:one')).toContain("Codex can't run commands")
  settings.set('autopilot.agent', 'Claude Code', 'p:box:one')
  check(settings, 'box', { claude: 'signed-out', codex: 'ready' }, { platform: 'Darwin', sandbox: 'missing' })
  expect(settings.pilotBlock('p:box:one')).toBe('Autopilot runs on Claude Code, which is not signed in on box.')
  check(settings, 'box', ready, { platform: 'Linux', sandbox: 'ok' })
  expect(settings.pilotBlock('p:box:one')).toBe('The Mac sandbox permission profile needs macOS. box runs Linux.')
  settings.set('autopilot.access', 'Isolated workspace', 'p:box:one')
  check(settings, 'box', ready, { platform: 'FreeBSD', sandbox: 'missing' })
  expect(settings.pilotBlock('p:box:one')).toBe('Autopilot needs Linux or macOS. box runs FreeBSD.')
  check(settings, 'box', ready, { platform: 'Linux', sandbox: 'missing' })
  expect(settings.pilotBlock('p:box:one')).toContain('bubblewrap')
  check(settings, 'box', ready, { platform: 'Linux', sandbox: 'blocked' })
  expect(settings.pilotBlock('p:box:one')).toContain('user namespaces')
  check(settings, 'box', { claude: 'signed-out', codex: 'ready' }, { platform: 'Linux', sandbox: 'ok' })
  expect(settings.pilotBlock('p:box:one')).toBe('Autopilot runs on Claude Code, which is not signed in on box.')
  settings.set('autopilot.agent', 'Codex', 'p:box:one')
  expect(settings.pilotBlock('p:box:one')).toBeUndefined()
}))

test('the machine check names no account: only a yes or no leaves the CLI', () => {
  expect(MACHINE_CHECK).toContain(`grep -o '"loggedIn"`)
  expect(MACHINE_CHECK).not.toMatch(/email/)
})
