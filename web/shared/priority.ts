// A task's priority (MSHEP-1): P0 Urgent, P1 High, P2 Medium, P3 Low, P4 Backlog, or none (the default, no field).
// herdr-task keeps it on the task as `priority` ("p0".."p4"; herdr-task add/edit --priority); the Tasks panel shows it as
// a flag in a pill, lets a click set it and can sort by it. The colours are the "Heat" palette unless the person set their
// own (Settings › Tasks › Priority colours, kept as tasks.priority_colors); the pill never relies on colour alone.

export const PRIORITIES = ['p0', 'p1', 'p2', 'p3', 'p4'] as const
export type Priority = (typeof PRIORITIES)[number]

/** the levels' number and name: "P0", "Urgent" */
export const PRIORITY_INFO: Record<Priority, { num: string; name: string }> = {
  p0: { num: 'P0', name: 'Urgent' },
  p1: { num: 'P1', name: 'High' },
  p2: { num: 'P2', name: 'Medium' },
  p3: { num: 'P3', name: 'Low' },
  p4: { num: 'P4', name: 'Backlog' },
}

/** Heat, the default palette: only P0 is red. Dark theme, and the darker shades of the same hues for the light theme */
export const HEAT_DARK: Record<Priority, string> = { p0: '#F2555A', p1: '#FF8A3D', p2: '#F5B83D', p3: '#5B9BFF', p4: '#9AA6BA' }
export const HEAT_LIGHT: Record<Priority, string> = { p0: '#D93036', p1: '#E8590C', p2: '#B7791F', p3: '#2F6FDE', p4: '#5C6778' }

/** a stored value as a level: anything else (absent, unknown, the older words) is none */
export function priorityOf(v: unknown): Priority | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (PRIORITIES as readonly string[]).includes(s) ? (s as Priority) : undefined
}

/** a colour as "#rrggbb" (lower case) from "#rgb" or "#rrggbb" (the # may be left off); anything else: none */
export function hexOf(v: unknown): string | undefined {
  const m = typeof v === 'string' ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim()) : null
  if (!m) return undefined
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

/** the darker shade of a colour the light theme uses, from the person's own colour: each channel at 78% */
export function darker(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x * 0.78))
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** each level's colour in each theme: the person's own (the dark theme's, and a derived darker shade for the light one),
 *  else Heat. A value that isn't a colour is ignored. */
export function colorsFor(custom?: Partial<Record<Priority, unknown>> | null): Record<Priority, { dark: string; light: string }> {
  return Object.fromEntries(
    PRIORITIES.map((p) => {
      const own = hexOf(custom?.[p])
      return [p, own ? { dark: own, light: darker(own) } : { dark: HEAT_DARK[p], light: HEAT_LIGHT[p] }]
    }),
  ) as Record<Priority, { dark: string; light: string }>
}

/** the pill's background: its colour at about 14% */
export const pillBg = (cssColor: string) => `color-mix(in srgb, ${cssColor} 14%, transparent)`

/** how the Tasks list is ordered within its groups: today's default order, or by priority */
export type SortBy = 'default' | 'priority'

export const SORTS: { key: SortBy; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'priority', label: 'Priority' },
]

/** 0 for P0 ... 4 for P4, 5 for none: the lower, the earlier */
export const rank = (p: Priority | undefined) => (p ? PRIORITIES.indexOf(p) : PRIORITIES.length)

/** the tasks with P0 first and the unflagged last; tasks of one level keep the order they came in (a stable sort, never
 *  reordering the input) */
export function byPriority<T extends { priority?: Priority }>(tasks: T[]): T[] {
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.priority) - rank(b.t.priority) || a.i - b.i).map((x) => x.t)
}
