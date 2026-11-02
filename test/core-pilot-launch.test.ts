import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreAgents } from '../server/core/agents.ts'
import { CoreStore } from '../server/core/store.ts'
import { preparePilotHome, type PilotHome } from '../helper/core-pilot-home.ts'
import { discardPilotPrepared, type PilotPrepared } from '../helper/core-pilot-launch.ts'
import type { CoreSession } from '../server/core/session.ts'
import type { Mailbox } from '../server/core/mailbox.ts'
import type { CoreFiles } from '../server/core/files.ts'
import type { CoreAgent } from '../server/core/model.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-launch-')), home = join(root, 'app'), provider = join(root, 'provider')
  mkdirSync(home, { mode: 0o700 }); mkdirSync(provider, { mode: 0o700 })
  const store = new CoreStore(home)
  let prepared: PilotPrepared | undefined, owned: PilotHome | undefined, argv: string[] = [], submitted = false, revoked = false, uncertain = false
  const core = { current: { terminals: new Map() }, call: async (_method: string, input: { argv: string[] }) => {
    submitted = true; argv = input.argv
    if (uncertain) throw Error('Core response lost')
    return { address: 't1', pid: 123 }
  } } as unknown as CoreSession
  const mailbox = { issue: () => ({ id: 'pilot-grant', credential: {} }), revoke: () => { revoked = true } } as unknown as Mailbox
  const agents = new CoreAgents({ home, port: 17887, session: 'test', socket: '/private/core.sock', binary: 'hc' },
    { format: 'shepherdr-core', schema: 1, id: 'installation' }, core, store, mailbox, async () => undefined, () => {})
  ;(agents as unknown as { files: CoreFiles }).files.exec = async (_machine, args, _cwd, bytes) => {
    const input = JSON.parse(Buffer.from(bytes!).toString('utf8'))
    if (args.at(-1) === 'discard') { discardPilotPrepared(input.prepared, input.parent); return Buffer.from('') }
    expect(args.at(-1)).toBe('prepare')
    owned = preparePilotHome(input.parent, provider, join(import.meta.dir, '..'), input.kind, input.instructions)
    const { root, state, control, captures, gateway } = owned
    prepared = { paths: { root, state, control, captures, gateway }, bwrap: '/usr/bin/bwrap', sandbox: { cwd: input.cwd, repo: input.repo, home: '/home/inside', state, control, binary: process.execPath, bun: process.execPath, kind: input.kind, writable: input.writable, privateRoots: [] } }
    return Buffer.from(JSON.stringify(prepared))
  }
  const space = { id: 'space', name: 'Example', machine: 'machine', folder: '/repo', base: 'main', prefix: 'EX', mode: 'regular' as const, added: 1 }
  const launch = (kind: 'claude' | 'codex' = 'codex') => agents.launch(space, 'EX-1/Reviewer-1', kind, 'Review only', { role: 'reviewer', readOnly: true, pilot: { run: 'run', hosts: ['chatgpt.com'], repo: '/repo' } })
  return { root, home, store, agents, launch, get prepared() { return prepared! }, get argv() { return argv }, get submitted() { return submitted }, get revoked() { return revoked }, loseResponse() { uncertain = true }, close() { owned?.discard(); store.close(); rmSync(root, { recursive: true, force: true }) } }
}

test('contained reviewer wraps only native args and keeps its endpoint credential outside mounted control', async () => {
  const f = fixture()
  try {
    const record = await f.launch()
    const review = JSON.parse(readFileSync(f.argv[2]!, 'utf8'))
    expect(review.argv[1]).toEndWith('/helper/core-pilot-launch.ts')
    const launch = JSON.parse(readFileSync(review.argv[2], 'utf8'))
    expect(launch.args.slice(0, 4)).toEqual(['exec', '--json', '--sandbox', 'read-only'])
    expect(launch.args.some((word: string) => word.includes('shell_environment_policy.set'))).toBe(false)
    expect(launch.credential.startsWith(f.prepared.paths.control + '/')).toBe(false)
    expect(record).toMatchObject({ state: 'working', transcriptFormat: 'codex-exec', command: '/run/shepherdr/bin/shepherdr', pilot: { run: 'run', pending: true } })
    expect(record.browser).toBeUndefined()
  } finally { f.close() }
})

test('a definite setup failure restores the earlier record, revokes the grant and discards only new private preparation', async () => {
  const f = fixture()
  try {
    const previous: CoreAgent = { chat: 'EX-1/Reviewer-1', space: 'space', machine: 'machine', role: 'reviewer', kind: 'codex', launch: 'old', grant: 'old', hook: '/old', started: 1, state: 'idle', terminal: 'finished-old' }
    f.store.set('agent', previous.chat, previous)
    const set = f.store.set.bind(f.store)
    f.store.set = (kind, key, value) => {
      set(kind, key, value)
      if (kind === 'agent' && (value as CoreAgent).pilot) mkdirSync(join(f.home, 'sessions/pilot-grant.review.jsonl'))
    }
    await expect(f.launch()).rejects.toThrow()
    expect(f.submitted).toBe(false); expect(f.revoked).toBe(true)
    expect(f.agents.get(previous.chat)).toEqual(previous)
    expect(existsSync(f.prepared.paths.root)).toBe(false)
    expect(existsSync(dirname(f.prepared.paths.gateway))).toBe(false)
  } finally { f.close() }
})

test('a readonly Claude reviewer runs headlessly with inside hooks/settings and captured native-history routing', async () => {
  const f = fixture()
  try {
    const record = await f.launch('claude')
    expect(f.argv[1]).toEndWith('/helper/core-pilot-launch.ts')
    const launch = JSON.parse(readFileSync(f.argv[2]!, 'utf8'))
    expect(launch.args).toContain('--print')
    expect(launch.args).toContain('/run/shepherdr/settings.json')
    expect(launch.args).toContain('/run/shepherdr/instructions.md')
    expect(launch.args).toContain('--dangerously-skip-permissions')
    expect(launch.args).not.toContain('--permission-mode')
    expect(record.pilot?.captures).toBe(f.prepared.paths.captures)
    expect(record.transcriptFormat).toBeUndefined()
  } finally { f.close() }
})

test('an unconfirmed core start retains mounted state and its launch record for authoritative reconciliation', async () => {
  const f = fixture()
  try {
    f.loseResponse()
    await expect(f.launch()).rejects.toThrow('Core response lost')
    expect(f.submitted).toBe(true); expect(f.revoked).toBe(false)
    expect(existsSync(f.prepared.paths.root)).toBe(true)
    expect(f.agents.get('EX-1/Reviewer-1')?.pilot?.run).toBe('run')
  } finally { f.close() }
})
