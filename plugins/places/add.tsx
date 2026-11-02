// A new space from the sidebar: pick the machine (when there is more than one, from a menu as a select's, each with its
// emoji or a server), then a folder in its home (the picker starts at ~), then its name, filled in from the folder's as
// the space rules have it (lowercase, - for a space). A repo becomes a space as it is; any other folder (or one not
// made yet) a new repo first. Typing the path narrows the list, and a line under it says what the folder is. It gets
// its own herdr space and coordinator, and opens.
import clsx from 'clsx'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { goPlace, placeOf, setUI, useSnap, useUI } from '@client/kernel.ts'
import { Sheet, SheetClose } from '@client/Stack.tsx'
import { CheckCircleIcon, CheckIcon, FolderIcon, ic, Menu, MenuItem, Meta, NextIcon, PlusIcon, Primary, ServerIcon, UpDownIcon, Who } from '@client/ui.tsx'
import { machineName, nameProblem, slugify, type FolderEntry, type Folders, type Machine, type Snapshot } from '@shared/types.ts'

/** opens the dialog; a machine's + opens it with that machine chosen */
export function openAddSpace(machine?: string) {
  setUI({ adding: machine ?? true, drawer: false, menu: false, plus: null, search: false })
}

const close = () => setUI({ adding: false })

/** as a space's name is typed: lowercase, and a space a hyphen (never two in a row), as Slack's channel names */
export const asTyped = (v: string) => v.toLowerCase().replace(/\s+/g, '-').replace(/-{2,}/g, '-')

/* ---------- folders, from the machine ---------- */

const cache = new Map<string, Promise<Folders>>()

