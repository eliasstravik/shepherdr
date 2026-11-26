// The cards a chat shows when an agent needs the person, in one style: a permission (the command, Decline, Allow
// once), a question with its quick answers, a plan, a secret asked for by name. Their words come from the agent's own
// request; Shepherdr never builds a card by reading an agent's screen. One answer settles it wherever it shows.
import { useState } from 'react'
import { copyText } from '@client/copy.ts'
import { focusBox } from '@client/commands.ts'
import { attempt, notice, openTask, useSnap } from '@client/kernel.ts'
import { press, waiting } from '@client/pending.ts'
import { ActBtn, ActError, Btn, I, IB, Seg, useCardActs } from '@client/ui.tsx'
import type { Question, SecretAsk, Snapshot } from '@shared/types.ts'
import { machineLabel, placeDown, placeOf, spaceLabel } from '@shared/view.ts'
import { Markdown } from './markdown.tsx'

/** a quiet line where a card was, once it is settled */
export function DoneRow({ icon = 'check', children }: { icon?: 'check' | 'warn'; children: React.ReactNode }) {
  return (
    <div className="donerow">
      <I n={icon} c="s16" />
      {children}
    </div>
  )
}

/** the design system's code block: the code, and a copy button */
export function Code({ text }: { text: string }) {
  return (
    <div className="code">
      <code>{text}</code>
      <IB icon="copy" label="Copy" onClick={(e) => void copyText(text, e.currentTarget).then((ok) => ok && notice('Copied'))} />
    </div>
  )
}

const answer = (chat: string, q: Question, body: Record<string, unknown>) => attempt({ type: 'answer', chat, question: q.id, ...body })

/** where a card's task runs, when the link to that machine is down: no buttons, it waits until the link is back */
function downLine(snap: Snapshot | null, place: string | undefined) {
  const m = snap && place ? placeDown(snap, place) : undefined
  return m ? <DoneRow icon="warn">Can't reach {m.name}: this waits until the link is back</DoneRow> : null
}

