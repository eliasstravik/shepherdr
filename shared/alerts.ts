// What a push alert says, where a tap on it opens and what the app icon counts: one place for the server, the service
// worker and the screen. An iPhone shows no buttons on an alert, so its words alone must let you decide from the lock
// screen: the title says the task and what it needs, the body the question or the card's choices.
import { excerpt } from './excerpt.ts'
import { splitFacts, taskChatId, type Alert, type Chat, type Message, type Question, type Snapshot } from './types.ts'

/** about what an iPhone's lock screen shows of a title (one line) and of a body (a few lines) */
export const TITLE_MAX = 40
export const BODY_MAX = 150
/** a button's words on Android and desktop Chrome */
const ACTION_MAX = 24

/** a task's summary for its alert: never its facts line, which older summaries carried at their end */
const summaryOf = (t: { said?: string; title: string }) => (t.said && splitFacts(t.said).said) || t.title

/** one line of plain words, cut with an ellipsis */
export const clip = (text: string, n: number) => excerpt(text, n)

/** the tag of a coordinator's open question: one alert per coordinator, as one per task */
export const askTag = (place: string) => `ask:${place}`

/** what waits on you everywhere: the count the app icon shows (the sidebar's own counts added up: every need, and each
 *  Ready task) and the tag of each thing, so alerts about what no longer waits can go */
export function waiting(snap: Pick<Snapshot, 'places' | 'tasks' | 'asks' | 'needs'>): { count: number; tags: string[] } {
  const places = new Set(snap.places.map((p) => p.id))
  const tasks = snap.tasks.filter((t) => places.has(t.place) && !t.archived && (t.status === 'need' || t.status === 'ready')).map((t) => t.id)
  const asks = Object.keys(snap.asks).filter((p) => places.has(p) && snap.asks[p]).map(askTag)
  const needs = snap.needs.filter((n) => places.has(n.place))
  const ready = snap.tasks.filter((t) => places.has(t.place) && !t.archived && t.status === 'ready')
  return { count: needs.length + ready.length, tags: [...tasks, ...asks] }
}

/** the tags of the alerts that may stay: what still waits on you, less the chats on screen right now (a task's, a
 *  coordinator's: you opened its card) */
export function keptTags(snap: Pick<Snapshot, 'places' | 'tasks' | 'asks' | 'needs'>, onScreen: string[]) {
  const seen = new Set(onScreen.map((k) => taskChatId(k) ?? askTag(k)))
  return waiting(snap).tags.filter((t) => !seen.has(t))
}

/** a choice as an alert shows it: a choice that needs a note says so in the app, not in the alert */
const short = (q: Question, i: number) => (q.noteRequiredFor === i ? q.choices[i].label.replace(/ with a note$/i, '') : q.choices[i].label)

/** the card's choices in short: "Approve the plan · Send it back" */
export const choicesLine = (q: Question) => q.choices.map((_, i) => short(q, i)).join(' · ')

/** the choices a notification button may send at once: not a pick of several, not one that needs a note, never a
 *  terminal menu (its first choices all say yes, and an old alert's button would press keys in whatever menu is up then);
 *  two at most */
export function quickChoices(q: Question): { label: string; choice: number }[] {
  if (q.multi || q.id.startsWith('menu:')) return []
  return q.choices
    .map((c, i) => ({ label: short(q, i), choice: i }))
    .filter((c) => c.choice !== q.noteRequiredFor)
    .slice(0, 2)
}

/** a question as an alert: "SHE-63 · Rerun CI on main?" over its choices; a question too long for the title moves into
 *  the body, over its choices */
export function askText(who: string, q: Question): { title: string; body: string } {
  if (q.kind === 'Plan') return { title: `${who} · Plan to approve`, body: clip(choicesLine(q), BODY_MAX) }
  const title = `${who} · ${excerpt(q.title, BODY_MAX)}`
  if (title.length <= TITLE_MAX) return { title, body: clip(choicesLine(q), BODY_MAX) }
  // the question and its choices share the body: the choices keep at least a line
  const choices = clip(choicesLine(q), 70)
  return { title: clip(`${who} · Asks you`, TITLE_MAX), body: `${excerpt(q.title, BODY_MAX - choices.length - 1)}\n${choices}` }
}

type Card = Message & { question: Question }

/** the cards the chat ends on, unanswered (a choice card, a plan, the CLI's own question or form, a menu): the agent
 *  waits on them. A card with words or a reply after it no longer counts (a plan answered by typing stays open). */
export function openCards(chat: Chat | undefined): Card[] {
  const out: Card[] = []
  for (const m of [...(chat?.messages ?? [])].reverse()) {
    // what you sent that waits for the menu to be answered
    if (m.who === 'you' && m.waiting) continue
    if (!m.question) break
    if (m.question.sent === undefined) out.unshift(m as Card)
  }
  return out
}

/** the card an alert is about: the first one open (a form's first question unanswered, which the CLI asks first) */
export const openCard = (chat: Chat | undefined): Card | undefined => openCards(chat)[0]

/** the agent's last reply in a chat */
export const lastReply = (chat: Chat | undefined) => chat?.messages.findLast((m) => m.who === 'agent' && m.text && !m.card)

/**
 * A task's alert: what it needs in the title, the question or what it said in the body, a tap opening its chat on that
 * card (a done task: its card in the project's chat), and the card's quick answers. sub: the task's second line.
 */
