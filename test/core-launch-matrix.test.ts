import { expect, test } from 'bun:test'
import { Automations, type Automation } from '../server/automations.ts'
import { eventRules, matches, nextRuns, timeRule, type TriggerEvent } from '../server/common/trigger.ts'

const at = (value: string) => Date.parse(value)

test('recurrence matrix: minute, weekly, month end, exclusions and finite count', () => {
  for (const [rule, after, expected] of [
    ['FREQ=MINUTELY;INTERVAL=5', '2026-11-02T09:00:00Z', ['2026-11-02T09:05:00Z', '2026-11-02T09:10:00Z']],
    ['FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0', '2026-11-02T09:00:00Z', ['2026-11-09T09:00:00Z', '2026-11-16T09:00:00Z']],
    ['FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=9;BYMINUTE=0', '2026-10-30T00:00:00Z', ['2026-10-31T09:00:00Z', '2026-11-30T09:00:00Z']],
    ['DTSTART:20261102T090000 RRULE:FREQ=DAILY;COUNT=3 EXDATE:20261103T090000', '2026-11-02T08:00:00Z', ['2026-11-02T09:00:00Z', '2026-11-04T09:00:00Z']],
  ] as [string, string, string[]][]) expect(nextRuns(timeRule(rule), 'UTC', at(after), 3).slice(0, expected.length)).toEqual(expected.map(at))
  expect(nextRuns(timeRule('DTSTART:20261102T090000 RRULE:FREQ=DAILY;COUNT=2'), 'UTC', at('2026-11-03T09:00:00Z'), 2)).toEqual([])
})

test('timezone matrix: daily wall-clock time survives spring and autumn DST', () => {
  const rule = timeRule('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')
  expect(nextRuns(rule, 'Europe/Stockholm', at('2026-03-28T07:59:59Z'), 3)).toEqual(['2026-03-28T08:00:00Z', '2026-03-29T07:00:00Z', '2026-03-30T07:00:00Z'].map(at))
  expect(nextRuns(rule, 'Europe/Stockholm', at('2026-10-24T06:59:59Z'), 3)).toEqual(['2026-10-24T07:00:00Z', '2026-10-25T08:00:00Z', '2026-10-26T08:00:00Z'].map(at))
})

test('durable recurring cursor: two runs, reconstruction, pause/resume and bounded offline catch-up', () => {
  let saved: Automation[] = []
  const persistence = { read: () => structuredClone(saved), write: (rows: Automation[]) => { saved = structuredClone(rows) } }
  let model = new Automations(persistence)
  const start = at('2026-11-02T09:00:00Z')
  let rule = model.add({ place: 'p:box:demo', name: 'recurring', trigger: { time: timeRule('FREQ=MINUTELY;INTERVAL=1') }, task: { title: 'Harmless' } }, start)
  for (const minute of [1, 2]) {
    const now = start + minute * 60000
    expect(model.dueNow('UTC', now)).toHaveLength(1)
    model.fired(rule, { task: `DEMO-${minute}` }, now, true)
    model = new Automations(persistence); rule = model.find(rule.place, rule.name)!
    expect(model.dueNow('UTC', now)).toEqual([])
  }
  model.pause(rule.place, rule.name, false)
  expect(model.dueNow('UTC', start + 20 * 60000)).toEqual([])
  model.pause(rule.place, rule.name, true)
  expect(model.dueNow('UTC', start + 20 * 60000)).toHaveLength(1)
  model.fired(rule, { task: 'DEMO-3' }, start + 20 * 60000, true)
  expect(model.dueNow('UTC', start + 20 * 60000)).toEqual([])
  expect(rule.runs?.map(run => run.task)).toEqual(['DEMO-1', 'DEMO-2', 'DEMO-3'])
})

test('event matrix: every supported event matches only its exact filters', () => {
  const events: TriggerEvent[] = ['added', 'ready', 'failed', 'needs-you', 'merged', 'stalled', 'main-red', 'health']
  for (const event of events) {
    const rules = eventRules(`${event} space=demo branch=main title=Acceptance`)
    expect(matches(rules, { event, space: 'demo', branch: 'main', title: 'Acceptance check' })).toBe(true)
    for (const other of events.filter(value => value !== event)) expect(matches(rules, { event: other, space: 'demo', branch: 'main', title: 'Acceptance check' })).toBe(false)
    expect(matches(rules, { event, space: 'other', branch: 'main', title: 'Acceptance check' })).toBe(false)
    expect(matches(rules, { event, space: 'demo', branch: 'other', title: 'Acceptance check' })).toBe(false)
    expect(matches(rules, { event, space: 'demo', branch: 'main', title: 'Unrelated' })).toBe(false)
  }
})
