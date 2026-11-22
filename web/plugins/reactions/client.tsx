// Reactions, both ways: the agent reacts to some of your messages with one emoji by itself; you react from a message's
// menu (a row of your most used emoji, then + for every emoji, with search). Your reaction reaches the agent at once
// as a small message. Switched off: the row is gone (an agent's own reactions still show).
import { useEffect, useState } from 'react'
import { definePlugin, tryAct } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { I } from '@client/ui.tsx'
import type { Chat, Message } from '@shared/types.ts'
import { loadEmoji, quickRow, remember, search, tone, withTone, type Group } from './emoji.ts'

/** react to a message; the same emoji again takes it back */
export function react(chat: string, msg: string, emoji: string) {
  remember(emoji)
  void tryAct({ type: 'react', chat, message: msg, emoji })
}

/** the small mark under a message: yours under the agent's (left), the agent's under yours (right) */
function Pills({ msg }: { msg: Message; chat: Chat }) {
  if (!msg.reactions?.length) return null
  return <span className={msg.who === 'you' ? 'rx' : 'rx l'} aria-label={`Reaction ${msg.reactions.map((r) => r.emoji).join(' ')}`}>{msg.reactions.map((r) => r.emoji).join(' ')}</span>
}

/** every emoji, with search */
function All({ onPick }: { onPick: (e: string) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => void loadEmoji().then(setGroups), [])
  const skin = tone()
  const found = groups && q.trim() ? search(groups, q) : null
  return (
    <div className="pk">
      <input className="inp" name="eq" aria-label="Search emoji" placeholder="Search emoji" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="emolist" role="listbox" aria-label="Emoji">
        {(found ?? groups?.flatMap((g) => g.list) ?? []).slice(0, found ? 120 : 400).map((e) => {
          const ch = e.tone ? withTone(e.e, skin) : e.e
          return <button type="button" key={e.e} role="option" aria-selected={false} aria-label={e.name} onClick={() => onPick(ch)}>{ch}</button>
        })}
      </div>
      {found && !found.length && <p className="hint" style={{ padding: 8 }}>No emoji matches.</p>}
    </div>
  )
}

function Row({ msg, chat, close }: { msg: Message; chat: Chat; close: () => void }) {
  const pick = (e: string) => {
    close()
    react(chat.key, msg.id, e)
  }
  return (
    <div className="emo">
      {quickRow(tone()).slice(0, 6).map((e) => <button type="button" key={e} aria-label={`React ${e}`} onClick={() => pick(e)}>{e}</button>)}
      <button
        type="button"
        aria-label="More emoji"
        onClick={() => {
          close()
          openDialog((done) => <All onPick={(e) => { done(); react(chat.key, msg.id, e) }} />, { wide: true, bare: true, label: 'Emoji' })
        }}
      >
        <I n="plus" />
      </button>
    </div>
  )
}

export default definePlugin({
  name: 'reactions',
  setup(reg) {
    reg.messageEdge.push({ order: 100, View: Pills })
    reg.messageMenu.push({ order: 10, Top: Row })
  },
})
