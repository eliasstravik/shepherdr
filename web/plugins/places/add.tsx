// New space, as the window's (mods/newspace; its words and rules core/newspace.js): on the machine it was opened for (a
// machine's + › New space; else the shown space's), "Icon and folder": the space's icon ("#" until an emoji is picked),
// the field holding the folder it is made in, and Browse…. The field starts where the person works (the shown space's
// folder, as its repo's top) and typing in it suggests that machine's recent folders (arrows walk them, Enter picks,
// Esc closes them first). Browse… lists the field's folder's subfolders under it, the folder above first, a click going
// on into one: the web has no system folder picker, so it lists them as the window does on another machine. Under the
// field: a folder that isn't there yet is made on Create, one outside git is offered "Make it a git repo" (on), one in
// git says so. Create space makes it, named as Herdr names it, and opens it.
import clsx from 'clsx'
import { useEffect, useId, useRef, useState } from 'react'
import { goPlace, placeOf, setUI, useSnap, useUI } from '@client/kernel.ts'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { CheckIcon, FolderIcon, Ghost, ic, Primary, Who } from '@client/ui.tsx'
import type { Folders } from '@shared/types.ts'
import * as NS from '@core/newspace.js'
import { IconChoice, IconPicker } from './section.tsx'

/** opens the dialog; a machine's + opens it on that machine */
export function openAddSpace(machine?: string) {
  setUI({ adding: machine ?? true, drawer: false, menu: false, plus: null, search: false })
}

const close = () => setUI({ adding: false })

/** as a space's name is typed: lowercase, and a space a hyphen (never two in a row), as Slack's channel names */
export const asTyped = (v: string) => v.toLowerCase().replace(/\s+/g, '-').replace(/-{2,}/g, '-')

const W = NS.WORDS

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const b = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok || b.error) throw new Error(b.error ?? `${r.status}`)
  return b
}

type Info = { home: string; recent: string[]; start: string }
/** what the field's folder is: there (a folder) or not yet, and in a git repo (null: couldn't ask) */
type Known = { exists: boolean; repo: boolean | null }
type Row = { path: string; up?: boolean }

/** the folder above, while browsing ("..") */
function UpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M14 9 9 4 4 9" />
      <path d="M20 20h-7a4 4 0 0 1-4-4V4" />
    </svg>
  )
}

