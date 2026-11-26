// What an agent left running in the background, just above the message box (so it never scrolls away): its own
// helper agents in herdr, its CLI's subagents, its background shells and watchers (the service's chat `jobs`). A tap
// opens one in place: a shell's command, what it printed last and Stop; a helper's last words and Stop. Nothing shows
// when none run. 3.1's JobsTag, smaller.
import { useEffect, useState } from 'react'
import { tryAct, useChat, watchAlso } from '@client/kernel.ts'
import { Btn, I } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import type { Chat, Job } from '@shared/types.ts'

/** how long it has run, as the window counts it: seconds for a minute, then minutes, then hours */
export function ago(at: number, now: number, until?: number): string {
  const s = Math.max(0, Math.floor(((until ?? now) - at) / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/** a helper's state in words */
const STATE = { working: 'working', needs: 'needs you', done: 'done' } as const

/** the line that heads two or more: "3 running in the background" */
export function jobsWords(jobs: Job[]): string {
  const on = jobs.filter((j) => !j.ended).length
  return on ? `${on} running in the background` : `${jobs.length} finished in the background`
}

const iconOf = (j: Job): IconName => (j.kind === 'shell' ? 'term' : j.kind === 'monitor' ? 'pulse' : 'agent')

/** the clock the ages count from, ticking while rows show */
function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function Jobs({ chat }: { chat: Chat | undefined }) {
  const jobs = chat?.jobs ?? []
  const [all, setAll] = useState(false)
  const [opened, setOpened] = useState<string | null>(null)
  const now = useNow(jobs.length > 0)
  if (!chat || !jobs.length) return null
  const rows = jobs.map((j) => <JobRow key={j.id} j={j} chat={chat.key} now={now} open={opened === j.id} toggle={() => setOpened(opened === j.id ? null : j.id)} />)
  // one shows as itself; more fold into one line that opens to them all (a phone keeps its room for the chat)
  if (jobs.length === 1) return <div className="jobs">{rows}</div>
  return (
    <div className="jobs">
      <button type="button" className="fold quiet" aria-expanded={all} onClick={() => setAll(!all)}>
        <I n="layers" c="s16" />
        <span className="ql">{jobsWords(jobs)}</span>
        <I n={all ? 'down' : 'right'} c="s16 qv" />
      </button>
      {all && <div className="jobl">{rows}</div>}
    </div>
  )
}

function JobRow({ j, chat, now, open, toggle }: { j: Job; chat: string; now: number; open: boolean; toggle: () => void }) {
  // a CLI's own subagent has nothing more to show and can't be stopped from here; an ended helper no longer opens
  const opens = j.kind === 'shell' || j.kind === 'monitor' || (j.kind === 'child' && !!j.chat)
  const words = (
    <>
      <I n={iconOf(j)} c="s16" />
      <span className="ql">
        {j.title}
        {j.kind === 'child' && j.status && <span className={j.status === 'needs' ? 'qm c-ask' : 'qm'}>{STATE[j.status]}</span>}
        <span className="qm">{ago(j.at, now, j.ended)}</span>
      </span>
    </>
  )
  if (!opens) return <div className="fold quiet" data-job={j.id}>{words}</div>
  return (
    <>
      <button type="button" className="fold quiet" data-job={j.id} aria-expanded={open} onClick={toggle}>
        {words}
        <I n={open ? 'down' : 'right'} c="s16 qv" />
      </button>
      {open && (
        <div className="quietb jobb">
          {j.command && <code className="qt jobc">{j.command}</code>}
          {j.kind === 'child' ? <HelperWords chat={j.chat!} /> : j.more === 'output' && <Output chat={chat} id={j.id} />}
          <StopJob j={j} chat={chat} />
        </div>
      )}
    </>
  )
}

/** what a shell printed last, asked again every few seconds while open */
function Output({ chat, id }: { chat: string; id: string }) {
  const [out, setOut] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    let live = true
    const look = async () => {
      try {
        const q = new URLSearchParams({ chat, id, what: 'job' })
        const r = (await (await fetch(`api/activity?${q}`, { headers: { 'x-shepherdr': '1' } })).json()) as { output?: string; error?: string }
        if (!live) return
        if (typeof r.output === 'string') setOut(r.output)
        else setGone(true)
      } catch {}
    }
    void look()
    const t = setInterval(look, 3000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [chat, id])
  if (gone) return <p className="qw">It isn't running any more.</p>
  if (out === null) return <p className="qw">Loading…</p>
  const tail = out.replace(/\s+$/, '').split('\n').slice(-20).join('\n')
  return tail ? <pre className="qt jobo">{tail}</pre> : <p className="qw">Nothing printed yet.</p>
}

/** a helper's last words, from its own chat (followed while open) */
function HelperWords({ chat }: { chat: string }) {
  useEffect(() => watchAlso(chat), [chat])
  const c = useChat(chat)
  if (!c) return <p className="qw">Loading…</p>
  const said = c.messages.filter((m) => m.who === 'agent' && typeof m.text === 'string' && m.text.trim()).slice(-2)
  if (!said.length) return <p className="qw">{c.working ? c.doing || 'Working' : 'Nothing said yet.'}</p>
  return (
    <>
      {said.map((m) => <p key={m.id} className="qt jobw">{m.text}</p>)}
    </>
  )
}

/** Stop: a shell or watcher ends (its CLI then tells the agent); a helper stops what it does, as Esc */
function StopJob({ j, chat }: { j: Job; chat: string }) {
  const [stopping, setStopping] = useState(false)
  if (j.kind === 'child' && j.status === 'done') return null
  if (j.kind !== 'child' && !j.stop) return null
  const stop = async () => {
    setStopping(true)
    const ok = await tryAct(j.kind === 'child' ? { type: 'stop', chat: j.chat! } : { type: 'stop-job', chat, job: j.id })
    if (!ok) setStopping(false)
  }
  return (
    <Btn small className="jobs-stop" disabled={stopping} onClick={() => void stop()}>
      <I n="stop" c="s16" />
      {stopping ? 'Stopping…' : 'Stop'}
    </Btn>
  )
}
