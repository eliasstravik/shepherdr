/** Familiar compact elapsed time, shared by product views. */
export function age(at: number, now = Date.now()) {
  const seconds = Math.max(0, (now - at) / 1000)
  return seconds < 60 ? 'now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`
}
