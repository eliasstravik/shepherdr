// The demo: `bun web/demo/serve.ts [port]` serves the built app (web/dist) with a fictional day instead of the service,
// on 127.0.0.1 only. For looking at every screen and comparing it with the design; nothing is wired to a real agent.
// `?case=empty` and `?case=down` in the page's address show "Nothing yet" and "Can't reach vm"; `?case=more` adds a
// third warning (the warnings line coming back after it was closed); `?case=long` gives spaces, tasks and pages long names;
// `?case=one` and `?case=five` show one machine only and five.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Chat, Message, Snapshot, Task } from '../shared/types.ts'
import { withLinks } from '../../service/artifact-links.ts'
import { artifacts, catalog, chats as seed, config, EV, snapshot } from './data.ts'

const dist = join(fileURLToPath(new URL('../', import.meta.url)), 'dist')
const port = Number(process.argv[2] || 7799)
type Sock = { send(s: string): void; data: { mode: 'normal' | 'empty' | 'down' | 'more' | 'long' | 'one' | 'five'; watch: string[]; app?: string } }
const socks = new Set<Sock>()
const state = { normal: structuredClone(snapshot('normal')), empty: structuredClone(snapshot('empty')), down: structuredClone(snapshot('down')), more: structuredClone(snapshot('more')), long: structuredClone(snapshot('long')), one: structuredClone(snapshot('one')), five: structuredClone(snapshot('five')) }
const chats: Record<string, Chat> = structuredClone(seed)
let n = 1000
function resetDemo() {
  for (const mode of ['normal', 'empty', 'down', 'more', 'long', 'one', 'five'] as const) state[mode] = structuredClone(snapshot(mode))
  for (const key of Object.keys(chats)) delete chats[key]
  Object.assign(chats, structuredClone(seed))
  n = 1000
}

const push = () => socks.forEach((s) => s.send(JSON.stringify({ type: 'snapshot', snapshot: state[s.data.mode] })))
/** your reaction toggles, as the real service's: the agent's own stays (the same emoji from both: 'both') */
function toggled(list: NonNullable<Message['reactions']>, emoji: string): NonNullable<Message['reactions']> {
  const out = list.flatMap((r) => (r.emoji !== emoji ? [r] : r.by === 'both' ? [{ ...r, by: 'them' as const }] : r.by === 'me' ? [] : [r]))
  if (list.some((r) => r.emoji === emoji && (r.by === 'me' || r.by === 'both'))) return out
  return out.some((r) => r.emoji === emoji) ? out.map((r) => (r.emoji === emoji ? { ...r, by: 'both' as const } : r)) : [...out, { emoji, by: 'me' }]
}
const pushChat = (key: string) => socks.forEach((s) => s.data.watch.includes(key) && s.send(JSON.stringify({ type: 'chat', chat: chatFor(s, key) })))
const chatFor = (s: Sock, key: string): Chat => {
  if (s.data.mode === 'empty') return { key, messages: chats[key]?.messages.filter((m) => m.id.startsWith('n')) ?? [], cli: 'claude', top: true, agent: chats[key]?.agent ?? chats[EV]!.agent }
  let chat = chats[key] ?? { key, messages: [], cli: 'claude' as const, top: true, agent: chats[EV]!.agent }
  // a link to the app itself (APP/?artifact=…) gets this page's own address, as `herdr-artifact link` prints it (SHEP-339)
  if (s.data.app) chat = { ...chat, messages: chat.messages.map((m) => (m.text?.includes('APP/') ? { ...m, text: m.text.replaceAll('APP/', s.data.app!) } : m)) }
  return s.data.mode === 'down' ? { ...chat, messages: chat.messages.map(({ suggest, suggests, ...m }) => m) } : chat
}
const each = (f: (snap: Snapshot) => void) => { for (const s of Object.values(state)) f(s); push() }
const taskOf = (id: string) => state.normal.tasks.find((t) => t.id === id || `${t.id}/worker` === id)
const patchTask = (id: string, p: Partial<Task>) => each((snap) => { snap.tasks = snap.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) })
const uploaded = new Map<string, File>()
const say = (key: string, m: Partial<Message>) => { (chats[key] ??= { key, messages: [], cli: 'claude', top: true }).messages.push({ id: `n${++n}`, who: 'agent', at: Date.now(), ...m } as Message); pushChat(key) }

