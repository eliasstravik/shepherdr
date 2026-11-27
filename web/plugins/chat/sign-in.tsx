import { useRef, useState } from 'react'
import { copyText } from '@client/copy.ts'
import { attempt, has, notice, openTask } from '@client/kernel.ts'
import { ActBtn, ActError, Btn, useCardActs } from '@client/ui.tsx'
import type { Question, SignIn } from '@shared/types.ts'
import { Term } from '../terminal/client.tsx'
import { switchView } from '../terminal/menu.ts'
import './sign-in.css'

export function SignInCard({ question, login, chat }: { question: Question; login: SignIn; chat: string }) {
  const [expanded, expand] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const alternative = picked === null ? undefined : login.methods?.[picked]
  const [showTerminal, setShowTerminal] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const acts = useCardActs(question.id, login.stage)
  const send = (body: Record<string, unknown>) => attempt({ type: 'sign-in', chat, id: question.id, ...body })
  const method = (i: number) => send({ choice: i })
  const terminal = has('terminal') && login.terminal && (
    <Btn onClick={() => {
      if (login.terminal!.startsWith('t:')) { setShowTerminal(!showTerminal); return }
      if (question.by) openTask(question.by.chat.slice(0, -7))
      switchView(login.terminal!, true)
    }}>{showTerminal ? 'Close terminal' : 'Open terminal'}</Btn>
  )
  const entry = login.stage === 'key' ? 'key' : login.input
  const field = entry === 'key' ? 'OpenAI API key' : entry === 'callback' ? 'Full address from the browser' : 'Sign-in code'
  const loginHost = login.signInUrl && new URL(login.signInUrl).hostname
  const title = login.apiKeySaved ? 'Codex · API key saved'
    : login.stage === 'signed' ? (login.connector || login.cli) + ' · Signed in' : question.title

  return (
    <section className="card sign-in-card" data-card={question.id} data-ask={login.stage === 'signed' ? undefined : ''}>
      <span className="t">{title}</span>
      {login.instructions && <span>{login.instructions}</span>}
      {login.stage === 'start' && <div className="acts">
        <ActBtn acts={acts} id="start" kind="pri" busy="Starting sign-in…" run={() => method(0)}>Sign in</ActBtn>
      </div>}
      {login.stage === 'methods' && !expanded && <div className="acts">
        <Btn kind="pri" onClick={() => expand(true)}>Sign in</Btn>
      </div>}
      {login.stage === 'methods' && expanded && <div className="sign-in-methods">
        {login.methods?.map((choice, i) => choice.fallback
          ? <Btn key={i} onClick={() => setPicked(i)}>{choice.label}</Btn>
          : <ActBtn key={i} acts={acts} id={String(i)} busy="Opening…" run={() => method(i)}>{choice.label}</ActBtn>)}
      </div>}
      {alternative?.fallback && <span>{alternative.fallback}</span>}
      {alternative?.sameComputer && <div className="acts">
        <ActBtn acts={acts} id="local-browser" kind="pri" busy="Starting sign-in…" run={() => send({ choice: picked, sameComputer: true })}>I'm on that computer</ActBtn>
      </div>}
      {login.signInUrl && <>
        {login.deviceCode ? <>
          <span>Copy this code, then enter it after signing in to ChatGPT.</span>
          <div className="sign-in-code">
            <code>{login.deviceCode}</code>
            <Btn small onClick={(e) => void copyText(login.deviceCode!, e.currentTarget).then((ok) => { if (ok) notice('Copied') })}>Copy code</Btn>
          </div>
        </> : login.input === 'callback' ? <span>After signing in, copy the full address from your browser, even if the page fails to load.</span>
          : login.input === 'code' ? <span>Sign in in your browser, then paste the code here if Claude gives you one.</span> : null}
        <div className="acts">
          <ActBtn acts={acts} id="cancel" busy="Canceling…" run={() => send({ cancel: true })}>Cancel</ActBtn>
          <a className="btn pri" href={login.signInUrl} target="_blank" rel="noopener noreferrer">Open {loginHost}</a>
        </div>
      </>}
      {entry && <form ref={form} className="sign-in-form" onSubmit={(event) => {
        event.preventDefault()
        event.currentTarget.querySelector<HTMLButtonElement>('[data-submit]')?.click()
      }}>
        {entry === 'key' && <span>The key is saved in Secrets for the computer running Codex.</span>}
        <label className="fld">
          <span>{field}</span>
          <input name="value" className="inp" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={entry === 'key' ? 1024 : 2048} />
        </label>
        <div className="acts">
          {entry === 'key' && <ActBtn acts={acts} id="back" busy="Going back…" run={() => send({ back: true })}>Back</ActBtn>}
          <ActBtn acts={acts} id="submit" data-submit="" kind={login.signInUrl ? undefined : 'pri'} busy="Sending…" run={async () => {
            const inputForm = form.current
            if (!inputForm?.reportValidity()) return 'Paste the value first.'
            const value = new FormData(inputForm).get('value')
            const why = await send(entry === 'key' ? { key: value } : { input: value })
            if (!why) inputForm.reset()
            return why
          }}>{entry === 'key' ? 'Save key and sign in' : 'Submit'}</ActBtn>
        </div>
      </form>}
      {(login.stage === 'continue' || login.stage === 'retry') && <div className="acts">
        <ActBtn acts={acts} id="continue" kind="pri" busy="Continuing…" run={() => method(0)}>{login.stage === 'retry' ? 'Try again' : 'Continue'}</ActBtn>
      </div>}
      {login.stage === 'waiting' && <span role="status">Waiting for {login.cli}…</span>}
      {login.stage === 'signed' && login.restart && <div className="acts">
        <ActBtn acts={acts} id="restart" kind="pri" busy="Reopening…" run={() => attempt({ type: 'agent-restart', chat: login.terminal ?? chat })}>Reopen chat</ActBtn>
      </div>}
      {(alternative?.fallback || login.stage === 'fallback' || login.instructions || acts.now?.error) && login.stage !== 'signed' && terminal && <div className="acts">{terminal}</div>}
      <ActError acts={acts} />
      {showTerminal && login.terminal && <Term stream={login.terminal} onEnd={() => setShowTerminal(false)} />}
    </section>
  )
}
