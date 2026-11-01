// The demo source: the prototype's fictional world, alive. Answers, merges, reactions and the rest change it the way
// the real thing would, so every screen and case can be walked through without touching real agents.
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apart, asEmoji, artifactQuote, cardMessage, modeCard, nameProblem, slugify, type Action, type ActivityAsk, type AddSpace, type Artifact, type Chat, type FolderEntry, type Folders, type Machine, type Message, type Need, type Place, type Snapshot, type Task, type TaskStatus, type TermScreen, type UpdateCard, type WorktreeAsk } from '../../shared/types.ts'
import { Emitter, type Source, type SourceEvents } from '../source.ts'
import * as D from './data.ts'
import { ARTIFACT_DATA, ARTIFACT_HTML, thumb } from './artifacts.ts'
import { DEMO_PRS, demoWorktree } from './code.ts'
import { demoActivity } from './activity.ts'
import { settingsBlock } from '../common/prompts.ts'
import { CLI_NAME, repositorySection, defaultOf, kindOf } from '../common/settings.ts'
import { harnessProblem, harnessWords, restartClis } from '../common/restart.ts'
import { nextWords } from '../common/trigger.ts'
import { secretPages, Vault } from '../common/secrets.ts'

const DEFAULT_WAYS = { review: defaultOf('brief.review') !== 'off', mustFix: defaultOf('review.mustFix')!, rounds: Number.parseInt(defaultOf('review.rounds')!, 10), merge: defaultOf('brief.merge')!, waitChecks: defaultOf('brief.merge') === 'after GitHub checks' }
const DEFAULT_REVIEWER = { kind: kindOf(defaultOf('reviewer.agent')!)! }
import { excerpt } from '../common/chatlines.ts'
import { TABLE } from '../common/models.ts'
import { Browsers } from '../demo/browser.ts'
import { shortUrl } from '../../shared/browser.ts'
import { deleteSection, moveSpace, newSection, PINNED, renameSection, sectionProblem, setOrder, sortPlaces, type PlaceOrder, type SectionDefs } from '../../shared/order.ts'

let seq = 1000
const id = () => `d${++seq}`

