// The order of the sidebar: the machines, each machine's spaces under it, and the sections the human made, as Slack's.
// A to Z until the human drags one; then the order they left is kept (by the main machine, so every device sees it), and
// one added later slots in where A to Z puts it among the rest. A machine's home space comes first until it is dragged.
// Sections only organize spaces: one at the top, beside Pinned (a built-in one, never deleted), holds any machine's
// spaces; one inside a machine holds only that machine's. A space sits in one section at most and moves there, out of
// its machine's list; taken out (or its section deleted) it is back where it was under its machine.
import { NAME_MAX, type Machine, type Place, type Section } from './types.ts'

/** the order the human left, by what it is under: 'all' for the machines, a machine's id for its spaces, a section's
 *  id (PINNED too) for the spaces in it, TOP for the sections at the top and sectionsIn(machine id) for a machine's */
export type PlaceOrder = Record<string, string[]>

/** the spaces pinned at the top of the sidebar: the built-in section, kept with the order */
export const PINNED = 'pinned'

/** where the order of the sections at the top is kept, Pinned among them */
export const TOP = 'sections'

/** where the order of a machine's sections is kept */
export const sectionsIn = (machineId: string) => `sections:${machineId}`

/** a section the human made (s:<id>): its name, its emoji, and the machine (its key) it is inside, none at the top */
export interface SectionDef {
  name: string
  emoji?: string
  machine?: string
}

export type SectionDefs = Record<string, SectionDef>

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }) || (a < b ? -1 : a > b ? 1 : 0)

/** items in the saved order; those it doesn't name go right after the last one before them A to Z, or first (all A to Z
 *  when none is saved): a favourite dragged to the top stays there */
export function ordered<T extends object>(items: T[], saved: string[] | undefined, id: (x: T) => string, name: (x: T) => string): T[] {
  const known = new Map(items.map((x) => [id(x), x]))
  const out = [...new Set(saved ?? [])].flatMap((k) => (known.has(k) ? [known.get(k)!] : []))
  const kept = new Set(out)
  for (const x of items.filter((x) => !kept.has(x)).sort((a, b) => byName(name(a), name(b)))) {
    out.splice(out.findLastIndex((y) => byName(name(y), name(x)) < 0) + 1, 0, x)
  }
  return out
}

/** ids in the saved order, then those it doesn't name in their own (a new section goes last) */
const listed = (ids: string[], saved: string[] | undefined) => {
  const first = [...new Set(saved ?? [])].filter((x) => ids.includes(x))
  return [...first, ...ids.filter((x) => !first.includes(x))]
}

/** a machine's spaces in the human's order, those in sections too: its home space first until it is dragged */
function machineSpaces(places: Place[], m: Machine, order: PlaceOrder) {
  const mine = places.filter((p) => p.machine === m.machine)
  const saved = order[m.id]
  const home = mine.filter((p) => p.home && !saved?.includes(p.id))
  return [...home, ...ordered(mine.filter((p) => !home.includes(p)), saved, (p) => p.id, (p) => p.name)]
}

/** the machines in the human's order; the spaces as the sidebar shows them, top to bottom (the sections at the top,
 *  then each machine's own, then its sections'); and every section with its spaces in order, the top ones first */
export function sortPlaces(places: Place[], machines: Machine[], order: PlaceOrder, defs: SectionDefs = {}): { places: Place[]; machines: Machine[]; sections: Section[] } {
  const ms = ordered(machines, order.all, (m) => m.id, (m) => m.name)
  const known = new Map(places.map((p) => [p.id, p]))
  const taken = new Set<string>()
  const section = (id: string, fits: (p: Place) => boolean): Section => {
    // Pinned keeps its pin: a name of its own, never an emoji
    const d = id === PINNED ? { name: defs[PINNED]?.name || 'Pinned' } : defs[id]
    const spaces = [...new Set(order[id] ?? [])].filter((x) => known.has(x) && !taken.has(x) && fits(known.get(x)!))
    for (const x of spaces) taken.add(x)
    return { id, name: d.name, ...(d.emoji ? { emoji: d.emoji } : {}), ...(d.machine ? { machine: d.machine } : {}), spaces }
  }
  const ids = Object.keys(defs).filter((id) => id !== PINNED)
  const sections = listed([PINNED, ...ids.filter((id) => !defs[id].machine)], order[TOP]).map((id) => section(id, () => true))
  const out = sections.flatMap((s) => s.spaces.map((x) => known.get(x)!))
  for (const m of ms) {
    const inside = listed(ids.filter((id) => defs[id].machine === m.machine), order[sectionsIn(m.id)]).map((id) => section(id, (p) => p.machine === m.machine))
    out.push(...machineSpaces(places, m, order).filter((p) => !taken.has(p.id)), ...inside.flatMap((s) => s.spaces.map((x) => known.get(x)!)))
    sections.push(...inside)
  }
  // a space whose machine isn't listed keeps its place at the end
  return { places: [...out, ...places.filter((p) => !out.includes(p))], machines: ms, sections }
}

