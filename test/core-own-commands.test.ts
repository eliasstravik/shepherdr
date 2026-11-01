import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreAgents } from '../server/core/agents.ts'
import { CoreStore } from '../server/core/store.ts'
import { ownCommand, ownRules } from '../server/core/own-commands.ts'
import { coreRequest } from '../server/core/request.ts'
import type { MailCredential } from '../server/core/envelope.ts'
import type { CoreSession } from '../server/core/session.ts'
import type { Mailbox } from '../server/core/mailbox.ts'

const command = '/opt/shepherdr/bin/shepherdr'
const own = (text: unknown, tool: unknown = 'Bash', path = command) => ownCommand(path, tool, { command: text })

test('Claude rules name the exact path, verb by verb, and never the commands that run or write anything', () => {
  const rules = ownRules(command)
  expect(rules).toContain(`Bash(${command} ask:*)`)
  expect(rules).toContain(`Bash(${command} merge:*)`)
  expect(rules).toContain(`Bash(${command} secret list:*)`)
  expect(rules.every(rule => rule.startsWith(`Bash(${command} `))).toBe(true)
  expect(rules.some(rule => /secret (run|env)/.test(rule))).toBe(false)
  expect(rules).not.toContain(`Bash(${command} secret:*)`)
})

test('a path a rule cannot state literally gets no rule rather than a wider one', () => {
  for (const path of ['/opt/*/shepherdr', '/opt/a b/shepherdr', '/opt/a(b)/shepherdr']) expect(ownRules(path)).toEqual([])
})

test('a Codex request counts as own only when it is one plain call of the exact path', () => {
  for (const text of [`${command} ask "Rerun CI?" --choice Yes --choice No`, `'${command}' ready EX-1 --summary 'It works; really' --facts "a \\"b\\" | c"`,
    `${command} status EX-1 "Half done" --done 50 --left 5m`, `${command} secret list`, `${command} secret ask TOKEN --why 'To push'`,
    `  ${command} merge EX-1  `, `${command} task add One --brief 'line one\nline two'`]) expect(own(text)).toBe(true)
})

test('everything else keeps its card', () => {
  for (const text of [`${command} secret run A -- rm -rf /`, `${command} secret 'run' A -- rm -rf /`, `${command} secret env A --file x`, `${command} agent secret run A -- ls`,
    `${command} ask x; rm -rf /`, `${command} ask x && rm y`, `${command} ask x | sh`, `${command} ask x &`, `${command} ask x\nrm y`, `${command} ask x > ~/.bashrc`,
    `${command} ask "$(rm y)"`, `${command} ask \`rm y\``, `${command} ask $HOME`, `${command} ask "\`rm y\`"`, `${command} ask 'open`, `FOO=1 ${command} ask x`,
    `${command}-evil ask x`, `/other/bin/shepherdr ask x`, 'shepherdr ask x', `${command} nonsense`, command, `${command} secret`, `sh -c '${command} ask x'`]) expect(own(text)).toBe(false)
  expect(own(`${command} ask x`, 'Edit')).toBe(false)
  expect(own(undefined)).toBe(false)
  expect(ownCommand(command, 'Bash', null)).toBe(false)
})

const launch = async (kind: 'claude' | 'codex', options: Record<string, unknown>) => {
  const home = mkdtempSync(join(tmpdir(), 'shep-own-')), store = new CoreStore(home)
  try {
    let argv: string[] = []
    const core = { call: async (_method: string, input: { argv: string[] }) => { argv = input.argv; return { address: 't1', pid: 123 } } } as unknown as CoreSession
    const mailbox = { issue: () => ({ id: 'grant', credential: {} }) } as unknown as Mailbox
    const agents = new CoreAgents({ home, port: 17887, session: 'test', socket: '/unused', binary: 'hc' },
      { format: 'shepherdr-core', schema: 1, id: 'installation' }, core, store, mailbox, async () => undefined, () => {})
    const agent = await agents.launch({ id: 'space', name: 'Example', machine: 'machine', folder: '/unused', base: 'main', prefix: 'EX', mode: 'regular', added: 1 }, 'EX-1/Agent', kind, 'Go', options)
    return { agent, argv, settings: kind === 'claude' ? JSON.parse(readFileSync(argv[argv.indexOf('--settings') + 1], 'utf8')) : undefined,
      words: kind === 'claude' ? readFileSync(argv[argv.indexOf('--append-system-prompt-file') + 1], 'utf8') : JSON.parse(argv.find(word => word.startsWith('developer_instructions='))!.slice('developer_instructions='.length)) as string }
  } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
}

test('a Claude launch allows its own command in the settings it passes, keeping the hooks and its permission mode', async () => {
  const { agent, argv, settings, words } = await launch('claude', { role: 'task' })
  expect(settings.permissions.allow).toEqual(ownRules(agent.command!))
  expect(Object.keys(settings.permissions)).toEqual(['allow'])
  expect(settings.hooks.PermissionRequest).toBeDefined()
  expect(argv).not.toContain('--permission-mode')
  expect(words).toContain('Write that full path each time')
  expect(words).not.toContain('require_escalated')
})

test('a reviewer gets no allowed command', async () => {
  const { settings, words } = await launch('claude', { role: 'reviewer', readOnly: true })
  expect(settings.permissions).toBeUndefined()
  expect(words).not.toContain('Write that full path each time')
})

test('Codex keeps the machine’s sandbox settings and is told to ask for the command outright', async () => {
  const { argv, words } = await launch('codex', { role: 'task' })
  expect(words).toContain('sandbox_permissions "require_escalated"')
  expect(argv.some(word => word.startsWith('sandbox_workspace_write.') || word.startsWith('approval_policy') || word.startsWith('sandbox_mode'))).toBe(false)
})

test('a caller that knows waiting cannot help gives up at once when it never connected', async () => {
  const started = Date.now()
  await expect(coreRequest('/nonexistent/core.sock', {} as MailCredential, 'cli', {}, { timeout: 30_000, once: true })).rejects.toThrow()
  expect(Date.now() - started).toBeLessThan(5_000)
})
