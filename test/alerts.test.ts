// Push alerts: words you can decide from on an iPhone's lock screen, a tap that opens on the card, one alert per task and
// the app icon's count.
import { describe, expect, test } from 'bun:test'
import { DemoWorld } from '../server/demo/world.ts'
import { alertUrl, askText, BODY_MAX, keptTags, pushPayload, taskAlert, TITLE_MAX, waiting } from '../shared/alerts.ts'
import type { Chat, Question } from '../shared/types.ts'

const w = new DemoWorld()
const snap = w.snapshot()
const task = (id: string) => {
  const t = snap.tasks.find((x) => x.id === id)!
  return { rec: { id: t.id, title: t.name, project: t.place, said: t.said }, status: t.status as 'need' | 'ready', sub: t.sub ?? '', chat: w.chat(`${id}/Agent`) }
}
const alertOf = (id: string) => {
  const t = task(id)
  return taskAlert(t.rec, t.status, t.sub, { task: t.chat })
}
const q = (over: Partial<Question>): Question => ({ id: 'ask:1', title: 'Rerun CI on main?', kind: 'Form', choices: [{ label: 'Rerun it' }, { label: 'Skip the flaky test' }, { label: 'Leave it for now' }], to: 'x', ...over })

describe('what an alert says', () => {
  test('a plan: the task and what it needs, over the choices in short', () => {
    expect(alertOf('GTM-16')).toMatchObject({ title: 'GTM-16 · Plan to approve', body: 'Approve the plan · Send it back' })
  })
  test('a short question goes in the title, its choices in the body', () => {
    expect(alertOf('HP-201')).toMatchObject({ title: 'HP-201 · Where should Pinned live?', body: 'A filter on the filter row · Its own tab' })
    expect(askText('SHE-63', q({}))).toEqual({ title: 'SHE-63 · Rerun CI on main?', body: 'Rerun it · Skip the flaky test · Leave it for now' })
  })
  test('a question too long for the title moves into the body, over its choices', () => {
    const a = askText('SHE-63', q({ title: 'Should the webhook retry failed deliveries with backoff, or drop them?' }))
    expect(a.title).toBe('SHE-63 · Asks you')
    expect(a.body).toBe('Should the webhook retry failed deliveries with backoff, or drop them?\nRerun it · Skip the flaky test · Leave it for now')
  })
  test("a permission the agent's CLI asks for", () => {
    const a = alertOf('GTM-14')
    expect(a.title).toBe('GTM-14 · Asks you')
    expect(a.body).toStartWith('Allow: rm -rf template/skills/old?\n')
  })
  test('ready, waiting for a reply, gone wrong', () => {
    expect(alertOf('GTM-15').title).toBe('GTM-15 · Merge GTM-15?')
    const ready = taskAlert({ id: 'X-1', title: 'Fix the webhook', project: 'p' }, 'ready', 'Ready to merge', { task: { key: 'X-1/Agent', cli: 'Claude Code', messages: [{ id: 'm1', who: 'agent', text: 'All done.' }] } })
    expect(ready).toMatchObject({ title: 'X-1 · Ready to merge', body: 'Fix the webhook', go: { place: 'p', task: 'X-1', focus: 'm1' }, tag: 'X-1' })
    const reply = taskAlert({ id: 'X-1', title: 'Fix', project: 'p' }, 'need', 'Waits for your reply', { task: { key: 'X-1/Agent', cli: 'Claude Code', messages: [{ id: 'm1', who: 'agent', text: 'Ready to start; say go when the last fix is merged.' }] } })
    expect(reply).toMatchObject({ title: 'X-1 · Waits for your reply', body: 'Ready to start; say go when the last fix is merged.' })
    const wrong = taskAlert({ id: 'X-1', title: 'Fix', project: 'p' }, 'need', 'Went wrong: the worktree could not be made', {})
    expect(wrong).toMatchObject({ title: 'X-1 · Went wrong', body: 'the worktree could not be made' })
  })
  test('every title and body fits what a lock screen shows', () => {
    for (const t of snap.tasks.filter((x) => x.status === 'need' || x.status === 'ready')) {
      const a = alertOf(t.id)
      expect(a.title.length).toBeLessThanOrEqual(TITLE_MAX)
      expect(a.body.length).toBeLessThanOrEqual(BODY_MAX * 2 + 1)
    }
    const long = askText('SHE-63', q({ choices: Array.from({ length: 12 }, (_, i) => ({ label: `A rather long choice number ${i}` })) }))
    expect(long.body.length).toBeLessThanOrEqual(BODY_MAX)
    expect(long.body).toEndWith('…')
  })
})

