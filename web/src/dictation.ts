// Talk to type: the microphone records while a meter on it draws the wave; on Done the service writes it down
// (whisper.cpp, as the window's dictation), and the words go into the box to edit; cancel drops it.
import { levelOf, meter, TALKING, type Sample } from './meter.ts'

type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void
  onend: () => void
  onerror: (e: { error: string }) => void
  start(): void
  stop(): void
  abort(): void
}

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

/** Starts listening. `end` gets what was heard when it finishes, or null when cancelled. Shepherdr 3: the phone records,
 *  the service writes it down with whisper.cpp (the window's dictation, the same words on every phone browser). */
export function dictate(end: (text: string | null) => void): Dictation {
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
        try {
          const r = await fetch('api/dictate', { method: 'POST', body: audio, headers: { 'x-shepherdr': '1', 'content-type': audio.type } }).then((x) => x.json())
          close(r.text ?? '')
        } catch {
          close('')
        }
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
    .catch(() => close(null))
  return self
}
