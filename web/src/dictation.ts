// Talk to type: the microphone records while a meter on it draws the wave, and the words are written as you speak
// (ElevenLabs' realtime speech to text, core/voice.js liveWords, with a single-use token from the service): on Done the
// microphone stops at once and the last words land a moment later. If the live words can't come, the recording (kept
// meanwhile) goes to the service to be written down (ElevenLabs speech to text, as the window's dictation), also when
// they come back empty (afterDone). The words go into the box to edit; cancel drops it, also while it's writing. When
// no words come, the mic says why (SAY), never nothing.
import * as V from '@core/voice.js'
import { levelOf, meter, TALKING, type Sample } from './meter.ts'

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

/** the time recorded, m:ss (the mic's pill while it records) */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** for the wave: how loud you are right now */
export function dictSample(): Sample {
  const l = levelOf(level)
  return { level: l, who: l > TALKING ? 'you' : null }
}

/** What the mic says when it can't write the words, in plain words (SHEP-307: on a phone it once wrote nothing and
 *  said nothing, so all the person could tell was "it still doesn't work"). The service's own reasons (no key for
 *  dictation, ElevenLabs' limits) come through heard() as it words them. */
export const SAY = {
  blocked: 'The microphone is blocked: allow it for this site in your browser’s settings.',
  noMic: 'No microphone was found.',
  busy: 'The microphone is in use by another app. Close it, then try again.',
  noStart: 'The microphone couldn’t start.',
  asking: 'Allow the microphone when your browser asks, then speak.',
  notYet: 'The microphone hadn’t started: allow it when your browser asks, then try again.',
  empty: 'The recording was empty. Check that the microphone isn’t muted, then try again.',
  unreached: "Shepherdr couldn't be reached.",
  slow: 'Shepherdr took too long to write it down. Try again.',
  silence: 'Nothing was heard. Try again a little closer to the microphone.',
  failedCode: (status: number) => `Shepherdr couldn't write it down (error ${status}).`,
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
  return { error: status ? SAY.failedCode(status) : SAY.unreached }
}

/** why the microphone didn't start, in plain words */
export function micError(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return SAY.blocked
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return SAY.noMic
  if (name === 'NotReadableError' || name === 'AbortError') return SAY.busy
  return SAY.noStart
}

type Written = { text: string } | { error: string }

/** After Done: the live words when they came and say something, else the recording uploaded and written down; words
 *  or why not, never nothing. An empty live answer is not taken as the result: on a phone whose microphone tap gave the
 *  live session no audio, it answered with no words, and the recording that had the words was never sent (SHEP-307).
 *  `live` is null when the live words can't come at all; null back means it was cancelled meanwhile. */
export async function afterDone(
  live: (() => Promise<string | null>) | null,
  upload: () => Promise<Written>,
  over: () => boolean = () => false,
  timing: (how: 'live' | 'upload') => void = () => undefined,
): Promise<Written | null> {
  const said = live ? await live().catch(() => null) : null
  if (over()) return null
  if (said?.trim()) {
    timing('live')
    return { text: said.trim() }
  }
  const r = await upload().catch(() => heard(0, ''))
  if (over()) return null
  timing('upload')
  if ('error' in r) return r
  return r.text.trim() ? { text: r.text.trim() } : { error: SAY.silence }
}

/** the audio worklet that hands the page the microphone's samples (for the live words), as a module from a blob */
const TAP = `registerProcessor('shepherdr-tap', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
})`
let tapUrl: string | null = null

/** The live words' socket for one dictation: open() with a token, send() the microphone's 16 kHz samples (kept until it
 *  opens), finish() asks for the last words: their text, or null when they can't come (then upload the recording). */
export interface Heard {
  /** the words kept so far */
  said: string
  /** the words still being heard (they may change) */
  partial: string
}