/** a git repo's line: a branch */
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function NewSpaceDialog() {
  const snap = useSnap()!
  const ui = useUI()
  const listId = useId()
  // the machine: the one it was opened for, else the shown space's (Ctrl+Shift+N, the + menu), else this computer
  const [machine] = useState(() => (typeof ui.adding === 'string' ? ui.adding : (placeOf(snap, ui.place)?.machine ?? snap.host)))
  const remote = machine !== snap.host ? machine : null
  const [place] = useState(ui.place)
  const [info, setInfo] = useState<Info | null>(null)
  const [text, setText] = useState('')
  const [known, setKnown] = useState<Record<string, Known | undefined>>({})
  const [listOpen, setListOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const [browse, setBrowse] = useState<{ dir: string; rows: Row[] | null } | null>(null)
  const [makeRepo, setMakeRepo] = useState(true)
  const [icon, setIcon] = useState('')
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // the machine's home, recent folders and where the field starts, first (the window finds them before it opens)
  useEffect(() => {
    let live = true
    get<Info>(`api/newspace?machine=${encodeURIComponent(machine)}&place=${encodeURIComponent(place ?? '')}`).then(
      (i) => {
        if (!live) return
        setInfo({ ...i, recent: i.recent.filter((p) => !NS.scratch(p)) })
        setText(NS.tilde(i.start, i.home))
        requestAnimationFrame(() => input.current?.focus({ preventScroll: true }))
      },
      (e: Error) => live && setError(e.message),
    )
    return () => void (live = false)
  }, [machine, place])

  const home = info?.home ?? ''
  const field = info ? NS.pathOf(text, home) : null
  // whether the field's folder exists, and whether it's in a git repo, asked once per path
  useEffect(() => {
    if (!field || field in known) return
    const t = setTimeout(() => {
      get<Folders>(`api/folders?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(field)}`).then(
        (f) => setKnown((k) => ({ ...k, [field]: { exists: f.dir, repo: f.dir ? !!f.repo : false } })),
        () => setKnown((k) => ({ ...k, [field]: { exists: false, repo: null } })),
      )
    }, 150)
    return () => clearTimeout(t)
  }, [field, known, machine])

  // once it is made, wait for the new space to show, then open it
  useEffect(() => {
    if (!opening) return
    if (snap.places.some((p) => p.id === opening)) {
      close()
      goPlace(opening)
      return
    }
    const giveUp = setTimeout(close, 10_000)
    return () => clearTimeout(giveUp)
  }, [opening, snap])

  const now = field ? known[field] : undefined
  // the folder Create space makes the space in: the field's, once it's known whether it exists
  const folder = now ? field : null
  const offers = NS.offersRepo(folder, now?.repo, home)
  const rows: Row[] = !listOpen || !info ? [] : browse ? (browse.rows ?? []) : NS.suggestions(info.recent, text, home).map((path: string) => ({ path }))
  const empty = listOpen && browse && !rows.some((r) => !r.up) ? (browse.rows ? W.empty : W.loading) : ''

  const shut = () => {
    setListOpen(false)
    setBrowse(null)
    setHi(-1)
  }
  // a folder into the field, the suggestions closed
  const set = (path: string) => {
    setText(NS.tilde(path, home))
    shut()
    setError('')
    input.current?.focus({ preventScroll: true })
  }
  // Browse…: `dir` in the field, its subfolders under it (the folder above first), the list kept open
  const list = (dir: string) => {
    setText(NS.tilde(dir, home))
    setBrowse({ dir, rows: null })
    setListOpen(true)
    setHi(-1)
    setError('')
    input.current?.focus({ preventScroll: true })
    get<Folders>(`api/folders?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(dir)}`).then(
      (f) => {
        if (!f.dir) throw new Error()
        const kids = f.entries.map((e) => NS.untilde(e.path, home))
        setKnown((k) => ({ ...k, [dir]: { exists: true, repo: !!f.repo } }))
        setBrowse((b) => (b?.dir === dir ? { dir, rows: [...(dir === '/' ? [] : [{ path: NS.parent(dir), up: true }]), ...kids.map((path) => ({ path }))] } : b))
      },
    ).catch(() => {
      setBrowse((b) => (b?.dir === dir ? null : b))
      setListOpen(false)
      setError(W.cantList(NS.tilde(dir, home), remote))
    })
  }
  const pick = (path: string) => (browse ? list(path) : set(path))
  const choose = () => list(field && now?.exists ? field : home)

  const create = async () => {
    if (busy || !folder) return
    setBusy(true)
    setError('')
    try {
      const r = await fetch('api/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shepherdr': '1' },
        body: JSON.stringify({ machine, path: folder, makeRepo: offers && makeRepo, icon: icon || null }),
      })
      const b = (await r.json().catch(() => ({}))) as { place?: string; error?: string }
      if (!r.ok || !b.place) throw new Error(b.error ?? `${r.status}`)
      setOpening(b.place)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  // Esc closes the suggestions first, then the dialog. Up and Down open them and walk them; Enter picks the one on,
  // else makes the space.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (listOpen) shut()
      else close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const all = listOpen ? rows : NS.suggestions(info?.recent ?? [], text, home)
      if (!listOpen) setListOpen(true)
      const n = all.length
      if (n) setHi(e.key === 'ArrowDown' ? (hi + 1) % n : hi <= 0 ? n - 1 : hi - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (hi >= 0 && rows[hi]) pick(rows[hi].path)
      else void create()
    }
  }

  const label = 'text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]'
  return (
    <Sheet label={W.title} onClose={close} panel="max-w-[460px]">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
        <Who name={W.title} kind={remote ? W.on(remote) : undefined} />
        <SheetClose onClose={close} />
      </div>
      <div className="flex min-h-0 flex-col px-4 pt-3.5 pb-4" onPointerDown={(e) => listOpen && !(e.target as HTMLElement).closest('[data-folders]') && e.target !== input.current && shut()}>
        <label htmlFor={`${listId}-path`} className={label}>
          {W.label}
        </label>
        <div className="mt-1.5 flex shrink-0 items-center gap-2">
          <IconChoice kind="space" emoji={icon} open={picking} onClick={() => { shut(); setPicking(!picking) }} />
          <div className="relative min-w-0 flex-1">
            <input
              ref={input}
              id={`${listId}-path`}
              name="folder"
              disabled={!info}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              role="combobox"
              aria-expanded={rows.length > 0 || !!empty}
              aria-controls={listId}
              aria-activedescendant={hi >= 0 && rows[hi] ? `${listId}-${hi}` : undefined}
              placeholder={W.placeholder}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setListOpen(true)
                setBrowse(null)
                setHi(-1)
                setError('')
              }}
              onKeyDown={onKey}
              className="h-9 w-full rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus disabled:opacity-60 phone:h-11 phone:px-3.5 phone:text-[1rem]"
            />
          </div>
          <Ghost className="h-9 px-3.5 text-sm! phone:h-11 phone:text-base!" disabled={!info} onClick={choose}>
            {W.browse}
          </Ghost>
        </div>
        {/* the suggestions, under the field while they're open (in the sheet, which would clip a popup) */}
        {rows.length || empty ? (
          <ul
            id={listId}
            data-folders
            role="listbox"
            aria-label="Folders"
            className="mt-1.5 max-h-[calc(8*2rem+0.5rem)] overflow-y-auto overscroll-contain rounded-box p-1 shadow-[inset_0_0_0_1px_var(--line)] coarse:max-h-[calc(5*2.75rem+0.5rem)]"
          >
            {rows.map((r, i) => (
              <li
                key={`${r.up ? 'up:' : ''}${r.path}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === hi}
                onPointerMove={() => setHi(i)}
                onClick={() => pick(r.path)}
                className={clsx('press flex min-h-8 cursor-pointer items-center gap-2.5 rounded-row px-2 coarse:min-h-11', i === hi && 'bg-hover')}
              >
                {r.up ? <UpIcon className={clsx(ic, 'text-fg3')} /> : <FolderIcon className={clsx(ic, 'text-fg3')} />}
                <span className="max-w-[45%] shrink-0 truncate">{r.up ? '..' : NS.base(r.path, home)}</span>
                <span className="min-w-0 flex-1 truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{NS.tilde(r.path, home)}</span>
              </li>
            ))}
            {empty ? <li className="flex min-h-8 items-center px-2 text-fg3 coarse:min-h-11">{empty}</li> : null}
          </ul>
        ) : null}
        {picking ? (
          <div className="mt-2 flex min-h-0 flex-col">
            <IconPicker kind="space" emoji={icon} onPick={(e) => { setIcon(e); setPicking(false); input.current?.focus({ preventScroll: true }) }} />
          </div>
        ) : null}
        {/* one quiet line each, their room kept so nothing moves as the field changes */}
        <p className="min-h-5 pt-1 text-[0.75rem] text-fg3 phone:text-[0.875rem]">{field && now && !now.exists ? W.missing : ''}</p>
        <div className="mt-1 flex min-h-5 items-center gap-2 text-[0.8125rem] phone:text-[0.9375rem]">
          {offers ? (
            <button type="button" role="checkbox" aria-checked={makeRepo} onClick={() => setMakeRepo(!makeRepo)} className="flex min-w-0 items-center gap-2 text-left">
              <span className={clsx('grid size-3.5 shrink-0 place-items-center rounded-[3px] shadow-[inset_0_0_0_1px_var(--line2)]', makeRepo && 'bg-fg text-bg shadow-none')}>
                {makeRepo ? <CheckIcon className="size-2.5" /> : null}
              </span>
              <span className="shrink-0 text-fg">{W.makeRepo}</span>
              <span className="min-w-0 truncate text-fg3">{W.makeRepoWhy}</span>
            </button>
          ) : folder && now?.repo ? (
            <span className="flex min-w-0 items-center gap-2 text-fg3">
              <BranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">{W.isRepo}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 phone:flex-wrap phone:*:justify-center">
          <p role={error ? 'alert' : undefined} className="min-w-0 flex-1 truncate text-[0.75rem] text-need-fg phone:basis-full phone:whitespace-normal phone:text-[0.875rem]">{error}</p>
          <Ghost className="h-[34px] text-sm! phone:h-11 phone:flex-1 phone:text-base!" onClick={close}>
            {W.cancel}
          </Ghost>
          <Primary disabled={!folder || busy} onClick={() => void create()} className="phone:flex-1">
            {busy ? W.creating : W.create}
          </Primary>
        </div>
      </div>
    </Sheet>
  )
}

/** the dialog, while it is open */
export function AddSpace() {
  const ui = useUI()
  return ui.adding ? <NewSpaceDialog /> : null
}
