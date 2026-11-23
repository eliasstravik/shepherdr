// The warnings line's close: what was closed is kept as the warnings' ids, and the line stays away while every warning
// now showing is one of them. One that goes away leaves the set, so if it comes back it counts as new.

/** the ids a stored dismiss holds ("a|b"), none for nothing stored */
export const idsOf = (what: string | null | undefined): string[] => (what ? what.split('|').filter(Boolean) : [])

/** the line shows when a warning is there that wasn't closed */
export const showing = (now: string[], closed: string[]): boolean => now.some((id) => !closed.includes(id))

/** the closed set, less what's no longer there: null once nothing in it is */
export function kept(now: string[], closed: string[]): string | null {
  const left = closed.filter((id) => now.includes(id))
  return left.length ? [...left].sort().join('|') : null
}
