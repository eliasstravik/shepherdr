// Settings › Web's Serve from, confirmed (the window's inline confirm under the row, mods/shepherdr-settings/web-section.js):
// the machine picked in the row's list, what moving the web app there does, then Move it. Its words: core/host.js.
import { useState, useSyncExternalStore } from 'react'
import * as HCc from '@core/host.js'
import { act } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { Primary } from '../ui.tsx'

const HC = HCc as any
const SERVE = HC.SERVE as { confirm: (m: string, here: boolean) => string; detail: (m: string, here: boolean) => string; verb: string; here: string }

/** the picked row's words ("mac-mini · macOS"), until moved or cancelled */
let picked: string | null = null
const listeners = new Set<() => void>()
export const askServeFrom = (label: string | null) => { picked = label; for (const f of listeners) f() }

export function ServeFromDialog() {
  const label = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => picked)
  return label ? <ServeFrom label={label} /> : null
}

function ServeFrom({ label }: { label: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const here = label.startsWith(SERVE.here)
  const name = label.split(' · ')[0]
  const go = async () => {
    setBusy(true)
    const r = (await act({ type: 'setting', key: 'web.serve', value: label } as never).catch((e: Error) => ({ ok: false, error: e.message }))) as { ok?: boolean; error?: string }
    setBusy(false)
    if (r?.ok === false) return setError(r.error || 'It could not be moved.')
    askServeFrom(null)
  }
  return (
    <Dialog title={SERVE.confirm(name, here)} onCancel={() => askServeFrom(null)} safe
      buttons={<Primary disabled={busy} onClick={() => void go()}>{SERVE.verb}</Primary>}>
      <div className="flex flex-col gap-2">
        <p className="text-sm/6 text-pretty text-fg2">{SERVE.detail(name, here)}</p>
        {error ? <p className="text-sm/6 text-pretty text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}
