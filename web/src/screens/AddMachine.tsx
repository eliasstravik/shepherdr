// Add machine (3.0's sidebar foot), as the window's (mods/machine-add-chat; its words and rules core/machine-add.js): the
// hosts in ~/.ssh/config to pick from, each added with one click (hc machine add), or one typed the way ssh reaches it.
// A row says Added, Connecting, or why it didn't work; an added Mac gets the note on Full Disk Access. One that needs
// something only the person can answer (a password, a new host key, herdr-core to install) the window adds in a small
// terminal window of its own; the web has none to open, so it shows the window's own fallback for that: the command to
// copy and run in any terminal.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import * as MA from '@core/machine-add.js'
import { copyText } from '../copy.ts'
import { act } from '../kernel.ts'
import { Sheet, SheetClose } from '../Stack.tsx'
import { CheckCircleIcon, CheckIcon, CopyIcon, FootButton, Ghost, ic, Primary, ServerIcon, Who } from '../ui.tsx'

const W = MA.WORDS
type Host = { alias: string; aliases: string[]; hostname: string | null; user: string | null }
type Added = { target?: string; name?: string; host?: string }
/** a target's state: adding, the copy-the-command fallback, or why it didn't work */
type State = 'adding' | 'manual' | string

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => { open = v; for (const f of listeners) f() }

export function AddMachineButton() {
  return (
    // too narrow a sidebar for both words beside Settings, just the plus (its name still read out)
    <FootButton onClick={() => set(true)}>
      {/* the window's foot row: a plus, "Add machine" */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2"><path d="M12 5v14M5 12h14" /></svg>
      <span className="truncate @max-[14rem]:sr-only phone:@max-[17.5rem]:sr-only">Add machine</span>
    </FootButton>
  )
}

export function AddMachineDialog() {
  const on = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  return on ? <AddMachine /> : null
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden className={clsx(ic, 'animate-spin text-work-fg')}>
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  )
}