function load(machine: string, path: string): Promise<Folders> {
  const key = `${machine}\n${path}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`api/folders?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(path)}`).then(async (r) => {
      const b = (await r.json().catch(() => ({}))) as Folders & { error?: string }
      if (!r.ok) throw new Error(b.error ?? `${r.status}`)
      return b
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

type Loaded = { data?: Folders; error?: string; for: string }

/** what a path is on a machine; the last answer stays while the next one comes */
function useFolders(machine: string, path: string | null, delay = 0): Loaded | null {
  const [got, setGot] = useState<Loaded | null>(null)
  useEffect(() => {
    if (path === null) return setGot(null)
    let live = true
    const key = `${machine}\n${path}`
    const t = setTimeout(
      () =>
        load(machine, path).then(
          (data) => live && setGot({ data, for: key }),
          (e: Error) => live && setGot({ error: e.message, for: key }),
        ),
      cache.has(key) ? 0 : delay,
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [machine, path, delay])
  return got
}

/* ---------- the dialog ---------- */

function startMachine(snap: Snapshot, place: string, chosen?: string) {
  const machines = snap.machines ?? []
  const here = chosen ?? placeOf(snap, place)?.machine ?? snap.host
  return machines.find((m) => m.machine === here && m.status !== 'off')?.machine ?? machines.find((m) => m.status !== 'off')?.machine ?? snap.host
}

/** ~/dev/sh → the folder ~/dev/ and what is typed after it, sh */
function split(path: string) {
  const p = path === '~' ? '~/' : path
  const i = p.lastIndexOf('/')
  return { dir: i < 0 ? '~/' : p.slice(0, i + 1), leaf: i < 0 ? p : p.slice(i + 1) }
}

const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? ''

function matching(entries: FolderEntry[], leaf: string) {
  const n = leaf.toLowerCase()
  const shown = entries.filter((e) => !e.name.startsWith('.') || n.startsWith('.'))
  if (!n) return shown
  const starts = shown.filter((e) => e.name.toLowerCase().startsWith(n))
  return [...starts, ...shown.filter((e) => !starts.includes(e) && e.name.toLowerCase().includes(n))]
}

function AddDialog() {
  const snap = useSnap()!
  const ui = useUI()
  const machines = snap.machines ?? []
  const [machine, setMachine] = useState(() => startMachine(snap, ui.place, typeof ui.adding === 'string' ? ui.adding : undefined))
  const [path, setPath] = useState('~/')
  const [cur, setCur] = useState(-1)
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  // a fresh look at the folders each time it opens
  useEffect(() => cache.clear(), [])

  const { dir, leaf } = split(path)
  const listing = useFolders(machine, dir)
  // the folder the path names, a trailing / or not (one opened or Tab-completed is still the one to add); never home
  const named = path.trim().replace(/\/+$/, '')
  const target = useFolders(machine, named && named !== '~' ? named : null, 150)
  const atHome = dir === '~/' && !leaf
  const listed = listing?.for === `${machine}\n${dir}` ? listing : null

  const rows = useMemo(() => {
    const entries = matching(listed?.data?.entries ?? [], leaf)
    if (!atHome) return entries
    const likely = listed?.data?.likely ?? []
    return [...likely, ...entries.filter((e) => !likely.some((l) => l.path === e.path))]
  }, [listed, leaf, atHome])
  const likelyCount = atHome ? (listed?.data?.likely?.length ?? 0) : 0

  // what the typed path is: only once its answer is in (while typing, the last one would mislead)
  const t = target?.for === `${machine}\n${named}` ? target : null
  const info = t?.data
  const create = !!info && !info.repo && (!info.exists || info.dir)
  const ready = !!info && !info.added && (!!info.repo || create)
  const shownName = name ?? slugify(base(path))
  const nameBad = nameProblem(shownName, snap.places.filter((p) => p.machine === machine).map((p) => p.name))

  // once it is added, wait for the new place to show, then open it
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

  const go = (p: string) => {
    setPath(p)
    setCur(-1)
    setName(null)
    setError(null)
    input.current?.focus()
  }

  const pick = (e: FolderEntry) => {
    if (e.added) return
    // a repo is picked; any other folder opens
    go(e.repo || e.path === path ? e.path : `${e.path}/`)
  }

  const submit = async () => {
    if (!ready || busy || nameBad) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('api/spaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shepherdr': '1' },
        body: JSON.stringify({ machine, path: named, name: shownName, create }),
      })
      const b = (await r.json().catch(() => ({}))) as { place?: string; error?: string }
      if (!r.ok || !b.place) throw new Error(b.error ?? `${r.status}`)
      setOpening(b.place)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCur(Math.min(rows.length - 1, cur + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCur(Math.max(-1, cur - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[cur]
      if (row && row.path !== named) pick(row)
      else submit()
    } else if (e.key === 'Tab' && !e.shiftKey && leaf && rows.length) {
      // completes to the folder and goes in, like a terminal
      e.preventDefault()
      go(`${rows[Math.max(0, cur)].path}/`)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  const status = (() => {
    if (error) return <span className="text-need">{error}</span>
    if (t?.error) return <span className="text-need">{t.error}</span>
    if (!named || path === '~/') return 'Pick a folder in your home, or type a name for a new one.'
    if (named === '~') return 'Your home folder is the home space already: pick a folder in it.'
    if (!info) return ' '
    if (info.added) return 'Already a space.'
    if (info.repo && info.repo !== info.path) return `Inside ${info.repo}, which is added.`
    if (info.repo) return 'A git repo. It gets its own herdr space and coordinator.'
    if (info.exists && !info.dir) return 'That is a file, not a folder.'
    if (info.exists) return 'Not a git repo yet. Create makes it one, with an empty first commit on main; its files stay as they are.'
    return 'No folder here yet. Create makes it, with git and a first commit on main.'
  })()

  // what the folder is, at a glance before the words: a repo, a folder to make one of, or one to make
  const mark =
    error || t?.error || !info || info.added || (info.repo && info.repo !== info.path) || (info.exists && !info.dir) ? null : info.repo ? (
      <CheckCircleIcon className={clsx(ic, 'text-ready-fg')} />
    ) : info.exists ? (
      <FolderIcon className={clsx(ic, 'text-fg3')} />
    ) : (
      <PlusIcon className={clsx(ic, 'text-fg3')} />
    )

  const one = machines.length < 2
  // a phone's keyboard leaves the sheet little room: the folders keep it, and what waits for the keyboard to go down
  // (the machine, the name's rules, Cancel and Create: the keyboard's Go creates) steps aside meanwhile
  const typing = ui.device === 'phone' && ui.keyboard
  return (
    <Sheet label="New space" onClose={close} panel="max-w-[480px]">
        <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
          <Who name="New space" kind={one ? `On ${machineName(snap.machines, machine)}` : 'Pick a machine, a folder and a name'} />
          <SheetClose onClose={close} />
        </div>

        <div className="flex shrink-0 flex-col gap-3 px-4 pt-3.5 pb-2 phone:gap-4 phone:pt-4">
          {one || typing ? null : (
            <div className="flex flex-col gap-1.5">
              <div className="text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
                Machine
              </div>
              <MachinePick
                machines={machines}
                value={machine}
                onPick={(m) => {
                  setMachine(m)
                  go('~/')
                }}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${listId}-path`} className="text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
              Folder
            </label>
            <input
              ref={input}
              id={`${listId}-path`}
              name="folder"
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={cur >= 0 ? `${listId}-${cur}` : undefined}
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                // what is typed narrows the list: the best match is ready for Enter
                setCur(split(e.target.value).leaf ? 0 : -1)
                setName(null)
                setError(null)
              }}
              onKeyDown={onKey}
              className="h-9 w-full rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus phone:h-11 phone:px-3.5 phone:text-[1rem]"
            />
          </div>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label="Folders"
          className="h-[min(300px,40vh)] min-h-0 overflow-y-auto px-2 pb-1.5 phone:h-auto phone:flex-1"
        >
          {rows.map((e, i) => (
            <FolderRow
              key={e.path}
              id={`${listId}-${i}`}
              e={e}
              cur={i === cur}
              chosen={e.path === named}
              heading={atHome && i === 0 && likelyCount ? 'Likely repos' : atHome && i === likelyCount && likelyCount ? 'Folders in ~' : undefined}
              where={i < likelyCount ? e.path.slice(0, -e.name.length - 1) : undefined}
              onPick={() => pick(e)}
              onHover={() => setCur(i)}
            />
          ))}
          {/* a name nothing matches is a new folder: the line under the list says so */}
          {listed && !rows.length && (listed.error ? listed.error !== t?.error : !leaf) ? (
            <li className="px-2 py-2 text-[0.8125rem] text-fg2 phone:text-[0.9375rem]">{listed.error ?? (listed.data?.exists === false ? 'No folder here yet.' : 'No folders in here.')}</li>
          ) : null}
        </ul>

        <div className="flex shrink-0 flex-col gap-3 border-t border-line px-4 pt-3 pb-4 phone:pb-[max(env(safe-area-inset-bottom),--spacing(4))]">
          <p className="flex gap-2 text-[0.8125rem] text-pretty text-fg2 phone:text-[0.9375rem]" aria-live="polite">
            {mark ? <span className="flex h-lh items-center">{mark}</span> : null}
            <span className="min-w-0">{status}</span>
          </p>
          {named && named !== '~' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${listId}-name`} className="text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
                Name
              </label>
              <input
                id={`${listId}-name`}
                name="name"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={80}
                aria-invalid={!!nameBad || undefined}
                aria-describedby={`${listId}-name-hint`}
                value={shownName}
                onChange={(e) => setName(asTyped(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                  else if (e.key === 'Escape') {
                    e.stopPropagation()
                    close()
                  }
                }}
                className="h-9 w-full rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus:shadow-box-focus aria-invalid:shadow-[inset_0_0_0_1.5px_var(--color-need-fg)] phone:h-11 phone:px-3.5 phone:text-[1rem]"
              />
              <p id={`${listId}-name-hint`} className={clsx('text-[0.75rem] phone:text-[0.875rem]', nameBad && shownName ? 'text-need' : 'text-fg3', typing && !(nameBad && shownName) && 'sr-only')}>
                {nameBad && shownName ? nameBad : 'Lowercase letters, numbers, - and _. Its links and commands use it.'}
              </p>
            </div>
          ) : null}
          <div className={clsx('flex items-center justify-end gap-2', typing && 'hidden')}>
            <Primary soft onClick={close} className="phone:flex-1 phone:justify-center">
              Cancel
            </Primary>
            <Primary disabled={!ready || busy || !!nameBad} onClick={submit} className="phone:flex-1 phone:justify-center">
              {busy ? (opening ? 'Opening…' : 'Creating…') : 'Create space'}
            </Primary>
          </div>
        </div>
    </Sheet>
  )
}

/** the machine, as a select: a field showing the one chosen that opens the app's own menu of them all, the chosen one
 *  checked; one out of reach can't be picked. Its menu scrolls where the dialog has too little room below it. */
function MachinePick({ machines, value, onPick }: { machines: Machine[]; value: string; onPick: (machine: string) => void }) {
  const [open, setOpen] = useState(false)
  const [tall, setTall] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const chosen = machines.find((m) => m.machine === value)
  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    const floor = ref.current?.closest('[role=dialog]')?.getBoundingClientRect().bottom ?? innerHeight
    if (r) setTall(Math.max(120, floor - r.bottom - 16))
    setOpen(!open)
  }
  // the chosen one in view (opened from the keyboard, the menu gives it the focus)
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-checked=true]')?.scrollIntoView({ block: 'nearest' })
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Machine: ${chosen?.name ?? value}`}
        onClick={toggle}
        className="press flex h-9 w-full items-center gap-2 rounded-full bg-bg pr-2 pl-3 text-left shadow-[inset_0_0_0_1px_var(--line2)] outline-none hover:bg-hover focus-visible:shadow-box-focus phone:h-11 phone:pl-3.5 phone:text-[1rem]"
      >
        <MachineMark m={chosen} />
        <span className="min-w-0 flex-1 truncate">{chosen?.name ?? value}</span>
        <UpDownIcon className={clsx(ic, 'text-fg3')} />
      </button>
      {open ? (
        <Menu label="Machines" select onClose={() => setOpen(false)} className="absolute top-full left-0 z-10 mt-1 w-full origin-top">
          <div ref={list} style={{ maxHeight: tall }} className="overflow-y-auto overscroll-contain">
            {machines.map((m) => (
              <MenuItem
                key={m.id}
                role="menuitemradio"
                aria-checked={m.machine === value}
                disabled={m.status === 'off'}
                icon={m.machine === value ? <CheckIcon className={ic} /> : null}
                hint={m.status === 'off' ? 'Out of reach' : undefined}
                onClick={() => {
                  setOpen(false)
                  if (m.machine !== value) onPick(m.machine)
                }}
                className="disabled:cursor-default disabled:text-fg3 disabled:hover:bg-transparent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <MachineMark m={m} />
                  <span className="truncate">{m.name}</span>
                </span>
              </MenuItem>
            ))}
          </div>
        </Menu>
      ) : null}
    </div>
  )
}

