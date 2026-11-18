// SHEP-250: Needs you is one rule everywhere. The web app's Tasks panel (its groups, the sidebar's and header's counts,
// the app icon's) and the glance feed (the phone's widgets, lock screen card and watch) are built from one snapshot here
// and must list the same things, in the same order, with the same counts. The case that split them: an Assistant's
// unread message and a working task's alert were on the phone ("2 need you") while the Tasks panel had no Needs you.
import { afterAll, describe, expect, test } from 'bun:test'
import type { Snapshot } from '@shared/types.ts'

// kernel.ts reads the page (its address, storage, width) as it loads: the little it needs, for this file only
const g = globalThis as Record<string, unknown>
const noop = () => {}
const page: Record<string, unknown> = {
  location: new URL('http://app.test/'),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  addEventListener: noop,
  removeEventListener: noop,
  innerWidth: 1280,
  innerHeight: 800,
  history: { replaceState: noop, pushState: noop, state: null },
  document: { head: { innerHTML: '' }, visibilityState: 'visible', addEventListener: noop, documentElement: { style: {}, dataset: {} } },
}
const had = Object.keys(page).filter((k) => k in g)
for (const k of Object.keys(page)) if (!had.includes(k)) g[k] = page[k]
afterAll(() => {
  for (const k of Object.keys(page)) if (!had.includes(k)) delete g[k]
})
const { shownGroups, needsIn, counts } = await import('./kernel.ts')
const { waiting } = await import('@shared/alerts.ts')
const { needsYou } = await import('@shared/needs-you.ts')
const { alertsOf } = await import('../../service/push.ts')
const { glanceOf } = await import('../../service/glance.ts')

const NOW = Date.now()
const MIN = 60_000
const all = { key: '*', search: '*', chips: [] as string[], level: 0 as const }

const place = (id: string, name: string, machine: string) => ({ id, name, machine, level: 2, status: 'idle', mode: 'regular', chat: `c:${id}`, tabs: [] })
const task = (id: string, status: string, p: string, more: Record<string, unknown> = {}) => ({ id, name: `${id} work`, status, place: p, on: p.split(':')[1], listName: p, age: '', created: '', at: NOW - 60 * MIN, ...more })
const q = (id: string, title: string) => ({ id, kind: 'Question', title, choices: [{ label: 'Yes' }, { label: 'No' }] })

