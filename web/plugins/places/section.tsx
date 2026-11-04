// "Rename space", "Rename machine", "New section" and "Rename section", as the window's one Rename dialog
// (mods/spaces-chat rename.js): a space's or machine's Rename…, a machine's + New section, a section's Rename…. "Icon
// and name": the icon (a click opens every emoji, with the way back to the plain mark at the bottom) and the name, then
// Cancel and Save (Create section). A machine's or space's name empty goes back to its own; a section needs one, its own
// among its peers. The main machine keeps them, so every device shows them; with no emoji a space shows #, a machine a
// server (this computer a monitor), a section a folder. Deleting a section asks first: its spaces go back under their
// machines.
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { act, useSnap } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { Ghost, ic, MonitorIcon, Primary, SectionIcon, ServerIcon, Who } from '@client/ui.tsx'
import { PINNED, sectionProblem, type SectionDefs } from '@shared/order.ts'
import { NAME_MAX, type Snapshot } from '@shared/types.ts'
import { EmojiChooser } from '@plugins/reactions/client.tsx'

/** what the dialog is on: renaming a machine or section (its id), or a new section at the top ('') or in a machine (its
 *  key); delete: asking before a section goes */
type Open = { rename: string } | { make: string } | { delete: string }

let open: Open | null = null
const listeners = new Set<() => void>()

function set(o: Open | null) {
  open = o
  for (const l of listeners) l()
}

/** opens Rename machine or Rename section on a machine's (m:<key>) or section's id */
export const openRename = (id: string) => set({ rename: id })
/** opens New section, at the top ('') or in a machine (its key) */
export const openNewSection = (machine = '') => set({ make: machine })
/** asks before a section goes */
export const openDeleteSection = (id: string) => set({ delete: id })

const close = () => set(null)

/** the sections made, as the snapshot has them, to check a name against */
const defsOf = (snap: Snapshot): SectionDefs =>
  Object.fromEntries((snap.sections ?? []).filter((s) => s.id.startsWith('s:') || (s.id === PINNED && s.name !== 'Pinned')).map((s) => [s.id, { name: s.name, machine: s.machine }]))

/** the dialog, while what it is on is still listed */
export function SectionDialogs() {
  const o = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => open,
  )
  const snap = useSnap()
  if (!o || !snap) return null
  if ('delete' in o) {
    const s = snap.sections?.find((x) => x.id === o.delete)
    return s ? <DeleteBox key={s.id} id={s.id} name={s.name} snap={snap} /> : null
  }
  if ('make' in o) {
    if (o.make && !snap.machines?.some((m) => m.machine === o.make)) return null
    return <NameDialog key={`new:${o.make}`} snap={snap} kind="new" machine={o.make || undefined} />
  }
  const m = snap.machines?.find((x) => x.id === o.rename)
  if (m) {
    const own = m.ownName ?? m.machine
    return <NameDialog key={m.id} snap={snap} kind="machine" id={m.id} own={own} here={m.machine === snap.host} name={m.name !== own ? m.name : ''} emoji={m.emoji} />
  }
  const s = snap.sections?.find((x) => x.id === o.rename)
  if (s) return <NameDialog key={s.id} snap={snap} kind="section" id={s.id} name={s.name} emoji={s.emoji} machine={s.machine} />
  // a space: the name given it (empty when nobody named it: what the sidebar shows is the placeholder, and saving it
  // empty keeps that)
  const p = snap.places.find((x) => x.id === o.rename)
  return p ? <NameDialog key={p.id} snap={snap} kind="space" id={p.id} own={p.name} name={p.unnamed ? '' : p.name} emoji={p.emoji} /> : null
}

/** what stands for it in the sidebar without an emoji: "#" (a space), the folder (a section), the server or monitor (a
 *  machine), as the window's Rename dialog shows it */
export type IconKind = 'space' | 'section' | 'server' | 'monitor'

function PlainIcon({ kind }: { kind: IconKind }) {
  if (kind === 'space') return <span aria-hidden className="text-[1rem] leading-none text-fg3">#</span>
  const I = kind === 'section' ? SectionIcon : kind === 'server' ? ServerIcon : MonitorIcon
  return <I className={clsx(ic, 'text-fg3')} />
}

/** the icon button left of a Rename or New space field: the emoji, else its plain mark; a click opens the picker */
export function IconChoice({ kind, emoji, open, onClick }: { kind: IconKind; emoji: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={emoji ? `Icon ${emoji}` : 'Icon'}
      aria-expanded={open}
      onClick={onClick}
      className="press grid size-9 shrink-0 place-items-center rounded-full bg-bg text-[1rem] leading-none shadow-[inset_0_0_0_1px_var(--line2)] hover:bg-hover aria-expanded:bg-sel phone:size-11 phone:text-[1.125rem]"
    >
      {emoji || <PlainIcon kind={kind} />}
    </button>
  )
}

/** the icon picker (the window's spaces-chat icon.js): every emoji with a search, and at the bottom the way back to the
 *  plain mark ("Reset to #", "Reset to folder", "Reset to server icon"), there while one is picked */
export function IconPicker({ kind, emoji, onPick }: { kind: IconKind; emoji: string; onPick: (e: string) => void }) {
  const reset = kind === 'space' ? 'Reset to #' : kind === 'section' ? 'Reset to folder' : `Reset to ${kind} icon`
  return (
    <div className="flex h-[320px] min-h-0 shrink flex-col overflow-hidden rounded-box shadow-[inset_0_0_0_1px_var(--line)] phone:h-[300px]">
      <EmojiChooser plain onPick={onPick} chosen={(e) => e === emoji} />
      <button
        type="button"
        disabled={!emoji}
        onClick={() => onPick('')}
        className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-left text-[0.8125rem] text-fg hover:bg-hover disabled:text-fg3 disabled:hover:bg-transparent coarse:h-11 phone:text-[0.9375rem]"
      >
        <PlainIcon kind={kind} />
        {reset}
      </button>
    </div>
  )
}