export function taskAlert(
  t: { id: string; title: string; project: string; said?: string },
  status: 'need' | 'ready' | 'done',
  sub: string,
  chats: { task?: Chat; project?: Chat },
): Pick<Alert, 'title' | 'body' | 'go' | 'tag' | 'card' | 'task'> {
  const go = { place: t.project, task: t.id }
  const tag = t.id
  if (status === 'done') {
    const card = chats.project?.messages.findLast((m) => m.card?.task === t.id)
    return { title: clip(`${t.id} · Done`, TITLE_MAX), body: clip(summaryOf(t), BODY_MAX), go: { place: t.project, focus: card?.id }, tag, task: true }
  }
  const open = openCards(chats.task)
  if (open.length) {
    const q = open[0].question
    // a form of several questions is answered in the app, where all of them show
    const card = { chat: chats.task!.key, question: q.id, choices: open.length > 1 ? [] : quickChoices(q) }
    return { ...askText(t.id, q), go: { ...go, focus: q.id }, tag, task: true, card: card.choices.length ? card : undefined }
  }
  const last = lastReply(chats.task)
  const focus = last?.id
  if (status === 'ready') return { title: clip(`${t.id} · Ready to merge`, TITLE_MAX), body: clip(summaryOf(t), BODY_MAX), go: { ...go, focus }, tag, task: true }
  if (sub.startsWith('Went wrong: ')) return { title: clip(`${t.id} · Went wrong`, TITLE_MAX), body: clip(sub.slice('Went wrong: '.length), BODY_MAX), go: { ...go, focus }, tag, task: true }
  const reply = last?.text ?? (sub.startsWith('Waits for your reply') ? sub.replace(/^Waits for your reply:? ?/, '') : undefined)
  if (reply !== undefined) return { title: clip(`${t.id} · Waits for your reply`, TITLE_MAX), body: clip(reply || t.title, BODY_MAX), go: { ...go, focus }, tag, task: true }
  return { title: clip(`${t.id} · Needs you`, TITLE_MAX), body: clip(sub, BODY_MAX), go: { ...go, focus }, tag, task: true }
}

/* ---------- Notify: what buzzes from a place, as in Slack's channel settings ---------- */

/** the setting (Settings → Notify, and each machine's and project's row menu), set at All machines (the default for
 *  every place), a machine or a project; the most specific one set wins. It is for the place's coordinator's chat
 *  only: tasks' alerts buzz as they always have */
export const NOTIFY_KEY = 'notify'
/** All: every new message from the coordinator too; Needs me: its questions and alerts; Off: nothing from it, and the
 *  row stays quiet (muted) */
export const NOTIFY = ['All', 'Needs me', 'Off'] as const
export type Notify = (typeof NOTIFY)[number]
export const NOTIFY_DEFAULT: Notify = 'Needs me'

/** a place's Notify row in Settings: its value there, and where it comes from or what it would be unset */
export const notifyRow = (snap: Pick<Snapshot, 'settings'>, place: string) => snap.settings.filter((s) => s.level === place).flatMap((s) => s.rows).find((r) => r.key === NOTIFY_KEY)

/** a place's Notify, as Settings has it at that place's level */
export function notifyOf(snap: Pick<Snapshot, 'settings'>, place: string): Notify {
  const v = notifyRow(snap, place)?.value
  return NOTIFY.find((n) => n === v) ?? NOTIFY_DEFAULT
}

/** does an alert buzz: a task's always; a coordinator's by its place's Notify, a new message only on All, the rest
 *  unless Off */
export function notifies(snap: Pick<Snapshot, 'settings'>, a: Pick<Alert, 'go' | 'message' | 'task'>): boolean {
  if (a.task) return true
  const n = notifyOf(snap, a.go.place)
  return n === 'All' || (n === 'Needs me' && !a.message)
}

/** where a tap on an alert opens: the place, the task and the card to bring into view */
export function alertUrl(go: Alert['go']) {
  const q = new URLSearchParams({ place: go.place })
  if (go.task) q.set('task', go.task)
  if (go.focus) q.set('focus', go.focus)
  return `./?${q}`
}

/** what the service worker gets */
export interface PushPayload {
  id: string
  title: string
  body: string
  /** one notification per tag: a newer one replaces it */
  tag: string
  /** about something that waits on you (a task, a coordinator's question): it goes once that no longer waits */
  waits?: true
  url: string
  /** the count for the app icon */
  badge: number
  /** the tags of what still waits on you: alerts with other tags go */
  open: string[]
  /** nothing new: it only takes what no longer waits off the screen, quietly */
  clear?: true
  /** the card a button answers, and the buttons (devices that show them) */
  answer?: { chat: string; question: string }
  actions?: { action: string; title: string }[]
}

/** cut to n characters, keeping its lines, never through an emoji */
const cut = (text: string, n: number) => {
  const chars = Array.from(text)
  return chars.length > n ? `${chars.slice(0, n - 1).join('').trimEnd()}…` : text
}

export function pushPayload(a: Alert, w: { count: number; tags: string[] }): PushPayload {
  const title = a.from === 'Shepherdr' ? a.title : `${a.from}: ${a.title}`
  return {
    id: a.id,
    title: clip(title, TITLE_MAX + 20),
    body: cut(a.body, BODY_MAX),
    tag: a.tag ?? a.id,
    ...(a.tag ? { waits: true as const } : {}),
    url: alertUrl(a.go),
    badge: w.count,
    open: w.tags,
    ...(a.clear ? { clear: true as const } : {}),
    ...(a.card?.choices.length
      ? { answer: { chat: a.card.chat, question: a.card.question }, actions: a.card.choices.map((c) => ({ action: String(c.choice), title: clip(c.label, ACTION_MAX) })) }
      : {}),
  }
}