describe('which card an alert is about', () => {
  const chat = (messages: Chat['messages']): Chat => ({ key: 'X/Agent', cli: 'Claude Code', messages })
  const about = (c: Chat, sub = 'Waits for your reply: ok') => taskAlert({ id: 'X', title: 'x', project: 'p' }, 'need', sub, { task: c })
  test('a plan answered by typing is no longer it: what came after is', () => {
    const a = about(chat([{ id: 'm1', who: 'agent', text: 'Here is my plan.', question: q({ id: 'plan:X:1', kind: 'Plan', title: 'Plan for X' }) }, { id: 'y1', who: 'you', text: 'Go ahead' }, { id: 'm2', who: 'agent', text: 'Done, have a look.' }]))
    expect(a).toMatchObject({ title: 'X · Waits for your reply', body: 'Done, have a look.', go: { focus: 'm2' } })
    expect(a.card).toBeUndefined()
  })
  test("a form of several questions: its first unanswered one, answered in the app (no buttons)", () => {
    const a = about(chat([{ id: 't#0', who: 'agent', question: q({ id: 't:0', title: 'First?', sent: 1 }) }, { id: 't#1', who: 'agent', question: q({ id: 't:1', title: 'Second?' }) }, { id: 't#2', who: 'agent', question: q({ id: 't:2', title: 'Third?' }) }]))
    expect(a).toMatchObject({ title: 'X · Second?', go: { focus: 't:1' } })
    expect(a.card).toBeUndefined()
  })
  test('a terminal menu: no buttons, its first choices all say yes', () => {
    const a = about(chat([{ id: 'menu:X/Agent', who: 'agent', question: q({ id: 'menu:X/Agent', title: 'Allow: rm -rf x?', choices: [{ label: 'Yes' }, { label: "Yes, and don't ask again" }, { label: 'No' }] }) }, { id: 'w', who: 'you', text: 'hi', waiting: true }]))
    expect(a).toMatchObject({ title: 'X · Allow: rm -rf x?', go: { focus: 'menu:X/Agent' } })
    expect(a.card).toBeUndefined()
  })
  test('a long question keeps its choices in the body', () => {
    const a = askText('SHE-63', q({ title: 'Why '.repeat(80) + '?' }))
    expect(a.body.length).toBeLessThanOrEqual(BODY_MAX)
    expect(a.body).toEndWith('\nRerun it · Skip the flaky test · Leave it for now')
  })
})

describe('where a tap opens', () => {
  test("a task's card: its chat, on that card", () => {
    const a = alertOf('GTM-16')
    const plan = task('GTM-16').chat.messages.find((m) => m.question?.kind === 'Plan')!
    expect(a.go).toEqual({ place: 'p:vm-str:gtm', task: 'GTM-16', focus: plan.question!.id })
    expect(alertUrl(a.go)).toBe(`./?place=p%3Avm-str%3Agtm&task=GTM-16&focus=${encodeURIComponent(plan.question!.id)}`)
  })
  test("a done task: its card in the project's chat", () => {
    const project: Chat = { key: 'p', cli: 'Claude Code', messages: [{ id: 'card:X-1:done|Merged', who: 'agent', text: 'X-1 is done', card: { id: 'card:X-1:done|Merged', task: 'X-1', status: 'done', text: 'is done' } }] }
    const a = taskAlert({ id: 'X-1', title: 'Fix', project: 'p', said: 'Fixed the webhook' }, 'done', 'Fixed the webhook', { project })
    expect(a).toMatchObject({ title: 'X-1 · Done', body: 'Fixed the webhook', go: { place: 'p', focus: 'card:X-1:done|Merged' } })
    expect(a.go.task).toBeUndefined()
  })
  test('a coordinator question: its chat, on the card', () => {
    expect(alertUrl({ place: 'all', focus: 'ask:12ab' })).toBe('./?place=all&focus=ask%3A12ab')
  })
})

