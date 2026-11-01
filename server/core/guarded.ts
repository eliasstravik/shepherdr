const said = new Map<string, { text: string; at: number }>()
const REPEAT = 60_000

/** Work a timer or core event starts and nobody awaits: it comes round again by itself, so a failure (a database lock
 *  that outlasted its wait) is logged, once a minute while it stays the same, and never left to end the app. */
export async function guarded(name: string, work: () => unknown) {
  try { await work() } catch (error) {
    const text = (error as Error)?.message ?? String(error), last = said.get(name), now = Date.now()
    if (last?.text === text && now - last.at < REPEAT) return
    said.set(name, { text, at: now })
    console.error(`${name} failed; it tries again on its next tick: ${text}`)
  }
}
