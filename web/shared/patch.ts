// What the service sends a page after the first snapshot and chat: only what changed (#1468). A busy machine's
// snapshot is over a megabyte (hundreds of tasks), and it was sent whole on every change, to every page.
//
// A snapshot patch, per top-level key: `set` (its new value, whole), `del` (gone), or `items`: a list whose every entry
// has its own string id (tasks, spaces, artifacts, needs) sends the entries that changed and the ids in their new order
// when that changed; a plain object (a record by key: screens, last, read) sends the keys that changed and the ones
// gone. The page applies it to the snapshot it has; one that can't (none yet) asks for the whole again.
//
// A chat patch keeps the first `keep` messages the page has, adds `add` after them, and takes the rest of the chat's
// fields from `chat` (all but messages).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** a list made of entries with their own string ids: a key for each, in order (its id; one that repeats it, as the
 *  same artifact on two machines, its id and how many came before), else null */
export function idsOf(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const ids: string[] = []
  const seen = new Map<string, number>()
  for (const x of v) {
    const id = isObj(x) ? x.id : undefined
    if (typeof id !== 'string') return null
    const n = seen.get(id) ?? 0
    seen.set(id, n + 1)
    ids.push(n ? `${id}\u0000${n}` : id)
  }
  return ids
}

/** One top-level value, cut up so a later one compares part by part: a list by its entries' ids, a record by its
 *  keys, anything else whole. */
interface Part {
  json: string
  value: unknown
  items?: Map<string, string>
  ids?: string[]
  keys?: Map<string, string>
}
/** a snapshot as sent, cut up for diffing */
export interface Cut {
  json: string
  parts: Map<string, Part>
}

export function cut(snap: unknown): Cut {
  const parts = new Map<string, Part>()
  for (const [k, value] of Object.entries(isObj(snap) ? snap : {})) {
    const ids = idsOf(value)
    if (ids) {
      const items = new Map<string, string>()
      const list = value as Obj[]
      list.forEach((x, i) => items.set(ids[i]!, JSON.stringify(x)))
      parts.set(k, { json: '[' + list.map((_, i) => items.get(ids[i]!)).join(',') + ']', value, items, ids })
    } else if (isObj(value)) {
      const keys = new Map<string, string>()
      for (const [kk, vv] of Object.entries(value)) keys.set(kk, JSON.stringify(vv))
      parts.set(k, { json: JSON.stringify(value), value, keys })
    } else parts.set(k, { json: JSON.stringify(value) ?? 'null', value })
  }
  return { json: JSON.stringify(snap), parts }
}

export interface SnapPatch {
  set?: Obj
  del?: string[]
  items?: Record<string, { up?: Obj[]; at?: string[]; rm?: string[]; ids?: string[] }>
  keys?: Record<string, { set?: Obj; del?: string[] }>
}

/** What turns snapshot `a` into `b`; null when nothing changed. */
export function diff(a: Cut, b: Cut): SnapPatch | null {
  if (a.json === b.json) return null
  const p: SnapPatch = {}
  for (const [k, nb] of b.parts) {
    const na = a.parts.get(k)
    if (na && na.json === nb.json) continue
    if (na?.items && nb.items) {
      const up: Obj[] = []
      const at: string[] = []
      ;(nb.value as Obj[]).forEach((x, i) => {
        const id = nb.ids![i]!
        if (na.items!.get(id) !== nb.items!.get(id)) (up.push(x), at.push(id))
      })
      const rm = na.ids!.filter((id) => !nb.items!.has(id))
      const moved = rm.length || na.ids!.length !== nb.ids!.length || na.ids!.some((id, i) => nb.ids![i] !== id)
      ;(p.items ??= {})[k] = { ...(up.length ? { up, at } : {}), ...(rm.length ? { rm } : {}), ...(moved ? { ids: nb.ids } : {}) }
    } else if (na?.keys && nb.keys) {
      const set: Obj = {}
      const v = nb.value as Obj
      for (const [kk, j] of nb.keys) if (na.keys.get(kk) !== j) set[kk] = v[kk]
      const del = [...na.keys.keys()].filter((kk) => !nb.keys!.has(kk))
      ;(p.keys ??= {})[k] = { ...(Object.keys(set).length ? { set } : {}), ...(del.length ? { del } : {}) }
    } else (p.set ??= {})[k] = nb.value
  }
  const del = [...a.parts.keys()].filter((k) => !b.parts.has(k))
  if (del.length) p.del = del
  return p
}

/** Snapshot `snap` with patch `p` applied (a new object; entries that didn't change stay the same objects). */
export function apply<T>(snap: T, p: SnapPatch): T {
  const out: Obj = { ...(snap as Obj) }
  for (const k of p.del ?? []) delete out[k]
  for (const [k, v] of Object.entries(p.set ?? {})) out[k] = v
  for (const [k, d] of Object.entries(p.items ?? {})) {
    const old = Array.isArray(out[k]) ? (out[k] as Obj[]) : []
    const was = idsOf(old) ?? []
    const byId = new Map<string, Obj>(old.map((x, i) => [was[i]!, x]))
    d.up?.forEach((x, i) => byId.set(d.at![i]!, x))
    for (const id of d.rm ?? []) byId.delete(id)
    const ids = d.ids ?? was
    out[k] = ids.map((id) => byId.get(id)).filter((x): x is Obj => !!x)
  }
  for (const [k, d] of Object.entries(p.keys ?? {})) {
    const v: Obj = { ...(isObj(out[k]) ? (out[k] as Obj) : {}) }
    for (const kk of d.del ?? []) delete v[kk]
    Object.assign(v, d.set ?? {})
    out[k] = v
  }
  return out as T
}

export interface ChatPatch {
  keep: number
  add: unknown[]
  chat: Obj
}

/** What turns chat `a` (as last sent, with its messages' JSON) into `b`; null: send it whole (nothing in common). */
export function chatDiff(a: { msgs: string[] }, b: { messages: unknown[] }, bMsgs: string[]): Omit<ChatPatch, 'chat'> | null {
  let keep = 0
  while (keep < a.msgs.length && keep < bMsgs.length && a.msgs[keep] === bMsgs[keep]) keep++
  if (!keep) return null
  return { keep, add: b.messages.slice(keep) }
}

/** Chat `old` with patch `p` applied; null when `old` hasn't the messages it keeps (the page asks for it whole). */
export function chatApply<C extends { messages: unknown[] }>(old: C | undefined, p: ChatPatch): C | null {
  if (!old || old.messages.length < p.keep) return null
  return { ...(p.chat as unknown as C), messages: [...old.messages.slice(0, p.keep), ...p.add] }
}
