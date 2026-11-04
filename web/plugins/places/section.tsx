// "Rename machine", "New section" and "Rename section", as Slack's: a machine's heading's ⋯ renames it or makes a
// section in it, the sidebar header's + makes one at the top, a section's ⋯ renames it. One field: its emoji (a tap opens
// every emoji below it, with Remove emoji while it has one) and its name (the × empties it), then Cancel and Save. A
// machine's name empty goes back to its own; a section needs one, its own among its peers. The main machine keeps them,
// so every device shows them; a machine with no emoji shows a server, a section a folder. Deleting a section asks first:
// its spaces go back under their machines.
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { act, useSnap } from '@client/kernel.ts'
import { Dialog } from '@client/rowmenu.tsx'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { Ghost, ic, Primary, SectionIcon, ServerIcon, SmileIcon, Who, XIcon } from '@client/ui.tsx'
import { PINNED, sectionProblem, type SectionDefs } from '@shared/order.ts'
import { machineName, NAME_MAX, type Snapshot } from '@shared/types.ts'
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
  if (m) return <NameDialog key={m.id} snap={snap} kind="machine" id={m.id} own={m.ownName ?? m.machine} name={m.name} emoji={m.emoji} />
  const s = snap.sections?.find((x) => x.id === o.rename)
  return s ? <NameDialog key={s.id} snap={snap} kind="section" id={s.id} name={s.name} emoji={s.emoji} machine={s.machine} /> : null
}

function NameDialog({ snap, kind, id, own, name: was = '', emoji: had = '', machine }: { snap: Snapshot; kind: 'machine' | 'section' | 'new'; id?: string; own?: string; name?: string; emoji?: string; machine?: string }) {
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
  // Pinned keeps its pin, and empty goes back to its own name
  const pinned = id === PINNED
  const problem = isMachine
    ? typed && (snap.machines ?? []).some((x) => x.id !== id && x.name.toLowerCase() === typed.toLowerCase())
      ? 'Another machine has that name.'
      : undefined
    : typed
      ? sectionProblem(defsOf(snap), typed, machine, id)
      : undefined
  const changed = (isMachine ? typed || own : pinned ? typed || 'Pinned' : typed) !== was || emoji !== had
  const can = !busy && !problem && changed && (isMachine || pinned || !!typed)
  const title = isMachine ? 'Rename machine' : kind === 'new' ? 'New section' : 'Rename section'
  const where = machine ? `In ${machineName(snap.machines, machine)}` : 'At the top, for any machine’s spaces'
  const save = async () => {
    if (!can) return !changed && !busy && !problem ? close() : undefined
    setBusy(true)
    setError(null)
    const action = kind === 'new' ? ({ type: 'section', op: 'new', name: typed, emoji, ...(machine ? { machine } : {}) } as const) : ({ type: 'rename', id: id!, name: typed, emoji } as const)
    const r = (await act(action).catch((e: Error) => ({ ok: false, error: e.message }))) as { ok?: boolean; error?: string }
    setBusy(false)
    if (r.ok === false) return setError(r.error || 'It could not be saved.')
    close()
  }
  const pick = (e: string) => {
    setEmoji(e)
    setPicking(false)
    input.current?.focus({ preventScroll: true })
  }
  const Plain = isMachine ? ServerIcon : SectionIcon
  return (
    <Sheet label={title} onClose={close} panel="max-w-[440px]">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
        <Who name={title} kind={isMachine ? `The machine ${own}` : where} />
        <SheetClose onClose={close} />
      </div>
      <form
        className="flex min-h-0 flex-col gap-3 px-4 pt-4 pb-4 phone:gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className={clsx('flex h-10 shrink-0 items-center gap-1 rounded-row bg-bg pr-1.5 pl-1 shadow-[inset_0_0_0_1px_var(--line2)] has-[input:focus]:shadow-[inset_0_0_0_1.5px_var(--focus)] coarse:h-11 phone:h-12', problem && 'shadow-[inset_0_0_0_1.5px_var(--color-need-fg)]!', pinned && 'pl-3')}>
          {pinned ? null : (
          <button
            type="button"
            aria-label={emoji ? `Emoji ${emoji}: change it` : 'Pick an emoji'}
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
            className="grid size-8 shrink-0 place-items-center rounded-full text-[1.125rem] leading-none text-fg3 hover:bg-hover hover:text-fg aria-expanded:bg-sel phone:size-10 phone:text-[1.25rem]"
          >
            {emoji || <SmileIcon className={ic} />}
          </button>
          )}
          <input
            ref={input}
            name="section-name"
            aria-label={isMachine ? 'Machine name' : 'Section name'}
            aria-invalid={!!problem || undefined}
            placeholder={isMachine ? own : pinned ? 'Pinned' : 'e.g. Clients'}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-fg outline-none placeholder:text-fg3 phone:text-[1rem]"
          />
          {name ? (
            <button
              type="button"
              aria-label="Clear the name"
              onClick={() => {
                setName('')
                input.current?.focus()
              }}
              className="relative grid size-6 shrink-0 place-items-center rounded-full text-fg3 hover:bg-hover hover:text-fg phone:size-9 phone:after:absolute phone:after:-inset-1 phone:after:content-['']"
            >
              <XIcon className={ic} />
            </button>
          ) : null}
        </div>
        {picking ? (
          <div className="flex h-[320px] min-h-0 shrink flex-col overflow-hidden rounded-box shadow-[inset_0_0_0_1px_var(--line)] phone:h-[300px]">
            {emoji ? (
              <button type="button" onClick={() => pick('')} className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-left text-[0.8125rem] text-fg2 hover:bg-hover hover:text-fg coarse:h-11 phone:text-[0.9375rem]">
                <Plain className={ic} />
                Remove emoji: show a {isMachine ? 'server' : 'folder'}
              </button>
            ) : null}
            <EmojiChooser onPick={pick} chosen={(e) => e === emoji} />
          </div>
        ) : null}
        <p className="min-h-5 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">
          {problem ? (
            <span className="text-need-fg">{problem}</span>
          ) : error ? (
            <span className="text-need-fg">{error}</span>
          ) : isMachine ? (
            typed ? (
              'Only the name that shows changes.'
            ) : (
              `Empty, it goes back to ${own}.`
            )
          ) : kind === 'new' ? (
            machine ? (
              `Holds ${machineName(snap.machines, machine)}’s spaces. Move one in from its ⋯ or drag it here.`
            ) : (
              'Holds spaces from any machine. Move one in from its ⋯ or drag it here.'
            )
          ) : pinned && !typed ? (
            'Empty, it goes back to Pinned.'
          ) : (
            'Only the name that shows changes.'
          )}
        </p>
        <div className="flex justify-end gap-2 phone:flex-col-reverse phone:*:w-full phone:*:justify-center">
          <Ghost className="h-[34px] text-sm! phone:h-11 phone:text-base!" onClick={close}>
            Cancel
          </Ghost>
          <Primary type="submit" disabled={!can}>
            {busy ? 'Saving…' : kind === 'new' ? 'Create' : 'Save'}
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