const analytics = { on: true, noted: false }
let demoVoiceKey = ''

const H = 3600_000
function demoAnalytics(days: number) {
  const k = days === 1 ? 0.2 : days === 30 ? 4 : 1
  const r = (x: number) => Math.round(x * k)
  return {
    days, events: r(412), on: analytics.on, unreached: [],
    app: { opened: r(38), devices: { phone: r(24), desktop: r(14) } },
    messages: { sent: r(126), how: { typed: r(71), dictated: r(33), bubble: r(19), talk: r(3) }, failed: r(1) },
    questions: { answered: r(17) },
    tasks: { added: r(21), started: r(20), ready: r(19), sent_back: r(4), done: r(16), reopened: r(1), removed: 0 },
    waits: { ready_for_review: { n: 16, avg_ms: 3.1 * H, median_ms: 1.2 * H }, needs_you: { n: 9, avg_ms: 0.4 * H, median_ms: 0.2 * H }, blocked: { n: 3, avg_ms: 0.9 * H, median_ms: 0.5 * H }, before_start: null, working: null },
    agents: [{ agent: 'claude', model: 'opus', effort: 'medium', tasks: r(14) }],
    errors: { send_failed: r(1), link_lost: r(2) },
    text: '',
  }
}
function demoEvents() {
  const t = Date.now()
  return [
    { t: t - 5 * H, e: 'app.opened', device: 'phone' },
    { t: t - 4.9 * H, e: 'message.sent', chat: 'shop', how: 'dictated' },
    { t: t - 4 * H, e: 'task.ready', task: 'SHOP-14', space: 'shop', agent: 'claude', model: 'opus', effort: 'medium', worked_ms: 42 * 60_000 },
    { t: t - 1 * H, e: 'task.done', task: 'SHOP-14', space: 'shop', merged: true, wait_ms: 3 * H, machine: 'mini' },
    { t: t - 0.5 * H, e: 'message.sent', chat: 'SHOP-15/worker', how: 'bubble' },
  ]
}

