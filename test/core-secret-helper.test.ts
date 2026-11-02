import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { secretEnv } from '../helper/core-secret.ts'

test('secret run masks short values split across native stdout and stderr chunks', async () => {
  // Synthetic sentinels only. Exercise the actual helper without provider/core credentials.
  const helper = new URL('../helper/core-secret.ts', import.meta.url).pathname
  const script = `const {secretRun}=await import(${JSON.stringify(helper)});process.exitCode=await secretRun([process.execPath,'-e',"process.stdout.write('x');process.stderr.write('a');setTimeout(()=>{process.stdout.write('yz');process.stderr.write('bc')},30)"],{ONE:'xyz',TWO:'abc'})`
  const child = Bun.spawn([process.execPath, '-e', script], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code).toBe(0); expect(out).toBe('********'); expect(err).toBe('********')
})

test('env refuses a path outside an ignored git worktree', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-secret-env-'))
  try {
    const file = join(home, '.env')
    expect(secretEnv(['secret', 'env', 'DEMO', '--file', file], { DEMO: 'synthetic' }).code).toBe(1)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('env refuses an ignored nonregular target before trying to read it', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-secret-fifo-'))
  try {
    const git = Bun.spawnSync(['git', 'init', root])
    expect(git.exitCode).toBe(0)
    writeFileSync(join(root, '.gitignore'), '.env\n')
    const file = join(root, '.env')
    expect(Bun.spawnSync(['mkfifo', file]).exitCode).toBe(0)
    expect(secretEnv(['secret', 'env', 'DEMO', '--file', file], { DEMO: 'synthetic' })).toMatchObject({ code: 1 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
