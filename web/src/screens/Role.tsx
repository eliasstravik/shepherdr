// Settings › Agents, as 3.0's: a role's agent picked in 2.1's restart sheet look (agent, model, effort, speed), saved
// at the page's level, and the instructions every agent of a role is told first, edited in a sheet.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RestartCli } from '@shared/types.ts'
import { act } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { Pick } from '../Settings.tsx'
import { Ghost, Primary, TextBox } from '../ui.tsx'

type Agent = { agent: string; model?: string | null; effort?: string | null; fast?: boolean }
type Open =
  | { kind: 'role'; level: string; key: string; title: string; pick: Agent | null }
  | { kind: 'file'; role: string; title: string; file: string }
  | null
let open: Open = null
const listeners = new Set<() => void>()
const tell = () => { for (const f of listeners) f() }
export const openRole = (o: NonNullable<Open>) => { open = o; tell() }
const close = () => { open = null; tell() }

export function RoleSheet() {
  const o = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)
  if (!o) return null
  return o.kind === 'role' ? <AgentSheet key={`${o.level}|${o.key}`} o={o} /> : <FileSheet key={o.role} o={o} />
}

const DEFAULT = 'default'

function AgentSheet({ o }: { o: Extract<Open, { kind: 'role' }> }) {
  const [clis, setClis] = useState<RestartCli[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState(o.pick?.agent ?? 'claude')
  const [model, setModel] = useState(o.pick?.model ?? '')
  const [effort, setEffort] = useState(o.pick?.effort ?? '')
  const [speed, setSpeed] = useState(o.pick?.fast ? 'fast' : '')
  useEffect(() => {
    act({ type: 'role-info' } as never).then((r: any) => (r.clis ? setClis(r.clis) : setError(r.error ?? 'Could not read the agents.')), (e: Error) => setError(e.message))
  }, [])
  const cli = clis?.find((c) => c.kind === kind)
  const levels = (model ? cli?.models?.find((m) => m.id === model)?.efforts : cli?.models?.[0]?.efforts) ?? cli?.efforts ?? []
  const label = (id: string) => (id ? (cli?.models?.find((m) => m.id === id)?.label ?? id) : DEFAULT)
  const save = async (value: string | null) => {
    setBusy(true); setError(null)
    const r: any = await act({ type: 'setting', key: o.key, value, place: o.level } as never).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r?.ok === false) return setError(r.error ?? 'It did not save.')
    close()
  }
  return (
    <Dialog title={o.title} onCancel={close}
      buttons={<>
        {o.pick ? <Ghost disabled={busy} onClick={() => save(null)}>Use default</Ghost> : null}
        <Primary autoFocus disabled={!clis || busy} onClick={() => save(JSON.stringify({ agent: kind, model: model || null, effort: effort || null, fast: speed === 'fast' }))}>{busy ? 'Saving…' : 'Save'}</Primary>
      </>}>
      {clis ? (
        <div className="flex flex-col gap-2.5 text-fg phone:gap-1">
          <Line label="Agent">
            <Pick label="Agent" value={cli?.name ?? kind} options={clis.map((c) => c.name)} onPick={(n) => { setKind(clis.find((c) => c.name === n)!.kind); setModel(''); setEffort('') }} />
          </Line>
          <Line label="Model">
            {cli?.models?.length ? <Pick label="Model" value={label(model)} options={[DEFAULT, ...cli.models.map((m) => m.label)]} onPick={(l) => { const id = cli.models!.find((m) => m.label === l)?.id ?? ''; setModel(id); if (!(cli.models!.find((m) => m.id === id)?.efforts ?? []).includes(effort)) setEffort('') }} /> : <span className="text-fg3">Default</span>}
          </Line>
          <Line label="Effort">
            {levels.length ? <Pick label="Effort" value={effort || DEFAULT} options={[DEFAULT, ...levels]} ordered onPick={(v) => setEffort(v === DEFAULT ? '' : v)} /> : <span className="text-fg3">Default</span>}
          </Line>
          {cli?.speeds && cli.speeds.length > 1 ? (
            <Line label="Speed">
              <Pick label="Speed" value={speed || DEFAULT} options={[DEFAULT, ...cli.speeds]} ordered onPick={(v) => setSpeed(v === DEFAULT ? '' : v)} />
            </Line>
          ) : null}
          <p className="text-sm text-fg3">For agents started from now on. Running ones keep theirs.</p>
          {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
        </div>
      ) : <p className={clsx(error && 'text-need-fg')}>{error ?? 'Reading the agents…'}</p>}
    </Dialog>
  )
}

function FileSheet({ o }: { o: Extract<Open, { kind: 'file' }> }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    act({ type: 'template', role: o.role } as never).then((r: any) => (r.ok === false ? setError(r.error) : (setSaved(r.text ?? ''), setText(r.text ?? ''))), (e: Error) => setError(e.message))
  }, [o.role])
  const save = async () => {
    setBusy(true); setError(null)
    const r: any = await act({ type: 'template', role: o.role, text } as never).catch((e: Error) => ({ ok: false, error: e.message }))
    setBusy(false)
    if (r?.ok === false) return setError(r.error ?? 'It did not save.')
    close()
  }
  return (
    <Dialog title={o.title} onCancel={close} cancel={text !== saved ? 'Discard' : 'Close'}
      buttons={<Primary disabled={saved === null || busy || text === saved} onClick={save}>{busy ? 'Saving…' : 'Save'}</Primary>}>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[0.75rem] text-fg3">{o.file} · the same for every space</span>
        {saved === null ? <p className={clsx(error && 'text-need-fg')}>{error ?? 'Reading…'}</p> : (
          <TextBox label={o.title} value={text} onChange={setText} spellCheck={false}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (text !== saved) void save() } }}
            className="max-h-[60dvh] min-h-60 w-full overflow-y-auto rounded-row bg-well px-3 py-2.5 font-mono text-[0.8125rem]/5 outline-none phone:text-[0.875rem]/[1.375rem]" />
        )}
        {saved !== null && error ? <p role="alert" className="text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="min-w-0">{label}</span>
      {children}
    </div>
  )
}
