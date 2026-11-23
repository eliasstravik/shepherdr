// The demo: `bun web/demo/serve.ts [port]` serves the built app (web/dist) with a fictional day instead of the service,
// on 127.0.0.1 only. For looking at every screen and comparing it with the design; nothing is wired to a real agent.
// `?case=empty` and `?case=down` in the page's address show "Nothing yet" and "Can't reach vm"; `?case=more` adds a
// third warning (the warnings line coming back after it was closed).
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Chat, Message, Snapshot, Task } from '../shared/types.ts'
import { artifacts, catalog, chats as seed, config, EV, snapshot } from './data.ts'

const dist = join(fileURLToPath(new URL('../', import.meta.url)), 'dist')
const port = Number(process.argv[2] || 7799)
type Sock = { send(s: string): void; data: { mode: 'normal' | 'empty' | 'down' | 'more'; watch: string[] } }
const socks = new Set<Sock>()
const state = { normal: structuredClone(snapshot('normal')), empty: structuredClone(snapshot('empty')), down: structuredClone(snapshot('down')) }
const chats: Record<string, Chat> = structuredClone(seed)
let n = 1000
function resetDemo() {
  for (const mode of ['normal', 'empty', 'down', 'more'] as const) state[mode] = structuredClone(snapshot(mode))
  for (const key of Object.keys(chats)) delete chats[key]
  Object.assign(chats, structuredClone(seed))
  n = 1000
}

const push = () => socks.forEach((s) => s.send(JSON.stringify({ type: 'snapshot', snapshot: state[s.data.mode] })))
const pushChat = (key: string) => socks.forEach((s) => s.data.watch.includes(key) && s.send(JSON.stringify({ type: 'chat', chat: chatFor(s, key) })))
const chatFor = (s: Sock, key: string): Chat => {
  if (s.data.mode === 'empty') return { key, messages: chats[key]?.messages.filter((m) => m.id.startsWith('n')) ?? [], cli: 'claude', top: true, agent: chats[key]?.agent ?? chats[EV]!.agent }
  const chat = chats[key] ?? { key, messages: [], cli: 'claude' as const, top: true, agent: chats[EV]!.agent }
  return s.data.mode === 'down' ? { ...chat, messages: chat.messages.map(({ suggest, ...m }) => m) } : chat
}
const each = (f: (snap: Snapshot) => void) => { for (const s of Object.values(state)) f(s); push() }
const taskOf = (id: string) => state.normal.tasks.find((t) => t.id === id || `${t.id}/worker` === id)
const patchTask = (id: string, p: Partial<Task>) => each((snap) => { snap.tasks = snap.tasks.map((t) => (t.id === id ? { ...t, ...p } : t)) })
const say = (key: string, m: Partial<Message>) => { (chats[key] ??= { key, messages: [], cli: 'claude', top: true }).messages.push({ id: `n${++n}`, who: 'agent', at: Date.now(), ...m } as Message); pushChat(key) }

