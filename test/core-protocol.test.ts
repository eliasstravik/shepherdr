import { expect, test } from 'bun:test'
import { FRAME, MAX_FRAME, FrameReader, encodeFrame } from '../server/core/protocol.ts'
import { seal, unseal, type MailCredential } from '../server/core/envelope.ts'

test('framed transport preserves split headers, split UTF-8 and coalesced frames', () => {
  const reader = new FrameReader()
  const received: unknown[] = []
  const bytes = Buffer.concat([encodeFrame(0, FRAME.data, Buffer.from('one')), encodeFrame(4, FRAME.data, Buffer.from('héllo'))])
  for (const byte of bytes) reader.push(Buffer.from([byte]), (channel, kind, body) => received.push([channel, kind, body.toString()]))
  expect(received).toEqual([[0, FRAME.data, 'one'], [4, FRAME.data, 'héllo']])
  const together: string[] = []
  reader.push(bytes, (_, __, body) => together.push(body.toString()))
  expect(together).toEqual(['one', 'héllo'])
})

test('rejects oversized frame from its header before accumulating its claimed body', () => {
  const header = Buffer.alloc(9)
  header.writeUInt32LE(MAX_FRAME + 1, 5)
  expect(() => new FrameReader().push(header, () => {})).toThrow('16 MiB')
})

const credential: MailCredential = { version: 1, grant: 'grant', server: 'server', machine: 'machine', key: Buffer.alloc(32, 5).toString('base64') }
test('mailbox ciphertext binds installation, machine, grant, request id and direction', () => {
  const encrypted = seal(credential, 'request-id', 'request', { action: 'secret', args: { name: 'EXAMPLE_KEY' } })
  expect(JSON.stringify(encrypted)).not.toContain('EXAMPLE_KEY')
  expect(unseal(credential, 'request-id', 'request', encrypted)).toEqual({ action: 'secret', args: { name: 'EXAMPLE_KEY' } })
  for (const other of [{ ...credential, server: 'other' }, { ...credential, machine: 'other' }, { ...credential, grant: 'other' }, { ...credential, key: Buffer.alloc(32, 7).toString('base64') }]) {
    expect(() => unseal(other, 'request-id', 'request', encrypted)).toThrow()
  }
  expect(() => unseal(credential, 'other-id', 'request', encrypted)).toThrow()
  expect(() => unseal(credential, 'request-id', 'response', encrypted)).toThrow()
  expect(() => unseal(credential, 'request-id', 'request', { ...encrypted, body: Buffer.from('tampered').toString('base64') })).toThrow()
})
