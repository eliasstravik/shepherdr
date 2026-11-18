// A task's priority flag (MSHEP-1): Highest, High, Medium, Low, Lowest, or none (the default, no field). herdr-task keeps
// it on the task as `priority` (herdr-task add/edit --priority); the Tasks panel shows it as an icon, lets a click set it
// and can sort by it. Modelled on Jira's priorities; the icons are drawn here (web/src/priority.tsx).

export const PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const
export type Priority = (typeof PRIORITIES)[number]

/** the levels' words (their colours are theme variables, styles.css --pri-*: Jira's hues, High and Medium a shade deeper
 *  in light mode, where the originals fall under 3:1 on white) */
export const PRIORITY_INFO: Record<Priority, { label: string }> = {
  highest: { label: 'Highest' },
  high: { label: 'High' },
  medium: { label: 'Medium' },
  low: { label: 'Low' },
  lowest: { label: 'Lowest' },
}

/** a stored value as a level: anything else (absent, unknown, other case) is none */
export function priorityOf(v: unknown): Priority | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (PRIORITIES as readonly string[]).includes(s) ? (s as Priority) : undefined
}

/** how the Tasks list is ordered within its groups: today's default order, or by priority */
export type SortBy = 'default' | 'priority'

export const SORTS: { key: SortBy; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'priority', label: 'Priority' },
]

/** 0 for Highest ... 4 for Lowest, 5 for no flag: the lower, the earlier */
export const rank = (p: Priority | undefined) => (p ? PRIORITIES.indexOf(p) : PRIORITIES.length)

/** the tasks with Highest first and the unflagged last; tasks of one level keep the order they came in (a stable sort,
 *  never reordering the input) */
export function byPriority<T extends { priority?: Priority }>(tasks: T[]): T[] {
  return tasks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.priority) - rank(b.t.priority) || a.i - b.i).map((x) => x.t)
}
