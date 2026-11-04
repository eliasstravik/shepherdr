// Toasts, as the window's (mods/toasts, the rules in core/toasts.js): the last three, each a dot in its level's color,
// its title on one line, its body wrapped to at most 3 lines, an X on hover (always there to a finger); a click goes to
// what it is about and closes it; each goes after its time, never while the pointer is on them. Bottom right as the
// window's float. A phone shows one compact toast at the top, clear of the bar at the bottom: its title on one line and
// at most one short line under it; several at once are one ("2 tasks need you", who under it); a tap goes to it (to
// Needs you for several), a swipe up puts it away, and it goes after its time too.
// What they say, as the window's: an agent that needs you ("HERD-4 · Needs you", why under it) and one that finished
// while you weren't looking at it ("HERD-4 · Finished"); an Assistant follows its space's Notify (a new reply only on
// All, nothing on Off). A task on another machine says which ("SHEP-17 on Mac mini"). One event is one toast: an agent
// that needs you again before its toast went changes that toast. While the app is off screen, push alerts say it
// instead (service/push.ts).
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { follow } from '@client/gestures.ts'
import { goChat, openNeeds, openTask, useSnap, useStore, visibleChats } from '@client/kernel.ts'
import { XIcon } from '@client/ui.tsx'
import { notifies, taskWho } from '@shared/alerts.ts'
import { taskChatId, type Snapshot } from '@shared/types.ts'
import * as T from '@core/toasts.js'

/** key: one event's, a later toast with it changes this one; who: whom it is about; need: someone needs you (task: a
 *  task's agent) */
type Toast = { id: string; at: number; title: string; body?: string; level?: string; timeout?: number; go?: () => void; key?: string; who?: string; need?: boolean; task?: boolean }

let list: Toast[] = []
const listeners = new Set<() => void>()
const set = (next: Toast[]) => { list = next; for (const f of listeners) f() }
const useToasts = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => list)

/** shows a toast, as the window's toast(): { title, body, level: info | success | warning | error | alert, go } */
export function toast(n: Omit<Toast, 'id' | 'at'>) {
  set(T.withToast(list, n) as Toast[])
}
const dismiss = (id: string) => set(list.filter((n) => n.id !== id))

const DOT: Record<string, string> = { red: 'bg-need', amber: 'bg-work', green: 'bg-ready', accent: 'bg-accent' }

/** who it is, as the window's toastWho: a task's agent by its ref (and its machine, not this computer's), an Assistant
 *  by its space */
const who = (snap: Snapshot, n: { task?: string; place: string }) => (n.task ? taskWho(snap, n.task) : T.assistantWho(snap.places.find((p) => p.id === n.place)?.name))

/** what changed between two snapshots that the window would toast: what needs you now, and who finished meanwhile */
function news(was: Snapshot, now: Snapshot, looking: string[]) {
  const out: Omit<Toast, 'id' | 'at'>[] = []
  const seen = (chat: string) => looking.includes(chat)
  const before = new Set(was.needs.map((n) => `${n.chat}\n${n.id}`))
  for (const n of now.needs) {
    if (before.has(`${n.chat}\n${n.id}`) || seen(n.chat)) continue
    if (!notifies(now, { go: { place: n.place }, task: n.task ? true : undefined })) continue
    const w = who(now, n)
    out.push({ key: `need:${n.chat}`, who: w, need: true, task: !!n.task, title: T.toastTitle(w, T.NEEDS_YOU), body: T.needReason(n), level: 'alert', go: () => goChat(n.chat) })
  }
  // an agent's own alert (herdr-task alert), each once: a click goes to its chat
  const told = new Set((was.alerts ?? []).map((a) => a.id))
  for (const a of now.alerts ?? []) {
    if (told.has(a.id) || !a.notify) continue
    const chat = a.chat
    out.push({ title: a.title, body: a.body, level: 'alert', go: chat ? () => goChat(chat) : undefined })
  }
  // a task's agent that stopped working without needing you (Needs you said that), while its chat wasn't on screen
  const working = new Set(was.tasks.filter((t) => t.status === 'work').map((t) => t.id))
  for (const t of now.tasks) {
    if (!working.has(t.id) || t.status === 'work' || t.status === 'need' || t.archived) continue
    if (looking.some((c) => taskChatId(c) === t.id)) continue
    const w = taskWho(now, t.id)
    out.push({ key: `done:${t.id}`, who: w, title: T.toastTitle(w, T.FINISHED), body: t.name, level: 'success', go: () => openTask(t.id) })
  }
  // an Assistant that finished its turn: a new reply, which only All brings
  const busy = new Set(was.places.filter((p) => p.status === 'work').map((p) => p.id))
  for (const p of now.places) {
    if (!busy.has(p.id) || p.status === 'work' || p.status === 'need' || seen(p.chat)) continue
    if (!notifies(now, { go: { place: p.id }, message: true })) continue
    const w = T.assistantWho(p.name)
    out.push({ key: `done:${p.chat}`, who: w, title: T.toastTitle(w, T.FINISHED), level: 'success', go: () => goChat(p.chat) })
  }
  return out
}

