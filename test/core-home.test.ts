import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectHome, prepareHome, readCredential } from '../server/core/home.ts'
import { CoreStore } from '../server/core/store.ts'

test('legacy home is classified without writes and startup refuses to reuse it', () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-legacy-'))
  try {
    const original = '{"legacy":true}\n'
    writeFileSync(join(home, 'tasks.json'), original)
    expect(inspectHome(home)).toBe('legacy')
    expect(() => prepareHome(home)).toThrow('legacy state')
    expect(readFileSync(join(home, 'tasks.json'), 'utf8')).toBe(original)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('fresh core home has stable identity and cannot be a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-home-'))
  try {
    const first = prepareHome(join(root, 'fresh'))
    expect(prepareHome(join(root, 'fresh'))).toEqual(first)
    symlinkSync(join(root, 'fresh'), join(root, 'link'))
    expect(() => prepareHome(join(root, 'link'))).toThrow('real directory')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('credential must be a private owned regular file, not a symlink', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-credential-'))
  try {
    writeFileSync(join(root, 'good'), '{"example":true}', { mode: 0o600 })
    writeFileSync(join(root, 'public'), '{}', { mode: 0o644 })
    symlinkSync(join(root, 'good'), join(root, 'link'))
    expect(readCredential(join(root, 'good'))).toEqual({ example: true })
    expect(() => readCredential(join(root, 'public'))).toThrow('private file')
    expect(() => readCredential(join(root, 'link'))).toThrow('private file')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('browser command idempotency persists outcomes across restart and rejects changed inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-command-'))
  const home = join(root, 'state')
  let store = new CoreStore(home), effects = 0
  try {
    const command = async () => ({ result: ++effects })
    expect(await store.command('command-123', { type: 'send', text: 'hello' }, command)).toEqual({ result: 1 })
    store.close(); store = new CoreStore(home)
    expect(await store.command('command-123', { type: 'send', text: 'hello' }, command)).toEqual({ result: 1 })
    await expect(store.command('command-123', { type: 'send', text: 'different' }, command)).rejects.toMatchObject({ kind: 'conflict' })
    expect(effects).toBe(1)
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})

test('installation IDs cannot inject paths into remote helper or export locations', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-marker-'))
  try {
    prepareHome(root)
    writeFileSync(join(root, 'installation.json'), JSON.stringify({ format: 'shepherdr-core', schema: 1, id: '../../other' }))
    expect(() => prepareHome(root)).toThrow('Unsupported Shepherdr home format')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('standalone core startup drops what a launching agent leaves in its environment', async () => {
  const { coreEnvironment } = await import('../server/core/config.ts')
  const left = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'HC_SCOPE', 'HC_TERMINAL_SOCKET', 'HC_TERMINAL_ID']
  const before = Object.fromEntries(['KEEP_THIS', ...left].map(key => [key, process.env[key]]))
  try {
    for (const key of ['KEEP_THIS', ...left]) process.env[key] = '1'
    const env = coreEnvironment({ home: '/private/preview', port: 17887, session: 'preview', socket: '/private/core.sock', binary: 'hc' })
    for (const key of left) expect(env[key]).toBeUndefined()
    expect(env).toMatchObject({ KEEP_THIS: '1', HC_SESSION: 'preview', HC_SOCKET: '/private/core.sock' })
  } finally { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } }
})

test('standalone core startup never inherits another task browser route', async () => {
  const { coreEnvironment } = await import('../server/core/config.ts')
  const before = process.env.AGENT_BROWSER_CDP
  try {
    process.env.AGENT_BROWSER_CDP = 'ws://old-session'
    const env = coreEnvironment({ home: '/private/preview', port: 17887, session: 'preview', socket: '/private/core.sock', binary: 'hc' })
    expect(env.AGENT_BROWSER_CDP).toBeUndefined()
    expect(env.HC_SESSION).toBe('preview')
  } finally { if (before === undefined) delete process.env.AGENT_BROWSER_CDP; else process.env.AGENT_BROWSER_CDP = before }
})
