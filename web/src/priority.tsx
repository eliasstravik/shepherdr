// A task's priority flag (MSHEP-1): its icon, and the small picker a click on it opens (the five levels and No flag).
// Choosing one saves it as the person's other task edits are (kernel setPriority: herdr-task edit --priority).
import clsx from 'clsx'
import { useRef, useState } from 'react'
import { PRIORITIES, PRIORITY_INFO, type Priority } from '@shared/priority.ts'
import type { Task } from '@shared/types.ts'
import { setPriority } from './kernel.ts'
import { CheckIcon, Floating, ic, Menu, MenuItem } from './ui.tsx'

// Drawn here: chevrons for Highest/High and Low/Lowest, two bars for Medium. Each level's colour is a theme variable
// (styles.css --pri-*): Jira's hues, a shade deeper in light mode where the spec's would not reach 3:1 on white.
const PATHS: Record<Priority, string[]> = {
  highest: ['m4.5 12.5 7.5-7 7.5 7', 'm4.5 18.5 7.5-7 7.5 7'],
  high: ['m4.5 15.5 7.5-8 7.5 8'],
  medium: ['M5 9.5h14', 'M5 14.5h14'],
  low: ['m4.5 8.5 7.5 8 7.5-8'],
  lowest: ['m4.5 5.5 7.5 7 7.5-7', 'm4.5 11.5 7.5 7 7.5-7'],
}

/** a level's icon in its colour; none draws a faint dashed circle (the placeholder of an unflagged task) */
export function PriorityIcon({ level, className }: { level?: Priority; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      className={className} style={level ? { color: `var(--pri-${level})` } : undefined}>
      {level ? PATHS[level].map((d) => <path key={d} d={d} />) : <circle cx="12" cy="12" r="7" strokeDasharray="3 3.4" strokeWidth="2" />}
    </svg>
  )
}

export const priorityLabel = (p?: Priority) => (p ? `${PRIORITY_INFO[p].label} priority` : 'No priority flag')

/**
 * The flag at a task row's end (or in its header): its icon, which opens the picker. An unflagged task shows a faint
 * placeholder on hover or focus (always, faintly, where there is no hover: a touch screen). `bare`: no hover fade (the
 * task view's header).
 */
export function PriorityFlag({ task, bare = false, className }: { task: Task; bare?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)
  const pick = (p: Priority | 'none') => {
    close()
    if ((p === 'none' ? undefined : p) === task.priority) return
    setError(null)
    setPriority(task, p).then((r) => r?.ok === false && setError(r.error ?? "Couldn't save it.")).catch((e: Error) => setError(e.message))
  }
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${priorityLabel(task.priority)}. Change priority`} title={priorityLabel(task.priority)}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={clsx('hit press-dim pointer-events-auto relative z-1 grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover aria-expanded:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)] phone:size-8',
          !task.priority && !bare && 'opacity-0 group-hover:opacity-70 focus-visible:opacity-100 aria-expanded:opacity-100 coarse:opacity-35', className)}>
        <PriorityIcon level={task.priority} className={clsx(ic, 'phone:size-5')} />
      </button>
      {error ? <span role="alert" className="sr-only">{error}</span> : null}
      {open ? (
        <Floating anchor={btn.current} place="below-end" gap={4} onClose={close}>
          <Menu label="Priority" onClose={close}>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} role="menuitemradio" aria-checked={task.priority === p} icon={<PriorityIcon level={p} className={ic} />} hint={task.priority === p ? <CheckIcon className={ic} /> : null} onClick={() => pick(p)}>
                {PRIORITY_INFO[p].label}
              </MenuItem>
            ))}
            <MenuItem role="menuitemradio" aria-checked={!task.priority} icon={<PriorityIcon className={ic} />} hint={!task.priority ? <CheckIcon className={ic} /> : null} onClick={() => pick('none')}>
              No flag
            </MenuItem>
          </Menu>
        </Floating>
      ) : null}
    </>
  )
}