function AddMachine() {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [added, setAdded] = useState<Added[]>([])
  const [state, setState] = useState<Record<string, State | undefined>>({})
  const [macs, setMacs] = useState<Record<string, { name: string; core: string }>>({})
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const close = () => set(false)

  useEffect(() => {
    act({ type: 'machine-hosts' } as never).then(
      (r) => { const b = r as { hosts?: Host[]; added?: Added[] }; setHosts(b.hosts ?? []); setAdded(b.added ?? []) },
      () => setHosts([]),
    )
  }, [])
  // Esc closes it, as the window's
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  }, [])

  const add = async (raw: string) => {
    const target = raw.trim()
    if (!target || state[target] === 'adding') return
    setState((s) => ({ ...s, [target]: 'adding' }))
    const r = (await act({ type: 'machine-add', target } as never).catch((e: Error) => ({ error: e.message || W.failed }))) as
      { ok?: boolean; added?: Added[]; mac?: { name: string; core: string }; manual?: boolean; error?: string }
    if (r.ok) {
      setState((s) => ({ ...s, [target]: undefined }))
      if (target === typed.trim()) setTyped('')
      if (r.added) setAdded(r.added)
      if (r.mac) setMacs((m) => ({ ...m, [target]: r.mac! }))
    } else setState((s) => ({ ...s, [target]: r.manual ? 'manual' : r.error || W.failed }))
  }

  // what a host's state says under it: an error in red, or the command to copy; nothing while it works
  const note = (target: string, pad: boolean) => {
    const st = state[target]
    if (st === 'manual')
      return (
        <div className={clsx('flex items-center gap-2.5 pb-1.5', pad && 'pl-[34px]')}>
          <p className="min-w-0 flex-1 text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{W.manual}</p>
          <Ghost onClick={(e) => void copyText(MA.command(target), e.currentTarget).then((ok) => ok && setCopied(target))}>
            {copied === target ? <CheckIcon className={ic} /> : <CopyIcon className={ic} />}
            {copied === target ? W.copied : W.copy}
          </Ghost>
        </div>
      )
    if (!st || st === 'adding') return null
    return <p className={clsx('pb-1.5 text-[0.75rem] text-need-fg phone:text-[0.8125rem]', pad && 'pl-[34px]')}>{st}</p>
  }

  // a neutral note (not an error): what the Mac will ask, and the way to allow it for good
  const macCard = (target: string) => {
    const mac = macs[target]
    return (
      <div className="mx-2 mb-2 flex flex-col gap-2 rounded-box bg-well p-3 shadow-[inset_0_0_0_1px_var(--line)]">
        <p className="font-semibold">{W.macTitle(mac.name)}</p>
        <p className="text-[0.75rem] text-fg2 phone:text-[0.8125rem]">{W.macAbout}</p>
        <code className="rounded-row bg-bg px-2 py-1 text-[0.75rem] break-all shadow-[inset_0_0_0_1px_var(--line)]">{mac.core}</code>
        <div className="flex flex-wrap items-center gap-2">
          <Ghost onClick={() => { void act({ type: 'machine-mac-open', machine: mac.name } as never).catch(() => null); setOpened((o) => ({ ...o, [target]: true })) }}>
            {W.macOpen(mac.name)}
          </Ghost>
          {opened[target] ? <span className="text-[0.75rem] text-fg3">{W.macOpened}</span> : null}
        </div>
      </div>
    )
  }

  const row = (h: Host) => {
    const target = h.alias
    const st = state[target]
    const done = MA.isAdded(added, target)
    const idle = !done && !st
    return (
      <li key={target} className="flex flex-col">
        <div
          role={idle ? 'button' : undefined}
          tabIndex={idle ? 0 : undefined}
          onClick={idle ? () => void add(target) : undefined}
          onKeyDown={idle ? (e) => e.key === 'Enter' && void add(target) : undefined}
          className={clsx('flex min-h-10 items-center gap-2.5 rounded-row px-2.5 coarse:min-h-12', idle && 'press cursor-pointer hover:bg-hover')}
        >
          <ServerIcon className={clsx(ic, 'text-fg3')} />
          <span className="shrink-0">{h.alias}</span>
          <span className="min-w-0 flex-1 truncate text-[0.75rem] text-fg3 phone:text-[0.8125rem]">{MA.hostSub(h)}</span>
          {done ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-ready-fg"><CheckCircleIcon className={ic} />{W.added}</span>
          ) : st === 'adding' ? (
            <span className="flex shrink-0 items-center gap-1.5 text-[0.75rem] text-fg2"><Spinner />{W.connecting}</span>
          ) : (
            <Ghost onClick={(e) => { e.stopPropagation(); void add(target) }}>{W.add}</Ghost>
          )}
        </div>
        {note(target, true)}
        {macs[target] ? macCard(target) : null}
      </li>
    )
  }

  const label = 'pb-1.5 text-[0.75rem] font-medium text-fg3 phone:text-[0.875rem]'
  const t = typed.trim()
  return (
    <Sheet label={W.title} onClose={close} panel="max-w-[480px]">
      <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
        <Who name={W.title} />
        <SheetClose onClose={close} />
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto px-4 pt-3.5 pb-4">
        <p className="text-pretty text-fg2">{W.about}</p>
        <p className={clsx(label, 'pt-4')}>{hosts?.length ? W.fromConfig : W.noHosts}</p>
        <ul className="-mx-2 flex max-h-[280px] min-h-0 shrink flex-col overflow-y-auto overscroll-contain">
          {hosts === null ? <li className="px-2.5 py-2 text-[0.75rem] text-fg3">{W.reading}</li> : hosts.map(row)}
        </ul>
        <label htmlFor="add-machine-typed" className={clsx(label, 'pt-3.5')}>{W.orType}</label>
        <div className="flex items-center gap-2">
          <input
            id="add-machine-typed"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add(typed)}
            placeholder={W.placeholder}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-9 min-w-0 flex-1 rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus phone:h-11 phone:px-3.5 phone:text-[1rem]"
          />
          {/* the dialog's one primary */}
          <Primary disabled={!t} onClick={() => void add(typed)}>
            {W.add}
          </Primary>
        </div>
        {t && note(t, false) ? <div className="pt-1.5">{note(t, false)}</div> : null}
      </div>
    </Sheet>
  )
}
