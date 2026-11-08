// Talk to type: the microphone records while a meter on it draws the wave, and the words are written as you speak
// (ElevenLabs' realtime speech to text, core/voice.js liveWords, with a single-use token from the service): on Done the
// microphone stops at once and the last words land a moment later. If the live words can't come, the recording (kept
// meanwhile) goes to the service to be written down (ElevenLabs speech to text, as the window's dictation). The words
// go into the box to edit; cancel drops it, also while it's writing.
import * as V from '@core/voice.js'
import { levelOf, meter, TALKING, type Sample } from './meter.ts'
import { note } from './usage.ts'

const { liveUrl, liveChunk, liveWords, base64, to16k, LIVE_TAIL, LIVE_WAIT } = V as any

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

/** the audio worklet that hands the page the microphone's samples (for the live words), as a module from a blob */
const TAP = `registerProcessor('shepherdr-tap', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
})`
let tapUrl: string | null = null

/** The live words' socket for one dictation: open() with a token, send() the microphone's 16 kHz samples (kept until it
 *  opens), finish() asks for the last words: their text, or null when they can't come (then upload the recording). */
export function liveSession(token: Promise<string | null>, make: (url: string) => WebSocket = (u) => new WebSocket(u)) {
  const words = liveWords()
  let ws: WebSocket | null = null
  let broken = false
  let queue: string[] = []
  let landed: ((text: string | null) => void) | null = null
  const fail = () => { broken = true; landed?.(null); landed = null; queue = []; try { ws?.close() } catch { /* gone */ } }
  token.then((t) => {
    if (!t || broken) return fail()
    ws = make(liveUrl(t))
    ws.onopen = () => { for (const m of queue) ws?.send(m); queue = [] }
    ws.onmessage = (e) => {
      const r = words.hear(String(e.data))
      if (r === 'failed') fail()
      else if (r === 'words') { landed?.(words.text()); landed = null; try { ws?.close() } catch { /* gone */ } }
    }
    // closed before Done's words came (the network, ElevenLabs' limits): the recording is uploaded instead
    ws.onerror = () => fail()
    ws.onclose = () => fail()
  }, fail)
  const send = (m: string) => { if (broken) return; if (ws?.readyState === WebSocket.OPEN) ws.send(m); else queue.push(m) }
  return {
    get broken() { return broken },
    send(pcm: Uint8Array) { if (pcm.length) send(liveChunk(base64(pcm))) },
    finish(wait = LIVE_WAIT): Promise<string | null> {
      if (broken) return Promise.resolve(null)
      return new Promise((res) => {
        const t = setTimeout(() => { landed = null; fail(); res(null) }, wait)
        landed = (text) => { clearTimeout(t); res(text) }
        words.done()
        send(liveChunk(base64(LIVE_TAIL), true))
      })
    },
    close() { landed = null; broken = true; queue = []; try { ws?.close() } catch { /* gone */ } },
  }
}

/** a single-use token for the live words (null: not now; the recording is uploaded at Done instead) */
async function liveTokenFor(): Promise<string | null> {
  try {
    const r = await fetch('api/dictate/live', { method: 'POST', headers: { 'x-shepherdr': '1' } })
    const j = await r.json().catch(() => null)
    return r.ok && typeof j?.token === 'string' ? j.token : null
  } catch {
    return null
  }
}

/** Starts listening. `end` gets what was heard when it finishes, or null when cancelled; `fail` why it didn't work. Shepherdr 3: the phone records,
 *  the service has ElevenLabs write it down (the window's dictation, the same words on every phone browser).
 *  `timing` (tests, the proof) hears each step after Done: 'live' or 'upload' and how many ms Done to words took. */
export function dictate(end: (text: string | null) => void, fail: (why: string) => void = () => undefined,
  timing: (how: 'live' | 'upload', ms: number) => void = () => undefined): Dictation {
  current?.cancel()
  let state = 'on' as 'on' | 'finishing' | 'over'
  let mic: MediaStream | null = null
  let ctx: AudioContext | null = null
  let rec: MediaRecorder | null = null
  let upload: AbortController | null = null
  const chunks: Blob[] = []
  // the microphone's 16 kHz samples not sent yet (sent about every 100 ms, and the rest at Done)
  let pending: Uint8Array[] = [], size = 0
  const flush = () => {
    if (!size) return
    const all = new Uint8Array(size); let at = 0
    for (const p of pending) { all.set(p, at); at += p.length }
    pending = []; size = 0
    live?.send(all)
  }
  const live = typeof WebSocket !== 'undefined' ? liveSession(liveTokenFor()) : null
  // the microphone and the wave stop as soon as you're done: only the writing is left
  const quiet = () => {
    mic?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => undefined)
    ctx = null
    level = null
  }
  const over = () => state === 'over'
  const close = (text: string | null) => {
    if (over()) return
    state = 'over'
    quiet()
    live?.close()
    upload?.abort()
    if (current === self) current = null
    end(text)
  }
  const recording = () => new Promise<Blob>((res) => {
    if (!rec || rec.state === 'inactive') return res(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }))
    rec.onstop = () => res(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }))
    rec.stop()
  })
  const uploaded = async (audio: Blob): Promise<{ text: string } | { error: string }> => {
    if (!audio.size) return { error: 'Nothing was recorded.' }
    upload = new AbortController()
    try {
      const x = await fetch('api/dictate', { method: 'POST', body: audio, signal: upload.signal, headers: { 'x-shepherdr': '1', 'content-type': audio.type } })
      return heard(x.status, await x.text())
    } catch {
      return heard(0, '')
    }
  }
  const self: Dictation = {
    finish() {
      if (state !== 'on') return
      state = 'finishing'
      if (!rec || rec.state === 'inactive') return close('')
      const done = performance.now()
      const audio = recording()
      flush()
      quiet()
      void (async () => {
        const said = live && !live.broken ? await live.finish() : null
        if (over()) return
        if (said !== null) { timing('live', performance.now() - done); return close(said) }
        const r = await uploaded(await audio)
        if (over()) return
        timing('upload', performance.now() - done)
        if ('error' in r) {
          fail(r.error)
          close(null)
        } else close(r.text)
      })()
    },
    cancel() {
      if (state === 'over') return
      if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop() }
      close(null)
    },
  }
  current = self
  note('feature', { type: 'dictation' })
  navigator.mediaDevices
    ?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    .then(async (stream) => {
      if (state === 'over') return stream.getTracks().forEach((t) => t.stop())
      mic = stream
      ctx = new AudioContext()
      level = meter(ctx)
      const src = ctx.createMediaStreamSource(stream)
      src.connect(level)
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start(1000)
      // the live words: the microphone's samples, 16 kHz, to the socket as they come
      if (live && ctx.audioWorklet) {
        try {
          tapUrl ??= URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }))
          const c = ctx
          await c.audioWorklet.addModule(tapUrl)
          if (state !== 'on' || ctx !== c) return
          const tap = new AudioWorkletNode(c, 'shepherdr-tap')
          const down = to16k(c.sampleRate)
          tap.port.onmessage = (e) => {
            if (state !== 'on') return
            const pcm: Uint8Array = down(e.data as Float32Array)
            pending.push(pcm); size += pcm.length
            if (size >= 3200) flush()
          }
          src.connect(tap)
          // pulled by the graph on every browser, silent
          const mute = c.createGain()
          mute.gain.value = 0
          tap.connect(mute).connect(c.destination)
        } catch {
          live.close()
        }
      } else live?.close()
    })
    .catch((e) => {
      if (state === 'over') return
      fail(micError(e))
      close(null)
    })
  return self
}
