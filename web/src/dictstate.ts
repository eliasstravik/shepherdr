// The dictation surface's states (SHEP-314): idle (the mic), asking (the browser's microphone question), on
// (recording: the wave, the time, the words as they come), writing (after Done, until the words land) and error (why it
// didn't work, in words). One step function, so the rules are tested apart from the page: Cancel writes nothing, and
// whatever the recording sends after a Cancel is dropped.
import type { Heard, Phase } from './dictation.ts'

export type DictState =
  | { k: 'idle' }
  | { k: 'asking'; slow: boolean }
  | { k: 'on'; since: number }
  | { k: 'writing'; took: number }
  | { k: 'error'; why: string }

export type DictEvent =
  /** the mic tapped (or Try again) */
  | { t: 'start' }
  /** the browser's question still open after a moment: say what it waits for */
  | { t: 'slow' }
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
export const NOTHING: Heard = { said: '', partial: '' }

/** the next state, and the words to write into the box when there are some */
export function step(s: DictState, e: DictEvent): { s: DictState; write?: string } {
  switch (e.t) {
    case 'start':
      return s.k === 'idle' || s.k === 'error' ? { s: { k: 'asking', slow: false } } : { s }
    case 'slow':
      return s.k === 'asking' ? { s: { k: 'asking', slow: true } } : { s }
    case 'phase':
      if (e.p === 'on' && s.k === 'asking') return { s: { k: 'on', since: e.at } }
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

/** the words to show while you speak, as one line: the kept ones, then the ones still being heard */
export function shownWords(w: Heard): { said: string; partial: string } {
  const said = w.said.trim()
  const partial = w.partial.trim()
  return { said, partial: said && partial ? ` ${partial}` : partial }
}
