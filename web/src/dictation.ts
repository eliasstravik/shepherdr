// Talk to type: the browser's own speech recognition hears you while a meter on the microphone draws the wave. What
// it heard waits until you are done, then goes into the box to edit; cancel drops it.
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
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

/** for the wave: how loud you are right now */
export function dictSample(): Sample {
  const l = levelOf(level)
  return { level: l, who: l > TALKING ? 'you' : null }
}

/** Starts listening. `end` gets what was heard when it finishes, or null when cancelled. */
export function dictate(end: (text: string | null) => void): Dictation {
  current?.cancel()
  const w = window as unknown as Record<string, new () => Rec>
  const R = w.SpeechRecognition || w.webkitSpeechRecognition
  const heard: string[] = []
  let state: 'on' | 'finishing' | 'over' = 'on'
  let blocked = false
  let quick = 0
  let startedAt = 0
  let mic: MediaStream | null = null
  let ctx: AudioContext | null = null
  let rec: Rec | null = null
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
      rec?.stop()
      // the last words normally come within a moment; don't wait on a browser that never says it stopped
      setTimeout(() => close(heard.join(' ')), 2500)
    },
    cancel() {
      if (state === 'over') return
      rec?.abort()
      close(null)
    },
  }
  current = self
  if (!R) {
    queueMicrotask(() => close(null))
    return self
  }
  const listen = () => {
    startedAt = Date.now()
    try {
      rec!.start()
    } catch {
      close(heard.join(' '))
    }
  }
  rec = new R()
  rec.lang = navigator.language || 'en-US'
  rec.continuous = true
  rec.interimResults = false
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heard.push(e.results[i][0].transcript.trim())
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') blocked = true
  }
  rec.onend = () => {
    // a browser stops by itself after a pause: keep listening until Done, unless it keeps stopping straight away
    quick = Date.now() - startedAt < 1000 ? quick + 1 : 0
    if (state === 'on' && !blocked && quick < 3) return listen()
    close(heard.join(' '))
  }
  listen()
  // the wave's own ear on the microphone
  navigator.mediaDevices
    ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then((stream) => {
      if (state === 'over') return stream.getTracks().forEach((t) => t.stop())
      mic = stream
      ctx = new AudioContext()
      level = meter(ctx)
      ctx.createMediaStreamSource(stream).connect(level)
    })
    .catch(() => undefined)
  return self
}
