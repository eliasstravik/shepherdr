import { useState } from 'react'
import { has, openTask } from '@client/kernel.ts'
import { Btn } from '@client/ui.tsx'
import type { Question, SignIn } from '@shared/types.ts'
import { Term } from '../terminal/client.tsx'
import { switchView } from '../terminal/menu.ts'

/** An agent needs signing in: what to run, in its own words, and its terminal. Shepherdr never signs in for you. */
export function SignInCard({ question, login }: { question: Question; login: SignIn }) {
  const [showTerminal, setShowTerminal] = useState(false)
  return (
    <section className="card" data-card={question.id} data-ask="">
      <span className="t">{question.title}</span>
      <span>{login.how}</span>
      {question.choices.map((c, i) => <span className="s" key={i}>{c.label}{c.description ? ` ${c.description}` : ''}</span>)}
      {has('terminal') && login.terminal && <div className="acts">
        <Btn kind="pri" onClick={() => {
          if (login.terminal!.startsWith('t:')) { setShowTerminal(!showTerminal); return }
          if (question.by) openTask(question.by.chat.slice(0, -7))
          switchView(login.terminal!, true)
        }}>{showTerminal ? 'Close terminal' : 'Open terminal'}</Btn>
      </div>}
      {showTerminal && login.terminal && <Term stream={login.terminal} onEnd={() => setShowTerminal(false)} />}
    </section>
  )
}