/** A question, a permission or a plan from an agent. `place`: the space its task is in (for "On vm, in garden-app"). */
export function QuestionCard({ q, chat, place }: { q: Question; chat: string; place?: string }) {
  const snap = useSnap()
  // its buttons answer at once and wait together (pending.ts), until the answer shows on the card
  const acts = useCardActs(`q:${q.id}`, `${q.sent ?? ''}|${q.closed ?? ''}`)
  const busy = waiting(acts.now)
  const [part, setPart] = useState(0)
  const [picked, setPicked] = useState<number[]>([])
  const [answers, setAnswers] = useState<Step[]>([])
  // "Other…" opened: a box on the card for your own answer
  const [other, setOther] = useState<string | null>(null)
  const down = downLine(snap, place)
  if (q.sent !== undefined && q.command !== undefined) return <DoneRow>{q.sent === 0 ? 'You allowed this' : 'You declined this'}</DoneRow>
  // an answered question: the answer shows as your message (the agent's reply follows it in the chat)
  if (q.sent !== undefined) return <p className="b mine gap">{q.said || q.choices[q.sent]?.label || 'Answered'}</p>
  if (q.closed) return <DoneRow>{q.closed}</DoneRow>
  if (down) return down
  /** a button of this card that sends its answer */
  const say = (id: string, body: Record<string, unknown>, label: React.ReactNode, o: { kind?: 'pri'; chip?: boolean; off?: boolean; busy?: string; then?: () => void } = {}) => (
    <ActBtn key={id} acts={acts} id={id} kind={o.kind} chip={o.chip} disabled={o.off} busy={o.busy ?? 'Sending…'} run={async () => { const why = await answer(chat, q, body); if (!why) o.then?.(); return why }}>{label}</ActBtn>
  )
  // a question's own two ways out (#1560): "Other…" types your own answer on the card, "Chat about this" answers
  // nothing (the agent hears you want to talk it over) and puts you in the chat's box
  const talk = () => {
    if (focusBox(chat)) return
    const t = q.by && snap?.tasks.find((x) => x.agent?.chat === chat)
    if (t) openTask(t.id)
    setTimeout(() => focusBox(chat), 300)
  }
  // body: what your own words answer (the card's last step); else a step of several, where they go on to the next
  const ways = (body: ((o: string) => Record<string, unknown>) | null, onward?: (o: string) => void) =>
    !q.other ? null : other === null ? (
      <>
        <button type="button" className="chip" disabled={busy} onClick={() => setOther('')}>Other…</button>
        {say('talk', { talk: true }, 'Chat about this', { chip: true, then: talk })}
      </>
    ) : (
      <OtherBox
        value={other}
        set={setOther}
        busy={busy}
        last={!!body}
        go={(o) => (body ? void press(acts.card, acts.at, 'other', () => answer(chat, q, body(o.trim()))) : onward?.(o.trim()))}
        button={body ? say('other', body(other.trim()), 'Send', { kind: 'pri', off: !other.trim() }) : <Btn kind="pri" disabled={!other.trim()} onClick={() => onward?.(other.trim())}>Next</Btn>}
      />
    )
  // a permission: the command, Decline, Allow once
  if (q.command !== undefined) {
    const p = snap && place ? placeOf(snap, place) ?? snap.places.find((x) => x.id === place) : undefined
    return (
      <div className="card" data-card={q.id} data-ask="">
        <span className="t">{q.title || 'Run a command'}</span>
        {p && snap && <span className="s">On {machineLabel(snap, p.machine)}, in {spaceLabel(snap, p.id).replace(/^#/, '')}</span>}
        <Code text={q.command} />
        <div className="acts">
          {say('decline', { choice: 1 }, 'Decline', { busy: 'Declining…' })}
          {say('allow', { choice: 0 }, 'Allow once', { kind: 'pri', busy: 'Allowing…' })}
        </div>
        <ActError acts={acts} />
      </div>
    )
  }
  // #1441: a CLI's folder-trust screen: what waits and what trusting allows, No, Trust this folder and start
  if (q.trust) {
    return (
      <div className="card" data-card={q.id} data-ask="">
        <span className="t">{q.title}</span>
        <span>{q.trust.waits}</span>
        <span className="s">{q.trust.allows}</span>
        <div className="acts">
          {say('no', { choice: 1 }, q.choices[1]?.label ?? 'No', { busy: 'Stopping…' })}
          {say('yes', { choice: 0 }, q.choices[0]?.label ?? 'Trust this folder and start', { kind: 'pri', busy: 'Starting…' })}
        </div>
        <ActError acts={acts} />
      </div>
    )
  }
  // a plan: what it will do, Keep planning, Approve
  if (q.kind === 'Plan' || q.plan) {
    return (
      <div className="card" data-card={q.id} data-ask="">
        <span className="t">{q.title || 'A plan to approve'}</span>
        {q.plan && <Markdown text={q.plan} />}
        <div className="acts">
          {q.choices.slice(1).map((c, i) => say(`c${i + 1}`, { choice: i + 1 }, c.label))}
          {say('c0', { choice: 0 }, q.choices[0]?.label ?? 'Approve', { kind: 'pri' })}
        </div>
        <ActError acts={acts} />
      </div>
    )
  }
  // several questions in one: one at a time, each with its quick answers
  if (q.parts?.length) {
    const cur = q.parts[part]!
    const next = (a: Step) => {
      setPicked([])
      setOther(null)
      setAnswers([...answers, a])
      setPart(part + 1)
    }
    // the last part's answer sends them all: its button shows it going
    const last = part + 1 === q.parts.length
    return (
      <div className="card" data-card={q.id} data-ask="">
        <span className="s">{part + 1} of {q.parts.length}</span>
        <span className="t">{cur.title}</span>
        <div className="chips" style={{ marginTop: 0 }}>
          {cur.choices.map((c, i) => (
            last && !cur.multi ? (
              say(`p${i}`, { answers: [...answers, { choice: i }] }, c.label, { chip: true })
            ) : (
              <button type="button" key={c.label} className="chip" aria-pressed={cur.multi ? picked.includes(i) : undefined} disabled={busy} onClick={() => (cur.multi ? setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]) : next({ choice: i }))}>
                {c.label}
              </button>
            )
          ))}
        </div>
        {ways(last ? (o) => ({ answers: [...answers, { other: o }] }) : null, (o) => next({ other: o }))}
        {cur.multi && other === null && (
          <div className="acts">
            {last ? (
              say('last', { answers: [...answers, { choices: picked }] }, 'Send', { kind: 'pri', off: !picked.length })
            ) : (
              <Btn kind="pri" disabled={busy || !picked.length} onClick={() => next({ choices: picked })}>Next</Btn>
            )}
          </div>
        )}
        <ActError acts={acts} />
      </div>
    )
  }
  // a question with quick answers: the buttons under it; typing in the box answers it too
  if (q.multi)
    return (
      <div className="card" data-card={q.id} data-ask="">
        <div className="chips" style={{ marginTop: 0 }}>
          {q.choices.map((c, i) => (
            <button type="button" key={c.label} className="chip" aria-pressed={picked.includes(i)} disabled={busy} onClick={() => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])}>
              {c.label}
            </button>
          ))}
        </div>
        {ways((o) => ({ other: o }))}
        {other === null && (
          <div className="acts">
            {say('send', { choices: picked }, 'Send', { kind: 'pri', off: !picked.length })}
          </div>
        )}
        <ActError acts={acts} />
      </div>
    )
  return (
    <div className="chips" data-card={q.id} data-ask="">
      {other === null && q.choices.map((c, i) => say(`c${i}`, { choice: i }, c.label, { chip: true }))}
      {ways((o) => ({ other: o }))}
      <ActError acts={acts} />
    </div>
  )
}

