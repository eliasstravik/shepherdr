// A task's priority (MSHEP-1): its flag in a pill (P0 to P4), and the small picker a click on it opens. Choosing one saves
// it as the person's other task edits are (kernel setPriority: herdr-task edit --priority). The colours are theme
// variables (styles.css --pri-pN: Heat); the person's own (Settings › Tasks › Priority colours) are written over them
// by PriorityColorSync.
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { colorsFor, PRIORITIES, PRIORITY_INFO, pillBg, type Priority } from '@shared/priority.ts'
import type { Snapshot, Task } from '@shared/types.ts'
import { setPriority, useSnap } from './kernel.ts'
import { Floating, ic, Menu, MenuItem } from './ui.tsx'

/** the flag: a pole and a filled pennant; P4 (Backlog) an outline one; none a faint dashed outline */
export function FlagIcon({ level, className }: { level?: Priority; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" strokeLinejoin="round" strokeLinecap="round" className={className} style={level ? { color: `var(--pri-${level})` } : undefined}>
      <path d="M6 3.5v17" fill="none" stroke="currentColor" strokeWidth="2.2" />
      {level && level !== 'p4' ? (
        <path d="M6.8 4.5h11.2l-3.2 4.2 3.2 4.2H6.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        <path d="M6.8 4.5h11.2l-3.2 4.2 3.2 4.2H6.8z" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={level ? undefined : '2.6 2.6'} />
      )}
    </svg>
  )
}

/** the flag and its number in a small pill, its background the colour at about 14% (a pill: never colour alone) */
export function PriorityPill({ level, className }: { level: Priority; className?: string }) {
  return (
    <span className={clsx('inline-flex h-5 items-center gap-1 rounded-full pr-1.5 pl-1 text-[0.6875rem]/none font-semibold tabular-nums phone:h-6 phone:text-[0.75rem]/none', className)}
      style={{ color: `var(--pri-${level})`, background: pillBg(`var(--pri-${level})`) }}>
      <FlagIcon level={level} className="size-3.5 phone:size-4" />
      {PRIORITY_INFO[level].num}
    </span>
  )
}

export const priorityLabel = (p?: Priority) => (p ? `${PRIORITY_INFO[p].num} ${PRIORITY_INFO[p].name}` : 'No priority')

/** the person's own colours (Settings › Tasks › Priority colours), read off the settings rows the snapshot carries */
export function customColors(snap?: Pick<Snapshot, 'settings'> | null): Partial<Record<Priority, string>> {
  const out: Partial<Record<Priority, string>> = {}
  for (const sec of snap?.settings ?? [])
    for (const r of sec.rows) {
      const m = /^tasks\.priority_color_(p[0-4])$/.exec(r.key)
      if (m && r.custom && !(m[1] in out)) out[m[1] as Priority] = r.value
    }
  return out
}

/** Writes the colours in use over Heat's variables, for both themes (a colour of the person's own gets a darker shade
 *  for the light theme). Rendered once, by the app. */
export function PriorityColorSync() {
  const snap = useSnap()
  const custom = JSON.stringify(customColors(snap))
  useEffect(() => {
    const root = document.documentElement.style
    const c = colorsFor(JSON.parse(custom))
    for (const p of PRIORITIES) {
      root.setProperty(`--pri-${p}-d`, c[p].dark)
      root.setProperty(`--pri-${p}-l`, c[p].light)
    }
  }, [custom])
  return null
}

/**
 * A task's priority at its row's end (or in its header): its pill, which opens the picker. Unflagged, a faint dashed flag
 * on hover or focus (always, faintly, where there is no hover: a touch screen). `bare`: always shown (the task view's header).
 * The picker's rows take their number key too.
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
  const choose = useRef(pick)
  choose.current = pick
  // 0 to 4 pick a level while the picker is open
  useEffect(() => {
    if (!open) return
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const p = PRIORITIES[Number(e.key)]
      if (e.key.length === 1 && e.key >= '0' && e.key <= '4' && p) {
        e.preventDefault()
        e.stopPropagation()
        choose.current(p)
      }
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  }, [open])
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={`${priorityLabel(task.priority)}. Change priority`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={clsx('hit press-dim pointer-events-auto relative z-1 inline-grid shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover aria-expanded:bg-hover keys:focus-visible:shadow-[inset_0_0_0_1.5px_var(--focus)]',
          task.priority ? 'min-h-6' : 'size-6 phone:size-8',
          !task.priority && !bare && 'opacity-0 group-hover:opacity-70 focus-visible:opacity-100 aria-expanded:opacity-100 coarse:opacity-35', className)}>
        {task.priority ? <PriorityPill level={task.priority} /> : <FlagIcon className={clsx(ic, 'phone:size-5')} />}
      </button>
      {/* what it refused (or why it couldn't save), under the flag until a click elsewhere */}
      {error ? (
        <Floating anchor={btn.current} place="below-end" gap={4} onClose={() => setError(null)}>
          <div role="alert" className="max-w-64 rounded-box bg-bg px-3 py-2 text-[0.8125rem]/5 text-need-fg shadow-menu phone:text-base/6">{error}</div>
        </Floating>
      ) : null}
      {open ? (
        <Floating anchor={btn.current} place="below-end" gap={4} onClose={close}>
          <Menu label="Priority" onClose={close}>
            {PRIORITIES.map((p, i) => (
              <MenuItem key={p} role="menuitemradio" aria-checked={task.priority === p} icon={<FlagIcon level={p} className={ic} />} hint={<kbd className="font-mono">{i}</kbd>} onClick={() => pick(p)}>
                <span className="font-semibold" style={{ color: `var(--pri-${p})` }}>{PRIORITY_INFO[p].num}</span> {PRIORITY_INFO[p].name}
              </MenuItem>
            ))}
            <MenuItem role="menuitemradio" aria-checked={!task.priority} icon={<FlagIcon className={ic} />} onClick={() => pick('none')}>
              No priority
            </MenuItem>
          </Menu>
        </Floating>
      ) : null}
    </>
  )
}
