import { randomUUID } from 'node:crypto'
import { CoreClient, CoreError, type CoreEndpoint } from './client.ts'
import { requestMail } from './mailbox.ts'
import type { MailCredential } from './envelope.ts'

/** Helpers survive a core reconnect by resubmitting the SAME authenticated request id/input.
 * A semantic uncertain response is returned to the caller, never retried as a new action.
 * once: a caller that knows waiting can't help gives up if it never connected, when nothing has been sent. */
export async function coreRequest(endpoint: CoreEndpoint, credential: MailCredential, action: string, args: unknown,
  options: { id?: string; timeout?: number; signal?: AbortSignal; once?: boolean } = {}): Promise<unknown> {
  const id = options.id ?? randomUUID(), deadline = Date.now() + (options.timeout ?? 60_000)
  let attempt = 0
  for (;;) {
    options.signal?.throwIfAborted()
    let client: CoreClient | undefined
    try {
      client = await CoreClient.endpoint(endpoint)
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new CoreError('uncertain', `Request ${id} expired; check its outcome`)
      return await requestMail(client, credential, action, args, { id, timeout: remaining, signal: options.signal })
    } catch (error) {
      if (!(error instanceof CoreError) || !['unavailable', 'disconnected', 'closed'].includes(error.kind) || Date.now() >= deadline || options.once && !client) throw error
      await Bun.sleep(Math.min(2000, 100 * 2 ** Math.min(attempt++, 5), Math.max(1, deadline - Date.now())))
    } finally { client?.close() }
  }
}