/** Rename space, Rename section, Rename machine and New section, as the window's (mods/spaces-chat rename.js): "Icon and
 *  name", the icon left of the field (a click opens the picker), the field starting with its text selected; Enter
 *  saves, Esc cancels. A section needs a name its machine's other sections don't have; a machine's or a space's empty
 *  name goes back to its own (the placeholder). */
function NameDialog({ snap, kind, id, own, here, name: was = '', emoji: had = '', machine }: { snap: Snapshot; kind: 'machine' | 'section' | 'new' | 'space'; id?: string; own?: string; here?: boolean; name?: string; emoji?: string; machine?: string }) {
  const [name, setName] = useState(was)
  const [emoji, setEmoji] = useState(had)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.select()
  }, [])
  // Escape closes the emoji first, then the dialog, keeping nothing
  const shut = useRef(() => {})
  shut.current = () => (picking ? setPicking(false) : close())
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      shut.current()
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  }, [])
  const typed = name.replace(/\s+/g, ' ').trim()
  const isMachine = kind === 'machine'
  const isSection = kind === 'section' || kind === 'new'
  // Pinned keeps its pin (no icon), and empty goes back to its own name
  const pinned = id === PINNED
  const title = kind === 'new' ? 'New section' : isMachine ? 'Rename machine' : kind === 'section' ? 'Rename section' : 'Rename space'
  const iconKind: IconKind = isMachine ? (here ? 'monitor' : 'server') : isSection ? 'section' : 'space'
  const save = async () => {
    if (busy) return
    // the window's checks, on Save: a section needs a name, its own among its machine's
    if (isSection && !pinned) {
      if (!typed) return setError('A section needs a name.')
      if (sectionProblem(defsOf(snap), typed, machine, id)) return setError('Another section here has this name.')
    }
    if (typed === was && emoji === had) return close()
    setBusy(true)
    setError(null)
    const action = kind === 'new' ? ({ type: 'section', op: 'new', name: typed, emoji, ...(machine ? { machine } : {}) } as const) : ({ type: 'rename', id: id!, name: typed, emoji, ...(kind === 'space' && !typed && was ? { unname: true } : {}) } as const)
    const r = (await act(action as never).catch((e: Error) => ({ ok: false, error: e.message }))) as { ok?: boolean; error?: string }
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be saved.')
    close()
  }
  const pick = (e: string) => {
    setEmoji(e)
    setPicking(false)
    input.current?.focus({ preventScroll: true })
  }
  return (
    <Sheet label={title} onClose={close} panel="max-w-[420px]">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
        <Who name={title} />
        <SheetClose onClose={close} />
      </div>
      <form
        className="flex min-h-0 flex-col gap-1.5 px-4 pt-3.5 pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label htmlFor="rename-name" className="text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
          Icon and name
        </label>
        <div className="flex shrink-0 items-center gap-2">
          {pinned ? null : <IconChoice kind={iconKind} emoji={emoji} open={picking} onClick={() => setPicking(!picking)} />}
          <input
            ref={input}
            id="rename-name"
            name="rename-name"
            aria-invalid={!!error || undefined}
            placeholder={isMachine ? own : isSection ? (pinned ? 'Pinned' : 'Section name') : own || 'Space name'}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            className="h-9 w-full min-w-0 flex-1 rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-need-fg)] phone:h-11 phone:px-3.5 phone:text-[1rem]"
          />
        </div>
        {picking ? <div className="mt-1.5 flex min-h-0 flex-col"><IconPicker kind={iconKind} emoji={emoji} onPick={pick} /></div> : null}
        <div className="mt-3.5 flex items-center justify-end gap-2 phone:flex-wrap phone:*:justify-center">
          <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 truncate text-[0.75rem] text-need-fg phone:basis-full phone:text-[0.875rem]">{error}</p>
          <Ghost className="h-[34px] text-sm! phone:h-11 phone:flex-1 phone:text-base!" onClick={close}>
            Cancel
          </Ghost>
          <Primary type="submit" disabled={busy} className="phone:flex-1">
            {kind === 'new' ? 'Create section' : 'Save'}
          </Primary>
        </div>
      </form>
    </Sheet>
  )
}

/** "Delete Clients?": its spaces go back under their machines, where they were */
function DeleteBox({ id, name, snap }: { id: string; name: string; snap: Snapshot }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const n = snap.sections?.find((s) => s.id === id)?.spaces.length ?? 0
  const go = async () => {
    setBusy(true)
    const r = (await act({ type: 'section', op: 'delete', id }).catch((e: Error) => ({ ok: false, error: e.message }))) as { ok?: boolean; error?: string }
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be deleted.')
    close()
  }
  return (
    <Dialog
      title={`Delete ${name}?`}
      safe
      onCancel={close}
      buttons={
        <Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={go}>
          {busy ? 'Deleting…' : 'Delete'}
        </Primary>
      }
    >
      <p>{n ? `${n > 1 ? `Its ${n} spaces go` : 'Its space goes'} back under ${n > 1 ? 'their machines' : 'its machine'}, where ${n > 1 ? 'they were' : 'it was'}. Nothing else changes.` : 'It is empty. Nothing else changes.'}</p>
      {error ? <p className="mt-1.5 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}
