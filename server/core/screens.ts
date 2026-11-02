import { randomUUID } from 'node:crypto'
import { askText, quickChoices } from '../../shared/alerts.ts'
import type { Action, Message, Question } from '../../shared/types.ts'
import { pressKeys, readScreen, sameScreen, screenText } from '../common/screen-card.ts'
import { Refusal } from './client.ts'
import type { CoreAgent } from './model.ts'
import { CLI_NAME } from './settings.ts'
import type { CoreSource } from './source.ts'
import { guarded } from './guarded.ts'

interface ScreenCard { id: string; chat: string; launch: string; screen: string; all?: string; question: Question; state: 'open' | 'answered'; at: number }

const FIRST_LOOK = 6000 // two matching reads, a poll or two apart, put a card with choices up by about 10 seconds
const POLL = 2000
const CATCH_UP = 1500 // how long a card waits for the agent's hooks to be read: a slow machine holds it back no longer
const RETRY = 10_000 // a pressed choice has this long to leave the screen before it is asked again

/** An agent with no session yet may be stopped at a screen of its CLI's own: folder trust, theme, sign-in, hooks, or one
 *  that CLI adds later. No hook reports those, so its screen goes to the chat as a card. `starting` only says no hook has
 *  been read yet, and they can run late: a CLI in a turn is not stopped, whatever its screen says, and
 *  words with nothing to choose only ever carry on from a card, with something to act on: a link to open, or a CLI
 *  that says it has stopped. Words on a screen grant nothing:
 *  a card only shows them, and a human's tap presses what they read, as they could in the Terminal panel. Readiness
 *  stays the hooks' word. */
