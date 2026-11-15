// Settings › Machines › Find machines (#967): Shepherdr contacts only the machines you linked. Finding others (the hosts in
// this computer's ssh config and its online Tailscale peers) happens only here, when you press the button: it lists what
// it will try first, tries each once (an ssh login in batch mode, no new host keys), at most once every 10 minutes, and
// says which have herdr-core and aren't linked yet. Nothing it finds is contacted again unless you link it.
// herdr-task machines find does the work (mods/tasks/bin/herdr_task/machines.py find), on the machine serving this app.
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Ghost, Small } from '@client/ui.tsx'
import { card, heading, rowLook } from '@client/Settings.tsx'

type Host = { to: string; over: string; ok?: boolean; state?: string; core?: string; linked?: boolean }
type Got = { hosts: Host[]; last: { at: number; hosts: (Host | null)[]; running?: boolean } | null; wait_ms: number; error?: string }

const call = (go: boolean): Promise<Got> =>
  fetch('api/machines/find', go ? { method: 'POST', headers: { 'x-shepherdr': '1' } } : undefined)
    .then((r) => r.json())
    .catch(() => ({ hosts: [], last: null, wait_ms: 0, error: "Couldn't reach Shepherdr. Try again." }))

const mins = (ms: number) => Math.max(1, Math.ceil(ms / 60000))

function result(h: Host) {
  if (h.core) return h.linked ? `Herdr ${h.core}, linked already` : `Herdr ${h.core}, not linked: add it with Add machine`
  if (h.ok) return 'Logged in; no Herdr there'
  return `Couldn't log in (${h.state || 'no answer'})`
}

export function FindMachines({ phone }: { phone: boolean }) {
  const [got, setGot] = useState<Got | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void call(false).then(setGot), [])

  const go = async () => {
    setBusy(true)
    const r = await call(true)
    setGot(r.error ? { ...(got ?? { hosts: [], last: null, wait_ms: 0 }), error: r.error } : r)
    setBusy(false)
  }

  const hosts = got?.hosts ?? []
  const done = (got?.last?.hosts ?? []).filter((h): h is Host => !!h)
  const wait = got?.wait_ms ?? 0
  return (
    <section className="w-full" aria-labelledby="find-machines">
      <h3 id="find-machines" className={heading(phone)}>Find machines</h3>
      <div className={phone ? card : undefined}>
        <div className={clsx(rowLook(phone), 'flex-col items-stretch! gap-2 pb-3!')}>
          <Small className="text-pretty">
            Shepherdr only contacts machines you linked. To find others, it can try to log in once to each host below, from
            this computer&apos;s ssh config and Tailscale. It runs only when you press the button, at most every 10 minutes.
          </Small>
          {!got ? (
            <Small>Checking…</Small>
          ) : got.error && !hosts.length ? null : hosts.length ? (
            <ul className="flex flex-col gap-0.5" aria-label="Hosts it will try">
              {hosts.map((h) => (
                <li key={h.to} className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{h.to}</span>
                  <Small className="shrink-0">{h.over === 'tailscale' ? 'Tailscale' : 'ssh config'}</Small>
                </li>
              ))}
            </ul>
          ) : (
            <Small>Nothing to try: no other hosts in ssh config or Tailscale.</Small>
          )}
          <span className="flex items-center justify-end">
            <Ghost disabled={busy || !got || !!wait || !hosts.length} onClick={go}>
              {busy ? 'Trying…' : wait ? `Again in ${mins(wait)} min` : `Try ${hosts.length} ${hosts.length === 1 ? 'host' : 'hosts'}`}
            </Ghost>
          </span>
        </div>
      </div>
      {got?.error ? <Small role="status" className={clsx('pt-1.5 text-pretty text-need-fg!', phone && 'px-4')}>{got.error}</Small> : null}
      {done.length ? <h4 className={clsx('pt-4 pb-1 text-[0.8125rem] font-medium text-fg2', phone && 'px-4')}>Last run</h4> : null}
      {done.length ? (
        <dl className={phone ? card : undefined} aria-label="Last run">
          {done.map((h) => (
            <div key={h.to} className={rowLook(phone)}>
              <dt className="min-w-0 flex-1 truncate">{h.to}</dt>
              <dd className="max-w-[65%] text-right"><Small className="text-pretty">{result(h)}</Small></dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
