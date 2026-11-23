import { describe, expect, test } from 'bun:test'
import { IDLE, insertAt, step, type DictEvent, type DictState } from './dictstate.ts'

// SHEP-314, SHEP-334: the composer as the dictation surface; its states and what each step writes into the box
const run = (events: DictEvent[], from: DictState = IDLE) => {
  let s = from
  const wrote: string[] = []
  for (const e of events) {
    const r = step(s, e)
    s = r.s
    if (r.write) wrote.push(r.write)
  }
  return { s, wrote }
}

describe('the dictation surface', () => {
  test('1: the mic starts neutral, not asking: "Allow the microphone" only when the browser really asks', () => {
    expect(run([{ t: 'start' }]).s).toEqual({ k: 'starting' })
    // allowed long ago: straight from starting to listening, never asking
    expect(run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }]).s).toEqual({ k: 'on', since: 5 })
    // the browser asks: asking, then listening once allowed
    expect(run([{ t: 'start' }, { t: 'phase', p: 'asking', at: 5 }]).s).toEqual({ k: 'asking' })
    expect(run([{ t: 'start' }, { t: 'phase', p: 'asking', at: 5 }, { t: 'phase', p: 'on', at: 5 }]).s).toEqual({ k: 'on', since: 5 })
    // a late "asking" after the audio started changes nothing
    expect(run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }, { t: 'phase', p: 'asking', at: 5 }]).s).toEqual({ k: 'on', since: 5 })
  })
  test('2: the bottom row as 3.2.2 has it: the time runs from the first audio and stops where Done was pressed', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }])
    expect(r.s).toEqual({ k: 'on', since: 5 })
    expect(run([{ t: 'phase', p: 'writing', at: 9 }], r.s).s).toEqual({ k: 'writing', took: 4 })
  })
  test('3, 4: nothing is written while listening; the words land once, in one go, after Done', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }])
    expect(r.wrote).toEqual([])
    const w = run([{ t: 'phase', p: 'writing', at: 5 }, { t: 'end', text: '  Add a cancel button. ' }, { t: 'end', text: 'again' }], r.s)
    expect(w.s).toEqual(IDLE)
    expect(w.wrote).toEqual(['Add a cancel button.'])
  })
  test('5: Cancel writes nothing, whenever it comes, and what the recording sends after it is dropped', () => {
    for (const before of [[{ t: 'start' }], [{ t: 'start' }, { t: 'phase', p: 'asking', at: 5 }], [{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }], [{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }, { t: 'phase', p: 'writing', at: 5 }]] as DictEvent[][]) {
      const r = run([...before, { t: 'cancel' }, { t: 'end', text: 'late words' }, { t: 'fail', why: 'late error' }])
      expect(r.s).toEqual(IDLE)
      expect(r.wrote).toEqual([])
    }
  })
  test('no words: back to the mic, nothing written', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }, { t: 'phase', p: 'writing', at: 5 }, { t: 'end', text: '   ' }])
    expect(r).toEqual({ s: IDLE, wrote: [] })
  })
  test('an error stays in words until closed or tried again; the recording ending after it changes nothing', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 5 }, { t: 'fail', why: 'Nothing was heard.' }, { t: 'end', text: null }])
    expect(r.s).toEqual({ k: 'error', why: 'Nothing was heard.' })
    expect(r.wrote).toEqual([])
    expect(run([{ t: 'dismiss' }], r.s).s).toEqual(IDLE)
    expect(run([{ t: 'start' }], r.s).s).toEqual({ k: 'starting' })
    expect(run([{ t: 'cancel' }], r.s).s).toEqual(IDLE)
  })
  test('Done is only Done while listening: a stray phase changes nothing', () => {
    expect(run([{ t: 'start' }, { t: 'phase', p: 'writing', at: 5 }]).s).toEqual({ k: 'starting' })
    expect(run([{ t: 'phase', p: 'on', at: 5 }]).s).toEqual(IDLE)
    const on: DictState = { k: 'on', since: 3 }
    expect(run([{ t: 'start' }], on).s).toBe(on)
  })
})

describe('5: where the words go in the box', () => {
  test('at the cursor, with a space where needed, what was typed stays', () => {
    expect(insertAt('', null, 'Hello there.')).toEqual({ value: 'Hello there.', caret: 12 })
    expect(insertAt('Fix this', null, 'Then merge.')).toEqual({ value: 'Fix this Then merge.', caret: 20 })
    expect(insertAt('Fix this ', { start: 9, end: 9 }, 'now')).toEqual({ value: 'Fix this now', caret: 12 })
    // in the middle: a space on both sides, the rest after it kept
    expect(insertAt('Fix this. Merge it.', { start: 9, end: 9 }, 'Test it.')).toEqual({ value: 'Fix this. Test it. Merge it.', caret: 18 })
    expect(insertAt('Fix this.Merge it.', { start: 9, end: 9 }, 'Test it.')).toEqual({ value: 'Fix this. Test it. Merge it.', caret: 18 })
    // at the start
    expect(insertAt('merge it', { start: 0, end: 0 }, 'Please')).toEqual({ value: 'Please merge it', caret: 6 })
  })
  test('over a selection: it takes the selected words’ place', () => {
    expect(insertAt('Send it to Anna now', { start: 11, end: 15 }, 'Bob')).toEqual({ value: 'Send it to Bob now', caret: 14 })
  })
  test('nothing dictated or a cursor past the end: the box is unchanged or written at its end', () => {
    expect(insertAt('Keep me', { start: 2, end: 2 }, '  ')).toEqual({ value: 'Keep me', caret: 2 })
    expect(insertAt('Keep me', { start: 99, end: 120 }, 'and this')).toEqual({ value: 'Keep me and this', caret: 16 })
  })
})