/** the evening's fleet, made up: two machines, a muted space, work in every state */
function fleet(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'vm', host: 'vma', user: 'you',
    machines: [{ id: 'm:vma', machine: 'vma', name: 'vm-a', status: 'idle', here: true }, { id: 'm:vmb', machine: 'vmb', name: 'vm-b', status: 'idle' }],
    places: [place('p:vma:home', 'home', 'vma'), place('p:vmb:shop', 'shop', 'vmb'), place('p:vma:quiet', 'quiet', 'vma')],
    tasks: [
      // a working task that sent an alert: it waits on you until the alert goes
      task('vma:ELIA-57', 'work', 'p:vma:home', { sub: 'Wiring the phone' }),
      task('vma:ELIA-58', 'work', 'p:vma:home'),
      task('vmb:SHOP-1', 'work', 'p:vmb:shop'),
      task('vmb:SHOP-2', 'merging', 'p:vmb:shop'),
      // a question on a task, two cards on one task (one row), a pinned task that waits, a need with no record
      task('vmb:SHOP-3', 'need', 'p:vmb:shop'),
      task('vmb:SHOP-4', 'need', 'p:vmb:shop'),
      task('vma:ELIA-59', 'need', 'p:vma:home', { pinned: true }),
      task('vma:ELIA-60', 'need', 'p:vma:home', { at: NOW - 90 * MIN }),
      task('vma:ELIA-61', 'ready', 'p:vma:home'),
      task('vma:ELIA-62', 'done', 'p:vma:home', { doneAt: NOW - 5 * MIN }),
      // a done task's old alert stands no more
      task('vma:ELIA-63', 'done', 'p:vma:home', { doneAt: NOW - 2 * MIN }),
    ],
    needs: [
      { id: 'q1', chat: 'vmb:SHOP-3/worker', place: 'p:vmb:shop', task: 'vmb:SHOP-3', at: NOW - 30 * MIN, question: q('q1', 'Rerun CI?') },
      { id: 'q2', chat: 'vmb:SHOP-4/worker', place: 'p:vmb:shop', task: 'vmb:SHOP-4', at: NOW - 20 * MIN, question: q('q2', 'Ship it?') },
      { id: 'q3', chat: 'vmb:SHOP-4/worker', place: 'p:vmb:shop', task: 'vmb:SHOP-4', at: NOW - 10 * MIN, question: q('q3', 'And the docs?') },
      { id: 'q4', chat: 'vma:ELIA-59/worker', place: 'p:vma:home', task: 'vma:ELIA-59', at: NOW - 25 * MIN, question: q('q4', 'Which colour?') },
      // the shop's Assistant asks, and wants a secret
      { id: 'q5', chat: 'c:p:vmb:shop', place: 'p:vmb:shop', at: NOW - 15 * MIN, question: q('q5', 'Plan the sale?') },
      { id: 's1', chat: 'c:p:vmb:shop', place: 'p:vmb:shop', at: NOW - 14 * MIN, secret: { name: 'SHOP_KEY', why: 'the sale' } },
    ],
    alerts: [
      { id: 'a1', at: NOW - 3 * MIN, title: 'ELIA-57 · One-time steps', body: 'Google phone prompt, two 1Password asks', chat: 'vma:ELIA-57/worker', place: 'p:vma:home', notify: true },
      { id: 'a2', at: NOW - 40 * MIN, title: 'ELIA-58 · Old news', body: 'gone by now', chat: 'vma:ELIA-58/worker', place: 'p:vma:home', notify: true },
      { id: 'a3', at: NOW - 1 * MIN, title: 'ELIA-63 · Finished', body: 'its task is done', chat: 'vma:ELIA-63/worker', place: 'p:vma:home', notify: true },
    ],
    // home's Assistant said something new; the shop's too, but its card says so already; quiet's is muted
    last: { 'c:p:vma:home': NOW - 4 * MIN, 'c:p:vmb:shop': NOW - 2 * MIN, 'c:p:vma:quiet': NOW - 2 * MIN },
    read: { 'c:p:vma:home': NOW - 50 * MIN },
    settings: [{ level: 'p:vma:quiet', rows: [{ key: 'notify', value: 'Off' }] }],
    automations: { 'p:vmb:shop': [{ name: 'nightly', what: 'Every night', listName: 'shop', machine: 'vmb', error: 'No such folder', failed: 'start', runs: [{ at: NOW - 35 * MIN, error: 'No such folder' }] }] },
    artifacts: [], asks: {},
    ...over,
  } as unknown as Snapshot
}

/** the Tasks panel by status, everything: its groups' rows (a task as task:<id>, the rest by their key) and counts, as
 *  web/plugins/tasks/client.tsx lays them out (its Needs you: the group's tasks and the rest, in Needs you's order) */
function panel(snap: Snapshot) {
  const gs = shownGroups(snap, all, { groups: 'status', allDone: [], shut: [] })
  const ws = needsIn(snap, all)
  const rank = (k: string) => ws.findIndex((w) => (w.task ? `task:${w.task}` : w.key) === k)
  const need = gs.find((x) => x.key === 'need')
  const needs = [...(need?.tasks ?? []).map((t) => `task:${t.id}`), ...ws.filter((w) => !w.task).map((w) => w.key)].sort((a, b) => rank(a) - rank(b))
  const of = (k: string) => gs.find((x) => x.key === k)?.count ?? 0
  return { needs, counts: { needs: needs.length, ready: of('ready'), working: of('work') + of('merging') }, pinned: gs.find((x) => x.key === 'pinned')?.tasks.map((t) => t.id) ?? [] }
}

/** the glance doc's Needs you, the same way (a task's item as task:<id>) */
function phone(snap: Snapshot) {
  const doc = glanceOf(snap, alertsOf(snap), NOW)
  return { needs: doc.items.filter((i) => i.kind === 'needs').map((i) => (i.task ? `task:${i.task}` : i.key)), counts: doc.counts, doc }
}

