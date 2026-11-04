// A space's worktrees (3.0's New, Open and Remove worktree), in 2.1's dialog: a branch name for a new one, the repo's
// worktrees to open one as a space, or removing the one this space is (asking again when it holds changes).
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { field, Primary } from '../ui.tsx'

type Open = { place: string; name: string; op: 'new' | 'open' | 'remove' } | null
let open: Open = null
const listeners = new Set<() => void>()
export const openWorktree = (o: NonNullable<Open>) => { open = o; for (const f of listeners) f() }
const close = () => { open = null; for (const f of listeners) f() }

export function WorktreeDialog() {
  const o = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  const [branch, setBranch] = useState('')
  const [list, setList] = useState<{ path: string; branch: string | null }[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setBranch(''); setList(null); setDirty(false); setBusy(false); setError(null)
    if (o?.op === 'open') act({ type: 'worktree', place: o.place, op: 'list' } as never).then((r: any) => setList(r.list ?? []), (e) => setError(e.message))
  }, [o])
  if (!o) return null
  const go = async (body: object) => {
    setBusy(true); setError(null)
    try {
      const r: any = await act({ type: 'worktree', place: o.place, ...body } as never)
      if (r.dirty) { setDirty(true); setBusy(false); return }
      close()
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  if (o.op === 'new')
    return (
      <Dialog title="New worktree" onCancel={close} buttons={<Primary disabled={busy || !branch.trim()} onClick={() => go({ op: 'new', branch })}>{busy ? 'Making…' : 'Create'}</Primary>}>
        <input autoFocus value={branch} onChange={(e) => setBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && branch.trim() && go({ op: 'new', branch })}
          placeholder="Branch" aria-label="Branch" className={`${field} h-10 w-full rounded-full bg-bg px-3.5`} />
        {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
      </Dialog>
    )
  if (o.op === 'open')
    return (
      <Dialog title="Open worktree" onCancel={close} buttons={null}>
        {!list ? <p className="text-fg3">Reading…</p> : !list.length ? <p className="text-fg3">No other worktrees.</p> : (
          <ul role="list" className="-mx-2 flex max-h-72 flex-col overflow-y-auto">
            {list.map((w) => (
              <li key={w.path}>
                <button type="button" disabled={busy} onClick={() => go({ op: 'open', path: w.path })} className="flex w-full min-w-0 flex-col rounded-row px-2 py-1.5 text-left hover:bg-hover">
                  <span className="truncate font-medium text-fg">{w.branch ?? w.path.split('/').pop()}</span>
                  <span className="truncate text-xs text-fg3">{w.path}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
      </Dialog>
    )
  return (
    <Dialog title={`Remove ${o.name}?`} onCancel={close} safe
      buttons={<Primary className="bg-need-fg! text-white! dark:text-black!" disabled={busy} onClick={() => go({ op: 'remove', force: dirty })}>{dirty ? 'Remove anyway' : 'Remove'}</Primary>}>
      <p>{dirty ? 'It has changes that aren’t committed: they go with it.' : 'Its space closes and its folder goes. Its branch stays.'}</p>
      {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}
