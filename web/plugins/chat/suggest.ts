// SHEP-186: the suggested replies shown as bubbles above the message box (the agent's reply's last lines,
// core/chat-log.js), each sent as it is with one tap.
import type { Chat, Message } from '@shared/types.ts'
import { HOLD_MS, SLOP } from './press.ts'

/** the most bubbles shown */
export const MAX_SUGGESTS = 3

/** a message's suggested replies, in order, at most MAX_SUGGESTS (an older service's single suggest is one) */
export function suggestsOfMessage(m: Message): string[] {
  const all = m.suggests?.length ? m.suggests : m.suggest ? [m.suggest] : []
  return [...new Set(all.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_SUGGESTS)
}

// The suggested replies to show: the newest text is the agent's, it carries suggestions and the person hasn't
// written after it. Off in Settings: none. { id, texts } or null.
export function suggestionOf(chat: Chat | undefined, on: boolean): { id: string; texts: string[] } | null {
  if (!on || !chat) return null
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]!
    if (!m.text) continue
    if (m.who === 'you' || m.error) return null
    const texts = suggestsOfMessage(m)
    return texts.length ? { id: m.id, texts } : null
  }
  return null
}

/** When the bubbles hide though the chat has some: a dictation or a call on, the agent working on a new reply, a
 *  message of yours still on its way (it outlives a reload), or this set already used. What is in the box never hides
 *  them: they stay while you type, until you send or a new reply replaces them. */
export function repliesHidden(s: { dictating: boolean; call: boolean; working: boolean; sending: boolean; spent: boolean }): boolean {
  return s.dictating || s.call || s.working || s.sending || s.spent
}

// Settings › Agents › Suggested replies: on unless it's off (the snapshot's rows, as Everywhere has it)
export function suggestionsOn(settings: { rows: { key: string; value: string }[] }[] | undefined): boolean {
  return (settings ?? []).flatMap((s) => s.rows).find((r) => r.key === 'agents.suggestions')?.value !== 'off'
}

/** One finger (or mouse) on one suggested reply: a tap sends it; held still for HOLD_MS (or a right-click / the
 *  phone's own long-press menu) it goes in the box to edit instead, and the tap that ends that hold sends nothing.
 *  The clock is passed in, so tests run it without waiting. */
export class ReplyPress {
  private timer: unknown = null
  private x = 0
  private y = 0
  private held = false
  constructor(
    private readonly edit: () => void,
    private readonly later: (f: () => void, ms: number) => unknown = setTimeout,
    private readonly cancel: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  ) {}
  down(x: number, y: number) {
    this.stop()
    this.held = false
    this.x = x
    this.y = y
    this.timer = this.later(() => {
      this.timer = null
      this.hold()
    }, HOLD_MS)
  }
  /** moved past the slop: scrolling the row, not a press */
  move(x: number, y: number) {
    if (this.timer !== null && Math.hypot(x - this.x, y - this.y) > SLOP) this.stop()
  }
  stop() {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
  }
  /** the context menu's event (a right-click, Android's long-press): edit, once */
  menu() {
    this.stop()
    if (!this.held) this.hold()
  }
  /** the click that ends a press: true when it sends */
  click(): boolean {
    this.stop()
    if (!this.held) return true
    this.held = false
    return false
  }
  private hold() {
    this.held = true
    this.edit()
  }
}
