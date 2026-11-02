import { expect, test } from 'bun:test'
import { appendFileSync, closeSync, mkdtempSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreNativeFile } from '../server/core/native-file.ts'
import type { CoreFiles } from '../server/core/files.ts'
import { runChild } from './child.ts'

const files = { exec: async (_machine: string, argv: string[], _cwd: string, input: Uint8Array) => {
  return runChild(argv, { input })
} } as unknown as CoreFiles

async function fixture(run: (path: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-native-file-'))
  try { await run(join(home, 'log')) } finally { rmSync(home, { recursive: true, force: true }) }
}

test('native log reads preserve partial lines, UTF-8 and byte offsets across bounded chunks', async () => {
  await fixture(async path => {
    const prefix = 'x'.repeat(1048575)
    writeFileSync(path, prefix + '🙂\r\nsecond')
    const file = new CoreNativeFile(path)
    let resets = 0
    const read = () => file.read(files, 'machine', process.execPath, () => { resets++ })
    expect(await read()).toMatchObject({ lines: [], more: true })
    expect((await read()).lines).toEqual([{ text: prefix + '🙂', offset: 0 }])
    expect((await read()).lines).toEqual([])
    appendFileSync(path, ' line\n')
    expect((await read()).lines).toEqual([{ text: 'second line', offset: Buffer.byteLength(prefix + '🙂\r\n') }])
    expect(resets).toBe(1)
  })
})

test('native log read detects inode replacement and same-size in-place overwrite', async () => {
  await fixture(async path => {
    writeFileSync(path, 'first\n')
    const file = new CoreNativeFile(path)
    let resets = 0
    const read = () => file.read(files, 'machine', process.execPath, () => { resets++ })
    expect((await read()).lines[0]?.text).toBe('first')
    writeFileSync(path, 'other\n')
    expect((await read()).lines[0]?.text).toBe('other')
    renameSync(path, path + '.old'); writeFileSync(path, 'third\n')
    expect((await read()).lines[0]?.text).toBe('third')
    expect(resets).toBe(3)
  })
})

test('a native file larger than core file.read limit is read incrementally without whole-file access', async () => {
  await fixture(async path => {
    const fd = openSync(path, 'w')
    try { writeSync(fd, Buffer.from('start\n'), 0, 6, 0); writeSync(fd, Buffer.from('end\n'), 0, 4, 70 * 1024 * 1024) }
    finally { closeSync(fd) }
    const file = new CoreNativeFile(path)
    const first = await file.read(files, 'machine', process.execPath, () => {})
    expect(first.lines[0]).toEqual({ text: 'start', offset: 0 })
    expect(first.more).toBe(true)
  })
})

test('an overwrite before an unchanged long suffix invalidates a completed cursor', async () => {
  await fixture(async path => {
    const suffix = 'same suffix '.repeat(20) + '\n'
    writeFileSync(path, 'old\n' + suffix)
    const file = new CoreNativeFile(path)
    const read = () => file.read(files, 'machine', process.execPath, () => {})
    await read()
    writeFileSync(path, 'new\n' + suffix)
    expect((await read()).lines[0]?.text).toBe('new')
  })
})

test('an oversized unfinished record is reported once, released and followed by later valid records', async () => {
  const { MAX_NATIVE_RECORD } = await import('../server/core/native-file.ts')
  const chunk = Buffer.alloc(1048576, 'x').toString('base64')
  let count = 0
  const stub = { exec: async (_machine: string, _argv: string[], _cwd: string, input: Uint8Array) => {
    const request = JSON.parse(Buffer.from(input).toString())
    const data = count++ <= MAX_NATIVE_RECORD / 1048576 ? chunk : Buffer.from('\nRECOVERED\n').toString('base64')
    return Buffer.from(JSON.stringify({ data, from: request.from, size: MAX_NATIVE_RECORD + 1048576 + 11, identity: 'file', anchor: 'anchor', modified: 'same' }))
  } } as unknown as CoreFiles
  const file = new CoreNativeFile('/native')
  let warnings = 0
  for (let i = 0; i <= MAX_NATIVE_RECORD / 1048576; i++) {
    const result = await file.read(stub, 'machine', 'bun', () => {})
    expect(result.lines).toEqual([])
    if (result.oversized) warnings++
  }
  const recovered = await file.read(stub, 'machine', 'bun', () => {})
  expect(warnings).toBe(1)
  expect(recovered.lines).toEqual([{ text: 'RECOVERED', offset: MAX_NATIVE_RECORD + 1048576 + 1 }])
})
