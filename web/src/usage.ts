// Usage insights in the web app (the "insights" add-on, docs/insights.md): what is on screen and for how long, the
// actions pressed, features used and errors met, sent in a batch every 30 s to this app's own service
// (POST api/action { type: "usage" }), which keeps them on its machine (service/usage.ts). Kinds, ids, counts and
// times only: never a message's words. Nothing else is called: no other server, no analytics library.
// The service answers on: false while the add-on is off: the page then keeps nothing until it loads again.

type Event = Record<string, unknown> & { kind: string }

/** the parts of the screen a view is made of (kernel.ts UI) */
export interface Shown {
  device: string
  place: string
  task: string | null
  tab: string
  side: string
  sheet: string | null
  viewer: { artifact: string } | null
  settings: { section: number | null } | null
  search: boolean
  adding: boolean | string
}

let buf: Event[] = []
let off = false
let surface = 'web'
let shown: { key: string; fields: Record<string, unknown>; since: number } | null = null
const sent = new Set<string>()

const flat = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''))

/** what a screen is, as an event's fields */
export function viewOf(ui: Shown): Record<string, unknown> {
  const view = ui.settings ? 'settings' : ui.viewer ? 'artifact' : ui.search ? 'search' : ui.adding ? 'add-project' : ui.task ? 'task' : 'place'
  return flat({
    view,
    space: ui.place,
    task: ui.task,
    tab: ui.device === 'phone' ? ui.tab : ui.task ? (ui.sheet ?? ui.side) : ui.side,
    artifact: ui.viewer?.artifact,
    section: ui.settings?.section != null ? String(ui.settings.section) : null,
  })
}

export function note(kind: string, fields: Record<string, unknown> = {}) {
  if (off) return
  buf.push({ ...fields, kind, from: surface, at: Date.now() })
  if (buf.length >= 200) void flush()
}

/** The screen now (each change of it): the one before ends, with its time. A page out of sight shows nothing. */
export function noteView(ui: Shown) {
  surface = ui.device === 'phone' ? 'phone' : 'web'
  // off: no view is timed, so turning it on again starts from then
  if (off) {
    shown = null
    return
  }
  const fields = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? null : viewOf(ui)
  const key = fields ? JSON.stringify(fields) : ''
  if (shown?.key === key) return
  const now = Date.now()
  if (shown?.key) note('view', { ...shown.fields, ms: now - shown.since })
  shown = { key, fields: fields ?? {}, since: now }
}

/** An action pressed (kernel.ts act): its type (a setting's key too, never its value). A send counts once, however
 *  often the outbox retries it. */
export function noteAct(a: { type: string; cid?: string; key?: unknown }) {
  if (a.type === 'usage') return
  // Delete: what this page still holds goes too, and the screen on now counts from now
  if (a.type === 'setting' && a.key === 'insights.delete') {
    buf = []
    if (shown) shown = { ...shown, since: Date.now() }
    return
  }
  if (a.type === 'send') {
    if (a.cid && sent.has(a.cid)) return
    if (a.cid) sent.add(a.cid)
    return note('send')
  }
  note('act', { type: a.type, ...(a.type === 'setting' && typeof a.key === 'string' ? { key: a.key } : {}) })
}

/** The add-ons switched off, from each snapshot: off, nothing is kept or sent; on again, it starts afresh. */
export function followOff(list: string[] | undefined) {
  const now = !!list?.includes('insights')
  if (now && !off) {
    buf = []
    shown = null
  }
  off = now
}

export async function flush(keepalive = false) {
  if (off || !buf.length) return
  const events = buf
  buf = []
  try {
    const r = await fetch('api/action', { method: 'POST', keepalive, headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify({ type: 'usage', events }) })
    if ((await r.json().catch(() => ({})))?.on === false) followOff(['insights'])
  } catch {
    /* offline: these are dropped, never worth a retry */
  }
}

/** Every 30 s, and when the page goes out of sight (the view it showed ends then). */
export function startUsage(current: () => Shown) {
  if (typeof window === 'undefined') return
  setInterval(() => void flush(), 30_000)
  document.addEventListener('visibilitychange', () => {
    noteView(current())
    if (document.visibilityState === 'hidden') void flush(true)
  })
}

/** tests: back to a fresh page */
export function resetUsage() {
  buf = []
  off = false
  shown = null
  sent.clear()
}
export const pending = () => buf