// Claude Code's models and levels as live has them when it can't ask it (models.ts), on Opus at high
const CLAUDE_CONTROLS = () => ({
  models: TABLE.claude.models.map((m) => m.label),
  model: 1,
  efforts: [...TABLE.claude.efforts],
  effort: 2,
})
/** a typed path, the way the demo's made-up folders are named: ~/dev/x, no trailing slash */
function demoPath(path: string) {
  const parts: string[] = []
  for (const seg of path.trim().replace(/^~\/?/, '').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  if (path.trim().startsWith('/')) throw new Error('Choose a folder in your home.')
  return ['~', ...parts].join('/')
}

// as live: other CLIs change model and effort only in their own pickers
const OTHER_CONTROLS = () => ({ models: [], model: 0, efforts: [], effort: 0 })

export class DemoWorld extends Emitter<SourceEvents> implements Source {
  readonly kind = 'demo' as const
  places: Place[] = D.places()
  machines: Machine[] = D.machines()
  /** the sidebar's order the human dragged */
  order: PlaceOrder = {}
  /** the sections the human made in the sidebar */
  groups: SectionDefs = {}
  /** how far you have read each chat: the demo's own messages count as read, what comes after it starts doesn't */
  read: Record<string, number> = { '*': Date.now() + 1000 }
  // every brief ends with its Settings block, as a live one does: HP-204's with two lines changed, one by its
  // coordinator and one by its space
  tasks: Task[] = D.tasks().map((t) => ({ base: 'main', ...(DEMO_PRS[t.id] ? { ...t, pr: DEMO_PRS[t.id] } : t), desc: `${t.desc}\n\n${settingsBlock(t.id, t.id === 'HP-204' ? { ways: { ...DEFAULT_WAYS, rounds: 1, merge: 'ask me first' }, reviewer: DEFAULT_REVIEWER, by: { rounds: 'task', merge: 'space' } } : { ways: DEFAULT_WAYS, reviewer: DEFAULT_REVIEWER })}` }))
  chats: Record<string, Chat> = D.chats()
  asks: Record<string, string> = { ...D.ASKS }
  /** each machine's defaults at their levels, as live */
  stores = D.settingStores()
  /** each place's HEARTBEAT.md as edited here */
  checklists: Record<string, string> = {}
  pluginsOff: string[] = []
  bases: Record<string, string> = Object.fromEntries(this.places.filter((p) => p.level === 2 && !p.id.endsWith(':~')).map((p) => [p.id, 'main']))
  sections = D.settings(this.stores)
  /** agents' secrets, in memory only */
  vault = new Vault('', D.secrets())
  automations = structuredClone(D.AUTOMATIONS)
  artifacts: Artifact[] = D.artifacts()
  /** what each artifact's page sent, by the HTML version it was sent from */
  artifactSent: Record<string, { html: number; text: string }> = {}
  termInput: Record<string, string> = {}
  files: Record<string, () => Blob> = { ...D.FILES }
  /** files uploaded for a chat (chat, newline, path): each can be seen before it is sent */
  private uploaded = new Set<string>()
  /** a real shared browser for the demo's tasks, to review the Browser panel (SHEPHERDR_DEMO_BROWSER=1 and
   *  agent-browser): in its own namespace, its profiles in a temporary folder */
  browsers = process.env.SHEPHERDR_DEMO_BROWSER
    ? new Browsers({
        host: D.DEMO_HOST,
        user: () => 'Elias',
        working: () => false,
        tell: () => undefined,
        env: (task) => ({ AGENT_BROWSER_NAMESPACE: 'shepherdr-demo', AGENT_BROWSER_SESSION: task, AGENT_BROWSER_PROFILE: join(tmpdir(), 'shepherdr-demo', 'browser', task) }),
      })
    : null

  constructor() {
    super()
    // a task's first message is its whole brief, Settings block and all, as a live one's is
    for (const t of D.tasks()) {
      const first = this.chats[`${t.id}/Agent`]?.messages[0]
      const desc = this.tasks.find((x) => x.id === t.id)?.desc
      if (first?.who === 'you' && t.desc && desc && first.text?.includes(t.desc)) first.text = first.text.replace(t.desc, desc)
    }
    // timestamps: Shepherdr's update cards were posted before the messages now in the chats
    let at = 1
    const cards: Record<string, Message[]> = {}
    for (const t of this.tasks.filter((x) => !x.archived && (x.status === 'need' || x.status === 'ready' || x.status === 'done'))) {
      const card: UpdateCard = {
        id: `card-${t.id}`,
        task: t.id,
        status: t.status,
        text: t.status === 'done' ? 'is merged' : t.status === 'ready' ? 'is ready to merge' : `needs you: ${t.sub ?? ''}`,
        pr: t.pr,
      }
      ;(cards[t.place] ??= []).push(cardMessage(card, at++))
    }
    // a working task that went quiet, and a project whose main went red
    const quiet = this.tasks.find((x) => !x.archived && x.status === 'work')
    if (quiet) (cards[quiet.place] ??= []).push(cardMessage({ id: `card-${quiet.id}-stalled`, task: quiet.id, status: 'work', text: 'may be stuck: quiet for 25m' }, at++))
    if (quiet) cards[quiet.place].push(cardMessage({ id: 'card-main-red', red: 'main', text: 'went red: Check failed' }, at++))
    for (const c of Object.values(this.chats)) {
      c.controls = c.cli === 'Claude Code' ? CLAUDE_CONTROLS() : OTHER_CONTROLS()
      c.agent = c.cli === 'Claude Code' ? { kind: 'claude', model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', effort: 'high' } : { kind: kindOf(c.cli) ?? 'codex' }
      for (const m of c.messages) m.at = at++
      if (cards[c.key]) c.messages.unshift(...cards[c.key])
    }
    // a space whose Settings now say another CLI for its coordinator than the one it runs on
    const moved = this.places.find((p) => !p.home && this.chats[p.chat])
    if (moved) this.chats[moved.chat].restart = { on: 'Claude Code', want: 'Codex' }
  }

  /* ---------- adding projects ---------- */

  /** made-up folders: each machine's from the data, plus the ones made here */
  private folderTree: Record<string, Map<string, boolean>> = Object.fromEntries(
    Object.entries(D.FOLDERS).map(([m, fs]) => {
      const tree = new Map<string, boolean>()
      for (const f of fs) {
        const parts = `~/${f.replace(/\*$/, '')}`.split('/')
        for (let i = 2; i < parts.length; i++) if (!tree.has(parts.slice(0, i).join('/'))) tree.set(parts.slice(0, i).join('/'), false)
        tree.set(parts.join('/'), f.endsWith('*'))
      }
      return [m, tree]
    }),
  )

  /** where the projects added here live; the demo's own ones are in ~/dev */
  private addedAt: Record<string, string> = {}

  private projectPath(p: Place) {
    return this.addedAt[p.id] ?? `~/dev/${p.name}`
  }

  /* ---------- a task's worktree (code.ts) ---------- */

  async activity(ask: ActivityAsk) {
    return demoActivity(ask)
  }

  async worktree(ask: WorktreeAsk) {
    return demoWorktree(ask, this.tasks.some((t) => t.id === ask.task && t.agent))
  }

  async folders(machine: string, path: string): Promise<Folders> {
    const tree = this.folderTree[machine]
    if (!tree) throw new Error(machine ? `Can't reach ${machine} right now.` : 'Pick a machine.')
    const at = demoPath(path)
    const added = new Set(this.places.filter((p) => !p.home && p.machine === machine).map((p) => this.projectPath(p)))
    const entry = (p: string): FolderEntry => ({ name: p.split('/').pop()!, path: p, repo: !!tree.get(p), added: added.has(p) || undefined })
    const kids = [...tree.keys()].filter((p) => p.startsWith(`${at === '~' ? '~' : at}/`) && !p.slice(at.length + 1).includes('/'))
    const exists = at === '~' || tree.has(at)
    const repo = [...tree.entries()].find(([p, r]) => r && (at === p || at.startsWith(`${p}/`)))?.[0] ?? null
    const entries = kids.map(entry).sort((a, b) => Number(b.repo) - Number(a.repo) || a.name.localeCompare(b.name))
    return {
      path: at,
      exists,
      dir: exists,
      repo,
      added: (repo && added.has(repo)) || undefined,
      entries,
      likely: at === '~' ? [...tree.entries()].filter(([p, r]) => r && !added.has(p)).map(([p]) => entry(p)) : undefined,
    }
  }

  async addSpace(req: AddSpace): Promise<{ place: string }> {
    const tree = this.folderTree[req.machine]
    if (!tree) throw new Error(`Can't reach ${req.machine} right now.`)
    const at = demoPath(req.path)
    if (at === '~') throw new Error('Pick or name a folder inside your home, not home itself.')
    const info = await this.folders(req.machine, at)
    if (!info.repo && !req.create) throw new Error(`${at} is not a git repository`)
    if (req.create) {
      const parts = at.split('/')
      for (let i = 2; i <= parts.length; i++) if (!tree.has(parts.slice(0, i).join('/'))) tree.set(parts.slice(0, i).join('/'), false)
      tree.set(at, true)
    }
    const name = (req.name ?? '').trim() || slugify((info.repo ?? at).split('/').pop()!)
    const bad = nameProblem(name, this.places.filter((p) => p.machine === req.machine).map((p) => p.name))
    if (bad) throw new Error(bad)
    const id = `p:${req.machine}:${name}`
    // the snapshot sorts it among its machine's others
    this.places = [...this.places, { id, name, machine: req.machine, level: 2, status: 'idle', mode: 'regular', chat: id, githubRemote: false }]
    this.addedAt[id] = info.repo ?? at
    this.chats[id] = { key: id, cli: 'Claude Code', messages: [], controls: CLAUDE_CONTROLS() }
    this.emit('snapshot')
    return { place: id }
  }

  /* ---------- reading ---------- */

  /** what waits on the human: each chat's open cards, and a task that waits with none */
  private needs(): Need[] {
    const open = (chat: string, place: string, task?: string): Need[] => (this.chats[chat]?.messages ?? []).flatMap((m) => m.question && m.question.sent === undefined && !m.question.closed
      ? [{ id: m.question.id, chat, place, task, at: m.at ?? 0, question: m.question, tap: m.question.kind !== 'Plan' && !m.question.title.startsWith('Merge ') }] : [])
    const waits = (chat: string, place: string, task: string | undefined, text?: string): Need[] => {
      const cards = open(chat, place, task)
      return cards.length ? cards : [{ id: 'attention', chat, place, task, at: 0, text }]
    }
    return [
      ...this.places.flatMap((p) => (this.asks[p.id] ? waits(p.chat, p.id, undefined) : open(p.chat, p.id))),
      ...this.tasks.filter((t) => t.status === 'need' && !t.archived).flatMap((t) => waits(t.agent?.chat ?? `${t.id}/Agent`, t.place, t.id, t.sub)),
      ...this.tasks.filter((t) => t.status === 'ready' && !t.archived).flatMap((t) => open(t.agent?.chat ?? `${t.id}/Agent`, t.place, t.id)),
    ].sort((a, b) => a.at - b.at)
  }

  snapshot(): Snapshot {
    return {
      name: 'Shepherdr',
      host: D.DEMO_HOST,
      ...sortPlaces(this.places, this.machines, this.order, this.groups),
      tasks: this.tasks.map((t) => (t.status === 'done' ? t : { ...t, browser: this.browsers?.status() ?? { ready: false, hint: 'The demo has no browser: start it with SHEPHERDR_DEMO_BROWSER=1.' } })),
      automations: this.automations,
      artifacts: this.artifacts,
      asks: this.asks,
      needs: this.needs(),
      last: this.last(),
      read: this.read,
      settings: secretPages([...this.sections, ...Object.entries(this.bases).map(([id, base]) => repositorySection(id, id.split(':')[1], base))], this.vault.names()),
      demo: true,
      user: 'Elias',
    }
  }

  /** when each coordinator's chat last had something from it or Shepherdr (tasks' chats count for nothing here) */
  private last() {
    const out: Record<string, number> = {}
    for (const c of Object.values(this.chats)) {
      if (c.key.includes('/')) continue
      const at = c.messages.findLast((m) => m.who === 'agent')?.at
      if (at) out[c.key] = at
    }
    return out
  }

  /** the spaces a space's lists show: its own; a home space's machine's; the main machine's every one */
  private subtree(id: string) {
    const p = this.places.find((x) => x.id === id)
    return this.places.filter((x) => x.id === id || p?.level === 0 || (p?.level === 1 && x.machine === p.machine)).map((x) => x.id)
  }

  private placeStatus(p: Place): Place['status'] {
    if (p.unreachableSince) return 'off'
    const sub = this.subtree(p.id)
    const ts = this.tasks.filter((t) => sub.includes(t.place) && !t.archived)
    if (ts.some((t) => t.status === 'need') || sub.some((x) => this.asks[x])) return 'need'
    if (ts.some((t) => t.status === 'ready')) return 'ready'
    if (ts.some((t) => t.status === 'work' || t.status === 'merging')) return 'work'
    return 'idle'
  }

  chat(key: string) {
    // an agent nobody has written to yet still has a chat: an empty one
    if (!this.chats[key] && key.includes('/')) this.chats[key] = { key, cli: this.cliOf(key), messages: [], controls: this.cliOf(key) === 'Claude Code' ? CLAUDE_CONTROLS() : OTHER_CONTROLS() }
    return this.chats[key]
  }

  private cliOf(key: string) {
    return this.task(key.split('/')[0])?.agent?.cli ?? 'Claude Code'
  }

  private art(aid: string) {
    return this.artifacts.find((a) => a.id === aid)
  }

  async artifact(aid: string, v?: number) {
    const a = this.art(aid)
    const ver = a?.versions.find((x) => x.n === (v ?? a.v))
    const html = ver && ARTIFACT_HTML[aid]?.[ver.html]
    if (!a || !ver || !html) return undefined
    // its data: the newest at or before that version
    const data = Object.entries(ARTIFACT_DATA[aid] ?? {}).filter(([n]) => Number(n) <= ver.n).pop()?.[1]
    const sent = this.artifactSent[aid]?.html === ver.html ? this.artifactSent[aid].text : undefined
    return { html, data, sent }
  }

  async artifactThumb(aid: string, dark: boolean) {
    return this.art(aid) ? thumb(aid, dark) : null
  }

  watch(_chats: string[], terms: string[]) {
    for (const k of terms) this.emit('terminal', k, this.screen(k))
  }

  async upload(chat: string, name: string, data: Uint8Array) {
    const path = `~/inbox/${Date.now().toString(36)}-${name.replace(/[^a-zA-Z0-9_. -]+/g, '_')}`
    const blob = new Blob([new Uint8Array(data)])
    this.files[path] = () => blob
    this.uploaded.add(`${chat}\n${path}`)
    return path
  }

  async attachment(chat: string, path: string) {
    // one attached in this chat, or uploaded for it and still waiting in the message box
    if (!this.uploaded.has(`${chat}\n${path}`) && !this.chats[chat]?.messages.some((m) => m.file?.path === path)) return null
    return this.files[path]?.() ?? null
  }

  /* ---------- helpers ---------- */

  private task(tid: string) {
    return this.tasks.find((t) => t.id === tid)
  }

  private push(key: string, ...msgs: Omit<Message, 'id'>[]) {
    const c = (this.chats[key] ??= { key, cli: 'Claude Code', messages: [], controls: CLAUDE_CONTROLS() })
    // what is sent together shares its time, as in a live chat: the pictures in it sit side by side
    const at = Date.now() + seq
    // an artifact sent with words is a message of its own, as in a live chat
    for (const m of msgs) c.messages.push(...apart([{ id: id(), at, ...m }]))
    this.emit('chat', key)
    // something new from its agent: unread where it isn't on screen
    if (msgs.some((m) => m.who === 'agent')) this.emit('snapshot')
  }

  private setTask(tid: string, status: TaskStatus, sub: string) {
    const t = this.task(tid)
    if (!t) return
    // done: a small card says so in its project's chat
    if (status === 'done' && t.status !== 'done') {
      const card: UpdateCard = { id: `card-${t.id}`, task: t.id, status, text: 'is merged', pr: t.pr }
      const messages = this.chats[t.place]?.messages ?? [], row = messages.find((m) => m.card?.task === t.id)
      if (row) row.card = card
      else messages.push(cardMessage(card, Date.now() + seq))
      this.emit('chat', t.place)
    }
    // done: it finished now, so it tops its Done group
    if (status === 'done' && t.status !== 'done') Object.assign(t, { doneAt: Date.now(), age: 'now' })
    if (status !== 'done') t.doneAt = undefined
    t.status = status
    t.sub = sub
    t.state = D.STATE_LABEL[status]
    if (t.agent) t.agent = { ...t.agent, status }
    // what its agent reported: frozen while it waits on you, gone once the job is done
    if (t.report) t.report = status === 'work' || status === 'need' ? { ...t.report, paused: status === 'need' || undefined } : undefined
    this.emit('snapshot')
  }

  /** an agent on its CLI's own menu, or a machine out of reach: what you send waits (a busy agent takes it at once) */
  private held(key: string) {
    const place = this.places.find((p) => p.chat === key)
    if (place) return !!place.unreachableSince
    const g = this.task(key.split('/')[0])?.agent
    return g?.status === 'need' && !!this.chats[key]?.messages.some((m) => m.question?.asks && m.question.sent === undefined)
  }

  /** a Claude Code pane 100 cells wide, as herdr reads it: full-width rulers, lines that never pass the edge */
  private screen(key: string): TermScreen {
    const cols = 100
    const c = this.chats[key]
    const you = c?.messages.filter((m) => m.who === 'you').at(-1)
    const ag = c?.messages.filter((m) => m.who === 'agent' && m.text).at(-1)
    const task = key.includes('/')
    const [tid, role] = key.split('/')
    const name = task ? `${tid} ${role.toLowerCase()}` : (this.places.find((p) => p.chat === key)?.name ?? key)
    const d = (s: string) => `\x1b[38;5;243m${s}\x1b[0m`
    const g = (s: string) => `\x1b[38;2;61;214;140m${s}\x1b[0m`
    const y = (s: string) => `\x1b[38;2;245;181;68m${s}\x1b[0m`
    const plain = (s = '') => s.replace(/```[\s\S]*?```/g, '').replace(/[`*]/g, '').replace(/\n+/g, ' ').trim()
    // a long line goes on at the next row, as the terminal wraps it
    const wrap = (first: string, text: string) => {
      const rows: string[] = []
      for (let rest = text, lead = first; rest; lead = '  ') {
        rows.push(lead + rest.slice(0, cols - 2))
        rest = rest.slice(cols - 2)
      }
      return rows
    }
    const rule = d('─'.repeat(cols))
    const lines = [
      d(`✻ ${name} · ${c?.cli ?? 'Claude Code'} · herdr pane`),
      '',
      ...wrap(`${d('>')} `, you?.text ?? '(waiting for you)'),
      '',
      `${g('●')} Read ${task ? 'src/webhooks/verify.ts (84 lines)' : 'board state (6 agents)'}`,
      `${g('●')} Bash ${task ? 'npm test' : 'herdr agent list'}`,
      `  ${d(`⎿ ${task ? '42 passed' : '2 need you · 3 working'}`)}`,
      ...wrap(`${g('●')} `, plain(ag?.text)),
      '',
      rule,
      `${y('>')} ${this.termInput[key] ?? ''}\x1b[7m \x1b[0m`,
      rule,
      `  ${d('⏵⏵ bypass permissions on (shift+tab to cycle)')}`,
    ]
    return { ansi: lines.join('\n'), cols, rows: 30 }
  }

  /* ---------- acting ---------- */

  browser(task: string, out: { send(d: string): void; close(): void; buffered?(): number }) {
    if (!this.browsers) {
      out.send(JSON.stringify({ type: 'error', message: 'The demo has no browser.' }))
      out.close()
      return { message() {}, end() {} }
    }
    return this.browsers.attach(task, out)
  }

  async act(a: Action): Promise<unknown> {
    switch (a.type) {
      case 'send': {
        const at = Date.now()
        const waiting = this.held(a.chat) || undefined
        const waitsFor = waiting && a.chat.includes('/') ? ('menu' as const) : undefined
        const cid = a.cid
        const to = a.reply ? this.chats[a.chat]?.messages.find((x) => x.id === a.reply) : undefined
        const art = to && !to.text && !to.file && to.artifact ? this.art(to.artifact.id) : undefined
        const reply =
          to &&
          (art
            ? { id: to.id, who: to.who, text: artifactQuote(art.title, to.artifact!.v), artifact: true }
            : { id: to.id, who: to.who, text: to.text ? excerpt(to.text, 160) : (to.file?.name ?? ''), ...(to.text ? {} : { file: true }) })
        const files = (a.attachments ?? []).map((p, i) => ({
          who: 'you' as const,
          file: { name: p.split('/').pop()!.replace(/^[a-z0-9]+-/, ''), path: p },
          waiting,
          waitsFor,
          cid,
          reply: !i && !a.text ? reply : undefined,
        }))
        // your words answer the choice cards still open there, as in the real one (not a plan, nor the CLI's own question)
        for (const m of this.chats[a.chat]?.messages ?? []) {
          const q = m.question
          if (!q || q.asks || q.kind === 'Plan' || q.sent !== undefined) continue
          Object.assign(q, { sent: -1, said: a.text.trim() || undefined, via: 'chat' })
          for (const [pl, qid] of Object.entries(this.asks)) if (qid === q.id) delete this.asks[pl]
        }
        this.push(a.chat, ...(a.text ? [{ who: 'you' as const, text: a.text, waiting, waitsFor, cid, reply }] : []), ...files)
        // a To do task's agent decides from your words: a go sets it to work, a change to its brief leaves it waiting
        const todo = this.task(a.chat.split('/')[0])
        // a queued task: any message is the go, it waits for nothing more
        if (todo?.status === 'queued')
          setTimeout(() => {
            todo.after = undefined
            this.push(a.chat, { who: 'agent', text: 'Starting now.' })
            this.setTask(todo.id, 'work', 'Reading the code')
          }, 800)
        if (todo?.status === 'todo')
          setTimeout(() => {
            const text = a.text ?? ''
            if (!/\b(go|start)\b/i.test(text) || /\b(don'?t|not yet|wait)\b/i.test(text)) return this.push(a.chat, { who: 'agent', text: 'Noted. I’ll keep waiting for your go.' })
            this.push(a.chat, { who: 'agent', text: 'On it.' })
            this.setTask(todo.id, 'work', 'Reading the code')
          }, 800)
        return { waiting: !!waiting, waitsFor, at }
      }
      case 'react': {
        const m = this.chats[a.chat]?.messages.find((x) => x.id === a.message)
        if (!m) return {}
        const rx = (m.reactions ??= [])
        const i = rx.findIndex((r) => r.emoji === a.emoji)
        const w = i >= 0 ? rx[i].by : undefined
        const next = w === 'me' ? undefined : w === 'them' ? 'both' : w === 'both' ? 'them' : 'me'
        if (i >= 0) rx.splice(i, 1)
        if (next) rx.splice(i >= 0 ? i : rx.length, 0, { emoji: a.emoji, by: next, pending: next !== 'them' && this.held(a.chat) ? true : undefined })
        this.emit('chat', a.chat)
        return {}
      }
      case 'answer':
        return this.answer(a)
      case 'secret': {
        const r = this.vault.set(a.level, a.name, a.value === null ? null : a.value.replace(/[\r\n]+$/, ''))
        if (!r.ok) return r
        // the card that asked for it says where it is kept, and the chat shows what you gave: its name
        const m = a.card && this.chats[a.card.chat]?.messages.find((x) => x.secret?.id === a.card!.id)
        if (a.card && m?.secret && a.value !== null) {
          const where = m.secret.levels.find((l) => l.id === a.level)?.label ?? a.level
          m.secret = { ...m.secret, saved: where }
          this.push(a.card.chat, { who: 'you', answered: 'Gave a secret', text: `${a.name}, for ${where}` })
          setTimeout(() => this.push(a.card!.chat, { who: 'agent', text: `Thanks: ${a.name} is in. Posting the release notes now.` }), 900)
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'artifact-send':
      case 'artifact-say':
      case 'artifact-note': {
        const art = this.art(a.artifact)
        if (!art) return { ok: false, error: 'That artifact is gone.' }
        // its keeper: the agent's chat while it has a task, else the place's coordinator
        const key = Object.values(this.chats).find((c) => c.key.includes('/') && c.messages.some((m) => m.artifact?.id === art.id))?.key ?? art.place
        if (a.type === 'artifact-send') {
          this.artifactSent[art.id] = { html: art.versions[0].html, text: a.text }
          this.push(key, { who: 'you', answered: `Sent from "${art.title}"`, text: a.text })
        } else if (a.type === 'artifact-note') this.push(key, { who: 'you', text: `[note on ${a.target ? `${a.target} in "${art.title}"` : `"${art.title}"`}] ${a.note}` })
        else {
          this.push(key, { who: 'you', answered: `About "${art.title}"`, text: a.text })
          // the agent takes it and comes back with a new version, as a real one would
          setTimeout(() => this.push(key, { who: 'agent', text: 'On it.' }), 900)
          setTimeout(() => {
            const n = art.v + 1
            art.v = n
            art.at = Date.now()
            art.when = 'now'
            art.versions.unshift({ n, when: 'now', by: art.by, note: a.text.slice(0, 40), html: art.versions[0].html })
            const extra = ARTIFACT_DATA[art.id]
            if (extra) extra[n] = extra[n - 1]
            this.push(key, { who: 'agent', text: 'Done: the new version is in.', artifact: { id: art.id, v: n } })
            this.emit('snapshot')
          }, 3200)
        }
        return { to: art.keeper }
      }
      case 'browser-notes': {
        // as the live chat shows them: each element and its note
        this.push(a.chat, { who: 'you', text: [`Notes in the browser on ${shortUrl(a.url)}:`, ...a.notes.map((n, i) => `${i + 1}. ${n.pick.element}: ${n.comment}`)].join('\n') })
        return {}
      }
      case 'artifact-delete': {
        this.artifacts = this.artifacts.filter((x) => x.id !== a.artifact)
        this.emit('snapshot')
        return {}
      }
      case 'autopilot-run':
        this.emit('snapshot'); return { ok: true }
      case 'mode': {
        const p = this.places.find((x) => x.id === a.place)
        if (!p || p.mode === a.mode) return {}
        p.mode = a.mode
        // a small card in its chat marks when the mode began
        const chat = this.chats[p.chat]
        if (chat) {
          chat.messages.push(cardMessage(modeCard(`mode-${id()}`, a.mode), Date.now() + seq))
          this.emit('chat', p.chat)
        }
        this.emit('snapshot')
        return {}
      }
      case 'model':
      case 'effort':
        return { ok: false, error: 'Use the + menu agent controls and Restart to apply model or effort changes. Chat and work are preserved.' }
      case 'text':
        this.termInput[a.chat] = (this.termInput[a.chat] ?? '') + a.text
        this.emit('terminal', a.chat, this.screen(a.chat))
        return {}
      case 'keys': {
        for (const k of a.keys) {
          const now = this.termInput[a.chat] ?? ''
          if (k === 'backspace') this.termInput[a.chat] = now.slice(0, -1)
          else if (k === 'enter' && now.trim()) {
            this.termInput[a.chat] = ''
            this.push(a.chat, { who: 'you', text: now.trim() })
          } else if (k === 'ctrl+c' || k === 'esc') this.termInput[a.chat] = ''
        }
        this.emit('terminal', a.chat, this.screen(a.chat))
        return {}
      }
      case 'call': {
        if (a.on) setTimeout(() => this.push(a.chat, { who: 'you', text: 'Also ping me when CI is green.' }, { who: 'agent', text: 'Will do.' }), 1500)
        return {}
      }
      case 'automation': {
        const list = (this.automations[a.place] ??= [])
        const x = list.find((y) => y.name === a.name)
        if (!x) return { ok: false, error: `No automation “${a.name}” here` }
        if (a.op === 'remove') this.automations[a.place] = list.filter((y) => y !== x)
        else if (a.op === 'run') x.runs = [{ at: Date.now(), task: `GTM-${50 + x.runs.length}` }, ...x.runs]
        else {
          x.on = a.op === 'resume'
          x.next = x.on && x.time ? nextWords(x.time, D.DEMO_ZONE) : []
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'setting': {
        if (a.key === 'space.base') {
          if (!a.place || !(a.place in this.bases) || !a.value?.trim() || /[\s~^:?*\[\\]/.test(a.value)) return { ok: false, error: 'Choose a branch name.' }
          this.bases[a.place] = a.value
          this.emit('snapshot')
          return { ok: true }
        }
        // a plugin's switch: on at once here (a real install restarts with it)
        if (a.key.startsWith('plugin.')) {
          const name = a.key.slice('plugin.'.length)
          this.pluginsOff = a.value === 'off' ? [...this.pluginsOff.filter((n) => n !== name), name] : this.pluginsOff.filter((n) => n !== name)
          this.sections = D.settings(this.stores, this.checklists, this.pluginsOff)
          this.emit('snapshot')
          return { ok: true }
        }
        if (a.key === 'heartbeat.md') {
          if (!a.place) return { ok: false, error: 'No such space.' }
          this.checklists[a.place] = a.value ?? ''
          this.sections = D.settings(this.stores, this.checklists, this.pluginsOff)
          this.emit('snapshot')
          return { ok: true }
        }
        // set at its level, on its machine; Everywhere is every machine's
        const [kind, machine, space] = (a.place ?? 'all').split(':')
        const level = kind === 'p' ? { space } : kind === 'm' ? ('machine' as const) : ('all' as const)
        const on = kind === 'all' ? Object.values(this.stores) : [this.stores[machine as keyof typeof this.stores]].filter(Boolean)
        for (const st of on) {
          const r = st.set(a.key, a.value, level)
          if (!r.ok) return r
        }
        this.sections = D.settings(this.stores, this.checklists, this.pluginsOff)
        this.emit('snapshot')
        return {}
      }
      case 'archive': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        t.archived = a.on ? Date.now() : undefined
        // archiving a working one stops its agent first
        if (a.on && t.status === 'work') Object.assign(t, { status: 'need', sub: 'Stopped', report: undefined })
        t.state = a.on ? 'Archived · just now' : D.STATE_LABEL[t.status]
        if (a.on) t.age = 'now'
        if (a.on) t.pinned = undefined
        this.emit('snapshot')
        return { ok: true }
      }
      case 'pin': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        t.pinned = a.on && !t.archived ? Date.now() : undefined
        this.emit('snapshot')
        return { ok: true }
      }
      case 'restart-info': {
        const c = this.chat(a.chat)
        const t = this.task(a.chat.split('/')[0])
        const on = kindOf(c?.cli ?? '') ?? 'claude'
        const want = c?.restart ? (kindOf(c.restart.want) ?? on) : on
        return { ok: true, info: { role: a.chat.includes('/') ? 'task' : 'coordinator', space: this.places.find((p) => p.id === (t?.place ?? a.chat))?.name, on: c?.agent ?? { kind: on }, onWords: harnessWords(c?.agent ?? { kind: on }), want: { kind: want }, clis: restartClis(['claude', 'codex', 'pi']), working: t?.status === 'work' } }
      }
      case 'restart': {
        const c = this.chat(a.chat)
        if (!c) return { ok: false, error: 'No such chat.' }
        const kind = a.kind ?? (c.restart ? kindOf(c.restart.want) : undefined) ?? kindOf(c.cli) ?? 'claude'
        const problem = harnessProblem({ kind, model: a.model, effort: a.effort })
        if (problem) return { ok: false, error: problem }
        const words = harnessWords({ kind, model: a.model, effort: a.effort })
        c.agent = { kind, model: a.model, effort: a.effort, speed: a.speed || undefined }
        c.cli = CLI_NAME[kind] ?? kind
        c.restart = undefined
        c.messages.push(cardMessage({ id: `restart-${id()}`, restart: true, text: `Restarted on ${words}` }, Date.now() + seq))
        this.emit('chat', a.chat)
        return { ok: true, on: words }
      }
      case 'pause': {
        const t = this.task(a.chat.split('/')[0])
        if (!t || t.status !== 'work') return { ok: false, error: 'It isn’t working.' }
        Object.assign(t, { status: 'todo', sub: '', report: undefined, state: 'To do · paused just now' })
        this.emit('snapshot')
        return { ok: true }
      }
      case 'close': {
        const t = this.task(a.chat.split('/')[0])
        if (!t || t.status === 'done') return { ok: false, error: 'It is done already.' }
        // a task at work or waiting holds work on its branch: asked about once, as the real one is
        if (!a.force && t.status !== 'todo' && t.status !== 'queued') return { ok: false, held: [`work on ${t.branch ?? 'its branch'} that main lacks`] }
        Object.assign(t, { status: 'done', sub: 'Nothing to merge', report: undefined, state: 'Done · nothing to merge · just now', age: 'now', doneAt: Date.now() })
        this.emit('snapshot')
        return { ok: true }
      }
      case 'space-remove': {
        const pr = this.places.find((p) => p.id === a.place)
        if (pr?.home) return { ok: false, error: `${pr.name} is ${pr.machine}'s home space: it can be renamed, not removed.` }
        if (!pr) return { ok: false, error: 'That space is gone already.' }
        const working = this.tasks.filter((t) => t.place === pr.id && !t.archived && t.status === 'work').map((t) => t.id)
        if (working.length) return { ok: false, error: `${working.join(', ')} ${working.length > 1 ? 'are' : 'is'} still working: pause or finish ${working.length > 1 ? 'them' : 'it'} first.` }
        // its tasks go with it (the live one keeps them, for when it is added again)
        this.places = this.places.filter((p) => p !== pr)
        this.tasks = this.tasks.filter((t) => t.place !== pr.id)
        delete this.addedAt[pr.id]
        this.emit('snapshot')
        return { ok: true }
      }
      case 'read': {
        for (const [k, at] of Object.entries(a.chats)) if (k !== '*' && at > (this.read[k] ?? 0)) this.read[k] = at
        this.emit('snapshot')
        return { ok: true }
      }
      case 'rename': {
        if (this.groups[a.id] || a.id === PINNED) {
          const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
          const bad = emoji === null ? 'One emoji at a time.' : renameSection(this.groups, a.id, a.name.replace(/\s+/g, ' ').trim(), emoji)
          if (bad) return { ok: false, error: bad }
          this.emit('snapshot')
          return { ok: true }
        }
        const m = this.machines.find((x) => x.id === a.id)
        const p = this.places.find((x) => x.id === a.id)
        const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
        if (emoji === null || (emoji !== undefined && !m)) return { ok: false, error: 'Only a machine takes an emoji, one at a time.' }
        if (m) {
          m.name = a.name.trim() || m.machine
          if (emoji) m.emoji = emoji
          else if (emoji === '') delete m.emoji
        } else if (!p) return { ok: false, error: 'Nothing to rename.' }
        else {
          const name = a.name.trim() || (p.home ? 'home' : p.id.split(':').at(-1)!)
          const bad = nameProblem(name, this.places.filter((x) => x.machine === p.machine && x !== p).map((x) => x.name))
          if (bad) return { ok: false, error: bad }
          p.name = name
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'order': {
        setOrder(this.order, a.under, a.ids)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'move': {
        const bad = moveSpace(this.order, this.groups, this.places, this.machines, a.id, a.to, a.before)
        if (bad) return { ok: false, error: bad }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'section': {
        if (a.op === 'delete') deleteSection(this.groups, this.order, a.id)
        else {
          const name = a.name.replace(/\s+/g, ' ').trim()
          const emoji = a.emoji === undefined ? '' : asEmoji(a.emoji)
          const bad = emoji === null ? 'One emoji at a time.' : sectionProblem(this.groups, name, a.machine || undefined)
          if (bad) return { ok: false, error: bad }
          const id = newSection(this.groups, this.order, { name, ...(emoji ? { emoji } : {}), ...(a.machine ? { machine: a.machine } : {}) }, this.machines)
          this.emit('snapshot')
          return { ok: true, id }
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'delete': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        // a task not finished holds work on its branch: refused once, as the real one is
        if (!a.force && t.status !== 'done') return { ok: false, held: [`work on ${t.branch ?? 'its branch'} that main lacks`] }
        this.tasks.splice(this.tasks.indexOf(t), 1)
        this.emit('snapshot')
        return { ok: true }
      }
    }
  }

  private answer(a: Extract<Action, { type: 'answer' }>) {
    const c = this.chats[a.chat]
    const msg = c?.messages.find((m) => m.question?.id === a.question)
    const q = msg?.question
    if (!c || !q || q.sent !== undefined) return { ok: false }
    if (q.noteRequiredFor !== undefined && a.choice === q.noteRequiredFor && !a.note) return { ok: false, error: 'A note is needed to send it back.' }
    q.sent = a.choice
    const label = a.other || q.choices[a.choice]?.label || ''
    if (q.asks) {
      // a CLI's own question: the card goes once answered, and what waited goes in after the answer
      c.messages = c.messages.filter((m) => m !== msg)
      const waiting = c.messages.filter((m) => m.waiting)
      c.messages = c.messages.filter((m) => !m.waiting)
      this.push(a.chat, { who: 'you', answered: `Answered “${q.title}”`, text: label, reactions: [{ emoji: '👍', by: 'them' }] }, { who: 'agent', text: D.REPLIES[q.id] ?? 'Thanks.' })
      void waiting
    } else {
      this.push(a.chat, { who: 'you', answered: `Answered “${q.title}”`, text: label + (a.note ? `\n${a.note}` : ''), reactions: [{ emoji: '👍', by: 'them' }] }, { who: 'agent', text: D.REPLIES[q.id] ?? 'Thanks.' })
    }
    for (const [pl, qid] of Object.entries(this.asks)) if (qid === q.id) delete this.asks[pl]
    if (q.id === 'f2') this.setTask('GTM-15', a.choice === 0 ? 'done' : 'ready', this.task('GTM-15')?.sub ?? '')
    if (q.id === 'f4') this.setTask('GTM-14', 'work', 'Carrying on')
    if (q.id === 'f5') this.setTask('LV-3', 'work', 'Writing the upload route')
    if (q.id === 'f6') this.setTask('GTM-16', 'work', a.choice === 0 ? 'Building it now' : 'Rewriting the plan')
    if (q.id === 'f7') this.setTask('LV-4', 'work', 'Building the devices list')
    this.emit('snapshot')
    return { ok: true }
  }
}
