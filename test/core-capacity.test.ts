import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreSource } from '../server/core/source.ts'
import type { CoreAgent, CoreSpace } from '../server/core/model.ts'
import type { CoreTask } from '../server/core/tasks.ts'

test('a full machine queues new native starts and preserves a human message until the slot frees', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-capacity-')), repo = join(root, 'repo')
  const source = new CoreSource({ home: join(root, 'home'), port: 17887, socket: '/unused', session: 'test', binary: 'hc' })
  const machine = source.localMachineId(), space: CoreSpace = { id: `p:${machine}:demo`, name: 'demo', machine, folder: repo, prefix: 'DEMO', base: 'main', mode: 'regular', added: 1 }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Core test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Core test', GIT_COMMITTER_EMAIL: 'test@localhost' }
  const exec = (argv: string[], cwd?: string, stdin?: Uint8Array) => {
    const result = Bun.spawnSync(argv, { cwd, env, stdin: stdin ?? 'ignore' })
    if (result.exitCode) throw Error(result.stderr.toString())
    return result.stdout
  }
  const started: string[] = [], sent: string[] = []
  try {
    exec(['git', 'init', '--initial-branch=main', repo]); writeFileSync(join(repo, 'base.txt'), 'before\n'); exec(['git', 'add', '.'], repo); exec(['git', 'commit', '-m', 'base'], repo)
    source.store.set('space', space.id, space)
    source.store.set('health-sample', machine, { at: Date.now(), cores: 8, load: 1, memTotal: 1000, memUsed: 400, disks: [], gpus: [] })
    source.settings.set('machine.maxTasks', '1', `m:${machine}`)
    source.core.current.connected = true
    source.core.call = async <T>(method: string) => { if (!['terminal.label', 'terminal.interrupt'].includes(method)) throw Error('Unexpected core call: ' + method); return {} as T }
    source.files.exec = async (_machine, argv, cwd, stdin) => Buffer.from(exec(argv, cwd, stdin))
    source.agents.worktreeRoot = async () => join(root, 'worktrees')
    source.agents.terminal = agent => agent ? { address: 't1', state: 'live', pid: 11 } as ReturnType<typeof source.agents.terminal> : undefined
    source.agents.launch = async (_space, chat, kind, _text, options) => {
      started.push(chat)
      const agent = { chat, space: space.id, machine, kind, launch: chat, grant: chat, role: options?.role || 'coordinator', state: 'idle', started: Date.now(), hook: '/unused' } as CoreAgent
      source.store.set('agent', chat, agent); return agent
    }
    source.agents.send = async (_chat, text) => { sent.push(text) }
    const busy = { id: 'BUSY-1', chat: 'BUSY-1/Agent', place: space.id, machine, workflow: 'working', status: 'work', name: 'Busy' } as CoreTask
    source.store.set('task', busy.id, busy)
    const task = await source.tasks.addInSpace(space, { title: 'Waiting task', brief: 'Wait for a real slot' })
    expect(source.tasks.get(task.id)).toMatchObject({ workflow: 'queued', capacity: expect.stringContaining('limit 1') })
    expect(started).toHaveLength(0)
    await source.act({ type: 'send', cid: 'capacity-human-send', chat: task.chat, text: 'Keep this message' }); await Bun.sleep(0)
    expect(source.store.get<{ state: string }>('pending-send', 'capacity-human-send')?.state).toBe('queued')
    expect(sent).toHaveLength(0)
    busy.workflow = 'todo'; source.store.set('task', busy.id, busy)
    await source.tasks.tick(); await Bun.sleep(0)
    expect(source.tasks.get(task.id)?.workflow).toBe('working')
    expect(started).toContain(task.chat)
    expect(sent).toContain('Keep this message')
    // An existing queued agent must not bypass the same gate.
    busy.workflow = 'working'; source.store.set('task', busy.id, busy)
    const queued = source.tasks.get(task.id)!; queued.workflow = 'queued'; source.store.set('task', task.id, queued)
    const before = sent.length
    await source.act({ type: 'send', cid: 'capacity-live-agent-send', chat: task.chat, text: 'Do not lose this queued go' }); await Bun.sleep(0)
    expect(sent).toHaveLength(before)
    expect(source.store.get<{ state: string }>('pending-send', 'capacity-live-agent-send')?.state).toBe('queued')
    await source.act({ type: 'pause', chat: task.chat }); await Bun.sleep(0)
    expect(source.store.get<{ state: string }>('pending-send', 'capacity-live-agent-send')?.state).toBe('cancelled')
    expect(source.tasks.get(task.id)?.reservedAt).toBeUndefined()
    busy.workflow = 'todo'; source.store.set('task', busy.id, busy)
    await source.tasks.tick(); await Bun.sleep(0)
    expect(sent).toHaveLength(before)
    // Ready agents also need a slot. A change with no merge card behind it drops the ready commit.
    const ready = source.tasks.get(task.id)!; ready.workflow = 'ready'; ready.readyHead = 'old'; ready.approvedHead = 'old'; source.store.set('task', task.id, ready)
    busy.workflow = 'working'; source.store.set('task', busy.id, busy)
    await source.act({ type: 'send', cid: 'capacity-ready-agent-send', chat: task.chat, text: 'Change the ready task' }); await Bun.sleep(0)
    expect(sent).toHaveLength(before)
    expect(source.tasks.get(task.id)?.workflow).toBe('ready')
    busy.workflow = 'todo'; source.store.set('task', busy.id, busy)
    source.retryPending(); await Bun.sleep(0)
    expect(sent).toContain('Change the ready task')
    expect(source.tasks.get(task.id)?.approvedHead).toBeUndefined()
    const answering = source.tasks.get(task.id)!; answering.workflow = 'ready'; answering.capacity = 'was full'; source.store.set('task', task.id, answering)
    await source.tasks.deliver(task.id, task.chat, '<answer>Merge</answer>', true)
    expect(source.tasks.get(task.id)?.workflow).toBe('ready')

  } finally { source.stop(); await Bun.sleep(0); source.mailbox.close(); source.store.close(); rmSync(root, { recursive: true, force: true }) }
})
