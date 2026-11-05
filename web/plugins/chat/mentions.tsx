// #-mentions of spaces (core/mentions.js): "#" in the box lists the spaces this chat's agent can reach (from its
// machine's reach map, what tell-assistant follows) with this space's tasks under them, and a sent one draws as a chip
// that opens its space; a space the agent can't reach, or one the person doesn't see here, draws locked, like Slack's
// link to a private channel.
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { LockClosedIcon } from '@heroicons/react/16/solid'
import * as MN from '@core/mentions.js'
import { goPlace, taskOf, useSnap } from '@client/kernel.ts'
import { taskChatId, type Place, type Snapshot } from '@shared/types.ts'

const M = MN as any

export type Reach = { id: string; name: string; route: string; machine: string; target: string; emoji?: string; assistant: boolean }
type Got = { from: string | null; spaces: Reach[]; checked: number | null }

/* ---------- what this chat's agent reaches ---------- */

const lists = new Map<string, { at: number; got: Promise<Got> }>()
const known = new Map<string, Got>()
const listeners = new Set<() => void>()

function load(chatKey: string) {
  const was = lists.get(chatKey)
  if (was && Date.now() - was.at < 60_000) return was.got
  const got: Promise<Got> = fetch(`api/reach?chat=${encodeURIComponent(chatKey)}`).then((r) => r.json()).catch(() => ({ from: null, spaces: [], checked: null }))
  lists.set(chatKey, { at: Date.now(), got })
  got.then((g) => { known.set(chatKey, g); listeners.forEach((f) => f()) })
  return got
}

/** the spaces this chat's agent reaches, once known (null before); asked for when first wanted */
export function useReach(chatKey: string, want = true): Got | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!want) return
    const on = () => tick((n) => n + 1)
    listeners.add(on)
    void load(chatKey)
    return () => void listeners.delete(on)
  }, [chatKey, want])
  return known.get(chatKey) ?? null
}

/** a space by its own id: the snapshot's place for it (another machine's place ids are "machine/id") */
export const placeOf = (snap: Snapshot | null | undefined, id: string): Place | undefined =>
  snap?.places.find((p) => p.id === id || p.id.endsWith(`/${id}`))

/* ---------- the box ---------- */

/** what the person picked in each chat's box: at send, its "#name" becomes the full mention */
const picks = new Map<string, Reach[]>()
export const pickedIn = (chatKey: string) => picks.get(chatKey) ?? []
export function remember(chatKey: string, s: Reach) {
  picks.set(chatKey, [...pickedIn(chatKey).filter((x) => x.name !== s.name), s])
}
/** the words to send: each picked "#name" as its mention (core/mentions.js expand) */
export const expandPicked = (chatKey: string, text: string): string => {
  const out = M.expand(text, pickedIn(chatKey))
  picks.delete(chatKey)
  return out
}

export type Item =
  | { kind: 'space'; key: string; space: Reach; place?: Place }
  | { kind: 'locked'; key: string; place: Place }
  | { kind: 'task'; key: string; ref: string; name: string; state?: string }

/** the "#" list for what is typed: reachable spaces, then this space's tasks, then a few the agent can't reach (never
 *  picked: they say why). Keys move over the first two. */
export function mentionItems(snap: Snapshot | null | undefined, chatKey: string, text: string, got: Got | null): Item[] {
  const q = M.typing(text)
  if (q === null || !snap) return []
  const spaces: Item[] = (got ? (M.match(got.spaces, q) as Reach[]) : []).map((s) => ({ kind: 'space', key: `s:${s.id}`, space: s, place: placeOf(snap, s.id) }))
  const own = taskChatId(chatKey)
  const here = own ? taskOf(snap, own)?.place : snap.places.find((p) => p.chat === chatKey)?.id
  const ql = q.toLowerCase()
  const refOf = (id: string) => id.split(':').pop() ?? id
  const tasks: Item[] = (snap.tasks ?? [])
    .filter((t) => t.place === here && (!ql || refOf(t.id).toLowerCase().includes(ql) || t.name.toLowerCase().includes(ql)))
    .slice(0, 5)
    .map((t) => ({ kind: 'task', key: `t:${t.id}`, ref: refOf(t.id), name: t.name, state: t.state }))
  // a space in the sidebar this agent can't reach: shown under the rest, so its absence isn't a mystery
  const reach = new Set(got?.spaces.map((s) => s.id) ?? [])
  const locked: Item[] = got
    ? snap.places
        .filter((p) => !reach.has(p.id.split('/').pop()!) && (!ql || p.name.toLowerCase().includes(ql)))
        .slice(0, ql ? 3 : 2)
        .map((p) => ({ kind: 'locked', key: `l:${p.id}`, place: p }))
    : []
  return [...spaces, ...tasks, ...locked]
}
export const pickable = (items: Item[]) => items.filter((i) => i.kind !== 'locked')

function SpaceMark({ emoji, dim }: { emoji?: string; dim?: boolean }) {
  return (
    <span aria-hidden="true" className={clsx('grid size-6 shrink-0 place-items-center rounded-md bg-well text-[0.8125rem] phone:size-7', dim ? 'text-fg3' : 'text-fg2')}>
      {emoji ?? '#'}
    </span>
  )
}

