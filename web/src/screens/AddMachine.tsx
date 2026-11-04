// Add machine (3.0's sidebar foot): another machine this one reaches with ssh, by its host or a Host from ~/.ssh/config,
// added with hc machine add. One that wants a password or a new host key once is added in a terminal instead.
import { useState, useSyncExternalStore } from 'react'
import { act } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { field, FootButton, Primary } from '../ui.tsx'

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => { open = v; for (const f of listeners) f() }

export function AddMachineButton() {
  return (
    <FootButton onClick={() => set(true)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0 text-fg3 coarse:text-fg2 phone:size-5 phone:text-fg2"><rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><path d="M6 6h.01M6 18h.01" /></svg>
      Add machine
    </FootButton>
  )
}

export function AddMachineDialog() {
  const on = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!on) return null
  const close = () => { set(false); setTarget(''); setError(null); setBusy(false) }
  const go = async () => {
    if (!target.trim() || busy) return
    setBusy(true); setError(null)
    try { await act({ type: 'machine-add', target: target.trim() } as never); close() }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <Dialog title="Add machine" onCancel={close} buttons={<Primary disabled={busy || !target.trim()} onClick={go}>{busy ? 'Adding…' : 'Add'}</Primary>}>
      <input autoFocus value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
        placeholder="Host" aria-label="Host" autoCapitalize="off" autoCorrect="off" spellCheck={false} className={`${field} h-10 w-full rounded-full bg-bg px-3.5`} />
      {error ? <p role="alert" className="mt-2 text-need-fg">{error}</p> : null}
    </Dialog>
  )
}