/** one step's answer on a card of several: a pick, picks, or your own words */
type Step = { choice?: number; choices?: number[]; other?: string }

/** "Other…" opened: a one-line box for your own answer, Cancel, and Send (Next on a step that isn't the last); Enter
 *  does the same, Escape cancels */
function OtherBox({ value, set, busy, last, go, button }: { value: string; set: (v: string | null) => void; busy: boolean; last: boolean; go: (v: string) => void; button: React.ReactNode }) {
  return (
    <div className="oth">
      <input
        className="inp"
        name="other"
        aria-label="Your answer"
        placeholder="Your answer"
        autoComplete="off"
        enterKeyHint={last ? 'send' : 'next'}
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        disabled={busy}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return set(null)
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !value.trim() || busy) return
          e.preventDefault()
          go(value)
        }}
      />
      <div className="acts">
        <Btn disabled={busy} onClick={() => set(null)}>Cancel</Btn>
        {button}
      </div>
    </div>
  )
}

/** An agent asks for a secret by name: you type it into a masked box and it goes straight to the vault. The agent
 *  never sees it. */
export function SecretCard({ ask, chat }: { ask: SecretAsk; chat: string }) {
  const [value, setValue] = useState('')
  const [level, setLevel] = useState(ask.levels[0]?.id ?? 'all')
  const acts = useCardActs(`secret:${ask.id}`, ask.saved ?? '')
  if (ask.saved) return <DoneRow>{ask.saved}</DoneRow>
  const put = (v: string | null) => attempt({ type: 'secret', level, name: ask.name, value: v, card: { chat, id: ask.id } })
  return (
    <div className="card" data-card={ask.id}>
      <span className="t">A secret: {ask.name}</span>
      {ask.why && <span className="s">{ask.why}</span>}
      <input className="inp" type="password" name="secret" aria-label={ask.name} placeholder="Paste it here" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && value && !waiting(acts.now) && void press(acts.card, acts.at, 'save', () => put(value))} />
      {ask.levels.length > 1 && <Seg label="Who may use it" values={ask.levels.map((l) => l.label)} value={ask.levels.find((l) => l.id === level)?.label ?? ''} onChange={(v) => setLevel(ask.levels.find((l) => l.label === v)?.id ?? level)} />}
      <div className="acts">
        <ActBtn acts={acts} id="decline" busy="Declining…" run={() => put(null)}>Decline</ActBtn>
        <ActBtn acts={acts} id="save" kind="pri" disabled={!value} busy="Saving…" run={() => put(value)}>Save</ActBtn>
      </div>
      <ActError acts={acts} />
    </div>
  )
}