function action(a: Record<string, any>): unknown {
  if (a.type === 'screen') {
    if (a.op === 'handback' || a.op === 'skip') each((snap) => { const screen = snap.screens?.[a.key]; if (screen?.hands) screen.hands.settled = a.op === 'skip' ? 'skip' : 'done' })
    return { ok: true }
  }
  // Settings › Voice: the key kept by name only, and its test (a key with "bad" in it is refused)
  if (a.type === 'secret' && typeof a.name === 'string') {
    if (a.name === 'ELEVENLABS_API_KEY') demoVoiceKey = a.value === null ? '' : String(a.value)
    each((snap) => { if (!snap.config) return; snap.config.secrets = snap.config.secrets.filter((x) => !(x.name === a.name && x.scope === a.level)); if (a.value !== null) snap.config.secrets.push({ name: a.name, scope: a.level, at: Date.now() }) })
    return { ok: true }
  }
  if (a.type === 'voice-check') {
    if (!demoVoiceKey) return { ok: false, state: 'none', says: 'Voice calls need an ElevenLabs key: add it in Settings › Voice.' }
    return /bad/i.test(demoVoiceKey)
      ? { ok: false, state: 'refused', from: 'here', says: "ElevenLabs doesn't accept this key. Copy it again from elevenlabs.io › Developers › API Keys and replace it." }
      : { ok: true, state: 'works', from: 'here', says: 'Works: ElevenLabs accepts this key.' }
  }
  if (a.type === 'catalog') return { ok: true, catalog: catalog(a.machine) }
  // Settings › Personal analytics: a fictional week (web/plugins/analytics)
  if (a.type === 'analytics') {
    if (a.do === 'state') return { ok: true, on: analytics.on, noted: analytics.noted }
    if (a.do === 'noted') return (analytics.noted = true), { ok: true }
    if (a.do === 'set') return (analytics.on = !!a.on), { ok: true, on: analytics.on }
    if (a.do === 'show') return { ok: true, ...demoAnalytics(Number(a.days) || 7) }
    if (a.do === 'raw' || a.do === 'export') return { ok: true, days: a.days ?? 7, events: demoEvents(), meaning: {} }
    if (a.do === 'delete') return { ok: true, deleted: { 'this machine': true, mini: true } }
    return { ok: true }
  }
  if (a.type === 'send') {
    // as the service gives your message back from the log: its words, then each file under them, a moment later
    const paths: string[] = Array.isArray(a.attachments) ? a.attachments.filter(Boolean) : []
    // a reply to a task quotes it (its title; the page shows its state)
    const quoted = typeof a.replyTask === 'string' ? taskOf(a.replyTask) : undefined
    if (!paths.length) say(a.chat, { who: 'you', text: a.text, cid: a.cid, ...(quoted ? { reply: { text: quoted.name, task: quoted.id } } : {}) })
    else setTimeout(() => {
      const id = `n${++n}`
      const at = Date.now()
      const c = (chats[a.chat] ??= { key: a.chat, messages: [], cli: 'claude', top: true })
      if (a.text) c.messages.push({ id, who: 'you', at, text: a.text, cid: a.cid } as Message)
      for (const [i, path] of paths.entries()) c.messages.push({ id: `${id}:f${i}`, who: 'you', at, cid: a.cid, file: { name: path.split('/').pop() ?? 'image', path } } as Message)
      pushChat(a.chat)
    }, 700)
    const text = String(a.text ?? '').trim()
    const from = state.normal.places.find((p) => p.chat === a.chat)?.id ?? EV
    const place = from === EV ? state.normal.places.find((p) => p.name === 'shop')?.id ?? EV : from
    const sp = state.normal.places.find((p) => p.id === place)
    const clean = (v: string) => { const t = v.trim().replace(/[\s,.;]+$/, ''); return t ? t[0]!.toUpperCase() + t.slice(1) : '' }
    const repeating = /\bevery\s+(.+?)[.!]?$/i.exec(text)
    const day = /\b(tomorrow|tonight|next week|(?:on\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.exec(text)
    if (/^File this feedback as an issue on the Shepherdr GitHub repository:/i.test(text)) {
      setTimeout(() => say(a.chat, { text: "Filed as issue #1262 on Shepherdr's GitHub repository." }), 500)
    } else if (/\bremind me\b/i.test(text) || repeating || day) {
      const raw = text.replace(/^(please\s+)?remind me\s+(to\s+)?/i, '').replace(/[\s,]*\bevery\s+.+$/i, '').replace(/[\s,]*\b(?:tomorrow|tonight|next week|(?:on\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b.*$/i, '')
      const title = clean(raw) || 'Reminder', id = `EV-S${++n}`
      const when = repeating ? `Every ${repeating[1]}` : `Once · ${clean((day?.[1] ?? 'tomorrow').replace(/^on\s+/i, ''))} 9:00`
      each((snap) => { (snap.automations[`demo:${id}`] ??= []).push({ id, name: title, place: from, when, what: text, on: true, next: [], once: !repeating }) })
      const spoken = when.replace('Once · ', 'once, ').replace(/^Every/, 'every')
      setTimeout(() => say(a.chat, { text: `Scheduled “${title}”: ${spoken}. It is in Tasks under Scheduled${repeating ? '.' : ' and leaves the list after it runs.'}` }), 500)
    } else if (/\b(add|make|build|fix|create|change|update|write|research|check)\b/i.test(text) && !a.chat.endsWith('/worker')) {
      const later = /\b(later|not yet|up next|don'?t start|do not start|without starting|not start)\b/i.test(text)
      const raw = text.replace(/^(please\s+)?(?:add|make|create)\s+(?:a\s+)?(?:new\s+)?task\s+(?:to\s+|for\s+|that\s+)?/i, '').replace(/[\s,.;]*(?:(?:but|and)\s+)?(?:don'?t|do not|without)\s+start(?:ing)?\b.*$/i, '').replace(/[\s,.;]*(?:for\s+|until\s+)?(?:later|up next)\b.*$/i, '')
      const title = clean(raw).slice(0, 60) || 'New task', id = `${(sp?.name ?? 'SHOP').toUpperCase().slice(0, 6)}-${++n}`
      each((snap) => { snap.tasks = [...snap.tasks, { id, name: title, place, status: later ? 'todo' : 'work', state: later ? 'todo' : 'work', on: sp?.machine ?? snap.host, created: '', age: '', ...(later ? {} : { started: Date.now() - 15 * 60_000, report: { msg: 'Just started', progress: 50 }, agent: { chat: `${id}/worker`, role: 'worker', cli: 'claude', status: 'work', running: true, age: '', note: '' } }) }] })
      say(`${id}/worker`, { text: later ? 'Added. Start it when you want.' : "Started. I'll tell you when it's ready for review." })
      const where = from === EV ? ` in #${sp?.name ?? 'shop'}` : ''
      setTimeout(() => say(a.chat, { text: later ? `Added ${id} to Up next${where}. It waits until you start it.` : `Added ${id}${from === EV ? ` to #${sp?.name ?? 'shop'}` : ''} and started it.` }), 500)
    } else setTimeout(() => say(a.chat, { text: a.chat.endsWith('/worker') ? "Thanks. I'll take that on board and carry on." : 'Got it. This demo only shows the screens: nothing is wired to a real agent.' }), 1200)
    return { ok: true, at: Date.now() }
  }
  if (a.type === 'answer') {
    for (const c of Object.values(chats)) for (const m of c.messages) if (m.question?.id === a.question) { m.question = { ...m.question, sent: a.choice ?? 0, said: m.question.choices[a.choice ?? 0]?.label, ...(a.byVoice ? { via: 'voice' as const } : {}) }; pushChat(c.key) }
    const t = a.question === 'q-pay' ? 'SHOP-14' : 'vm:GARDEN-4'
    patchTask(t, { status: 'work', blocked: undefined, report: { msg: 'Carrying on' } })
    if (a.byVoice && a.question === 'q-pay') setTimeout(() => say('SHOP-14/worker', { text: "Going with Stripe. I'll tell you when it's ready." }), 500)
    return { ok: true }
  }
  if (a.type === 'accept') {
    const t = taskOf(a.task)
    if (!t) return { ok: false, error: 'No such task.' }
    if (t.repo === 'branch') { patchTask(t.id, { status: 'merging' }); setTimeout(() => patchTask(t.id, { status: 'done', merged: true, doneAt: Date.now() }), 1200) }
    else patchTask(t.id, { status: 'done', doneAt: Date.now() })
    return { ok: true }
  }
  if (a.type === 'evidence') {
    const files: Record<string, [string, number, number][]> = { 'SHOP-12': [['src/search/index.ts', 42, 17], ['src/search/cache.ts', 58, 0], ['test/search.test.ts', 31, 2]], 'BLOG-10': [['content/about.md', 3, 3]] }
    const list = (files[a.task] ?? []).map(([path, added, removed]) => ({ path, added, removed }))
    return { ok: true, evidence: { diff: list.length ? { files: list.length, added: 0, removed: 0, list } : undefined, checks: a.task === 'SHOP-12' ? { state: 'passed', text: 'checks passed' } : a.task === 'BLOG-10' ? { state: 'passed', text: 'site builds' } : { state: 'none', text: '' } } }
  }
  const t = a.chat ? taskOf(a.chat) : undefined
  if (a.type === 'close' && t) return patchTask(t.id, { status: 'done', doneAt: Date.now() }), { ok: true }
  if (a.type === 'delete' && t) return each((snap) => { snap.tasks = snap.tasks.filter((x) => x.id !== t.id) }), { ok: true }
  if (a.type === 'archive' && t) return patchTask(t.id, { archived: a.on ? Date.now() : undefined }), { ok: true }
  if (a.type === 'task-rename' && t) return patchTask(t.id, { name: a.name }), { ok: true }
  if (a.type === 'task-move' && t) return patchTask(t.id, { place: a.place }), { ok: true }
  if (a.type === 'task-start' && t) { patchTask(t.id, { status: 'work', started: Date.now() - 15 * 60_000, report: { msg: 'Just started', progress: 50 }, agent: { chat: `${t.id}/worker`, role: 'worker', cli: 'claude', status: 'work', running: true, age: '', note: '' } }); say(`${t.id}/worker`, { text: "Started. I'll tell you when it's ready for review." }); return { ok: true } }
  if (a.type === 'stop' && t) return patchTask(t.id, { status: 'need', stopped: { by: 'you' } }), { ok: true }
  if (a.type === 'rename') return each((snap) => { snap.places = snap.places.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)); snap.sections = snap.sections?.map((s) => (s.id === a.id ? { ...s, name: a.name } : s)); snap.machines = snap.machines.map((m) => (m.id === a.id ? { ...m, name: a.name || (m.ownName ?? m.machine) } : m)) }), { ok: true }
  if (a.type === 'space-archive') return each((snap) => { snap.places = snap.places.map((p) => (p.id === a.place ? { ...p, archived: a.on } : p)) }), { ok: true }
  if (a.type === 'space-remove') return each((snap) => { snap.places = snap.places.filter((p) => p.id !== a.place) }), { ok: true }
  if (a.type === 'move') return each((snap) => { snap.sections = snap.sections?.map((s) => ({ ...s, spaces: [...s.spaces.filter((x) => x !== a.id), ...(s.id === a.to ? [a.id] : [])] })) }), { ok: true }
  if (a.type === 'section' && a.op === 'new') { const id = `s:g${++n}`; each((snap) => { snap.sections = [...(snap.sections ?? []), { id, name: a.name, machine: a.machine, spaces: [] }] }); return { ok: true, id } }
  if (a.type === 'section' && a.op === 'delete') return each((snap) => { snap.sections = snap.sections?.filter((s) => s.id !== a.id) }), { ok: true }
  if (a.type === 'config') {
    each((snap) => {
      const c = snap.config!
      if (a.key.startsWith('plugin.')) return void (c.plugins = c.plugins.map((p) => (p.id === a.key.slice(7) ? { ...p, on: !!a.value } : p)))
      // Settings › Shortcuts (SHEP-470), as the service keeps them
      if (a.key.startsWith('shortcut')) {
        const sc = (c.shortcuts ??= { keys: {}, letters: true })
        if (a.key === 'shortcuts.letters') sc.letters = a.value !== false
        else if (a.key === 'shortcuts.reset') sc.keys = {}
        else if (a.value === null) { const { [a.key.slice(9)]: _, ...rest } = sc.keys; sc.keys = rest }
        else sc.keys = { ...sc.keys, [a.key.slice(9)]: a.value }
        c.shortcuts = { ...sc }
        return
      }
      const lv: any = a.place === 'all' ? c.all : (c.spaces[a.place] ??= { ...structuredClone(c.all), own: [] })
      const own: string[] = a.place === 'all' ? [] : lv.own
      const [k, sub] = a.key.split('.')
      const from: any = c.all
      const v = a.value === null ? (sub ? from[k][sub] : from[k]) : a.value
      if (sub) lv[k] = { ...lv[k], [sub]: v }
      else lv[k] = v
      if (a.place !== 'all') lv.own = a.value === null ? own.filter((x) => x !== a.key) : [...new Set([...own, a.key])]
    })
    return { ok: true }
  }
  if (a.type === 'automation') {
    each((snap) => { for (const k of Object.keys(snap.automations)) snap.automations[k] = snap.automations[k]!.map((x) => (x.id === a.id ? { ...x, ...(a.op === 'pause' ? { on: false } : a.op === 'resume' ? { on: true } : a.op === 'edit' ? { when: a.when ?? x.when, what: a.what ?? x.what, place: a.place ?? x.place } : {}) } : x)) })
    if (a.op === 'run') {
      const x = Object.values(state.normal.automations).flat().find((y) => y.id === a.id)
      if (x) { const id = `RUN-${++n}`; each((snap) => { snap.tasks = [...snap.tasks, { id, name: x.name, place: x.place!, status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: Date.now(), schedule: x.name, report: { msg: 'Started by its schedule' }, agent: { chat: `${id}/worker`, role: 'worker', cli: 'claude', status: 'work', running: true, age: '', note: '' } }] }); say(`${id}/worker`, { text: `Started by the schedule “${x.name}”. ${x.what}` }) }
    }
    return { ok: true }
  }
  if (a.type === 'artifact-delete') return each((snap) => { snap.artifacts = snap.artifacts.filter((x) => x.id !== a.artifact) }), { ok: true }
  if (a.type === 'artifact-pin') return each((snap) => { snap.artifacts = snap.artifacts.map((x) => (x.id === a.artifact ? { ...x, pinned: a.on } : x)) }), { ok: true }
  if (a.type === 'artifact-rename') return each((snap) => { snap.artifacts = snap.artifacts.map((x) => (x.id === a.artifact ? { ...x, title: a.name } : x)) }), { ok: true }
  if (a.type === 'react') { for (const c of Object.values(chats)) for (const m of c.messages) if (m.id === a.message && c.key === a.chat) { m.reactions = toggled(m.reactions ?? [], a.emoji); pushChat(c.key) } return { ok: true } }
  return { ok: true }
}

const PAGES: Record<string, string> = {
  'a-mock': `<h2>Your basket</h2><div class="r"><span>Garden gloves</span><span class="qty"><button id="m" aria-label="Fewer">−</button><b id="q">1</b><button id="p" aria-label="More">+</button></span></div><div class="r"><span>Total</span><b id="t">€12</b></div><button class="pay" id="pay">Pay now</button><p>A real page the agent made. You can use it here.</p><script>let q=1,paid=false;const u=()=>{document.getElementById('q').textContent=q;document.getElementById('t').textContent='€'+12*q;document.getElementById('pay').textContent=paid?'Paid':'Pay now'};m.onclick=()=>{q=Math.max(1,q-1);paid=false;u()};p.onclick=()=>{q++;paid=false;u()};pay.onclick=()=>{paid=!paid;u()}</script>`,
  // a long page with pictures beside its index.html: the panel shows all of it and scrolls to its end (SHEP-340)
  'a-picks': `<h2>Garden chair picks</h2><p>Five chairs under €200 that fit a small balcony, best first.</p><h2>The best matches</h2>${['Oak folding chair', 'Rattan lounger', 'Steel bistro chair', 'Teak deck chair', 'Rope swing seat'].map((t, i) => `<section class="pick"><h3>${i + 1}. ${t}</h3><img src="pic${(i % 4) + 1}.jpg" alt="${t}" width="640" height="400"><p>Folds flat, weatherproof, about €${120 + i * 15}. Delivery in a week.</p></section>`).join('')}<p>More: <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">a video review</a> · <a href="#end">to the end</a> · <a href="../../../../?artifact=a-mock">the basket</a></p><p id="end">That's the whole list.</p>`,
  // a proof as long as a real one, ending in a reply box an agent wrote with a plain form (it would reload the frame,
  // or meet the service's read-only answer, if the link catcher let it go)
  'a-shop12': `<h2>Faster product search · Proof</h2><p>Search answers from the new index: results show in about 80 ms, down from 400.</p><div class="bar" style="width:100%"></div><p>Before · 400 ms</p><div class="bar g" style="width:20%"></div><p>After · 80 ms</p>${['Searching “gloves” on a phone', 'Searching “chair” with 2,000 products', 'A typo: “glvoes”'].map((t, i) => `<h3>${t}</h3><img src="pic${i + 1}.jpg" alt="${t}" width="640" height="400" style="display:block;width:100%;height:auto;border-radius:8px">`).join('')}<h3>Tests</h3><p>214 tests pass. 3 files changed.</p><h3>Not proven</h3><p>Search on the vm's shop, which has no index yet.</p><form method="post" onsubmit="parent.postMessage({ shepherdr: 'answer', text: this.r.value }, '*')"><textarea name="r" aria-label="Your reply" style="display:block;width:100%;box-sizing:border-box;min-height:60px"></textarea><button class="pay">Reply</button></form>`,
}
const page = (id: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}body{margin:0;padding:16px;font:14px/20px system-ui,sans-serif}h2{font-size:18px;margin:0 0 12px}.r{display:flex;justify-content:space-between;align-items:center;min-height:40px;border-top:1px solid #8883}.qty{display:flex;align-items:center;gap:8px}.qty button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:CanvasText;font:inherit}.pay{width:100%;margin-top:12px;height:32px;padding:0 12px;border:0;border-radius:8px;background:CanvasText;color:Canvas;font:inherit;font-weight:500}.l{height:8px;border-radius:4px;background:#8884;margin:12px 0}.bar{height:6px;border-radius:3px;background:#8886}.bar.g{background:#15803d}p{color:#737373;font-size:13px;line-height:18px}.pick img{display:block;width:100%;height:auto;border-radius:8px}h3{font-size:16px;margin:24px 0 8px}@media(max-width:443px){body{font-size:16px;line-height:24px}.pay{height:40px}p{font-size:14px;line-height:20px}}</style>${PAGES[id] ?? `<h2>${artifacts.find((x) => x.id === id)?.title ?? id}</h2>${[92, 78, 85, 40, 88, 64].map((w) => `<div class="l" style="width:${w}%"></div>`).join('')}`}`

/** a stand-in for the live picture of an agent's browser: one still frame */
const shotFile = (key: string) => join(fileURLToPath(new URL('./shots/', import.meta.url)), key.includes('SHOP-17') ? 'login.jpg' : 'checkout.jpg')

/** a stand-in for the picture taken of a page when it is published */
function thumb(id: string, dark: boolean) {
  const [bg, ink, soft] = dark ? ['#1e1e1e', '#a3a3a3', '#3a3a3a'] : ['#f5f5f5', '#737373', '#dcdcdc']
  const bar = (y: number, w: number, c = soft, h = 6) => `<rect x="16" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}"/>`
  const body = id === 'a-mock' ? bar(16, 150, ink, 10) + bar(38, 170) + bar(52, 110) + `<rect x="16" y="70" width="120" height="20" rx="5" fill="${dark ? '#fafafa' : '#0a0a0a'}"/>` : id === 'a-shop12' ? bar(20, 260) + bar(36, 84, '#15803d') : id === 'a-deck' ? `<rect x="64" y="70" width="190" height="10" rx="5" fill="${ink}"/><rect x="100" y="94" width="110" height="6" rx="3" fill="${soft}"/>` : bar(16, 150, ink, 10) + bar(38, 260) + bar(52, 170) + bar(66, 260) + bar(80, 110)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="${bg}"/>${body}</svg>`
}

Bun.serve<Sock['data'], never>({
  hostname: '127.0.0.1',
  port,
  async fetch(req, server) {
    const url = new URL(req.url)
    const path = url.pathname.replace(/^\/[\w-]+(?=\/api\/)/, '')
    if (path === '/api/screen') return server.upgrade(req, { data: { mode: 'normal', watch: [], screen: url.searchParams.get('key') ?? '' } as any }) ? undefined : new Response('no', { status: 400 })
    if (path === '/api/terminal') return server.upgrade(req, { data: { mode: 'normal', watch: [], term: url.searchParams.get('chat') ?? '' } as any }) ? undefined : new Response('no', { status: 400 })
    if (path === '/api/ws') {
      // which day to show: the page was opened with ?case=empty or ?case=down (kept in a cookie: the app rewrites its address)
      const c = /(?:^|;\s*)demo-case=(\w+)/.exec(req.headers.get('cookie') ?? '')?.[1]
      const app = `${req.headers.get('origin') ?? url.origin}${url.pathname.slice(0, -'api/ws'.length)}`
      return server.upgrade(req, { data: { mode: c === 'empty' || c === 'down' || c === 'more' || c === 'long' || c === 'one' || c === 'five' ? c : 'normal', watch: [], app } }) ? undefined : new Response('no', { status: 400 })
    }
    if (path === '/api/screen/shot') return new Response(Bun.file(shotFile(url.searchParams.get('key') ?? '')), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
    if (path === '/api/me') return Response.json({ login: 'sam', off: [] })
    if (path === '/api/action') return Response.json(action((await req.json()) as Record<string, any>) ?? { ok: true })
    if (path === '/api/upload') {
      const f = (await req.formData()).get('file') as File | null
      const name = (f?.name || 'file').replace(/[^\w.-]/g, '_')
      if (f) uploaded.set(`/tmp/demo/${++n}-${name}`, f)
      return Response.json({ path: `/tmp/demo/${n}-${name}`, name })
    }
    // a file you sent, at its own address (only what was sent to this demo)
    if (path === '/api/file' && uploaded.has(url.searchParams.get('path') ?? '')) return new Response(uploaded.get(url.searchParams.get('path')!)!)
    const m = /^\/api\/artifacts\/([^/]+)\/(page|thumb)/.exec(path)
    // a picture beside a page's index.html
    const pic = /^\/api\/artifacts\/[^/]+\/page\/pic(\d)\.jpg$/.exec(path)
    if (pic) return new Response(Bun.file(shotFile(Number(pic[1]) % 2 ? 'SHOP-17' : '')), { headers: { 'content-type': 'image/jpeg' } })
    // ?case=nopics: no page has its picture (a machine with no browser): each tile shows its first lines instead
    if (m?.[2] === 'thumb' && /(?:^|;\s*)demo-case=nopics/.test(req.headers.get('cookie') ?? '')) return new Response('no picture', { status: 404, headers: { 'cache-control': 'no-store' } })
    if (m?.[2] === 'thumb') return new Response(thumb(decodeURIComponent(m[1]!), url.searchParams.has('dark')), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
    // the page is read only, as the service serves it
    if (m?.[2] === 'page' && req.method !== 'GET' && req.method !== 'HEAD') return new Response('read only', { status: 405, headers: { 'content-security-policy': 'sandbox allow-scripts allow-forms' } })
    if (m) return new Response(withLinks(page(decodeURIComponent(m[1]!))), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "sandbox allow-scripts allow-forms" } })
    if (path.startsWith('/api/')) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    // The fictional day starts over when the demo is reloaded.
    if (req.headers.get('sec-fetch-dest') === 'document' || (req.headers.get('accept') ?? '').includes('text/html')) { resetDemo(); push() }
    // under any path (tailscale serve --set-path /name): the file as asked, else without its first part
    for (const p of [url.pathname, url.pathname.replace(/^\/[\w-]+(?=\/)/, '')]) {
      const f = Bun.file(join(dist, p.endsWith('/') ? `${p}index.html` : p))
      if (!(await f.exists())) continue
      // the page itself says which day the demo shows
      return p.endsWith('/') ? new Response(f, { headers: { 'set-cookie': `demo-case=${url.searchParams.get('case') ?? 'normal'}; Path=/; SameSite=Lax` } }) : new Response(f)
    }
    return new Response(Bun.file(join(dist, 'index.html')))
  },
  websocket: {
    async open(ws) {
      const key = (ws.data as any).screen as string | undefined
      if (key !== undefined) {
        const known = state.normal.screens?.[key]
        ws.send(JSON.stringify({ type: 'state', driver: 'agent', url: known?.b?.url ?? '', title: '', connected: true, viewport: { w: 1280, h: 800 } }))
        if (known?.b) ws.send(JSON.stringify({ type: 'frame', data: Buffer.from(await Bun.file(shotFile(key)).arrayBuffer()).toString('base64'), metadata: { deviceWidth: 1280, deviceHeight: 800 } }))
        return
      }
      socks.add(ws as unknown as Sock)
      ws.send(JSON.stringify({ type: 'snapshot', snapshot: state[ws.data.mode] }))
    },
    message(ws, raw) {
      if ((ws.data as any).screen !== undefined) return
      if ((ws.data as any).term !== undefined) {
        // a stand-in terminal: it shows a prompt and echoes what is typed; nothing runs
        const m = JSON.parse(String(raw)) as { type: string; id: number; text?: string; keys?: string[] }
        const say = (t: string) => ws.send(new TextEncoder().encode(t))
        if (m.type === 'open') { ws.send(JSON.stringify({ type: 'size', cols: 100, rows: 12 })); say(TERM_LINKS + 'sam@mac-mini shop % ') }
        else if (m.type === 'text') say(m.text ?? '')
        else if (m.type === 'keys' && m.keys?.includes('enter')) say("\r\n(this demo doesn't run commands)\r\nsam@mac-mini shop % ")
        ws.send(JSON.stringify({ type: 'ack', id: m.id }))
        return
      }
      const msg = JSON.parse(String(raw)) as { type: string; chats?: string[] }
      if (msg.type === 'ping') return void ws.send(JSON.stringify({ type: 'pong' }))
      if (msg.type !== 'watch') return
      ws.data.watch = msg.chats ?? []
      for (const key of ws.data.watch) ws.send(JSON.stringify({ type: 'chat', chat: chatFor(ws as unknown as Sock, key) }))
    },
    close(ws) {
      socks.delete(ws as unknown as Sock)
    },
  },
})
/** what the stand-in terminal shows first: links of each kind, a sign-in address broken over three lines at its 100
 *  columns as Claude Code does, one the program marks (OSC 8) and a file: one that is only copied */
const SIGN_IN = 'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile&state=Zx9_-kq'
const osc8 = (url: string, text: string) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`
const TERM_LINKS = [
  'Browser didn\'t open? Use the url below to sign in:',
  ...(SIGN_IN.match(/.{1,100}/g) ?? []),
  '',
  `Docs (see https://example.com/docs/getting-started).  ${osc8('https://example.com/changelog', 'What\'s new')}  ${osc8('file:///home/sam/shop/notes.md', 'notes.md')}`,
  '',
].join('\r\n')
console.log(`demo on http://127.0.0.1:${port}/`)
void config