function action(a: Record<string, any>): unknown {
  if (a.type === 'screen') {
    if (a.op === 'handback' || a.op === 'skip') each((snap) => { const screen = snap.screens?.[a.key]; if (screen?.hands) screen.hands.settled = a.op === 'skip' ? 'skip' : 'done' })
    return { ok: true }
  }
  if (a.type === 'catalog') return { ok: true, catalog: catalog(a.machine) }
  if (a.type === 'send') {
    say(a.chat, { who: 'you', text: a.text, cid: a.cid })
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
  if (a.type === 'rename') return each((snap) => { snap.places = snap.places.map((p) => (p.id === a.id ? { ...p, name: a.name } : p)); snap.sections = snap.sections?.map((s) => (s.id === a.id ? { ...s, name: a.name } : s)) }), { ok: true }
  if (a.type === 'space-archive') return each((snap) => { snap.places = snap.places.map((p) => (p.id === a.place ? { ...p, archived: a.on } : p)) }), { ok: true }
  if (a.type === 'space-remove') return each((snap) => { snap.places = snap.places.filter((p) => p.id !== a.place) }), { ok: true }
  if (a.type === 'move') return each((snap) => { snap.sections = snap.sections?.map((s) => ({ ...s, spaces: [...s.spaces.filter((x) => x !== a.id), ...(s.id === a.to ? [a.id] : [])] })) }), { ok: true }
  if (a.type === 'section' && a.op === 'new') { const id = `s:g${++n}`; each((snap) => { snap.sections = [...(snap.sections ?? []), { id, name: a.name, machine: a.machine, spaces: [] }] }); return { ok: true, id } }
  if (a.type === 'section' && a.op === 'delete') return each((snap) => { snap.sections = snap.sections?.filter((s) => s.id !== a.id) }), { ok: true }
  if (a.type === 'config') {
    each((snap) => {
      const c = snap.config!
      if (a.key.startsWith('plugin.')) return void (c.plugins = c.plugins.map((p) => (p.id === a.key.slice(7) ? { ...p, on: !!a.value } : p)))
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
  if (a.type === 'react') { for (const c of Object.values(chats)) for (const m of c.messages) if (m.id === a.message && c.key === a.chat) { m.reactions = [{ emoji: a.emoji, by: 'me' }]; pushChat(c.key) } return { ok: true } }
  return { ok: true }
}

const PAGES: Record<string, string> = {
  'a-mock': `<h2>Your basket</h2><div class="r"><span>Garden gloves</span><span class="qty"><button id="m" aria-label="Fewer">−</button><b id="q">1</b><button id="p" aria-label="More">+</button></span></div><div class="r"><span>Total</span><b id="t">€12</b></div><button class="pay" id="pay">Pay now</button><p>A real page the agent made. You can use it here.</p><script>let q=1,paid=false;const u=()=>{document.getElementById('q').textContent=q;document.getElementById('t').textContent='€'+12*q;document.getElementById('pay').textContent=paid?'Paid':'Pay now'};m.onclick=()=>{q=Math.max(1,q-1);paid=false;u()};p.onclick=()=>{q++;paid=false;u()};pay.onclick=()=>{paid=!paid;u()}</script>`,
  'a-shop12': `<h2>Faster product search · Proof</h2><div class="bar" style="width:100%"></div><p>Before · 400 ms</p><div class="bar g" style="width:20%"></div><p>After · 80 ms</p><p>214 tests pass. 3 files changed.</p>`,
}
const page = (id: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}body{margin:0;padding:16px;font:14px/20px system-ui,sans-serif}h2{font-size:18px;margin:0 0 12px}.r{display:flex;justify-content:space-between;align-items:center;min-height:40px;border-top:1px solid #8883}.qty{display:flex;align-items:center;gap:8px}.qty button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:CanvasText;font:inherit}.pay{width:100%;margin-top:12px;height:32px;padding:0 12px;border:0;border-radius:8px;background:CanvasText;color:Canvas;font:inherit;font-weight:500}.l{height:8px;border-radius:4px;background:#8884;margin:12px 0}.bar{height:6px;border-radius:3px;background:#8886}.bar.g{background:#15803d}p{color:#737373;font-size:13px;line-height:18px}@media(max-width:443px){body{font-size:16px;line-height:24px}.pay{height:40px}p{font-size:14px;line-height:20px}}</style>${PAGES[id] ?? `<h2>${artifacts.find((x) => x.id === id)?.title ?? id}</h2>${[92, 78, 85, 40, 88, 64].map((w) => `<div class="l" style="width:${w}%"></div>`).join('')}`}`

/** a stand-in for the live picture of an agent's browser: one still frame */
const shotFile = (key: string) => join(fileURLToPath(new URL('./shots/', import.meta.url)), key.includes('SHOP-17') ? 'login.jpg' : 'checkout.jpg')

/** a stand-in for the picture taken of a page when it is published */
function thumb(id: string, dark: boolean) {
  const [bg, ink, soft] = dark ? ['#1e1e1e', '#a3a3a3', '#3a3a3a'] : ['#f5f5f5', '#737373', '#dcdcdc']
  const bar = (y: number, w: number, c = soft, h = 6) => `<rect x="16" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}"/>`
  const body = id === 'a-mock' ? bar(16, 150, ink, 10) + bar(38, 170) + bar(52, 110) + `<rect x="16" y="70" width="120" height="20" rx="5" fill="${dark ? '#fafafa' : '#0a0a0a'}"/>` : id === 'a-shop12' ? bar(20, 260) + bar(36, 84, '#15803d') : id === 'a-deck' ? `<rect x="64" y="70" width="190" height="10" rx="5" fill="${ink}"/><rect x="100" y="94" width="110" height="6" rx="3" fill="${soft}"/>` : bar(16, 150, ink, 10) + bar(38, 260) + bar(52, 170) + bar(66, 260) + bar(80, 110)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="${bg}"/>${body}</svg>`
}

Bun.serve<{ mode: 'normal' | 'empty' | 'down' | 'more'; watch: string[] }, never>({
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
      return server.upgrade(req, { data: { mode: c === 'empty' || c === 'down' || c === 'more' ? c : 'normal', watch: [] } }) ? undefined : new Response('no', { status: 400 })
    }
    if (path === '/api/screen/shot') return new Response(Bun.file(shotFile(url.searchParams.get('key') ?? '')), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } })
    if (path === '/api/me') return Response.json({ login: 'sam', off: [] })
    if (path === '/api/action') return Response.json(action((await req.json()) as Record<string, any>) ?? { ok: true })
    if (path === '/api/upload') return Response.json({ path: `/tmp/demo/${Date.now()}`, name: 'file' })
    const m = /^\/api\/artifacts\/([^/]+)\/(page|thumb)/.exec(path)
    if (m?.[2] === 'thumb') return new Response(thumb(decodeURIComponent(m[1]!), url.searchParams.has('dark')), { headers: { 'content-type': 'image/svg+xml' } })
    if (m) return new Response(page(decodeURIComponent(m[1]!)), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "sandbox allow-scripts allow-forms" } })
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
        if (m.type === 'open') { ws.send(JSON.stringify({ type: 'size', cols: 100, rows: 12 })); say('sam@mac-mini shop % ') }
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
console.log(`demo on http://127.0.0.1:${port}/`)
void config
