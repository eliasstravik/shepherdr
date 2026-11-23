// Reactions, both ways: the agent reacts to some of your messages with one emoji by itself; you react from the quick
// bar a tap on a message shows (its smiley), or from its menu (a row of your most used emoji, then + for every emoji,
// with search). Each reaction is a small pill pinned to the bubble's top corner that faces the middle of the chat, as
// Claude Duet places it (top right for the agent's, top left for yours, straddling it): the emoji at about the text's size, a count when you both picked it, yours tinted; a tap on yours takes it back, a tap on
// the agent's adds the same. You keep one reaction per message: picking another changes it. Your reaction reaches the
// agent at once as a small message. Switched off: the row is gone (an agent's own reactions still show).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { definePlugin, tryAct } from '@client/kernel.ts'
import { openDialog, openMenu } from '@client/overlay.tsx'
import { cx, I } from '@client/ui.tsx'
import type { Chat, Message } from '@shared/types.ts'
import { chipLabel, chipsOf, minesOf, togglesFor } from './chips.ts'
import { fit } from './place.ts'
import { quickRow, remember, tone } from './emoji.ts'
import { All } from './all.tsx'

/** react to a message: the same emoji again takes it back, another one changes yours */
export function react(chat: string, msg: Message, emoji: string) {
  remember(emoji)
  void (async () => {
    for (const e of togglesFor(msg.reactions, emoji)) if (!(await tryAct({ type: 'react', chat, message: msg.id, emoji: e }))) return
  })()
}

/** the chips on a message's top corner; one added while it is on screen pops in */
export function Chips({ msg, chat }: { msg: Message; chat: Chat }) {
  const chips = chipsOf(msg.reactions)
  const first = useRef<Set<string> | null>(null)
  first.current ??= new Set(chips.map((c) => c.emoji))
  const box = useRef<HTMLDivElement>(null)
  const sig = chips.map((c) => c.emoji + c.count).join()
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    fit(el)
    // the column or the bubble changing width (a panel opening, a message still arriving) moves the corner
    const ro = new ResizeObserver(() => fit(el))
    const col = el.closest('.msgs')
    if (col) ro.observe(col)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [sig])
  if (!chips.length) return null
  return (
    <div className="rxs" role="group" aria-label="Reactions" ref={box}>
      {chips.map((c) => (
        <button
          type="button"
          key={c.emoji}
          className={cx('rxc', c.pending && 'rx-pending', !first.current!.has(c.emoji) && 'rx-new')}
          aria-pressed={c.mine}
          aria-label={chipLabel(c)}
          onClick={(e) => {
            e.stopPropagation()
            react(chat.key, msg, c.emoji)
          }}
        >
          <span className="e">{c.emoji}</span>
          {c.count > 1 && <span className="n">{c.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** the emoji row: your most used six, then + for every emoji; the one you picked already is marked */
export function Row({ msg, chat, close }: { msg: Message; chat: Chat; close: () => void }) {
  const pick = (e: string) => {
    close()
    react(chat.key, msg, e)
  }
  const mine = minesOf(msg.reactions)
  return (
    <div className="emo" role="group" aria-label="React">
      {quickRow(tone()).slice(0, 6).map((e) => <button type="button" key={e} aria-label={`React ${e}`} aria-pressed={mine.includes(e)} onClick={() => pick(e)}>{e}</button>)}
      <button
        type="button"
        aria-label="More emoji"
        onClick={() => {
          close()
          openDialog((done) => <All onPick={(e) => { done(); react(chat.key, msg, e) }} />, { wide: true, bare: true, label: 'Emoji' })
        }}
      >
        <I n="plus" />
      </button>
    </div>
  )
}

/** the quick bar's smiley: the emoji row floats above it */
function Add({ msg, chat }: { msg: Message; chat: Chat }) {
  return (
    <button
      type="button"
      className="qbtn"
      aria-label="Add reaction"
      onClick={(e) => openMenu(e.currentTarget, (close) => <Row msg={msg} chat={chat} close={close} />, { label: 'React', float: true })}
    >
      <I n="smile" />
    </button>
  )
}

export default definePlugin({
  name: 'reactions',
  setup(reg) {
    reg.messageEdge.push({ order: 100, View: Chips })
    reg.messageQuick.push({ order: 10, View: Add })
    reg.messageMenu.push({ order: 10, Top: Row })
  },
})