/** the "#" list over the box: a tap (or Enter / Tab on the chosen one) takes one */
export function MentionList({ items, sel, pick, from }: { items: Item[]; sel: number; pick: (i: Item) => void; from: string | null }) {
  if (!items.length) return null
  const ok = pickable(items)
  const chosen = ok[Math.min(sel, ok.length - 1)]?.key
  const head = (text: string) => <div className="px-2.5 pt-1.5 pb-1 text-[0.75rem] text-fg3">{text}</div>
  const groups: [string, Item[]][] = [
    [from ? `Spaces ${from} can reach` : 'Spaces this agent can reach', items.filter((i) => i.kind === 'space')],
    ['Tasks in this space', items.filter((i) => i.kind === 'task')],
    ['Out of reach for this agent', items.filter((i) => i.kind === 'locked')],
  ]
  return (
    <div role="listbox" aria-label="Mention a space or task" className="max-h-[min(22rem,40dvh)] overflow-y-auto overscroll-contain rounded-box bg-bg p-1 shadow-menu">
      {groups.filter(([, g]) => g.length).map(([title, g]) => (
        <div key={title} role="group" aria-label={title}>
          {head(title)}
          {g.map((i) => {
            if (i.kind === 'locked') return (
              <div key={i.key} role="option" aria-disabled="true" aria-selected={false} className="flex min-w-0 items-center gap-2.5 rounded-row px-2.5 py-1 phone:py-1.5">
                <SpaceMark emoji={i.place.emoji} dim />
                <span className="min-w-0 truncate text-fg3">{i.place.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[0.75rem] text-fg3">
                  <LockClosedIcon className="size-3" aria-hidden="true" />
                  {i.place.machine}
                </span>
              </div>
            )
            const on = i.key === chosen
            return (
              <button key={i.key} type="button" role="option" aria-selected={on} data-chosen={on ? '' : undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
                className={clsx('flex w-full min-w-0 items-center gap-2.5 rounded-row px-2.5 py-1 text-left hover:bg-hover phone:py-1.5', on && 'bg-hover')}>
                {i.kind === 'space' ? (
                  <>
                    <SpaceMark emoji={i.space.emoji ?? i.place?.emoji} />
                    <span className="min-w-0 truncate font-medium">{i.space.name}</span>
                    <span className="ml-auto shrink-0 text-[0.75rem] text-fg3">{i.space.route ? i.space.machine : 'This machine'}</span>
                  </>
                ) : (
                  <>
                    <span className="w-6 shrink-0 text-center text-[0.75rem] font-medium text-fg2 phone:w-7">#</span>
                    <span className="shrink-0 font-medium">{i.ref}</span>
                    <span className="min-w-0 flex-1 truncate text-fg2">{i.name}</span>
                    {i.state ? <span className="shrink-0 text-[0.6875rem] text-fg3">{i.state}</span> : null}
                  </>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** the box after a pick: a space as "#name " (its full mention goes in at send), a task as its id */
export function takeItem(chatKey: string, text: string, i: Item): string {
  if (i.kind === 'space') {
    remember(chatKey, i.space)
    return M.pickInto(text, i.space)
  }
  if (i.kind === 'task') return text.replace(/\n+$/, '').replace(/#[\w.-]*$/, `${i.ref} `)
  return text
}

/* ---------- in a message ---------- */

type Mention = { name: string; target: string; id: string; route: string }

/** how a mention shows here: its place when the person sees it, and whether this chat's agent reaches it (unknown
 *  until its list comes: it shows as it would, not locked) */
export function stateOf(m: Mention, snap: Snapshot | null | undefined, got: Got | null) {
  const place = placeOf(snap, m.id)
  const agent = got ? got.spaces.some((s) => s.id === m.id) : true
  const machine = place?.machine ?? (m.route ? m.route.split('>').pop()! : got?.from ?? '')
  return { place, ok: !!place && agent, why: !agent ? M.LOCKED.why : !place ? M.UNSEEN : '', machine }
}

export function Chip({ m, chatKey }: { m: Mention; chatKey: string }) {
  const snap = useSnap()
  const got = useReach(chatKey)
  const { place, ok, why, machine } = stateOf(m, snap, got)
  const label = (
    <>
      <span className="font-medium">#{m.name}</span>
      {machine ? <span className="opacity-70"> · {machine}</span> : null}
    </>
  )
  if (!ok) return (
    <span data-mention="locked" title={why} aria-label={`${m.name}: ${why}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-md bg-fg/6 px-1.5 align-baseline whitespace-nowrap text-fg3">
      <LockClosedIcon className="size-3 shrink-0 translate-y-[0.1em] self-center" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
  return (
    <button type="button" data-mention="open" aria-label={`Open space ${m.name} on ${machine}`}
      onClick={(e) => { e.stopPropagation(); goPlace(place!.id) }}
      className="inline-flex max-w-full items-baseline rounded-md bg-accent/12 px-1.5 align-baseline whitespace-nowrap text-accent hover:bg-accent/20">
      <span className="truncate">{label}</span>
    </button>
  )
}

/** the person's words with each mention as a chip */
export function withChips(text: string, chatKey: string): ReactNode {
  if (!M.hasMention(text)) return text
  return (M.split(text) as ({ text: string } | { mention: Mention })[]).map((p, i) =>
    'mention' in p ? <Chip key={i} m={p.mention} chatKey={chatKey} /> : p.text,
  )
}

/** an agent's markdown before it is drawn: each mention as a link toHtml() turns into a chip ("#space=" survives the
 *  sanitizer; "space:" wouldn't) */
export const forMarkdown = (text: string) =>
  M.hasMention(text) ? text.replace(/\[#([^\]\n]{1,80})\]\(space:([^)\s]+)\)/g, (_: string, n: string, t: string) => `[#${n}](#space=${encodeURIComponent(t)})`) : text

export const hasMention = (text: string): boolean => M.hasMention(text)
export const parseMention = (name: string, target: string): Mention => M.parse(name, target)
