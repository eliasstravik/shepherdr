// Personal analytics (SHEP-453): Settings › Personal analytics, the quiet note the first time, and the page's own
// events (opened, on which kind of device; a lost link; a message that didn't go through). The record stays on the
// person's machines: the service appends to its own data folder and herdr-task reads it back (docs/analytics.md).
// Nothing here talks to anything but the person's own Shepherdr service.
import { useEffect, useState } from 'react'
import { PROMISE } from '../../../core/analytics.js'
import { act, definePlugin, getState, notice, openSettings, subscribe, tryAct } from '@client/kernel.ts'
import { confirm, openDialog } from '@client/overlay.tsx'
import { Btn, IB, Seg, Tgl } from '@client/ui.tsx'
import { SRow } from '@client/settings.tsx'

export const NAME = 'Personal analytics'
const PERIODS = { Day: 1, Week: 7, Month: 30 } as const
type Period = keyof typeof PERIODS

type Wait = { n: number; avg_ms: number; median_ms: number } | null
export type Summary = {
  days: number
  events: number
  on: boolean
  unreached?: string[]
  app: { opened: number; devices: Record<string, number> }
  messages: { sent: number; how: Record<string, number>; failed: number }
  questions: { answered: number }
  tasks: Record<'added' | 'started' | 'ready' | 'sent_back' | 'done' | 'reopened' | 'removed', number>
  waits: Record<'ready_for_review' | 'needs_you' | 'blocked' | 'before_start' | 'working', Wait>
  agents: { agent: string | null; model: string | null; effort: string | null; tasks: number }[]
  errors: { send_failed: number; link_lost: number }
  text: string
}
type Ev = { t: number; e: string; machine?: string; [k: string]: unknown }

/** a duration in plain words: 40 min, 3.2 h, 1.5 days */
export function took(ms: number | null | undefined): string {
  if (ms == null) return '–'
  const m = ms / 60000
  return m < 1 ? '<1 min' : m < 90 ? `${Math.round(m)} min` : m < 48 * 60 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`
}

/** the device this page runs on, as the record keeps it */
export function deviceOf(phone: boolean, coarse: boolean): 'phone' | 'tablet' | 'desktop' {
  return phone ? 'phone' : coarse ? 'tablet' : 'desktop'
}

const event = (name: string, fields: Record<string, unknown> = {}) => void act({ type: 'analytics', do: 'event', event: name, fields }).catch(() => undefined)

/** the main numbers, as tiles: a label and a value */
export function Numbers({ s }: { s: Summary }) {
  const how = (k: string) => s.messages.how[k] ?? 0
  const tiles: [string, string][] = [
    ['App opened', String(s.app.opened)],
    ['Messages sent', String(s.messages.sent)],
    ['Typed · dictated', `${how('typed')} · ${how('dictated')}`],
    ['Bubbles · Talk', `${how('bubble')} · ${how('talk')}`],
    ['Tasks added', String(s.tasks.added)],
    ['Tasks done', String(s.tasks.done)],
    ['Sent back', String(s.tasks.sent_back)],
    ['Reopened', String(s.tasks.reopened)],
    ['Wait at Ready', took(s.waits.ready_for_review?.avg_ms)],
    ['Wait at Needs you', took(s.waits.needs_you?.avg_ms)],
    ['Agents stopped for', took(s.waits.blocked?.avg_ms)],
    ['Questions answered', String(s.questions.answered)],
  ]
  return (
    <dl className="stats">
      {tiles.map(([k, v]) => (
        <div className="stat" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Raw({ days, close }: { days: number; close: () => void }) {
  const [got, setGot] = useState<{ events: Ev[]; meaning: Record<string, string> } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    act<{ ok?: boolean; error?: string; events?: Ev[]; meaning?: Record<string, string> }>({ type: 'analytics', do: 'raw', days })
      .then((r) => (r.ok === false ? setErr(r.error || 'It could not be read.') : setGot({ events: r.events ?? [], meaning: r.meaning ?? {} })))
      .catch((e) => setErr(String((e as Error).message || e)))
  }, [days])
  return (
    <>
      <h2>What is stored</h2>
      <p className="hint">Every event of the last {days === 1 ? 'day' : `${days} days`}, as kept on your machines: when, what, and ids. Never what was said.</p>
      {err && <p className="hint">{err}</p>}
      {!got && !err && <p className="hint">Reading…</p>}
      {got && !got.events.length && <p className="hint">Nothing stored for this period.</p>}
      {got && !!got.events.length && (
        <ol className="rawlog" role="list">
          {got.events.slice(-500).reverse().map((e, i) => (
            <li key={i}>
              <time>{new Date(e.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              <b>{e.e}</b>
              <span>{Object.entries(e).filter(([k]) => k !== 't' && k !== 'e').map(([k, v]) => `${k} ${k.endsWith('ms') && typeof v === 'number' ? took(v) : String(v)}`).join(' · ')}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="acts">
        <Btn onClick={close}>Close</Btn>
      </div>
    </>
  )
}

async function exportAll() {
  try {
    const r = await act<{ ok?: boolean; error?: string }>({ type: 'analytics', do: 'export' })
    if (r.ok === false) return notice(r.error || 'It could not be exported.', { tone: 'error' })
    const { ok: _ok, ...rest } = r
    const url = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `shepherdr-personal-analytics-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    notice(String((e as Error).message || e), { tone: 'error' })
  }
}

