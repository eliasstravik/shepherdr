import { createHash } from 'node:crypto'
/** Keep agent-browser's Unix socket paths short; full installation/chat IDs stay in our records. */
export const browserNamespace = (installation: string) => `sc-${createHash('sha256').update(installation).digest('hex').slice(0, 12)}`
export const browserSession = (chat: string) => createHash('sha256').update(chat).digest('hex').slice(0, 16)
