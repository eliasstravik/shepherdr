// Find machines' answers kept for the page (#1108): when its cooldown ends, counted on this device's clock from the
// answer's wait (the label counts down and the button comes back without a reload), and a failed read kept apart
// from the last good one, so a first read that failed can be tried again.
export type Host = { to: string; over: string; ok?: boolean; state?: string; core?: string; linked?: boolean }
export type Got = {
  hosts: Host[]
  last: { at: number; hosts: (Host | null)[]; running?: boolean } | null
  wait_ms: number
  error?: string
  /** when the cooldown ends, on this device's clock */
  until?: number
}

/** the page's state after an answer that came at `at`: a failure keeps what was there (its hosts, its cooldown) */
export function settle(prev: Got | null, r: Got, at: number): Got {
  if (r.error) return { ...(prev ?? { hosts: [], last: null, wait_ms: 0 }), error: r.error }
  return { ...r, until: at + (r.wait_ms || 0) }
}

/** ms of cooldown left at `now` */
export const left = (g: Got | null, now: number) => Math.max(0, (g?.until ?? 0) - now)

/** nothing read yet but a failure: the button reads the list again */
export const retryRead = (g: Got | null) => !!g?.error && !g.hosts.length && !g.last

/** ms until the label's whole minutes change (mins() rounds up), a moment after; at the end, the button is back */
export const nextLook = (wait: number) => (wait % 60000 || 60000) + 50
