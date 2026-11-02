import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, utimesSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PilotCapture, type PilotCapturePacket } from '../helper/core-pilot-capture.ts'

async function fixture(run: (home: string, file: string) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'shep-pilot-capture-')), folder = join(home, '.claude/projects/repo')
  mkdirSync(folder, { recursive: true })
  try { await run(home, join(folder, 'session.jsonl')) } finally { rmSync(home, { recursive: true, force: true }) }
}
test('native capture delivers all chunk bytes, detects same-size rewrites and keeps retry identity stable', async () => fixture(async (home, file) => {
  const packets: PilotCapturePacket[] = [], input = Buffer.from('é'.repeat(150_000))
  writeFileSync(file, input)
  const capture = new PilotCapture(home, async packet => { packets.push(packet) })
  for (let i = 0; i < 3; i++) await capture.poll()
  expect(Buffer.concat(packets.map(packet => Buffer.from(packet.data, 'base64')))).toEqual(input)
  expect(packets.map(packet => packet.offset)).toEqual([0, 131072, 262144])
  expect((await capture.poll()).complete).toBe(true)
  const count = packets.length
  // Same inode, same size, unchanged tail: modification metadata still forces a reread.
  writeFileSync(file, Buffer.concat([Buffer.from('x'), input.subarray(1)]))
  utimesSync(file, new Date('2030-01-01'), new Date('2030-01-01'))
  await capture.poll()
  expect(packets[count]).toMatchObject({ offset: 0, reset: true })
  expect(packets[count].identity).not.toBe(packets[0].identity)
  let reject = true; const retries: PilotCapturePacket[] = []
  const retrying = new PilotCapture(home, async packet => { retries.push(packet); if (reject) { reject = false; throw Error('response lost') } })
  expect((await retrying.poll()).complete).toBe(false)
  await retrying.poll()
  expect(retries[1]).toEqual(retries[0])
}))
test('appended native lines retain offsets; rotating batches include the thirty-third transcript', async () => fixture(async (home, file) => {
  writeFileSync(file, 'first\n')
  const packets: PilotCapturePacket[] = [], capture = new PilotCapture(home, async packet => { packets.push(packet) })
  await capture.poll(); appendFileSync(file, 'second\n'); await capture.poll()
  expect(packets[1]).toMatchObject({ offset: 6, reset: false, identity: packets[0].identity })
  for (let i = 0; i < 32; i++) writeFileSync(join(home, '.claude/projects/repo', `child-${i}.jsonl`), 'child\n')
  await capture.poll(); expect((await capture.poll()).complete).toBe(true)
  expect(new Set(packets.map(packet => packet.file)).size).toBe(33)
}))
test('cancelling an in-flight capture stops the batch without advancing its byte cursor', async () => fixture(async (home, file) => {
  writeFileSync(file, 'native\n')
  const abort = new AbortController(); let arrived!: () => void; let hold = true
  const receiving = new Promise<void>(resolve => { arrived = resolve })
  const packets: PilotCapturePacket[] = []
  const capture = new PilotCapture(home, (packet, signal) => {
    packets.push(packet); if (!hold) return Promise.resolve()
    return new Promise((_resolve, reject) => {
      arrived(); signal!.addEventListener('abort', () => reject(Error('cancelled')), { once: true })
    })
  })
  const polling = capture.poll(abort.signal); await receiving; abort.abort()
  expect((await polling).complete).toBe(false)
  expect(packets).toHaveLength(1)
  hold = false; await capture.poll()
  expect(packets[1]).toEqual(packets[0])
}))

test('an unread file removed before its rotated batch cannot leave capture permanently pending', async () => fixture(async (home, file) => {
  const folder = join(home, '.claude/projects/repo'), seen = new Set<string>()
  for (let i = 0; i < 33; i++) writeFileSync(join(folder, `child-${i}.jsonl`), 'child\n')
  const capture = new PilotCapture(home, async packet => { seen.add(packet.file.split('/').at(-1)!) })
  expect((await capture.poll()).complete).toBe(false)
  const unread = readdirSync(folder).find(name => !seen.has(name))!
  rmSync(join(folder, unread))
  expect((await capture.poll()).complete).toBe(true)
}))

test('truncate-to-empty sends an acknowledged reset instead of leaving stale outside history', async () => fixture(async (home, file) => {
  writeFileSync(file, 'old native turn\n')
  const packets: PilotCapturePacket[] = []
  let loseReset = true
  const capture = new PilotCapture(home, async packet => {
    packets.push(packet)
    if (packet.reset && !packet.data && loseReset) { loseReset = false; throw Error('reset response lost') }
  })
  await capture.poll()
  writeFileSync(file, '')
  expect((await capture.poll()).complete).toBe(false)
  expect((await capture.poll()).complete).toBe(true)
  expect(packets[1]).toMatchObject({ offset: 0, reset: true, data: '' })
  expect(packets[2]).toEqual(packets[1])
  expect(packets[1].identity).not.toBe(packets[0].identity)
}))
