// Shepherdr's service worker: shows push alerts, keeps the app icon's count and opens the app on the card an alert is
// about. With the app on screen, an alert shows nothing: the server already skips this device then, and this catches
// the rest. One alert per task: a task's newer alert takes its old one's place (its tag), and alerts about what no
// longer waits on you go with the next one. Where alerts have buttons (Android and so a Wear OS watch, desktop Chrome),
// one button does the thing from there (SHEP-243): a card's first choice answers it, Accept accepts a Ready task as the Tasks panel
// does, Reply sends what was typed into the notification (else it opens the chat). Each says on the notification what
// came of it ("Accepted ✓", "Already handled"); an old alert's button can't do harm: an answer goes to that one card
// only, and Accept only to a task still Ready. An iPhone shows no buttons.
// windows of this app only: another app on the same host has its own windows
const ours = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.filter((c) => c.url.startsWith(self.registration.scope)))

/** the count on the app icon, where the device has one (the Badging API: iPhone, Mac, Windows, ChromeOS) */
const badge = (n) => {
  const nav = self.navigator
  if (!nav || !('setAppBadge' in nav) || typeof n !== 'number') return Promise.resolve()
  return (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge()).catch(() => undefined)
}

/** close alerts about what no longer waits on you (open: the tags of what still does); a plain alert stays */
const tidy = (open) =>
  Array.isArray(open)
    ? self.registration.getNotifications().then((list) => {
        for (const n of list) if (n.data && n.data.waits && !open.includes(n.tag)) n.close()
      })
    : Promise.resolve()

/** how many buttons an alert here can carry (2 on Android) */
const room = () => (typeof Notification !== 'undefined' && Notification.maxActions) || 0

/** words typed into the notification itself come back (Chrome on Android): else Reply opens the chat */
const typed = () => typeof NotificationEvent !== 'undefined' && 'reply' in NotificationEvent.prototype

/** the button this device shows: Reply only where it can be typed into */
const fit = (actions) => {
  const n = room()
  if (!n || !Array.isArray(actions)) return []
  const kept = actions.filter((x) => x.action !== 'reply' || typed()).map((x) => (x.type === 'text' ? x : { action: x.action, title: x.title }))
  // one: Chrome on Android hands every site button's tap over as the last button's action (web/shared/alerts.ts)
  return kept.slice(0, 1)
}

/* Share into Shepherdr (SHEP-345): Android's Share sheet POSTs pictures, files, words and links to ./share (the
   manifest's share_target). They are kept here in Cache Storage under an id, and the app opens on ./?share=<id>, which
   puts them in the message box of the chat you had open last (web/plugins/chat/share.ts). */
const SHARED = 'shepherdr-share'
const word = (v) => (typeof v === 'string' ? v.slice(0, 20000) : '')

const keepShared = async (req) => {
  const scope = self.registration.scope
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  try {
    const form = await req.formData()
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size > 0)
    const meta = { title: word(form.get('title')), text: word(form.get('text')), url: word(form.get('url')), files: files.map((f) => ({ name: f.name || '', type: f.type || '' })) }
    const cache = await caches.open(SHARED)
    // one share waits at a time: an older one never taken (the app was closed before it opened) goes
    for (const k of await cache.keys()) await cache.delete(k)
    for (const [i, f] of files.entries()) await cache.put(new URL(`share/${id}/${i}`, scope).href, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } }))
    await cache.put(new URL(`share/${id}`, scope).href, new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }))
    return Response.redirect(new URL(`./?share=${id}`, scope).href, 303)
  } catch {
    return Response.redirect(new URL('./?share=lost', scope).href, 303)
  }
}

self.addEventListener('fetch', (e) => {
  const r = e.request
  if (r.method === 'POST' && r.url.split('?')[0] === new URL('share', self.registration.scope).href) e.respondWith(keepShared(r))
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  const a = e.data ? e.data.json() : { title: 'Shepherdr', body: '' }
  e.waitUntil(
    Promise.all([badge(a.badge), tidy(a.open)])
      .catch(() => undefined)
      .then(ours)
      .then((list) => {
        // a test (Settings › Notifications › Send a test) shows though you are looking at the app
        if (!a.test && list.some((c) => c.visibilityState === 'visible')) return
        const tag = a.tag || a.id
        // a push must show something: quietly, and gone at once, it leaves only the older alert's going
        if (a.clear) return self.registration.showNotification(a.title, { tag, silent: true }).then(() => self.registration.getNotifications({ tag })).then((shown) => shown.forEach((n) => n.close()))
        const options = {
          body: a.body,
          tag,
          // a task's newer alert buzzes again, though it takes the old one's place
          renotify: !!tag,
          icon: 'icon-192.png?v=2',
          badge: 'badge-96.png?v=2',
          data: { url: a.url || './', waits: !!a.waits, answer: a.answer, accept: a.accept, reply: a.reply, restart: a.restart },
        }
        const actions = fit(a.actions)
        if (actions.length) options.actions = actions
        return self.registration.showNotification(a.title, options)
      }),
  )
})

