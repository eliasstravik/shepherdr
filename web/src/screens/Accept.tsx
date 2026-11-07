// The Accept card (Shepherdr 3's mods/accept-card), in 2.1's dialog: what the person approves before a Ready task
// merges. Its summary, then Changes (commits and files), Checks, Proof and folded Details, all from
// `herdr-task show --evidence`; Accept runs `herdr-task accept`, which merges first when there is something to merge.
// A task no longer Ready says where it is now, with only Close. On a phone it slides up as a sheet.
import clsx from 'clsx'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act, closeArtifact, getState, openArtifact, taskOf, useStore } from '../kernel.ts'
import { Dialog } from '../rowmenu.tsx'
import { DownIcon, NextIcon, OpenIcon, Primary } from '../ui.tsx'
import { Markdown } from '@plugins/chat/markdown.tsx'
// the card's words, the summary's cut and the details as bullets: the window's own (core/accept.js)
import * as A from '@core/accept.js'

type Evidence = {
  summary?: string
  details?: string
  proof?: { id: string; title: string } | null
  /** its other artifacts (a research task's report), linked beside its proof */
  artifacts?: { id: string; title: string }[]
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
// The tasks whose accept runs now from this screen: their row and header say "Accepting…" meanwhile, as the window's
// (its own accepts come in the snapshot: Task.accepting)
const accepting = new Set<string>()
const setAccepting = (task: string, on: boolean) => { if (on) accepting.add(task); else accepting.delete(task); for (const f of listeners) f() }
export const useAccepting = (task: string) => useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f) }, () => accepting.has(task))

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
  if (e.git === false) return <p className="text-fg3">{A.ACCEPT.notGit}</p>
  const c = e.commits ?? { count: 0, list: [] }, d = e.diff
  if (!c.count && !d?.files) return <p className="text-fg3">{A.ACCEPT.noCommits}</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 tabular-nums">
        <span>{A.commitsLine(c.count)}</span>
        {d ? (
          <>
            <span className="text-fg3">·</span>
            <span>{A.filesLine(d.files)}</span>
            <span className="font-mono text-xs text-ready-fg tabular-nums">+{d.added}</span>
            <span className="font-mono text-xs text-need-fg tabular-nums">−{d.removed}</span>
          </>
        ) : <span className="text-need-fg">{A.ACCEPT.noFiles}</span>}
      </p>
      {c.list.length ? (
        <ul role="list" className="flex min-w-0 flex-col gap-0.5">
          {c.list.map((x) => (
            <li key={x.sha} className="flex min-w-0 gap-2">
              <span className="shrink-0 font-mono text-xs/5 text-fg3">{x.sha}</span>
              <span className="min-w-0 truncate">{x.subject}</span>
            </li>
          ))}
          {c.count > c.list.length ? <li className="text-xs text-fg3 tabular-nums">{A.moreLine(c.count - c.list.length)}</li> : null}
        </ul>
      ) : null}
      {d?.list?.length ? (
        <ul role="list" className="flex min-w-0 flex-col gap-0.5 font-mono text-xs/5 text-fg2">
          {d.list.map((f) => <li key={f.path} className="truncate">{f.path}</li>)}
          {d.files > d.list.length ? <li className="font-sans text-fg3 tabular-nums">{A.moreLine(d.files - d.list.length)}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

// An artifact (its proof, or another it published) over the card, in the viewer; closing it comes back here
function ArtifactRow({ a }: { a: { id: string; title: string } }) {
  return (
    <button type="button" onClick={() => openArtifact(a.id)} className="press-dim flex h-9 w-full items-center gap-2 rounded-[var(--row-radius)] bg-well px-2.5 text-left shadow-soft hover:bg-hover phone:h-11">
      <span className="min-w-0 flex-1 truncate">{A.proofTitle(a.title)}</span>
      <span className="shrink-0 text-xs text-fg3">{A.ACCEPT.open}</span>
      <OpenIcon className="size-3.5 shrink-0 text-fg3" />
    </button>
  )
}

export function AcceptCard() {
  const task = useOpen()
  const named = useStore((s) => (task && s.snap ? taskOf(s.snap, task)?.name : undefined))
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
    setBusy(true); setError(null); setAccepting(task, true)
    try {
      await act({ type: 'accept', task } as never)
      // done: the next snapshot moves it out of Ready; until then its row still says Accepting…
      setTimeout(() => setAccepting(task, false), 15000)
      close()
    } catch (err) {
      setAccepting(task, false)
      setError(String((err as Error)?.message ?? err))
      // accepted (or changed) from elsewhere meanwhile: show where it is now, not the refusal
      const now = (await act({ type: 'evidence', task } as never).catch(() => null)) as Shown | null
      if (now && now.state !== 'ready') { setT(now); setError(null) }
      setBusy(false)
    }
  }

  // as the window's card: "Accept HERD-4?" while it can be accepted, only its ref once settled; its name under it
  const ref = t?.ref ?? task
  const settled = !!t && !ready
  const w = A.words(e) as { summary: string; details: string }
  // Escape over the proof (the viewer sits over this card) closes the proof, back to the card as it was
  const cancel = () => (getState().ui.viewer ? closeArtifact() : close())

  return (
    <Dialog title={settled ? ref : A.ACCEPT.title(ref)} sub={t?.title ?? named ?? ''} closer wide onCancel={cancel} safe
      cancel={settled ? A.ACCEPT.close : A.ACCEPT.cancel}
      foot={t && (error || settled) ? (
        <>
          {error ? <p role="alert" className="text-need-fg">{error}</p> : null}
          {settled ? (
            <p className="flex items-center gap-2 text-fg"><span className={clsx('size-[7px] shrink-0 rounded-full', t.state === 'done' ? 'bg-ready' : 'bg-fg3')} />{A.whereNow(t)}</p>
          ) : null}
        </>
      ) : null}
      // Accept shows while it is read too, not yet pressable; once settled only Close is left
      buttons={settled ? null : <Primary disabled={!ready || busy} onClick={accept}>{busy ? A.ACCEPT.accepting : A.ACCEPT.accept}</Primary>}>
      <div className="flex max-h-[60dvh] min-w-0 flex-col gap-4 overflow-y-auto pt-2 pb-1 text-fg">
        {!t ? <p className={error ? 'text-need-fg' : 'text-fg3'} role={error ? 'alert' : undefined}>{error ?? A.ACCEPT.reading}</p> : (
          <>
            <p className={clsx('max-w-[560px] text-pretty', !w.summary && 'text-fg3')}>{w.summary || A.ACCEPT.noSummary}</p>
            <Section label={A.ACCEPT.changes}><Changes e={e} /></Section>
            <Section label={A.ACCEPT.checks}>
              <p className="flex items-center gap-2">
                {e.checks && e.checks.state !== 'none' ? <span className={clsx('size-[7px] shrink-0 rounded-full', CHECK[e.checks.state])} /> : null}
                <span className={clsx(!e.checks || e.checks.state === 'none' ? 'text-fg3' : '')}>{e.checks?.text ?? A.ACCEPT.noChecks}</span>
              </p>
            </Section>
            <Section label={A.ACCEPT.proof}>
              {e.proof ? <ArtifactRow a={e.proof} /> : <p className="text-fg3">{A.ACCEPT.noProof}</p>}
            </Section>
            {e.artifacts?.length ? (
              <Section label={A.ACCEPT.artifacts}>
                <div className="flex flex-col gap-1.5">{e.artifacts.map((a) => <ArtifactRow key={a.id} a={a} />)}</div>
              </Section>
            ) : null}
            {w.details ? (
              <section className="flex flex-col gap-2 border-t border-line pt-3">
                <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="flex items-center gap-1.5 self-start text-[0.8125rem] font-medium text-fg3 hover:text-fg phone:text-sm">
                  {details ? <DownIcon className="size-3.5 shrink-0" /> : <NextIcon className="size-3.5 shrink-0" />}
                  {A.ACCEPT.details}
                </button>
                {details ? <div data-selectable className="pl-5"><Markdown text={A.readable(w.details)} /></div> : null}
              </section>
            ) : null}
          </>
        )}
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
