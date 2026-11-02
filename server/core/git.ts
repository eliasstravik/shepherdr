import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { PilotRepositoryContext } from './pilot-repositories.ts'
import { Refusal } from './client.ts'
import type { CoreFiles } from './files.ts'

export interface RepoLocation { machine: string; folder: string }
/** Same GitHub host forms as legacy, without importing its worker/SSH transport. */
export function githubRemote(url: string) {
  const match = url.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return match && /github/i.test(match[1]) ? `${match[1].toLowerCase()}/${match[2]}` : undefined
}
export class CoreGit {
  constructor(private readonly files: CoreFiles,
    private readonly guard?: (repo: RepoLocation, additional?: string[]) => PilotRepositoryContext | undefined,
    private readonly runtime?: (machine: string) => Promise<{ bun: string; root: string }>) {}
  private async execute(repo: RepoLocation, tool: 'git' | 'gh', args: string[], timeout: number, stdin?: string, additional?: string[]) {
    const context = this.guard?.(repo, additional)
    if (!context) return this.files.exec(repo.machine, [tool, ...args], repo.folder, stdin === undefined ? undefined : Buffer.from(stdin), timeout)
    if (!this.runtime) throw Error('Checked repository runtime is unavailable')
    const runtime = await this.runtime(repo.machine)
    return this.files.exec(repo.machine, [runtime.bun, join(runtime.root, 'helper/core-pilot-git.ts')], undefined,
      Buffer.from(JSON.stringify({ ...context, cwd: repo.folder, tool, args, stdin, timeout: timeout * 1000 })), timeout + 10)
  }
  async run(repo: RepoLocation, args: string[], timeout = 30, stdin?: string, additional?: string[]) { return (await this.execute(repo, 'git', args, timeout, stdin, additional)).toString('utf8').trim() }
  async ghRun(repo: RepoLocation, args: string[], timeout = 60, stdin?: string) { return (await this.execute(repo, 'gh', args, timeout, stdin)).toString('utf8').trim() }
  async head(repo: RepoLocation, ref = 'HEAD') { return this.run(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]) }
  async branchHead(repo: RepoLocation, branch: string) {
    const ref = `refs/heads/${branch}`
    const rows = (await this.run(repo, ['for-each-ref', '--format=%(refname) %(objectname)', ref])).split('\n')
    const row = rows.find(row => row.startsWith(ref + ' '))
    if (!row) return undefined
    const head = row.slice(ref.length + 1)
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error('Git returned an invalid branch identity')
    return head
  }
  async clean(repo: RepoLocation) { return !(await this.run(repo, ['status', '--porcelain'])).length }
  async remote(repo: RepoLocation) {
    if (!(await this.run(repo, ['remote'])).split('\n').includes('origin')) return undefined
    // Both URLs matter when insteadOf rewrites a public GitHub URL to a local host/SSH alias.
    const [used, written] = await Promise.all([this.run(repo, ['remote', 'get-url', 'origin']), this.run(repo, ['config', '--get', 'remote.origin.url'])])
    return githubRemote(used) ?? githubRemote(written)
  }
  async gh<T>(repo: RepoLocation, args: string[], timeout = 60): Promise<T> {
    const text = await this.ghRun(repo, args, timeout)
    return (text ? JSON.parse(text) : undefined) as T
  }
  async contains(repo: RepoLocation, base: string, head: string) {
    const common = await this.run(repo, ['merge-base', base, head])
    return common === await this.head(repo, head)
  }
  async addWorktree(repo: RepoLocation, folder: string, branch: string, base: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(base) || base.includes('..')) throw new Error('Invalid base branch')
    await this.head(repo, base)
    await this.run(repo, ['worktree', 'add', '-b', branch, folder, base], 60, undefined, [folder])
  }
  /** Reopen only the saved branch at its saved location; Git refuses occupied paths without overwriting. */
  async ensureWorktree(repo: RepoLocation, folder: string, branch: string, base: string): Promise<boolean> {
    const blocks = (await this.run(repo, ['worktree', 'list', '--porcelain'])).split('\n\n').map(block => block.split('\n'))
    const ref = `branch refs/heads/${branch}`
    const here = blocks.find(lines => lines.includes(`worktree ${folder}`))
    if (here) {
      if (!here.includes(ref)) throw Error('The saved task folder now belongs to another branch; it was left untouched')
      if (await this.run({ machine: repo.machine, folder }, ['symbolic-ref', '--quiet', 'HEAD']) !== `refs/heads/${branch}`) throw Error('The saved task checkout changed; it was left untouched')
      return false
    }
    if (blocks.some(lines => lines.includes(ref))) throw Error('The saved task branch is checked out elsewhere; it was left untouched')
    if (await this.branchHead(repo, branch)) await this.run(repo, ['worktree', 'add', folder, branch], 60, undefined, [folder])
    else await this.addWorktree(repo, folder, branch, base)
    return true
  }
  async pushTaskBranch(repo: RepoLocation, branch: string, expected?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(branch) || branch.includes('..') || expected !== undefined && !/^[a-f0-9]{40,64}$/.test(expected)) throw Error('Invalid saved task branch identity')
    const ref = `refs/heads/${branch}`
    if (await this.run(repo, ['symbolic-ref', '--quiet', 'HEAD']) !== ref) throw Error('The task branch is not checked out; nothing was pushed')
    const head = await this.head(repo, ref)
    if (!/^[a-f0-9]{40,64}$/.test(head)) throw Error('Git did not return a task commit identity')
    try {
      await this.run(repo, ['push', `--force-with-lease=${ref}:${expected ?? ''}`, 'origin', `${head}:${ref}`], 90)
    } catch (error) {
      // A lost response is not a reason to blindly repeat a force push. Confirm the exact remote commit.
      let remote: string
      try { remote = await this.run(repo, ['ls-remote', '--heads', 'origin', ref], 60) } catch { throw error }
      if (remote !== `${head}\t${ref}`) throw error
    }
    return head
  }
  async syncBase(repo: RepoLocation, base: string, merged: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(base) || base.includes('..') || !/^[a-f0-9]{40,64}$/.test(merged)) throw Error('Invalid confirmed base identity')
    const ref = `refs/shepherdr/base-sync/${createHash('sha256').update(JSON.stringify([repo.machine, repo.folder, base])).digest('hex')}`
    await this.run(repo, ['fetch', '--no-tags', 'origin', `refs/heads/${base}:${ref}`], 90)
    const fetched = await this.head(repo, ref)
    if (!await this.contains(repo, fetched, merged)) throw Error('The fetched base does not contain GitHub’s confirmed merge')
    if (await this.contains(repo, base, merged)) return
    if (await this.run(repo, ['symbolic-ref', '--quiet', 'HEAD']) !== `refs/heads/${base}`) throw Error('The base branch is not checked out')
    await this.fastForward(repo, fetched)
  }
  /** Git alone judges what is at risk, so unrelated local work stays out of the way; a change to a file it ignores counts too. */
  async fastForward(repo: RepoLocation, target: string) {
    try { await this.run(repo, ['merge', '--ff-only', '--no-autostash', '--no-overwrite-ignore', target], 60) }
    catch (error) {
      const files = String((error as Error).message).split('\n').filter(row => row.startsWith('\t')).map(row => row.trim())
      if (!files.length) throw error
      throw new Refusal(`The base checkout's own copy of ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` and ${files.length - 5} more` : ''} would be overwritten. Nothing was changed there. It needs committing, moving or removing first`)
    }
  }
  async findPullRequest(repo: RepoLocation, branch: string, base: string) {
    const remote = await this.remote(repo)
    if (!remote) throw Error('This repository has no GitHub origin')
    const found = await this.gh<{ number: number; headRefName: string; baseRefName: string }[]>(repo, ['pr', 'list', '--repo', remote, '--state', 'open', '--head', branch, '--base', base, '--limit', '100', '--json', 'number,headRefName,baseRefName'])
    if (!Array.isArray(found) || found.length > 1 || found.some(pr => !Number.isSafeInteger(pr.number) || pr.number < 1 || pr.headRefName !== branch || pr.baseRefName !== base)) throw Error('GitHub did not return an unambiguous task pull request')
    return found[0] ? this.pullRequest(repo, String(found[0].number), false) : undefined
  }
  async pullRequest(repo: RepoLocation, branch: string, checks = true) {
    const remote = await this.remote(repo)
    if (!remote) throw Error('This repository has no GitHub origin')
    return this.gh<{ number: number; url: string; state: string; isDraft?: boolean; headRefOid: string; baseRefName: string; mergeCommit?: { oid: string } | null; statusCheckRollup: { conclusion?: string; status?: string; state?: string; name?: string; context?: string; targetUrl?: string; detailsUrl?: string }[] }>(repo,
      ['pr', 'view', branch, '--repo', remote, '--json', `number,url,state,isDraft,headRefOid,baseRefName,mergeCommit${checks ? ',statusCheckRollup' : ''}`])
  }
}
