import { expect, test } from 'bun:test'
import { newsWords } from '../../../core/chat-view.js'
import { newsRow } from './news.ts'

const LONG = 'The proof was listed under the scratchpad folder, so ready said there was no such artifact for the task. '.repeat(2)
const REPORT = "herdr-artifact publish registers a proof under the shell's cwd · Goal: publish a proof. Tried: ran it. Fix: use the task's folder."
const said = (event: string, text: string, title = 'Research') => {
  const w = newsWords({ ref: 'SHOP-2', event, text }, { title })
  return { task: 'SHOP-2', ref: 'SHOP-2', event, ...w }
}

test("a feedback report is one quiet row naming its task, opening to the report, never the report as words", () => {
  expect(newsRow(said('feedback', `"Research" feedback: ${REPORT}`), 'Research')).toEqual({ label: 'Feedback noted from Research', body: REPORT })
  // an older line without the title, and a task the app doesn't know: still the row, named by its key
  expect(newsRow(said('feedback', `Feedback: ${REPORT}`, ''), '')?.label).toBe('Feedback noted from SHOP-2')
})

test('started, ready and done draw nothing; every other event is one row', () => {
  for (const e of ['started', 'working-again', 'ready', 'done']) expect(newsRow(said(e, `"Research" is ${e}`), 'Research')).toBeNull()
  for (const e of ['needs-you', 'failed', 'told', 'accept-failed', 'stalled', 'something-new']) {
    const r = newsRow(said(e, `"Research" ${e}: ${LONG}`), 'Research')
    expect(r).not.toBeNull()
    expect(r!.label.length).toBeLessThan(40)
    expect(r!.body).toBe(LONG.trim())
  }
  expect(newsRow(said('needs-you', '"Research" needs you: Needs a go'), 'Research')).toEqual({ label: 'Needs you: Needs a go', body: '' })
  expect(newsRow(said('accept-failed', '"Research" accept-failed: the merge hit a conflict'), 'Research')?.label).toBe('Accept failed: the merge hit a conflict')
  expect(newsRow({ task: 'SHOP-2', ref: 'SHOP-2', mark: 'needs', what: '', text: 'Stripe or Adyen?' }, 'Pay')).toEqual({ label: 'Needs you: Stripe or Adyen?', body: '' })
})
