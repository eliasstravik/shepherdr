// A space's worktrees, as the window's worktree dialog (Herdr's mods/worktree, opened by a space's New worktree, Open
// worktree and Remove worktree): New asks a branch name for a checkout in ~/.herdr/worktrees/<repo>/; Open lists the
// repo's checkouts (the main one first, then the latest committed) to filter and open, the one a space shows marked
// "open"; Remove says what goes (uncommitted changes, submodule commits pushed nowhere) before it closes the space and
// deletes the checkout. The window's dialog has no buttons, only its keys under it (↵ create · esc cancel): so has this
// one with a keyboard; a touch screen gets the buttons instead.
import clsx from 'clsx'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { act, goPlace, useSnap } from '../kernel.ts'
import { Sheet, SheetClose } from '../Stack.tsx'
import { Ghost, Primary, Who } from '../ui.tsx'

type Checkout = { path: string; branch: string | null; main: boolean; at: number; place?: string }
type Info = { home: string; root: string; folder: string; repo: { name: string; linked: boolean; top: string } | null; dirty?: boolean; unpushed?: string[]; list?: Checkout[] }

const tilde = (p: string, home: string) => (home && (p === home || p.startsWith(home + '/')) ? `~${p.slice(home.length)}` : p)
const ago = (s: number) => {
  const d = Date.now() / 1000 - s
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`
}

type Open = { place: string; name: string; op: 'new' | 'open' | 'remove' } | null
let open: Open = null
const listeners = new Set<() => void>()
export const openWorktree = (o: NonNullable<Open>) => { open = o; for (const f of listeners) f() }
const close = () => { open = null; for (const f of listeners) f() }

export function WorktreeDialog() {
  const o = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  return o ? <Worktree key={`${o.place}:${o.op}`} o={o} /> : null
}

function Worktree({ o }: { o: NonNullable<Open> }) {
  const snap = useSnap()
  const [info, setInfo] = useState<Info | null>(null)
  const [text, setText] = useState('')
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const remove = o.op === 'remove'
  const opening_ = o.op === 'open'

  // what it shows first: the repo (and, to remove, what would be lost; to open, its checkouts)
  useEffect(() => {
    act({ type: 'worktree', place: o.place, op: 'info', for: o.op } as never).then(
      (r) => setInfo(r as Info),
      (e: Error) => { setInfo({ home: '', root: '', folder: '', repo: null }); setError(e.message) },
    )
  }, [o])
  // a space made or opened: go there once it shows
  useEffect(() => {
    if (!opening || !snap) return
    if (snap.places.some((p) => p.id === opening)) { close(); goPlace(opening); return }
    const giveUp = setTimeout(close, 10_000)
    return () => clearTimeout(giveUp)
  }, [opening, snap])

  const r = info?.repo
  const home = info?.home ?? ''
  const all = info?.list ?? []
  const f = text.trim().toLowerCase()
  const shown = all.filter((c) => !f || `${c.branch ?? ''} ${c.path}`.toLowerCase().includes(f))
  const blocked = !r || (remove && !r.linked)

  const send = async (body: object) => {
    if (busy || !r) return
    setBusy(true)
    setError('')
    try {
      const out = (await act({ type: 'worktree', place: o.place, ...body } as never)) as { place?: string; error?: string; dirty?: boolean; unpushed?: string[]; ok?: boolean }
      if (out.error) {
        // what changed since it opened is now said, and Enter again removes it anyway
        if (out.dirty !== undefined) setInfo((i) => (i ? { ...i, dirty: out.dirty, unpushed: out.unpushed ?? i.unpushed } : i))
        setError(out.error)
        setBusy(false)
        return
      }
      if (out.place) setOpening(out.place)
      else close()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const go = () => (remove ? (r?.linked ? send({ op: 'remove', dirty: !!info?.dirty, unpushed: info?.unpushed ?? [] }) : undefined) : send({ op: 'new', branch: text }))
  const openOne = (c?: Checkout) => {
    if (!c) return
    if (c.place) { close(); goPlace(c.place); return }
    void send({ op: 'open', path: c.path })
  }

  // Esc closes it; Remove has no field, so Enter removes, as the window's
  const goRef = useRef(go)
  goRef.current = go
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close()
      } else if (remove && e.key === 'Enter' && !e.repeat && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        void goRef.current()
      }
    }
    addEventListener('keydown', on, true)
    return () => removeEventListener('keydown', on, true)
  }, [remove])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (opening_) {
      const n = shown.length
      if (e.key === 'Enter') openOne(shown[at])
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) setAt((at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
      else return
      e.preventDefault()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void go()
    }
  }

  const title = opening_ ? `Open worktree${r ? ` of ${r.name}` : ''}` : remove ? `Remove worktree ${o.name}?` : `New worktree${r ? ` of ${r.name}` : ''}`
  const notRepo = `${info?.folder ? tilde(info.folder, home) : 'This folder'} is not in a git repository.`
  const detail = !info
    ? '…'
    : !r
      ? notRepo
      : remove
        ? !r.linked
          ? "This is the repository's main checkout, not a worktree."
          : `Closes the space and deletes ${tilde(r.top, home)}. The branch stays.`
        : `A new space on a checkout in ${tilde(info.root, home)}/${r.name}/. A branch that exists is checked out; a new one starts from here.`
  const keys = busy ? 'working…' : opening_ ? '↑↓ choose · ↵ open · esc close' : blocked ? 'esc close' : remove ? '↵ remove · esc cancel' : '↵ create · esc cancel'
  const count = all.length ? (shown.length === all.length ? `${all.length} checkouts` : `${shown.length}/${all.length} checkouts`) : ''
  const fieldCls = 'h-9 w-full rounded-full bg-bg px-3 shadow-[inset_0_0_0_1px_var(--line2)] outline-none placeholder:text-fg3 focus:shadow-box-focus phone:h-11 phone:px-3.5 phone:text-[1rem]'

  return (
    <Sheet label={title} onClose={close} panel={opening_ ? 'max-w-[560px]' : 'max-w-[440px]'}>
      <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-3 pl-4">
        <Who name={title} />
        {opening_ && r && count ? <span className="shrink-0 text-[0.75rem] text-fg3 tabular-nums">{count}</span> : null}
        <SheetClose onClose={close} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pt-3.5 pb-4">
        {opening_ ? (
          !info || (r && !info.list) ? (
            <p className="text-fg2">{'…'}</p>
          ) : !r ? (
            <p className="text-fg2">{notRepo}</p>
          ) : (
            <>
              <input ref={input} autoFocus value={text} onChange={(e) => { setText(e.target.value); setAt(0); setError('') }} onKeyDown={onKey}
                placeholder="filter worktrees" aria-label="filter worktrees" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={fieldCls} />
              <ul role="listbox" aria-label="Worktrees" className="-mx-1 flex max-h-[min(340px,50vh)] min-h-0 flex-col overflow-y-auto overscroll-contain">
                {shown.map((c, i) => (
                  <li key={c.path} role="option" aria-selected={i === at} onPointerMove={() => setAt(i)} onClick={() => openOne(c)}
                    className={clsx('press flex min-h-11 cursor-pointer flex-col justify-center rounded-row px-2.5 py-1', i === at ? 'bg-sel' : 'hover:bg-hover')}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-fg">{c.branch ?? 'detached'}</span>
                      {c.main ? <span className="shrink-0 text-[0.6875rem] text-fg3">main checkout</span> : null}
                      {c.place ? <span className="shrink-0 text-[0.6875rem] text-accent">open</span> : c.at > 0 ? <span className="shrink-0 text-[0.6875rem] text-fg3 tabular-nums">{ago(c.at)}</span> : null}
                    </span>
                    <span className="truncate text-[0.71875rem] text-fg3">{tilde(c.path, home)}</span>
                  </li>
                ))}
                {!shown.length ? <li className="p-2.5 text-fg3">No matching worktrees.</li> : null}
              </ul>
            </>
          )
        ) : (
          <>
            <p className="text-pretty text-fg2">{detail}</p>
            {remove && info?.dirty ? <p className="text-need-fg">It has uncommitted changes: they will be lost.</p> : null}
            {remove && info?.unpushed?.length ? <p className="text-need-fg">{`Submodule ${info.unpushed.join(', ')} has commits that aren't pushed anywhere: they will be lost.`}</p> : null}
            {!remove && !blocked ? (
              <input ref={input} autoFocus value={text} onChange={(e) => { setText(e.target.value); setError('') }} onKeyDown={onKey}
                placeholder="branch name" aria-label="branch name" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" className={fieldCls} />
            ) : null}
          </>
        )}
        {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
        <p className="mt-1 text-right text-[0.6875rem] text-fg3 pointer-coarse:hidden">{keys}</p>
        {/* a touch screen has no Enter or Esc to press: the same two as buttons */}
        <div className="mt-1 flex justify-end gap-2 not-pointer-coarse:hidden phone:*:flex-1 phone:*:justify-center">
          <Ghost className="h-[34px] text-sm! phone:h-11 phone:text-base!" onClick={close}>{blocked || opening_ ? 'Close' : 'Cancel'}</Ghost>
          {!blocked && !opening_ ? (
            <Primary disabled={busy} onClick={() => void go()} className={remove ? 'bg-need-fg! text-white! dark:text-black!' : undefined}>
              {busy ? 'Working…' : remove ? 'Remove' : 'Create'}
            </Primary>
          ) : null}
        </div>
      </div>
    </Sheet>
  )
}