export class CoreScreens {
  private timer?: ReturnType<typeof setInterval>
  private looking = new Set<string>()
  private last = new Map<string, { seen: string; shown: string }>()
  private pressing = new Set<string>()
  constructor(private readonly source: CoreSource) {}
  start() { this.timer = setInterval(() => { if (!this.source.quiescing) void guarded('Screen check', () => this.tick()) }, POLL) }
  stop() { clearInterval(this.timer) }
  private cards() { return this.source.store.all<ScreenCard>('screen-card') }
  /** The CLI's own report of a turn running or just ended, helpers perhaps still at work: start-up screens send neither. */
  private inTurn(agent: CoreAgent) { return ['working', 'done'].includes(this.source.agents.terminal(agent)?.status?.state ?? '') }
  private waiting(row: ScreenCard) { const agent = this.source.agents.get(row.chat); return agent?.launch === row.launch && agent.state === 'starting' && this.source.agents.terminal(agent)?.state === 'live' && !this.inTurn(agent) }
  open(chat: string) { return this.cards().filter(row => row.chat === chat && row.state === 'open' && this.waiting(row)) }
  /** A card outlives its wait only as a record of how it ended. */
  reconcile(chat: string) {
    for (const row of this.cards()) {
      if (row.chat !== chat || row.state !== 'open' || this.waiting(row)) continue
      const agent = this.source.agents.get(chat)
      this.finish(row, agent?.launch !== row.launch ? 'Session replaced' : agent.state === 'starting' && !this.inTurn(agent) ? 'The agent stopped' : undefined)
    }
  }
  async tick(now = Date.now()) {
    if (!this.source.connected()) return
    for (const chat of new Set(this.cards().filter(row => row.state === 'open').map(row => row.chat))) this.reconcile(chat)
    const starting = this.source.agents.all().filter(agent => agent.state === 'starting' && agent.role !== 'reviewer' && !agent.pilot && now - agent.started >= FIRST_LOOK && !this.inTurn(agent))
    for (const launch of this.last.keys()) if (!starting.some(agent => agent.launch === launch)) this.last.delete(launch)
    // A machine out of reach shows as that, the next poll looks again, and it holds up no other agent's card.
    await Promise.allSettled(starting.filter(agent => !this.looking.has(agent.launch)).map(async agent => {
      this.looking.add(agent.launch)
      try { await this.look(agent, now) } finally { this.looking.delete(agent.launch) }
    }))
  }
  private async read(agent: CoreAgent) {
    const terminal = this.source.agents.terminal(agent)
    if (terminal?.state !== 'live') return undefined
    return { terminal, text: (await this.source.core.call<{ text: string }>('terminal.read', { terminal: terminal.address })).text }
  }
  private async look(agent: CoreAgent, now: number) {
    const read = await this.read(agent)
    if (!read) return
    const seen = sameScreen(read.text), all = screenText(read.text), { words, choices } = readScreen(read.text, read.terminal.cols), before = this.last.get(agent.launch)
    const shown = JSON.stringify([all, choices])
    this.last.set(agent.launch, { seen, shown })
    const current = this.source.agents.get(agent.chat)
    if (before?.seen !== seen || current?.launch !== agent.launch || current.state !== 'starting') return // still moving
    const cards = this.cards().filter(row => row.chat === agent.chat && row.launch === agent.launch)
    const open = cards.find(row => row.state === 'open' && row.screen === seen)
    // the same screen with a new code or number on it: a timer never reads the same twice, so it stays out. A new card,
    // so a tap on the old one, from a phone yet to hear of this, can't reach words it didn't show.
    if (open && before.shown === shown && JSON.stringify([open.all, open.question.choices]) !== shown) { this.finish(open, 'The screen changed'); this.post(agent, seen, all, words, choices); return }
    if (open || cards.some(row => row.screen === seen && now - row.at < RETRY)) return
    for (const row of cards) if (row.state === 'open') this.finish(row)
    if (!choices.length && !(words && cards.length && (/https?:\/\//.test(read.text) || ['idle', 'blocked'].includes(read.terminal.status?.state ?? '')))) return
    await Promise.race([this.source.logs.catchUp(agent.chat), Bun.sleep(CATCH_UP)])
    const latest = this.source.agents.get(agent.chat)
    if (latest?.launch === agent.launch && latest.state === 'starting' && !this.inTurn(latest)) this.post(agent, seen, all, words, choices)
  }
  private post(agent: CoreAgent, screen: string, all: string, words: string, choices: Question['choices']) {
    const task = this.source.tasks.forChat(agent.chat), id = randomUUID(), cli = CLI_NAME[agent.kind]
    const question: Question = { id, title: `${cli} is waiting on its screen`, kind: 'Question', screen: words, terminal: true, press: true, choices, noNote: true, to: cli }
    this.source.store.set('screen-card', id, { id, chat: agent.chat, launch: agent.launch, screen, all, question, state: 'open', at: Date.now() } satisfies ScreenCard)
    this.source.post(agent.chat, { id, who: 'agent', question, at: Date.now() })
    this.source.forwardQuestion(agent.chat, question)
    this.source.emit('alert', { id, from: 'Shepherdr', ...askText(task?.id || this.source.space(agent.space)?.name || 'Shepherdr', question), go: { place: agent.space, task: task?.id, focus: id }, tag: task?.id || `ask:${agent.space}`,
      task: task ? true : undefined, card: { chat: agent.chat, question: id, choices: quickChoices(question) } })
    this.source.emit('snapshot')
  }
  /** Gone with no tap on the card: `closed` says why, and with no reason it was answered in the terminal. */
  private finish(row: ScreenCard, closed?: string) {
    row.state = 'answered'; row.question.sent = -1
    if (closed) row.question.closed = closed
    else row.question.via = 'terminal'
    this.settle(row, closed ?? 'Answered in the terminal', closed ? 'No longer waiting' : 'Answered')
  }
  private settle(row: ScreenCard, words?: string, outcome?: string) {
    this.source.store.set('screen-card', row.id, row)
    const message = this.source.store.get<Message>(`message:${row.chat}`, row.id)
    this.source.post(row.chat, { ...message, id: row.id, who: 'agent', question: row.question, at: message?.at ?? Date.now() })
    this.source.forwardQuestion(row.chat, row.question, words, outcome)
  }
  async answer(action: Extract<Action, { type: 'answer' }>): Promise<boolean> {
    const row = this.source.store.get<ScreenCard>('screen-card', action.question)
    if (!row) return false
    if (row.chat !== action.chat || row.state !== 'open' || !this.waiting(row)) throw new Refusal('This screen is no longer waiting for an answer')
    if (!Number.isInteger(action.choice) || !row.question.choices[action.choice]) throw new Refusal('Choose one of the card’s answers')
    if (this.pressing.has(row.id)) return true
    this.pressing.add(row.id)
    try {
      // The cursor may have moved, or the screen gone, since the card was drawn. Nothing is pressed on a screen it doesn't show.
      const read = await this.read(this.source.agents.get(row.chat)!)
      const screen = read && readScreen(read.text, read.terminal.cols)
      if (!read || !screen || screenText(read.text) !== row.all || JSON.stringify(screen.choices) !== JSON.stringify(row.question.choices)) throw new Refusal('That screen has changed, so nothing was pressed')
      await this.source.core.call('terminal.keys', { terminal: read.terminal.address, keys: pressKeys(screen.at, action.choice) })
      row.state = 'answered'; row.at = Date.now(); row.question.sent = action.choice
      this.settle(row, row.question.choices[action.choice].label, 'Answered')
      return true
    } finally { this.pressing.delete(row.id) }
  }
}