/** one of the app's actions, as its pages send them (the same gate: this origin, x-shepherdr): { ok } or { error } */
const act = (body) =>
  fetch(new URL('api/action', self.registration.scope), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shepherdr': '1' },
    body: JSON.stringify(body),
  })
    .then(async (r) => {
      if (!r.ok) return { error: (await r.text()).trim() || `It was refused (${r.status}).` }
      const out = await r.json().catch(() => ({}))
      return out && out.ok === false ? { error: out.error || "It didn't go through." } : { ok: true }
    })
    .catch(() => ({ error: "Shepherdr couldn't be reached." }))

/** a refusal that only means it was done already: accepted, answered or gone (web/shared/alerts.ts alreadyHandled) */
const handled = (error) => /isn't ready|answered already|isn't here any more|no longer waiting|only a ready task/i.test(error || '')

/** what came of a button, on the notification in its place, quietly; gone by itself a moment later when it worked */
const settle = (n, title, body, ok) => {
  const tag = n.tag || undefined
  const data = { url: (n.data && n.data.url) || './' }
  return self.registration
    .showNotification(title, { body, tag, silent: true, renotify: false, icon: 'icon-192.png?v=2', badge: 'badge-96.png?v=2', data })
    .then(() => (ok ? new Promise((r) => setTimeout(r, 4000)).then(() => self.registration.getNotifications({ tag })).then((l) => l.forEach((x) => x.title === title && x.close())) : undefined))
}

/** a button's answer, said on the notification: done, already handled, or why not (a tap then opens the app) */
const said = (n, r, done, what) => {
  if (r.ok) return settle(n, done, what, true)
  if (handled(r.error)) return settle(n, 'Already handled', 'Nothing more to do here.', true)
  return settle(n, "Didn't go through", (r.error || '').slice(0, 80) + ' Tap to open.', false)
}

/** after an answer: the icon's count and the alerts left follow what waits on you now */
const refresh = () =>
  fetch(new URL('api/waiting', self.registration.scope))
    .then((r) => r.json())
    .then((w) => Promise.all([badge(w.count), tidy(w.tags)]))
    .catch(() => undefined)

/** open the app where the alert points: an open window goes there without reloading, else a new one opens */
const open = (url) => {
  const href = new URL(url || './', self.registration.scope).href
  return ours().then((list) => {
    const c = list.find((w) => 'focus' in w)
    if (!c) return self.clients.openWindow(href)
    return c
      .focus()
      .then((w) => (w || c).postMessage({ type: 'open', url: href }))
      .catch(() => c.navigate(href).then((w) => w && w.focus()))
      .catch(() => self.clients.openWindow(href))
  })
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification
  const d = n.data || {}
  const label = ((n.actions || []).find((x) => x.action === e.action) || {}).title || ''
  n.close()
  const then = (p) => e.waitUntil(p.then(refresh))
  if (e.action === 'later') return
  if (e.action === 'accept' && d.accept) return then(act({ type: 'accept', task: d.accept.task }).then((r) => said(n, r, 'Done ✓', n.body)))
  if (e.action === 'restart-all' && d.restart) return then(act({ type: 'restart-all', alert: d.restart.alert }).then((r) => said(n, r, 'Restarting ✓', n.body)))
  if (/^\d+$/.test(e.action) && d.answer)
    return then(act({ type: 'answer', chat: d.answer.chat, question: d.answer.question, choice: Number(e.action), fromAlert: true }).then((r) => said(n, r, 'Answered ✓', label)))
  if (e.action === 'reply' && d.reply && typeof e.reply === 'string' && e.reply.trim()) {
    // one send per notification, never twice (its cid), as a person's own message in the app
    const cid = `push:${n.tag || ''}:${n.timestamp || ''}`.slice(0, 80)
    const text = e.reply.trim()
    return then(act({ type: 'send', chat: d.reply.chat, text, cid, human: true, ...(d.reply.to ? { reply: d.reply.to } : {}) }).then((r) => said(n, r, 'Sent ✓', text.slice(0, 80))))
  }
  e.waitUntil(open(d.url))
})
