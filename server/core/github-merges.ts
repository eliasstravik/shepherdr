import type { CoreSource } from './source.ts'
interface Check { at: number; error?: string }
/** Observe completed GitHub actions even when the original agent has exited. Never initiate a merge here. */
export class CoreGitHubMerges {
  constructor(private source: CoreSource) {}
  async scan(now = Date.now()) {
    let count = 0
    const eligible = this.source.tasks.all().filter(task => task.pr && ['ready', 'merging'].includes(task.workflow) && !task.archived)
      .sort((a, b) => (this.source.store.get<Check>('github-merge-check', a.id)?.at ?? 0) - (this.source.store.get<Check>('github-merge-check', b.id)?.at ?? 0))
    for (const task of eligible) {
      if (this.source.quiescing || count >= 2) break
      if (!this.source.space(task.place) || !this.source.machineConnected(task.machine) || this.source.tasks.busy(task.id) || now - (this.source.store.get<Check>('github-merge-check', task.id)?.at ?? 0) < 60000) continue
      count++
      try {
        const pr = await this.source.tasks.git.pullRequest({ machine: task.machine, folder: task.folder }, task.branch, false)
        if (this.source.quiescing || this.source.tasks.busy(task.id)) continue
        if (pr.state === 'MERGED') await this.source.tasks.observedMerge(task.id, pr)
        this.source.store.set('github-merge-check', task.id, { at: now })
      } catch (error) { this.source.store.set('github-merge-check', task.id, { at: now, error: String((error as Error).message).slice(0, 1000) }) }
    }
    count = 0
    for (const task of this.source.tasks.all()) {
      if (this.source.quiescing || count >= 2) break
      if (task.workflow !== 'merged' || !task.baseSyncPending || !this.source.space(task.place) || !this.source.machineConnected(task.machine) || this.source.tasks.busy(task.id) || now - (task.baseSyncChecked ?? 0) < 60000) continue
      count++; await this.source.tasks.syncBase(task.id)
    }
  }
}