/** a machine's mark, as its sidebar heading has it: its emoji, or a server */
function MachineMark({ m }: { m?: Machine }) {
  return m?.emoji ? (
    <span aria-hidden className="grid w-4 shrink-0 place-items-center text-[0.9375rem] leading-none phone:text-base">
      {m.emoji}
    </span>
  ) : (
    <ServerIcon className={clsx(ic, 'text-fg3')} />
  )
}

function FolderRow({
  id,
  e,
  cur,
  chosen,
  heading,
  where,
  onPick,
  onHover,
}: {
  id: string
  e: FolderEntry
  cur: boolean
  chosen: boolean
  heading?: string
  /** the folder it is in, for likely repos from all over home */
  where?: string
  onPick: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (cur) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  return (
    <>
      {heading ? (
        <li role="presentation" className="px-2 pt-2.5 pb-1 text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]">
          {heading}
        </li>
      ) : null}
      <li
        ref={ref}
        id={id}
        role="option"
        aria-selected={cur || chosen}
        aria-disabled={e.added || undefined}
        onMouseMove={onHover}
        onClick={onPick}
        className={clsx(
          'press flex min-h-8 cursor-pointer items-center gap-2.5 rounded-row px-2 aria-disabled:cursor-default coarse:min-h-11 phone:min-h-12',
          cur && 'bg-hover',
          chosen && 'bg-sel',
        )}
      >
        <FolderIcon className={clsx(ic, e.repo ? 'text-fg2' : 'text-fg3')} />
        <span className={clsx('min-w-0 flex-1 truncate', e.added && 'text-fg3')}>
          {e.name}
          {where ? <span className="text-fg3"> {where}</span> : null}
        </span>
        {e.added ? <Meta>Added</Meta> : e.repo ? <Meta>git</Meta> : <NextIcon className={clsx(ic, 'text-fg3')} />}
      </li>
    </>
  )
}

/** the dialog, while it is open */
export function AddSpace() {
  const ui = useUI()
  return ui.adding ? <AddDialog /> : null
}
