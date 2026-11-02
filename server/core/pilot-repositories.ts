import { isAbsolute } from 'node:path'
import type { CoreStore } from './store.ts'
import type { RepoLocation } from './git.ts'

interface GuardedRepository { machine: string; repo: string; folders: string[]; homes: string[] }
export interface PilotRepositoryContext { repo: string; writableRoots: string[] }
/** Durable capabilities, never reconstructed from labels. Retain roots after exit: their files remain untrusted. */
export class CorePilotRepositories {
  constructor(private store: CoreStore) {}
  remember(machine: string, repo: string, folders: string[], homes: string[] = []) {
    if (!machine || [repo, ...folders, ...homes].some(path => !isAbsolute(path) || path === '/' || path.includes('\0'))) throw Error('Invalid contained repository boundary')
    const key = JSON.stringify([machine, repo]), old = this.store.get<GuardedRepository>('pilot-repository', key)
    const record = { machine, repo, folders: [...new Set([repo, ...(old?.folders ?? []), ...folders])], homes: [...new Set([...(old?.homes ?? []), ...homes])] }
    if (record.folders.length + record.homes.length > 8192) throw Error('Too many contained filesystem boundaries; clean up with the human before starting more')
    this.store.set('pilot-repository', key, record)
    return record
  }
  context(location: RepoLocation, additional: string[] = []): PilotRepositoryContext | undefined {
    let records = this.store.all<GuardedRepository>('pilot-repository').filter(item => item.machine === location.machine)
    const own = records.find(item => item.repo === location.folder || item.folders.includes(location.folder))
    if (!own) return
    if (additional.length) { this.remember(own.machine, own.repo, additional); records = this.store.all<GuardedRepository>('pilot-repository').filter(item => item.machine === location.machine) }
    const writableRoots = [...new Set(records.flatMap(item => [...item.folders, ...item.homes]))]
    if (writableRoots.length > 8192) throw Error('Too many contained filesystem boundaries')
    return { repo: own.repo, writableRoots }
  }
}