export function liveSession(token: Promise<string | null>, make: (url: string) => WebSocket = (u) => new WebSocket(u),
  /** the words so far, each time they change, while you speak (SHEP-314) */
  onWords: (w: Heard) => void = () => undefined) {
  const words = liveWords()
  let ws: WebSocket | null = null
  let broken = false
  let queue: string[] = []
  let landed: ((text: string | null) => void) | null = null
  const fail = () => { broken = true; landed?.(null); landed = null; queue = []; try { ws?.close() } catch { /* gone */ } }
  token.then((t) => {
    if (!t || broken) return fail()
    try {
      ws = make(liveUrl(t))
    } catch {
      return fail()
    }
    ws.onopen = () => { for (const m of queue) ws?.send(m); queue = [] }
    ws.onmessage = (e) => {
      const r = words.hear(String(e.data))
      if (r === null && !broken) onWords(words.shown())
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

/** how long Done waits for the recording to be written down before it says so */
const UPLOAD_WAIT = 90_000
/** how long the microphone's start waits for the audio to run (a phone's resume() can wait for a tap forever) */
const RESUME_WAIT = 1500

/** The audio for the wave and the live words, made inside the tap itself: Android's Chrome keeps an AudioContext made
 *  after an await (the microphone's permission) suspended, so its tap gets no samples. resume() here, in the tap. */
function audioContext(): AudioContext | null {
  const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    const c = new AC()
    c.resume().catch(() => undefined)
    return c
  } catch {
    return null
  }
}

/** resume() again once the microphone is on, bounded: true when the audio runs */
async function running(c: AudioContext): Promise<boolean> {
  if (c.state !== 'running') {
    await Promise.race([c.resume().catch(() => undefined), new Promise((r) => setTimeout(r, RESUME_WAIT))])
  }
  return c.state === 'running'
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
export type Phase = 'asking' | 'on' | 'writing'

export function dictate(end: (text: string | null) => void, fail: (why: string) => void = () => undefined,
  timing: (how: 'live' | 'upload', ms: number) => void = () => undefined,
  /** what the button shows: waiting for the microphone (its permission), recording, writing it down */
  phase: (p: Phase) => void = () => undefined,
  /** the live words as they come (only while the live words work; the upload has none until Done) */
  words: (w: Heard) => void = () => undefined): Dictation {
  current?.cancel()
  let state = 'on' as 'on' | 'finishing' | 'over'
  let mic: MediaStream | null = null
  // made here, inside the tap, so a phone lets it run (see audioContext)
  let ctx: AudioContext | null = audioContext()
  let rec: MediaRecorder | null = null
  let upload: AbortController | null = null
  const chunks: Blob[] = []
  // the microphone's 16 kHz samples not sent yet (sent about every 100 ms, and the rest at Done); tapped: all of them
  let pending: Uint8Array[] = [], size = 0, tapped = 0
  const flush = () => {
    if (!size) return
    const all = new Uint8Array(size); let at = 0
    for (const p of pending) { all.set(p, at); at += p.length }
    pending = []; size = 0
    live?.send(all)
  }
  let live: ReturnType<typeof liveSession> | null = null
  try {
    live = typeof WebSocket !== 'undefined' ? liveSession(liveTokenFor(), undefined, (w) => { if (state !== 'over') words(w) }) : null
  } catch {
    live = null
  }
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
  const failed = (why: string) => {
    if (over()) return
    fail(why)
    close(null)
  }
  const recording = () => new Promise<Blob>((res) => {
    if (!rec || rec.state === 'inactive') return res(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }))
    rec.onstop = () => res(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }))
    try {
      rec.stop()
    } catch {
      res(new Blob(chunks, { type: rec?.mimeType || 'audio/webm' }))
    }
  })
  const uploaded = async (audio: Blob): Promise<Written> => {
    if (!audio.size) return { error: SAY.empty }
    const a = (upload = new AbortController())
    let slow = false
    const t = setTimeout(() => { slow = true; a.abort() }, UPLOAD_WAIT)
    try {
      const x = await fetch('api/dictate', { method: 'POST', body: audio, signal: a.signal, headers: { 'x-shepherdr': '1', 'content-type': audio.type } })
      return heard(x.status, await x.text())
    } catch {
      return slow ? { error: SAY.slow } : heard(0, '')
    } finally {
      clearTimeout(t)
    }
  }
  const self: Dictation = {
    finish() {
      if (state !== 'on') return
      state = 'finishing'
      // Done before the microphone started (its permission still open): nothing to write down, and say why
      if (!rec || rec.state === 'inactive') return failed(mic ? SAY.empty : SAY.notYet)
      phase('writing')
      const done = performance.now()
      const audio = recording()
      flush()
      quiet()
      // live words only when the tap gave the session audio; else (a phone's silent tap) straight to the upload
      const said = live && !live.broken && tapped > 0 ? () => live!.finish() : null
      void afterDone(said, async () => uploaded(await audio), over, (how) => timing(how, performance.now() - done)).then((r) => {
        if (!r) return
        if ('error' in r) failed(r.error)
        else close(r.text)
      })
    },
    cancel() {
      if (state === 'over') return
      if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* gone */ } }
      close(null)
    },
  }
  current = self
  phase('asking')
  const asked = navigator.mediaDevices?.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  if (!asked) {
    failed(SAY.noMic)
    return self
  }
  asked
    .then(async (stream) => {
      if (state !== 'on') return stream.getTracks().forEach((t) => t.stop())
      mic = stream
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start(1000)
      phase('on')
      // the recording runs whatever the audio below does: it is what Done uploads when the live words can't come
      const c = ctx
      if (!c) return live?.close()
      try {
        const src = c.createMediaStreamSource(stream)
        level = meter(c)
        src.connect(level)
        await running(c)
        if (state !== 'on' || ctx !== c) return
        // the live words: the microphone's samples, 16 kHz, to the socket as they come
        if (!live || !c.audioWorklet) return live?.close()
        tapUrl ??= URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }))
        await c.audioWorklet.addModule(tapUrl)
        if (state !== 'on' || ctx !== c) return
        const tap = new AudioWorkletNode(c, 'shepherdr-tap')
        const down = to16k(c.sampleRate)
        tap.port.onmessage = (e) => {
          if (state !== 'on') return
          const pcm: Uint8Array = down(e.data as Float32Array)
          pending.push(pcm); size += pcm.length; tapped += pcm.length
          if (size >= 3200) flush()
        }
        src.connect(tap)
        // pulled by the graph on every browser, silent
        const mute = c.createGain()
        mute.gain.value = 0
        tap.connect(mute).connect(c.destination)
      } catch {
        // no wave or live words (a failed worklet): Done uploads the recording
        live?.close()
      }
    })
    .catch((e) => failed(micError(e)))
  return self
}