describe('what goes to the device', () => {
  test("one alert per task: the task's id is its tag, and it waits", () => {
    const p = pushPayload({ id: 'u1', from: 'Shepherdr', ...alertOf('HP-201') }, waiting(snap))
    expect(p).toMatchObject({ id: 'u1', tag: 'HP-201', waits: true, title: 'HP-201 · Where should Pinned live?' })
    expect(p.url).toStartWith('./?place=')
  })
  test("a coordinator's plain alert keeps its own tag and its name, and never waits", () => {
    const p = pushPayload({ id: 'u2', from: 'All machines', title: 'Main is red', body: 'CI fails on main since 9:10', go: { place: 'all' } }, { count: 0, tags: [] })
    expect(p).toMatchObject({ tag: 'u2', title: 'All machines: Main is red', body: 'CI fails on main since 9:10', url: './?place=all' })
    expect(p.waits).toBeUndefined()
    expect(p.actions).toBeUndefined()
  })
  test("buttons answer the card: its first two choices, never one that needs a note or a pick of several", () => {
    const plan = pushPayload({ id: 'u', from: 'Shepherdr', ...alertOf('GTM-16') }, waiting(snap))
    expect(plan.actions).toEqual([{ action: '0', title: 'Approve the plan' }])
    expect(plan.answer).toEqual({ chat: 'GTM-16/Agent', question: task('GTM-16').chat.messages.find((m) => m.question?.kind === 'Plan')!.question!.id })
    const three = taskAlert({ id: 'X', title: 'x', project: 'p' }, 'need', '', { task: { key: 'X/Agent', cli: 'Claude Code', messages: [{ id: 'm', who: 'agent', question: q({}) }] } })
    expect(pushPayload({ id: 'u', from: 'Shepherdr', ...three }, { count: 1, tags: ['X'] }).actions).toEqual([
      { action: '0', title: 'Rerun it' },
      { action: '1', title: 'Skip the flaky test' },
    ])
    const multi = taskAlert({ id: 'X', title: 'x', project: 'p' }, 'need', '', { task: { key: 'X/Agent', cli: 'Claude Code', messages: [{ id: 'm', who: 'agent', question: q({ multi: true }) }] } })
    expect(multi.card).toBeUndefined()
  })
  test('an answered card is no longer the one an alert opens on', () => {
    const answered = taskAlert({ id: 'X', title: 'x', project: 'p' }, 'need', 'Waits for your reply: ok', { task: { key: 'X/Agent', cli: 'Claude Code', messages: [{ id: 'm', who: 'agent', text: 'Pick one', question: q({ sent: 0 }) }] } })
    expect(answered).toMatchObject({ title: 'X · Waits for your reply', go: { focus: 'm' } })
    expect(answered.card).toBeUndefined()
  })
})

describe("the app icon's count", () => {
  test('what waits on you: tasks that need you or are ready (not archived ones), and open coordinator questions', () => {
    const wt = waiting(snap)
    expect(wt.count).toBe(snap.needs.length + snap.tasks.filter((t) => !t.archived && t.status === 'ready').length)
    expect(wt.count).toBe(8)
    expect(wt.tags).not.toContain('GTM-11')
    expect(wt.tags).toContain('GTM-15')
    expect(wt.tags).toContain('ask:p:vm-str:gtm')
    expect(wt.tags).not.toContain('HP-202')
  })
  test("opening a card lets its alert go: a task's chat, a coordinator's chat", () => {
    const all = waiting(snap).tags
    expect(keptTags(snap, [])).toEqual(all)
    expect(keptTags(snap, ['GTM-15/Agent'])).toEqual(all.filter((t) => t !== 'GTM-15'))
    expect(keptTags(snap, ['p:vm-str:gtm', 'HP-201/Agent'])).toEqual(all.filter((t) => t !== 'ask:p:vm-str:gtm' && t !== 'HP-201'))
  })
  test('nothing waits: no count', () => {
    expect(waiting({ places: snap.places, tasks: [], asks: {}, needs: [] })).toEqual({ count: 0, tags: [] })
  })
  test('it follows an answer', async () => {
    const world = new DemoWorld()
    const before = waiting(world.snapshot()).count
    const card = world.chat('GTM-15/Agent').messages.find((m) => m.question?.title === 'Merge GTM-15?')!.question!
    await world.act({ type: 'answer', chat: 'GTM-15/Agent', question: card.id, choice: 0 })
    // its card and its Ready row both go
    expect(waiting(world.snapshot()).count).toBe(before - 2)
  })
})
