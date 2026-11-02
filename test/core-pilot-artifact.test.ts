import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, linkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { pilotArtifact } from '../helper/core-pilot-artifact.ts'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'shep-pilot-artifact-')), root = join(base, 'pilot-fixture'), repo = join(base, 'repo')
  for (const p of [root, repo, join(root, 'control'), join(root, 'captures')]) mkdirSync(p, { mode: 0o700 })
  return { base, root, repo, input: { captures: join(root, 'captures'), cwd: repo, repo }, close: () => rmSync(base, { recursive: true, force: true }) }
}

test('contained artifact exports live in immutable control, return namespace paths, and retain full bounded bytes', async () => {
  const f = fixture()
  try {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 65)
    const path = await pilotArtifact({ ...f.input, op: 'export', name: '../../page.html', data: bytes.toString('base64') })
    expect(path).toMatch(/^\/run\/shepherdr\/artifacts\/[a-f0-9]{16}-page.html$/)
    expect(readFileSync(join(f.root, 'control/artifacts', basename(path)))).toEqual(bytes)
    await expect(pilotArtifact({ ...f.input, op: 'export', data: Buffer.alloc(bytes.length + 1).toString('base64') })).rejects.toThrow('over 2 MiB')
    await expect(pilotArtifact({ ...f.input, op: 'export', data: 'malformed===' })).rejects.toThrow('encoding')
  } finally { f.close() }
})

test('artifact export refuses an agent-controlled directory link instead of writing through it', async () => {
  const f = fixture()
  try {
    symlinkSync(f.repo, join(f.root, 'control/artifacts'))
    await expect(pilotArtifact({ ...f.input, op: 'export', data: 'aGVsbG8=' })).rejects.toThrow('private and real')
    await expect(pilotArtifact({ ...f.input, captures: join(f.root, 'home'), op: 'export', data: 'aGVsbG8=' })).rejects.toThrow('Invalid private')
  } finally { f.close() }
})


const bwrap = Bun.which('bwrap')
const namespaces = !!bwrap && Bun.spawnSync([bwrap, '--unshare-all', '--ro-bind', '/', '/', '/bin/true'], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
// CI runners without unprivileged user namespaces report this case skipped; no host-read substitute.
test.skipIf(!namespaces)('real namespace reads full project bytes and exports but refuses private links and shared files', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.base, 'private.txt'), 'OUTSIDE_PRIVATE')
    writeFileSync(join(f.repo, 'page.html'), '<h1>PROJECT_OK</h1>')
    symlinkSync(join(f.base, 'private.txt'), join(f.repo, 'escape.txt'))
    linkSync(join(f.base, 'private.txt'), join(f.repo, 'shared.txt'))
    // An agent-controlled Bun preload must never be evaluated by the file reader.
    writeFileSync(join(f.repo, 'bunfig.toml'), 'preload = ["./preload.ts"]')
    writeFileSync(join(f.repo, 'preload.ts'), `await Bun.write(${JSON.stringify(join(f.repo, 'executed'))}, 'BAD'); console.log('PRELOAD_RAN')`)
    const read = (path: string) => pilotArtifact({ ...f.input, op: 'read', path, max: 2 * 1024 * 1024 })
    expect(Buffer.from(await read('page.html'), 'base64').toString()).toBe('<h1>PROJECT_OK</h1>')
    expect(existsSync(join(f.repo, 'executed'))).toBe(false)
    await expect(read('escape.txt')).rejects.toThrow()
    await expect(read('shared.txt')).rejects.toThrow()
    await expect(read(join(f.base, 'private.txt'))).rejects.toThrow()
    const exported = await pilotArtifact({ ...f.input, op: 'export', data: 'RVhQT1JUX09L' })
    expect(Buffer.from(await read(exported), 'base64').toString()).toBe('EXPORT_OK')
  } finally { f.close() }
})
