import { expect, test } from 'bun:test'
import { failureLogTail } from '../server/core/github-logs.ts'
import type { CoreGit } from '../server/core/git.ts'
const repo = { machine: 'machine', folder: '/scratch' }
const jobs = { total_count: 1, jobs: [{ id: 9, name: 'Build', status: 'completed', conclusion: 'failure' }] }

test('failed logs stay on the configured GitHub host and remove terminal controls', async () => {
  const calls: string[][] = []
  const git = { gh: async (_repo: unknown, args: string[]) => { calls.push(args); return jobs }, ghRun: async (_repo: unknown, args: string[]) => {
    calls.push(args)
    if (!args.includes('--allow-escape-sequences')) throw Error('the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway')
    return '\u001b[31mEXPECTED_FAILURE\u001b[0m\u0007'
  } } as unknown as CoreGit
  expect(await failureLogTail(git, repo, 'github.example/owner/repo', 12)).toBe('\nBuild\nEXPECTED_FAILURE')
  expect(calls).toHaveLength(3)
  for (const args of calls) expect(args.slice(0, 3)).toEqual(['api', '--hostname', 'github.example'])
})

test('invalid jobs and permission failures never trigger another authority or a misleading log tail', async () => {
  for (const result of [null, {}, { ...jobs, total_count: 101 }, { ...jobs, jobs: [{ ...jobs.jobs[0], id: -1 }] }, { ...jobs, jobs: [] }]) {
    const git = { gh: async () => result, ghRun: async () => { throw Error('Must not fetch invalid job logs') } } as unknown as CoreGit
    await expect(failureLogTail(git, repo, 'github.example/owner/repo', 12)).rejects.toThrow()
  }
  let reads = 0
  const git = { gh: async () => jobs, ghRun: async () => { reads++; throw Error('HTTP 403') } } as unknown as CoreGit
  await expect(failureLogTail(git, repo, 'github.example/owner/repo', 12)).rejects.toThrow('HTTP 403')
  expect(reads).toBe(1)
})
