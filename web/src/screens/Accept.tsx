// The Accept card (Shepherdr 3's mods/accept-card), in 2.1's dialog: what the person approves before a Ready task
// merges. Its summary, then Changes (commits and files), Checks, Proof and folded Details, all from
// `herdr-task show --evidence`; Accept runs `herdr-task accept`, which merges first when there is something to merge.
// A task no longer Ready says where it is now, with only Close. On a phone it slides up as a sheet.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act, openArtifact } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { Primary } from '../ui.tsx'
import { Markdown } from '@plugins/chat/markdown.tsx'

type Evidence = {
  summary?: string
  details?: string
  proof?: { id: string; title: string } | null
  git?: boolean
  commits?: { count: number; list: { sha: string; subject: string }[] }
  diff?: { files: number; added: number; removed: number; list: { path: string; added: number; removed: number }[] } | null
  checks?: { state: 'passed' | 'failed' | 'running' | 'none' | 'unknown'; text: string }
}
type Shown = { ref: string; title: string; state: string; status_text?: string; accepted_at?: number; evidence?: Evidence }

// Which task's card is open (one at a time): a small store of its own, so any row or header can open it.
let open: string | null = null
const listeners = new Set<() => void>()
export const openAccept = (task: string) => { open = task; for (const f of listeners) f() }
const close = () => { open = null; for (const f of listeners) f() }
const useOpen = () => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => open)

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const CHECK = { passed: 'bg-ready', failed: 'bg-need', running: 'bg-work', unknown: 'bg-need', none: '' } as const

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-3">
      <h3 className="text-[0.8125rem] font-medium text-fg3 phone:text-sm">{label}</h3>
      {children}
    </section>
  )
}

function Changes({ e }: { e: Evidence }) {
  if (e.git === false) return <p className="text-fg3">Not a git folder.</p>
  const c = e.commits ?? { count: 0, list: [] }, d = e.diff
  if (!c.count && !d?.files) return <p className="text-fg3">No commits.</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2">
        <span>{plural(c.count, 'commit')}</span>
        {d ? (
          <>
            <span className="text-fg3">·</span>
            <span>{plural(d.files, 'file')} changed</span>
            <span className="font-mono text-xs text-ready-fg tabular-nums">+{d.added}</span>
            <span className="font-mono text-xs text-need-fg tabular-nums">−{d.removed}</span>
          </>
        ) : <span className="text-need-fg">· Couldn't read the files</span>}
      </p>
      {c.list.length ? (
        <ul role="list" className="flex min-w-0 flex-col gap-0.5">
          {c.list.map((x) => (
            <li key={x.sha} className="flex min-w-0 gap-2">
              <span className="shrink-0 font-mono text-xs/5 text-fg3">{x.sha}</span>
              <span className="min-w-0 truncate">{x.subject}</span>
            </li>
          ))}
          {c.count > c.list.length ? <li className="text-xs text-fg3">And {c.count - c.list.length} more</li> : null}
        </ul>
      ) : null}
      {d?.list?.length ? (
        <ul role="list" className="flex min-w-0 flex-col gap-0.5 font-mono text-xs/5 text-fg2">
          {d.list.map((f) => <li key={f.path} className="truncate">{f.path}</li>)}
          {d.files > d.list.length ? <li className="font-sans text-fg3">And {d.files - d.list.length} more</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

export function AcceptCard() {
  const task = useOpen()
  const [t, setT] = useState<Shown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [details, setDetails] = useState(false)

  useEffect(() => {
    setT(null); setError(null); setBusy(false); setDetails(false)
    if (!task) return
    let gone = false
    act({ type: 'evidence', task } as never).then((x) => !gone && setT(x as Shown), (e) => !gone && setError(String(e?.message ?? e)))
    return () => { gone = true }
  }, [task])

  if (!task) return null
  const ready = t?.state === 'ready'
  const e = t?.evidence ?? {}

  const accept = async () => {
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      await act({ type: 'accept', task } as never)
      close()
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
      // accepted (or changed) from elsewhere meanwhile: show where it is now, not the refusal
      const now = (await act({ type: 'evidence', task } as never).catch(() => null)) as Shown | null
      if (now && now.state !== 'ready') { setT(now); setError(null) }
      setBusy(false)
    }
  }

  const title = t ? `${t.ref} · ${t.title}` : task
  const where = t && !ready ? (t.state === 'done' ? (t.accepted_at ? 'Already accepted.' : 'Already done.') : `Not ready right now: it's in ${t.status_text ?? t.state}.`) : null

  return (
    <Dialog title={title} cancel={ready ? 'Cancel' : 'Close'} onCancel={close} safe
      buttons={ready ? <Primary disabled={busy} onClick={accept}>{busy ? 'Accepting…' : 'Accept'}</Primary> : null}>
      <div className="flex max-h-[60dvh] min-w-0 flex-col gap-3 overflow-y-auto pt-1 text-fg">
        {!t && !error ? <p className="text-fg3">Reading its changes…</p> : null}
        {where ? (
          <p className="flex items-center gap-2"><span className={clsx('size-[7px] rounded-full', t?.state === 'done' ? 'bg-ready' : 'bg-muted')} />{where}</p>
        ) : null}
        {e.summary ? <p className="text-pretty">{e.summary}</p> : null}
        {t ? (
          <>
            <Section label="Changes"><Changes e={e} /></Section>
            <Section label="Checks">
              <p className="flex items-center gap-2">
                {e.checks && e.checks.state !== 'none' ? <span className={clsx('size-[7px] shrink-0 rounded-full', CHECK[e.checks.state])} /> : null}
                <span className={clsx(!e.checks || e.checks.state === 'none' ? 'text-fg3' : '')}>{e.checks?.text ?? 'No GitHub checks here'}</span>
              </p>
            </Section>
            <Section label="Proof">
              {e.proof ? (
                // the proof artifact over the card, in the viewer
                <button type="button" onClick={() => openArtifact(e.proof!.id)} className="press-dim flex h-9 w-full items-center gap-2 rounded-[var(--row-radius)] bg-well px-2.5 text-left shadow-soft hover:bg-hover phone:h-11">
                  <span className="min-w-0 flex-1 truncate">{e.proof.title.replace(/^[A-Z]+-\d+:\s*/, '')}</span>
                  <span className="shrink-0 text-xs text-fg3">Open</span>
                </button>
              ) : <p className="text-fg3">No proof artifact.</p>}
            </Section>
            {e.details ? (
              <section className="border-t border-line pt-3">
                <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="text-[0.8125rem] font-medium text-fg3 phone:text-sm">
                  Details
                </button>
                {details ? <div data-selectable className="mt-1.5"><Markdown text={e.details} /></div> : null}
              </section>
            ) : null}
          </>
        ) : null}
        {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
      </div>
    </Dialog>
  )
}

// A link straight to a task's card (a notification's Accept): #accept=<task id>
function fromLink(hash: string) {
  const m = /^#accept=(.+)$/.exec(hash)
  if (m) openAccept(decodeURIComponent(m[1]))
}
if (typeof window !== 'undefined') {
  // index.html keeps the first one, before the app writes its own address
  fromLink((window as { shepherdrLink?: string }).shepherdrLink ?? '')
  addEventListener('hashchange', () => fromLink(location.hash))
}