describe('Needs you is one rule: the web app and the glance feed list the same (SHEP-250)', () => {
  test('the same items, in the same order, oldest first', () => {
    const snap = fleet()
    const web = panel(snap), app = phone(snap)
    expect(web.needs).toEqual(app.needs)
    expect(app.needs).toEqual([
      'task:vma:ELIA-60', // a need with no record, 90 min
      'auto:vmb:shop:nightly', // a failed automation, 35 min
      'task:vmb:SHOP-3', // its question, 30 min
      'task:vma:ELIA-59', // pinned, but it waits: in Needs you
      'task:vmb:SHOP-4', // two cards, one row
      'need:c:p:vmb:shop:q5', // the shop Assistant's question
      'need:c:p:vmb:shop:s1', // its secret ask
      'task:vma:ELIA-57', // a working task's alert
    ])
    // the pinned task waits, so it is in Needs you only
    expect(web.pinned).toEqual([])
  })

  test('the same counts: the Tasks panel, the phone, the header, the sidebar and the app icon', () => {
    const snap = fleet()
    const web = panel(snap), app = phone(snap)
    expect(web.counts).toEqual({ needs: app.counts.needs, ready: app.counts.ready, working: app.counts.working })
    expect(app.counts).toMatchObject({ needs: 8, ready: 1, working: 3 })
    expect(app.doc.groups.find((x) => x.kind === 'needs')!.count).toBe(8)
    // the header's Needs you, the spaces' red counts added up, the app icon
    expect(needsYou(snap, NOW).length).toBe(8)
    expect(snap.places.reduce((n, p) => n + counts(snap, p.id).ownNeed, 0)).toBe(8)
    expect(waiting(snap, NOW).count).toBe(app.counts.needs + app.counts.ready)
  })

  test('it leaves everywhere at once: read, answered, the alert gone', () => {
    const snap = fleet({ read: { 'c:p:vma:home': NOW }, needs: fleet().needs.filter((n) => n.id !== 'q1'), alerts: [] })
    const web = panel(snap), app = phone(snap)
    expect(web.needs).toEqual(app.needs)
    expect(app.needs).not.toContain('task:vma:ELIA-57')
    expect(app.needs.some((k) => k.startsWith('msg:'))).toBe(false)
    // SHOP-3 still says Needs you, with no card left: it stays until its status moves
    expect(app.needs).toContain('task:vmb:SHOP-3')
    // ELIA-57 is back in Working, on both
    expect(app.counts.working).toBe(4)
    expect(web.counts.working).toBe(4)
  })

  test('an alert 15 minutes old has gone from both', () => {
    const snap = fleet({ alerts: [{ ...fleet().alerts![0], at: NOW - 16 * MIN }] })
    expect(panel(snap).needs).toEqual(phone(snap).needs)
    expect(phone(snap).needs).not.toContain('task:vma:ELIA-57')
  })

  test("Elias's evening: an Assistant's unread message and a working task's alert, on both", () => {
    const snap = fleet({
      tasks: fleet().tasks.filter((t) => t.status === 'work' || t.status === 'done'),
      needs: [], automations: {}, alerts: [fleet().alerts![0]], read: { 'c:p:vma:home': NOW - 50 * MIN, 'c:p:vmb:shop': NOW },
    })
    const web = panel(snap), app = phone(snap)
    // SHEP-253: the Assistant's message is Chat's, not a task: only the task's alert needs you
    expect(app.needs).toEqual(['task:vma:ELIA-57'])
    expect(web.needs).toEqual(app.needs)
    expect(web.counts).toMatchObject({ needs: 1, working: 2 })
    expect(app.doc.unread).toBe(1)
  })

  test('an Assistant\'s unread messages are no rows, no counts, no badge in Tasks; the feed has them as unread (SHEP-253)', () => {
    const snap = fleet({ tasks: [], needs: [], automations: {}, alerts: [], read: {} })
    const web = panel(snap), app = phone(snap)
    expect(web.needs).toEqual([])
    expect(app.needs).toEqual([])
    expect(app.counts.needs).toBe(0)
    expect(needsYou(snap, NOW)).toEqual([])
    expect(snap.places.reduce((n, p) => n + counts(snap, p.id).ownNeed, 0)).toBe(0)
    expect(waiting(snap, NOW).count).toBe(0)
    expect(app.doc.items.some((i) => (i.type as string) === 'msg')).toBe(false)
    expect(app.doc.unread).toBeGreaterThan(0)
  })
})
