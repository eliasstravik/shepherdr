// How the live link to the server comes back. A phone back from the background finds its socket dead, sometimes
// still looking open, and its network can take a moment to wake: the link is tried again at once and then more and
// more slowly, a try that hangs is given up, and the top line says the link is gone only once it has been gone a while.

/** wait before the next try after `tries` failed ones in a row: at once, then 0.5 s, 1 s, 2 s, then every 3 s */
export const retryIn = (tries: number) => (tries <= 0 ? 0 : Math.min(3000, 500 * 2 ** (tries - 1)))

/** a socket not open by then is given up and tried again (a waking network can hold a try for many seconds) */
export const OPEN_WITHIN = 4000

/** back on screen, an open socket must answer a ping this fast or it is replaced (one the phone killed asleep) */
export const PONG_WITHIN = 1500

/** the top line says the link is gone only after this long without it: a quick reconnect shows nothing */
export const SAY_LOST_AFTER = 3000
