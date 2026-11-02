import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CoreStore } from '../server/core/store.ts'
import { CoreGitHubMerges } from '../server/core/github-merges.ts'
import type { CoreSource } from '../server/core/source.ts'
import type { CoreTask } from '../server/core/tasks.ts'

test('completed merges are observed without a live agent, bounded and throttled across reconstruction', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-merged-')), store = new CoreStore(home)
  const tasks = Array.from({ length: 3 }, (_, index) => ({ id: `TASK-${index}`, place: 'space', machine: 'machine', folder: `/task/${index}`, branch: `work/${index}`, workflow: 'ready', pr: { number: index + 1 } }) as CoreTask)
  const seen: string[] = [], synced: string[] = []
  const source = { store, space: () => ({}), machineConnected: () => true, tasks: { all: () => tasks, busy: () => false,
    git: { pullRequest: async (_repo: unknown, branch: string, checks: boolean) => { expect(checks).toBe(false); return { state: 'MERGED', branch } } },
    observedMerge: async (id: string) => { seen.push(id); const task = tasks.find(t => t.id === id)!; task.workflow = 'merged'; task.baseSyncPending = true; return true },
    syncBase: async (id: string) => { synced.push(id); const task = tasks.find(t => t.id === id)!; task.baseSyncPending = undefined },
  } } as unknown as CoreSource
  try {
    await new CoreGitHubMerges(source).scan(100000)
    expect(seen).toEqual(['TASK-0', 'TASK-1']); expect(synced).toEqual(seen)
    await new CoreGitHubMerges(source).scan(100001)
    expect(seen).toEqual(['TASK-0', 'TASK-1', 'TASK-2'])
    tasks[0].workflow = 'ready'
    await new CoreGitHubMerges(source).scan(100002)
    expect(seen).toHaveLength(3)
    source.machineConnected = () => false
    await new CoreGitHubMerges(source).scan(200000)
    expect(seen).toHaveLength(3)
  } finally { store.close(); rmSync(home, { recursive: true, force: true }) }
})
