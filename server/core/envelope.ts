import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export interface MailCredential {
  version: 1
  server: string
  grant: string
  machine: string
  key: string
}
export interface Envelope { version: 1; iv: string; tag: string; body: string }
const LIMIT = 128 * 1024

/** Names a tool call's input in hook records without copying it there. */
export const toolHash = (input: unknown) => createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex').slice(0, 24)

function aad(credential: MailCredential, id: string, direction: 'request' | 'response') {
  return Buffer.from(JSON.stringify([1, credential.server, credential.grant, credential.machine, id, direction]))
}
function key(credential: MailCredential) {
  const bytes = Buffer.from(credential.key, 'base64')
  if (bytes.length !== 32) throw new Error('Invalid mailbox credential')
  return bytes
}

/** Payloads, including secret replies, remain opaque to document readers. */
export function seal(credential: MailCredential, id: string, direction: 'request' | 'response', value: unknown): Envelope {
  const plaintext = Buffer.from(JSON.stringify(value))
  if (plaintext.length > LIMIT) throw new Error('Mailbox message is too large; use a file reference')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(credential), iv)
  cipher.setAAD(aad(credential, id, direction))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') }
}

export function unseal<T>(credential: MailCredential, id: string, direction: 'request' | 'response', envelope: unknown): T {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid mailbox envelope')
  const e = envelope as Envelope
  if (e.version !== 1 || typeof e.body !== 'string' || e.body.length > LIMIT * 2 || typeof e.iv !== 'string' || typeof e.tag !== 'string') throw new Error('Invalid mailbox envelope')
  const iv = Buffer.from(e.iv, 'base64'), tag = Buffer.from(e.tag, 'base64')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid mailbox envelope')
  const decipher = createDecipheriv('aes-256-gcm', key(credential), iv)
  decipher.setAAD(aad(credential, id, direction)); decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(Buffer.from(e.body, 'base64')), decipher.final()])
  if (plaintext.length > LIMIT) throw new Error('Mailbox message is too large')
  return JSON.parse(plaintext.toString('utf8')) as T
}
