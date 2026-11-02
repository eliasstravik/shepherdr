import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { CoreSource } from './source.ts'
import type { CoreTask } from './tasks.ts'
import { CorePilotRepositories } from './pilot-repositories.ts'
import { Refusal } from './client.ts'

interface Relocation { task: string; machine: string; repo: string; branch: string; from: string; to: string; until: number }
/** Explicit adoption only. A durable intent prevents replaying an uncertain Git worktree move. */
export class CoreTaskRelocation {
  constructor(private source: CoreSource) {}
  async adopt(task: CoreTask) {
    const space = this.source.space(task.place)
    if (!space || space.machine !== task.machine || space.folder !== task.repo) throw new Refusal('Task repository no longer matches its space; relocation was refused')
    const saved = this.source.store.get<Relocation>('task-relocation', task.id)
    if (saved && (saved.task !== task.id || saved.repo !== task.repo || saved.machine !== task.machine || saved.branch !== task.branch || ![saved.from, saved.to].includes(task.folder))) throw new Refusal('Saved worktree move does not match this task; inspect it before retrying')
    if (saved && Date.now() < saved.until) throw new Refusal('Worktree move is not yet confirmed; wait up to 90 seconds before retrying task start')
    const to = saved?.to ?? join(await this.source.agents.pilotWorktreeRoot(task.machine), 'adopted', `${task.id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}-${createHash('sha256').update(task.id).digest('hex').slice(0, 12)}`)
    const intent: Relocation = saved ?? { task: task.id, machine: task.machine, repo: task.repo, branch: task.branch, from: task.folder, to, until: Date.now() + 90000 }
    new CorePilotRepositories(this.source.store).remember(task.machine, task.repo, [intent.from, intent.to])
    const repo = { machine: task.machine, folder: task.repo }
    const list = await this.source.tasks.git.run(repo, ['worktree', 'list', '--porcelain', '-z'])
    const matches = list.split('\0\0').map(block => block.split('\0')).filter(lines => lines.includes(`branch refs/heads/${task.branch}`))
    const folder = matches.length === 1 ? matches[0].find(line => line.startsWith('worktree '))?.slice(9) : undefined
    if (!folder || ![intent.from, intent.to].includes(folder)) throw new Refusal('Task worktree registration changed; its files were left untouched')
    if (folder !== intent.to) {
      const runtime = await this.source.agents.browserRuntime(task.machine)
      // A normal agent may have altered cache directories; never follow those links when preparing the destination.
      const script = `const f=require('node:fs'),p=require('node:path'),x=JSON.parse(await Bun.stdin.text());const parent=p.dirname(x.to);for(let dir=parent;dir!=='/';dir=p.dirname(dir)){try{const s=f.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||f.realpathSync(dir)!==dir)throw Error('Worktree destination has a linked or invalid parent')}catch(e){if(e.code!=='ENOENT')throw e}}f.mkdirSync(parent,{recursive:true,mode:0o700});if(f.existsSync(x.to)||(()=>{try{f.lstatSync(x.to);return true}catch(e){if(e.code!=='ENOENT')throw e;return false}})())throw Error('Worktree destination already exists; nothing was overwritten')`
      await this.source.files.exec(task.machine, [runtime.bun, '-e', script], undefined, Buffer.from(JSON.stringify({ to: intent.to })))
      intent.until = Date.now() + 90000
      this.source.store.set('task-relocation', task.id, intent)
      const context = new CorePilotRepositories(this.source.store).context(repo)!
      try {
        const result = await this.source.files.exec(task.machine, [runtime.bun, join(runtime.root, 'helper/core-worktree-move.ts')], undefined, Buffer.from(JSON.stringify({ ...context, from: intent.from, to: intent.to, branch: task.branch, sessions: runtime.sessions })), 80)
        if (result.toString('utf8') !== 'WORKTREE_MOVE_CONFIRMED') throw Error('Move acknowledgement missing')
      }
      catch {
        task.startError = 'Worktree move is unconfirmed. Preserve both paths and retry task start after 90 seconds.'
        this.source.store.set('task', task.id, task); this.source.emit('snapshot')
        throw new Refusal(task.startError)
      }
    }
    // Checked Git validates linked-worktree metadata before the new path becomes authoritative.
    if (await this.source.tasks.git.head({ machine: task.machine, folder: intent.to }) !== await this.source.tasks.git.head(repo, task.branch)) throw new Refusal('Moved worktree head does not match its task branch; inspect both paths')
    this.source.store.db.transaction(() => {
      task.folder = intent.to; delete task.startError
      this.source.store.set('task', task.id, task); this.source.store.delete('task-relocation', task.id)
    })()
    this.source.emit('snapshot')
  }
}
