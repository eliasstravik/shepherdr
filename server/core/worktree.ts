import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WorktreeAsk } from '../../shared/types.ts'
import { CorePilotRepositories } from './pilot-repositories.ts'
import type { CoreSource } from './source.ts'

/** The task record chooses machine and folder; callers may choose only a view and a relative path. */
export class CoreWorktree {
  private script = readFileSync(join(import.meta.dir, '../../helper/core-worktree.ts'), 'utf8') + '\ntry { process.stdout.write(JSON.stringify({ ok: true, value: await readWorktree(JSON.parse(await Bun.stdin.text())) })) } catch (error) { process.stdout.write(JSON.stringify({ ok: false, error: error.message })) }'
  private prs = new Map<string, { at: number; value: Promise<unknown> }>()
  constructor(private source: CoreSource) {}
  async ask(ask: WorktreeAsk) {
    const task = this.source.tasks.get(ask.task)
    if (!task) throw new Error('No such task')
    const read = async () => {
      const bun = await this.source.agents.bun(task.machine)
      const context = new CorePilotRepositories(this.source.store).context({ machine: task.machine, folder: task.folder })
      const runtime = context ? await this.source.agents.browserRuntime(task.machine) : undefined
      const checked = context && runtime ? { ...context, bun: runtime.bun, helper: join(runtime.root, 'helper/core-pilot-git.ts') } : undefined
      const result = await this.source.files.exec(task.machine, [bun, '-e', this.script], undefined,
        Buffer.from(JSON.stringify({ checked, folder: task.folder, base: task.base, branch: task.branch, what: ask.what, ...('path' in ask ? { path: ask.path } : {}) })), 90)
      const reply = JSON.parse(result.toString('utf8')) as { ok: boolean; value?: unknown; error?: string }
      if (!reply.ok) throw new Error(reply.error || 'Could not read this worktree')
      return reply.value
    }
    if (ask.what !== 'pr') return read()
    const old = this.prs.get(task.id)
    if (old && Date.now() - old.at < 30000) return old.value
    const value = read()
    this.prs.set(task.id, { at: Date.now(), value })
    for (const [id, item] of this.prs) if (Date.now() - item.at > 300000) this.prs.delete(id)
    return value
  }
}