function deleteAll(done: () => void) {
  confirm({
    title: 'Delete all personal analytics?',
    body: 'Everything recorded so far is deleted on every machine of yours. This cannot be undone.',
    ok: 'Delete all',
    danger: true,
    run: async () => {
      const r = await act<{ ok?: boolean; deleted?: Record<string, boolean> }>({ type: 'analytics', do: 'delete' }).catch(() => null)
      const missed = Object.entries(r?.deleted ?? {}).filter(([, v]) => !v).map(([k]) => k)
      notice(!r ? 'It was not deleted.' : missed.length ? `Deleted, except on ${missed.join(', ')} (not reached).` : 'All deleted.')
      done()
    },
  })
}

export function AnalyticsSettings() {
  const [on, setOn] = useState<boolean | null>(null)
  const [period, setPeriod] = useState<Period>('Week')
  const [s, setS] = useState<Summary | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    void act<{ on?: boolean }>({ type: 'analytics', do: 'state' }).then((r) => setOn(r.on !== false), () => setOn(true))
  }, [])
  useEffect(() => {
    setErr('')
    act<Summary & { ok?: boolean; error?: string }>({ type: 'analytics', do: 'show', days: PERIODS[period] })
      .then((r) => (r.ok === false ? setErr(r.error || 'It could not be read.') : setS(r)))
      .catch((e) => setErr(String((e as Error).message || e)))
  }, [period, n])
  const flip = async (v: boolean) => {
    setOn(v)
    if (!(await tryAct({ type: 'analytics', do: 'set', on: v }))) setOn(!v)
  }
  return (
    <>
      <p className="hint">Shepherdr keeps a record of how you use it: events and timings, never what you write. Your agents can read it to suggest how to work better.</p>
      <p className="promise">{PROMISE}</p>
      <SRow label="Record how I use Shepherdr">
        <Tgl label="Personal analytics" on={on ?? true} disabled={on === null} onChange={(v) => void flip(v)} />
      </SRow>
      <h3>Your numbers</h3>
      <Seg label="Period" values={Object.keys(PERIODS) as Period[]} value={period} onChange={setPeriod} />
      {err && <p className="hint">{err}</p>}
      {s && !err && (s.events ? <Numbers s={s} /> : <p className="hint">{on === false ? 'Off: nothing is recorded.' : 'Nothing recorded for this period yet.'}</p>)}
      {s?.unreached?.length ? <p className="hint">Not reached now: {s.unreached.join(', ')}.</p> : null}
      <h3>Your record</h3>
      <div className="acts" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
        <Btn small onClick={() => openDialog((close) => <Raw days={PERIODS[period]} close={close} />, { wide: true, label: 'What is stored' })}>See what is stored</Btn>
        <Btn small onClick={() => void exportAll()}>Export</Btn>
        <Btn small kind="danger" onClick={() => deleteAll(() => setN((x) => x + 1))}>Delete all</Btn>
      </div>
    </>
  )
}

/** the first time: one quiet line saying it is on and where the switch is; gone once closed or opened */
function Note() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    void act<{ on?: boolean; noted?: boolean }>({ type: 'analytics', do: 'state' }).then((r) => setShow(r.on !== false && r.noted === false), () => undefined)
  }, [])
  if (!show) return null
  const seen = () => {
    setShow(false)
    void act({ type: 'analytics', do: 'noted' }).catch(() => undefined)
  }
  return (
    <div className="anote" role="status">
      <span className="n">Shepherdr now keeps personal analytics, only on your machines.</span>
      <Btn small onClick={() => { seen(); openSettings('all', NAME) }}>Show me</Btn>
      <IB icon="x" label="Close" onClick={seen} />
    </div>
  )
}

/** the page's own events: opened (once a load, with its kind of device), a link lost (said once it is back) */
function watchPage() {
  if (typeof window === 'undefined') return
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches
  let opened = false
  let lostAt: number | null = null
  subscribe(() => {
    const s = getState()
    if (!opened && s.snap) {
      opened = true
      event('app.opened', { device: deviceOf(s.ui.phone, coarse) })
    }
    if (s.ui.offline && lostAt === null) lostAt = s.ui.offline
    else if (!s.ui.offline && lostAt !== null) {
      event('app.link_lost', { ms: Date.now() - lostAt })
      lostAt = null
    }
  })
}

export default definePlugin({
  name: 'analytics',
  setup(reg) {
    reg.settings.push({ name: NAME, icon: 'pulse', order: 90, scope: 'all', View: AnalyticsSettings })
    reg.topBars.push(Note)
    watchPage()
  },
})

