// The dictation surface's states (SHEP-314, SHEP-334): idle (the mic), starting (pressed, no audio yet: the row as it
// is, no words), asking (only when the browser really asks for the microphone), on (recording: the wave and the time,
// no words), writing (after Done, until the clean text lands) and error (why it didn't work, in words). One step function, so the rules are
// tested apart from the page: Cancel writes nothing, whatever the recording sends after a Cancel is dropped, and the
// words are written once.
import type { Phase } from './dictation.ts'

export type DictState =
  | { k: 'idle' }
  | { k: 'starting' }
  | { k: 'asking' }
  | { k: 'on'; since: number }
  | { k: 'writing'; took: number }
  | { k: 'error'; why: string }

export type DictEvent =
  /** the mic tapped (or Try again) */
  | { t: 'start' }
  /** what the recording says it is doing now */
  | { t: 'phase'; p: Phase; at: number }
  /** the recording's end: its words, or null (cancelled, or after a failure) */
  | { t: 'end'; text: string | null }
  /** why it didn't work */
  | { t: 'fail'; why: string }
  /** Cancel, Escape, leaving the chat */
  | { t: 'cancel' }
  /** the error read and closed */
  | { t: 'dismiss' }

export const IDLE: DictState = { k: 'idle' }

/** the next state, and the words to write into the box when there are some */
export function step(s: DictState, e: DictEvent): { s: DictState; write?: string } {
  switch (e.t) {
    case 'start':
      return s.k === 'idle' || s.k === 'error' ? { s: { k: 'starting' } } : { s }
    case 'phase':
      if (e.p === 'asking' && s.k === 'starting') return { s: { k: 'asking' } }
      if (e.p === 'on' && (s.k === 'starting' || s.k === 'asking')) return { s: { k: 'on', since: e.at } }
      if (e.p === 'writing' && s.k === 'on') return { s: { k: 'writing', took: Math.max(0, e.at - s.since) } }
      return { s }
    case 'end': {
      // after a Cancel (idle) or a failure (error) the recording has nothing more to say
      if (s.k === 'idle' || s.k === 'error') return { s }
      const text = e.text?.trim()
      return text ? { s: IDLE, write: text } : { s: IDLE }
    }
    case 'fail':
      return s.k === 'idle' ? { s } : { s: { k: 'error', why: e.why } }
    case 'cancel':
      return { s: IDLE }
    case 'dismiss':
      return s.k === 'error' ? { s: IDLE } : { s }
  }
}

/** Where the dictated words go: at the cursor (over what was selected), with a space between them and the words on
 *  either side where there is none, never clearing what was typed. Back: the box's new text and the cursor after them. */
export function insertAt(value: string, at: { start: number; end: number } | null, text: string): { value: string; caret: number } {
  const t = text.trim()
  if (!t) return { value, caret: at?.end ?? value.length }
  const start = Math.max(0, Math.min(at?.start ?? value.length, value.length))
  const end = Math.max(start, Math.min(at?.end ?? start, value.length))
  const before = value.slice(0, start)
  const after = value.slice(end)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const out = `${before}${lead}${t}${trail}${after}`
  return { value: out, caret: before.length + lead.length + t.length }
}
