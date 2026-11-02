import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PilotRecords } from '../helper/core-pilot-records.ts'
import type { PilotCapturePacket } from '../helper/core-pilot-capture.ts'

test('outside native capture writer restores cursor, accepts identical retries and resets empty history', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-records-'))
  let records = new PilotRecords(root)
  const packet = (offset: number, text: string, identity = '1:2:0', reset = offset === 0): PilotCapturePacket => ({ file: '.claude/projects/repo/session.jsonl', identity, offset, reset, data: Buffer.from(text).toString('base64') })
  try {
    expect(records.write(packet(0, 'first\n'))).toEqual({ offset: 6 })
    expect(records.write(packet(0, 'first\n'))).toEqual({ offset: 6 })
    records.close(); records = new PilotRecords(root)
    // Simulate data reaching disk before its cursor transaction committed.
    appendFileSync(records.path(packet(0, '').file), 'sec')
    expect(records.write(packet(6, 'second\n'))).toEqual({ offset: 13 })
    expect(readFileSync(records.path(packet(0, '').file), 'utf8')).toBe('first\nsecond\n')
    expect(() => records.write(packet(3, 'BAD', '1:2:0', false))).toThrow('differs')
    expect(() => records.write(packet(50, 'gap', '1:2:0', false))).toThrow('gap')
    expect(records.write(packet(0, '', '1:2:1'))).toEqual({ offset: 0 })
    expect(readFileSync(records.path(packet(0, '').file), 'utf8')).toBe('')
    expect(records.write(packet(0, '', '1:2:1'))).toEqual({ offset: 0 })
  } finally { records.close(); rmSync(root, { recursive: true, force: true }) }
})
test('capture bytes cannot escape through names, symlink parents or existing host files', () => {
  const root = mkdtempSync(join(tmpdir(), 'shep-pilot-records-')), captures = join(root, 'captures'), outside = join(root, 'outside')
  mkdirSync(captures, { mode: 0o700 }); mkdirSync(outside, { mode: 0o700 }); writeFileSync(join(outside, 'secret'), 'untouched')
  const records = new PilotRecords(captures)
  const packet: PilotCapturePacket = { file: '.claude/projects/repo/session.jsonl', identity: '1:2:0', offset: 0, reset: true, data: Buffer.from('bytes').toString('base64') }
  try {
    for (const file of ['../../outside/secret', '.claude/projects/../../../outside/secret.jsonl', '/tmp/out.jsonl', '.claude/projects/repo/../session.jsonl']) expect(() => records.write({ ...packet, file })).toThrow('name')
    symlinkSync(outside, join(captures, '.claude'))
    expect(() => records.write(packet)).toThrow('private')
    expect(readFileSync(join(outside, 'secret'), 'utf8')).toBe('untouched')
  } finally { records.close(); rmSync(root, { recursive: true, force: true }) }
})
