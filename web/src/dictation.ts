// Talk to type: the microphone records while a meter on it draws the wave; on Done the service writes it down
// (ElevenLabs speech to text, as the window's dictation), and the words go into the box to edit; cancel drops it.
import { levelOf, meter, TALKING, type Sample } from './meter.ts'

export interface Dictation {
  /** stop listening; the words still on their way come in, then the end callback gets them all */
  finish(): void
  /** stop listening and drop what was heard */
  cancel(): void
}

let current: Dictation | null = null
let level: AnalyserNode | null = null

export function canDictate() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

/** for the wave: how loud you are right now */
export function dictSample(): Sample {
  const l = levelOf(level)
  return { level: l, who: l > TALKING ? 'you' : null }
}

/** What the service answered to a recording: its words, or why it couldn't write them down in plain words. A failure
 *  used to land as no words at all, so Done just emptied the box's recording row and nothing came. */
export function heard(status: number, body: string): { text: string } | { error: string } {
  let r: { text?: unknown; error?: unknown } | null = null
  try {
    r = JSON.parse(body)
  } catch {
    r = null
  }
  if (r && typeof r.error === 'string' && r.error) return { error: r.error }
  if (status >= 200 && status < 300 && r && typeof r.text === 'string') return { text: r.text }
  return { error: status ? `Shepherdr couldn't write it down (error ${status}).` : "Shepherdr couldn't be reached." }
}

/** why the microphone didn't start, in plain words */
export function micError(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The microphone is blocked: allow it for this site in your browser’s settings.'
  if (name === 'NotFoundError') return 'No microphone was found.'
  return 'The microphone couldn’t start.'
}

/** Starts listening. `end` gets what was heard when it finishes, or null when cancelled; `fail` why it didn't work. Shepherdr 3: the phone records,
 *  the service has ElevenLabs write it down (the window's dictation, the same words on every phone browser). */
export function dictate(end: (text: string | null) => void, fail: (why: string) => void = () => undefined): Dictation {
  current?.cancel()
  let state: 'on' | 'finishing' | 'over' = 'on'
  let mic: MediaStream | null = null
  let ctx: AudioContext | null = null
  let rec: MediaRecorder | null = null
  const chunks: Blob[] = []
  const close = (text: string | null) => {
    if (state === 'over') return
    state = 'over'
    mic?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => undefined)
    level = null
    if (current === self) current = null
    end(text)
  }
  const self: Dictation = {
    finish() {
      if (state !== 'on') return
      state = 'finishing'
      if (!rec || rec.state === 'inactive') return close('')
      rec.onstop = async () => {
        const audio = new Blob(chunks, { type: rec?.mimeType || 'audio/webm' })
        let r: { text: string } | { error: string }
        if (!audio.size) r = { error: 'Nothing was recorded.' }
        else {
          try {
            const x = await fetch('api/dictate', { method: 'POST', body: audio, headers: { 'x-shepherdr': '1', 'content-type': audio.type } })
            r = heard(x.status, await x.text())
          } catch {
            r = heard(0, '')
          }
        }
        if ('error' in r) {
          if (state === 'over') return
          fail(r.error)
          close(null)
        } else close(r.text)
      }
      rec.stop()
    },
    cancel() {
      if (state === 'over') return
      if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop() }
      close(null)
    },
  }
  current = self
  navigator.mediaDevices
    ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => {
      if (state === 'over') return stream.getTracks().forEach((t) => t.stop())
      mic = stream
      ctx = new AudioContext()
      level = meter(ctx)
      ctx.createMediaStreamSource(stream).connect(level)
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start(1000)
    })
    .catch((e) => {
      if (state === 'over') return
      fail(micError(e))
      close(null)
    })
  return self
}