/** Watches the snapshots for what the window toasts, and draws the toasts. */
export function Toasts() {
  const snap = useSnap()
  const ui = useStore((s) => s.ui)
  const phone = ui.device === 'phone'
  const all = useToasts()
  const shown = all.slice(-T.SHOWN)
  const last = useRef<Snapshot | null>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!snap) return
    const was = last.current
    last.current = snap
    if (!was) return
    // looking: its chat on screen while this window has the focus
    const looking = document.hasFocus() ? visibleChats(ui, snap) : []
    // what no longer needs you (answered here, in the window or on another device) goes from the toasts too
    const waits = new Set(snap.needs.map((n) => `need:${n.chat}`))
    if (list.some((n) => n.need && !waits.has(n.key!))) set(list.filter((n) => !n.need || waits.has(n.key!)))
    for (const n of news(was, snap, looking)) toast(n)
    // ui only says what is on screen: a change of it alone is nothing new
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap])

  // each goes after its time, never while the pointer is on them
  useEffect(() => {
    if (!list.length || hovered) return
    const t = setInterval(() => { const left = T.unexpired(list) as Toast[]; if (left.length !== list.length) set(left) }, 1000)
    return () => clearInterval(t)
  }, [shown.length, hovered])

  if (!shown.length) return null
  if (phone) return <PhoneToast items={all} />
  return (
    <div
      role="status"
      aria-live="polite"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={clsx(
        'absolute z-25 flex flex-col overflow-hidden rounded-box bg-bg shadow-toast',
        phone ? 'inset-x-3 top-[max(env(safe-area-inset-top),--spacing(3))]' : 'right-4 bottom-4',
      )}
      style={phone ? undefined : { width: T.WIDTH }}
    >
      {shown.map((n, i) => (
        <div
          key={n.id}
          role={n.go ? 'button' : undefined}
          tabIndex={n.go ? 0 : undefined}
          onClick={n.go ? () => { n.go!(); dismiss(n.id) } : undefined}
          onKeyDown={n.go ? (e) => { if (e.key === 'Enter') { n.go!(); dismiss(n.id) } } : undefined}
          className={clsx('group flex items-start gap-2.5 py-2.5 pr-1.5 pl-3', i > 0 && 'border-t border-line', n.go && 'cursor-pointer hover:bg-hover')}
        >
          <span aria-hidden className={clsx('mt-[5px] size-2 shrink-0 rounded-full', DOT[T.tone(n.level)])} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate font-semibold text-fg">{n.title}</p>
            {n.body ? <p className="line-clamp-3 text-[0.8125rem]/[18px] text-fg2">{T.clip(String(n.body), T.BODY_MAX)}</p> : null}
          </div>
          {/* the X's place is always kept, so nothing moves when it shows */}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); dismiss(n.id) }}
            className="grid size-5 shrink-0 place-items-center rounded-full text-fg3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100 pointer-coarse:size-7 pointer-coarse:opacity-100"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** A phone's toast: one at a time, compact, at the top. Several at once are one ("2 tasks need you", who under it). */
function PhoneToast({ items }: { items: Toast[] }) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const n = items[items.length - 1]
  const many = items.length > 1
  const title = many ? T.together(items) : n.title
  const body = many ? [...items].reverse().map((x) => x.who ?? x.title).join(', ') : n.body
  const go = many ? (items.every((x) => x.need) ? openNeeds : n.go) : n.go
  const shut = () => set(list.filter((x) => !items.includes(x)))
  const open = () => { go?.(); shut() }
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-3 top-[max(env(safe-area-inset-top),--spacing(2))] z-25"
    >
      <div
        role={go ? 'button' : undefined}
        tabIndex={go ? 0 : undefined}
        onClick={go ? open : undefined}
        onKeyDown={go ? (e) => { if (e.key === 'Enter') open() } : undefined}
        // a swipe up puts it away; let go short of that, it settles back
        onPointerDown={(e) => follow(e.nativeEvent, {
          axis: 'y', sign: -1,
          start: () => setDragging(true),
          move: (d) => setDy(Math.min(0, d)),
          end: ({ d, v }) => { setDragging(false); if (d < -24 || v < -0.3) shut(); else setDy(0) },
          cancel: () => { setDragging(false); setDy(0) },
        })}
        style={dy ? { transform: `translateY(${dy}px)`, opacity: Math.max(0, 1 + dy / 80) } : undefined}
        className={clsx(
          'flex min-h-14 touch-none items-center gap-3 rounded-box bg-bg px-3.5 py-2 shadow-toast select-none animate-toast-in motion-reduce:animate-none',
          !dragging && 'transition-[transform,opacity] duration-200 motion-reduce:transition-none',
          go && 'cursor-pointer active:bg-hover',
        )}
      >
        <span aria-hidden className={clsx('size-2 shrink-0 rounded-full', DOT[T.tone(n.level)])} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-[0.9375rem]/5 font-semibold text-fg">{title}</p>
          {body ? <p className="truncate text-[0.8125rem]/5 text-fg2">{body}</p> : null}
        </div>
      </div>
    </div>
  )
}
