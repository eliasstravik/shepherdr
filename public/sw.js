// Shepherdr's service worker: shows push alerts, keeps the app icon's count and opens the app on the card an alert is
// about. With the app on screen, an alert shows nothing: the server already skips this device then, and this catches
// the rest. One alert per task: a task's newer alert takes its old one's place (its tag), and alerts about what no
// longer waits on you go with the next one. Where alerts have buttons (Android, desktop Chrome), the card's first
// choices answer it from there; an iPhone shows none.
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

/** alerts here can carry buttons */
const buttons = () => typeof Notification !== 'undefined' && Notification.maxActions > 0

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  const a = e.data ? e.data.json() : { title: 'Shepherdr', body: '' }
  e.waitUntil(
    Promise.all([badge(a.badge), tidy(a.open)])
      .catch(() => undefined)
      .then(ours)
      .then((list) => {
        if (list.some((c) => c.visibilityState === 'visible')) return
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
          data: { url: a.url || './', waits: !!a.waits, answer: a.answer },
        }
        if (a.answer && a.actions && buttons()) options.actions = a.actions.slice(0, Notification.maxActions)
        return self.registration.showNotification(a.title, options)
      }),
  )
})

/** answer the card from a button; false when it didn't go in */
const answer = (to, choice) =>
  fetch(new URL('api/action', self.registration.scope), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shepherdr': '1' },
    body: JSON.stringify({ type: 'answer', chat: to.chat, question: to.question, choice, fromAlert: true }),
  })
    .then((r) => (r.ok ? r.json() : { ok: false }))
    .then((r) => r.ok !== false)
    .catch(() => false)

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
  const d = e.notification.data || {}
  e.notification.close()
  if (e.action && d.answer) e.waitUntil(answer(d.answer, Number(e.action)).then((ok) => (ok ? refresh() : open(d.url))))
  else e.waitUntil(open(d.url))
})
