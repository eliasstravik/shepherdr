import { stripVTControlCharacters } from 'node:util'
import type { CoreGit, RepoLocation } from './git.ts'
const FAILED = new Set(['failure', 'timed_out', 'action_required', 'startup_failure', 'stale'])

/** Read through the configured host explicitly; CLI run URLs can name another API host. */
export async function failureLogTail(git: CoreGit, repo: RepoLocation, target: string, run: number) {
  if (!Number.isSafeInteger(run) || run < 1) throw Error('Invalid workflow run')
  const slash = target.indexOf('/'), host = target.slice(0, slash), name = target.slice(slash + 1)
  if (slash < 1 || !name) throw Error('Invalid GitHub repository')
  const jobs = await git.gh<unknown>(repo, ['api', '--hostname', host, `repos/${name}/actions/runs/${run}/jobs?filter=latest&per_page=100`], 20)
  const data = jobs as { total_count: number; jobs: { id: number; name: string; status: string; conclusion: string | null }[] }
  if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 1 || data.total_count > 100 || !Array.isArray(data.jobs) || data.jobs.length !== data.total_count || data.jobs.some(job => !job || !Number.isSafeInteger(job.id) || job.id < 1 || typeof job.name !== 'string' || typeof job.status !== 'string' || !(job.conclusion === null || typeof job.conclusion === 'string'))) throw Error('Incomplete GitHub job results')
  const failed = data.jobs.filter(job => job.status === 'completed' && FAILED.has(job.conclusion ?? '')).slice(0, 2)
  if (!failed.length) throw Error('No completed failed jobs available')
  let tail = ''
  for (const job of failed) {
    const args = ['api', '--hostname', host, `repos/${name}/actions/jobs/${job.id}/logs`]
    let log: string
    try { log = await git.ghRun(repo, args, 20) }
    catch (error) {
      // Newer gh versions explicitly require this switch for raw log control sequences.
      // Capture only; strip controls before this data enters an agent notice.
      if (!(error instanceof Error) || !error.message.includes('pass --allow-escape-sequences')) throw error
      log = await git.ghRun(repo, [...args, '--allow-escape-sequences'], 20)
    }
    tail = `${tail}\n${job.name.slice(0, 160)}\n${stripVTControlCharacters(log).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')}`.slice(-12000)
  }
  return tail
}