/** a new order dragged: a machine's spaces as they show keep those in sections where they were among them, for when
 *  they come back */
export function setOrder(order: PlaceOrder, under: string, ids: string[]) {
  order[under] = under.startsWith('m:') ? kept(order[under] ?? [], ids) : ids
}

/** a new order of those that show, the others in it as they were among them */
export function kept(was: string[], ids: string[]) {
  const out = [...ids]
  for (const [i, id] of was.entries()) {
    if (out.includes(id)) continue
    const after = was.slice(0, i).findLast((x) => out.includes(x))
    out.splice(after ? out.indexOf(after) + 1 : 0, 0, id)
  }
  return out
}

/** why a section can't be called so (beside the others at the top, or in the same machine), or undefined */
export function sectionProblem(defs: SectionDefs, name: string, machine?: string, except?: string) {
  if (!name) return 'A section needs a name.'
  if (name.length > NAME_MAX) return `A name fits ${NAME_MAX} characters.`
  const same = (n: string) => n.toLowerCase() === name.toLowerCase()
  if (!machine && except !== PINNED && !defs[PINNED] && same('Pinned')) return 'Pinned is there already.'
  if (Object.entries(defs).some(([id, d]) => id !== except && d.machine === machine && same(d.name))) return `Another section is called ${name}.`
}

/** a section renamed (Pinned too: '' gives it back its own), with its emoji ('' none; undefined leaves it); why not, or
 *  undefined */
export function renameSection(defs: SectionDefs, id: string, name: string, emoji?: string) {
  if (id === PINNED) {
    if (emoji) return 'Pinned keeps its pin.'
    const bad = sectionProblem(defs, name || 'Pinned', undefined, PINNED)
    if (bad) return bad
    if (name && name !== 'Pinned') defs[PINNED] = { name }
    else delete defs[PINNED]
    return
  }
  const d = defs[id]
  if (!d) return 'No such section.'
  const bad = sectionProblem(defs, name, d.machine, id)
  if (bad) return bad
  d.name = name
  if (emoji) d.emoji = emoji
  else if (emoji === '') delete d.emoji
}

/** a new section, last among its peers: its id */
export function newSection(defs: SectionDefs, order: PlaceOrder, d: SectionDef, machines: Machine[]) {
  const id = `s:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  defs[id] = d
  const under = d.machine ? sectionsIn(machines.find((m) => m.machine === d.machine)?.id ?? `m:${d.machine}`) : TOP
  if (order[under]) order[under] = [...order[under], id]
  return id
}

/** a section gone: its spaces back where they were under their machines; Pinned stays */
export function deleteSection(defs: SectionDefs, order: PlaceOrder, id: string) {
  if (id === PINNED) return
  delete defs[id]
  delete order[id]
  for (const [k, ids] of Object.entries(order)) if (k === TOP || k.startsWith('sections:')) order[k] = ids.filter((x) => x !== id)
}

/** moves a space into a section (PINNED too), or out of its section back under its machine (to: the machine's id),
 *  before another space there or last; back under its machine with none, it is where it was. Why not, or undefined */
export function moveSpace(order: PlaceOrder, defs: SectionDefs, places: Place[], machines: Machine[], id: string, to: string, before?: string) {
  const p = places.find((x) => x.id === id)
  if (!p) return 'No such space.'
  const m = machines.find((x) => x.machine === p.machine)
  if (to.startsWith('m:')) {
    if (to !== `m:${p.machine}`) return 'A space stays on its own machine.'
  } else if (to !== PINNED) {
    const d = defs[to]
    if (!d) return 'No such section.'
    if (d.machine && d.machine !== p.machine) return 'That section holds only its machine’s spaces.'
  }
  for (const k of new Set([PINNED, ...Object.keys(defs)])) if (order[k]?.includes(id)) order[k] = order[k].filter((x) => x !== id)
  const put = (ids: string[]) => {
    const i = before && before !== id ? ids.indexOf(before) : -1
    return i < 0 ? [...ids, id] : [...ids.slice(0, i), id, ...ids.slice(i)]
  }
  if (!to.startsWith('m:')) order[to] = put(order[to] ?? [])
  else if (before && m) order[m.id] = put(machineSpaces(places, m, order).map((x) => x.id).filter((x) => x !== id))
}
