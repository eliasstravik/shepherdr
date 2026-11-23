import { describe, expect, test } from 'bun:test'
import { IDLE, shownWords, step, type DictEvent, type DictState } from './dictstate.ts'

// SHEP-314: the composer's recording surface; its states and what each step writes into the box
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
  test('mic, the browser asks, recording, Done, writing it down, the words land once', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'asking', at: 1 }, { t: 'phase', p: 'on', at: 5 }])
    expect(r.s).toEqual({ k: 'on', since: 5 })
    // the time stops where Done was pressed
    expect(run([{ t: 'phase', p: 'writing', at: 9 }], r.s).s).toEqual({ k: 'writing', took: 4 })
    const w = run([{ t: 'phase', p: 'writing', at: 9 }, { t: 'end', text: '  add a cancel button ' }], r.s)
    expect(w.s).toEqual(IDLE)
    expect(w.wrote).toEqual(['add a cancel button'])
  })
  test('the question still open after a moment says what it waits for', () => {
    expect(run([{ t: 'start' }, { t: 'slow' }]).s).toEqual({ k: 'asking', slow: true })
    expect(run([{ t: 'slow' }]).s).toEqual(IDLE)
  })
  test('Cancel writes nothing, whenever it comes, and what the recording sends after it is dropped', () => {
    for (const before of [[{ t: 'start' }], [{ t: 'start' }, { t: 'phase', p: 'on', at: 1 }], [{ t: 'start' }, { t: 'phase', p: 'on', at: 1 }, { t: 'phase', p: 'writing', at: 2 }]] as DictEvent[][]) {
      const r = run([...before, { t: 'cancel' }, { t: 'end', text: 'late words' }, { t: 'fail', why: 'late error' }])
      expect(r.s).toEqual(IDLE)
      expect(r.wrote).toEqual([])
    }
  })
  test('no words: back to the mic, nothing written', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 1 }, { t: 'phase', p: 'writing', at: 2 }, { t: 'end', text: '   ' }])
    expect(r).toEqual({ s: IDLE, wrote: [] })
  })
  test('an error stays in words until closed or tried again; the recording ending after it changes nothing', () => {
    const r = run([{ t: 'start' }, { t: 'phase', p: 'on', at: 1 }, { t: 'fail', why: 'Nothing was heard.' }, { t: 'end', text: null }])
    expect(r.s).toEqual({ k: 'error', why: 'Nothing was heard.' })
    expect(r.wrote).toEqual([])
    expect(run([{ t: 'dismiss' }], r.s).s).toEqual(IDLE)
    expect(run([{ t: 'start' }], r.s).s).toEqual({ k: 'asking', slow: false })
    expect(run([{ t: 'cancel' }], r.s).s).toEqual(IDLE)
  })
  test('Done is only Done while recording: a stray phase changes nothing', () => {
    expect(run([{ t: 'start' }, { t: 'phase', p: 'writing', at: 1 }]).s).toEqual({ k: 'asking', slow: false })
    expect(run([{ t: 'phase', p: 'on', at: 1 }]).s).toEqual(IDLE)
    const on: DictState = { k: 'on', since: 3 }
    expect(run([{ t: 'start' }], on).s).toBe(on)
  })
})

describe('the words while you speak', () => {
  test('the kept words, then the ones still being heard, one space between', () => {
    expect(shownWords({ said: 'Add a', partial: 'cancel but' })).toEqual({ said: 'Add a', partial: ' cancel but' })
    expect(shownWords({ said: '', partial: 'Add' })).toEqual({ said: '', partial: 'Add' })
    expect(shownWords({ said: ' Add a ', partial: '' })).toEqual({ said: 'Add a', partial: '' })
  })
})
