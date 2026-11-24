// Talk to type (SHEP-334): the microphone records while a meter on it draws the wave; nothing is written while you
// speak. Underneath, the words are already being written (ElevenLabs' realtime speech to text, core/voice.js liveWords,
// with a single-use token from the service), never shown: on Done the microphone stops at once and the clean text lands
// a moment later, in one go (ElevenLabs drops "um"s and false starts, tidyText the rest). If the live words can't come,
// the recording (kept meanwhile) goes to the service to be written down instead, also when they come back empty
// (afterDone); only one of the two ever writes. Cancel drops it, also while it's writing. When no words come, the mic
// says why (SAY), never nothing.
import * as V from '@core/voice.js'
import { levelOf, meter, TALKING, type Sample } from './meter.ts'

const { liveUrl, liveChunk, liveWords, base64, to16k, tidyText, LIVE_TAIL, LIVE_WAIT } = V as any

export interface Dictation {
  /** stop listening; the words still on their way come in, then the end callback gets them all */
  finish(): void
  /** stop listening and drop what was heard */
  cancel(): void
}

let current: Dictation | null = null
let level: AnalyserNode | null = null

/** the time recorded, m:ss (the bottom row's time while it records) */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function canDictate() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
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
  /** the installed app on Android: its microphone is the phone's setting for the app, not a browser's */
  blockedApp: 'The microphone is blocked: turn it on in your phone’s Settings › Apps › Shepherdr › Permissions › Microphone.',
  asking: 'Allow the microphone when asked, then speak.',
  notYet: 'The microphone hadn’t started: allow it when asked, then try again.',
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

/** the page runs as the app installed on an Android phone (not in a browser tab) */
export function androidApp(): boolean {
  try {
    return /Android/i.test(navigator.userAgent) && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || / wv\)/.test(navigator.userAgent))
  } catch {
    return false
  }
}

/** why the microphone didn't start, in plain words */
export function micError(e: unknown, app = androidApp()): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return app ? SAY.blockedApp : SAY.blocked
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return SAY.noMic
  if (name === 'NotReadableError' || name === 'AbortError') return SAY.busy
  return SAY.noStart
}

type Written = { text: string } | { error: string }

/** After Done: the live words when they came and say something, else the recording uploaded and written down, either
 *  tidied (tidyText); words
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
  const clean = (t: string): string => tidyText(t)
  if (clean(said ?? '')) {
    timing('live')
    return { text: clean(said!) }
  }
  const r = await upload().catch(() => heard(0, ''))
  if (over()) return null
  timing('upload')
  if ('error' in r) return r
  return clean(r.text) ? { text: clean(r.text) } : { error: SAY.silence }
}

/** the audio worklet that hands the page the microphone's samples (for the live words), as a module from a blob */
const TAP = `registerProcessor('shepherdr-tap', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true }
})`
let tapUrl: string | null = null

/** The live words' socket for one dictation: open() with a token, send() the microphone's 16 kHz samples (kept until it
 *  opens), finish() asks for the last words: their text, or null when they can't come (then upload the recording). The
 *  words heard meanwhile are never shown (SHEP-334: a word-for-word line while you talk is not dictation). */
export function liveSession(token: Promise<string | null>, make: (url: string) => WebSocket = (u) => new WebSocket(u), words: string[] = []) {
  const heard = liveWords()
  let ws: WebSocket | null = null
  let broken = false
  let queue: string[] = []
  let landed: ((text: string | null) => void) | null = null
  const fail = () => { broken = true; landed?.(null); landed = null; queue = []; try { ws?.close() } catch { /* gone */ } }
  token.then((t) => {
    if (!t || broken) return fail()
    try {
      ws = make(liveUrl(t, words))
    } catch {
      return fail()
    }
    ws.onopen = () => { for (const m of queue) ws?.send(m); queue = [] }
    ws.onmessage = (e) => {
      const r = heard.hear(String(e.data))
      if (r === 'failed') fail()
      else if (r === 'words') { landed?.(heard.text()); landed = null; try { ws?.close() } catch { /* gone */ } }
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
        heard.done()
        send(liveChunk(base64(LIVE_TAIL), true))
      })
    },
    close() { landed = null; broken = true; queue = []; try { ws?.close() } catch { /* gone */ } },
  }
}

/** SHEP-334: what the microphone is asked for. The browser's noise suppression and echo cancellation gate the quiet
 *  start of speech (the first syllables came out clipped), and dictation plays nothing to cancel: off. Its gain stays. */
export const MIC: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true }

/** SHEP-334: the live words are taken only when they heard the whole recording. Their tap starts after the recording
 *  (its audio module loads, a phone's audio waits to resume), so the opening words could be missing from them while
 *  the recording has them: then the recording is written down instead. liveSecs: the audio the live words got;
 *  recSecs: the recording's length; slack: what a tap's start may lag without losing a word. */
export const LIVE_SLACK = 0.3
export function wholeLive(liveSecs: number, recSecs: number, slack = LIVE_SLACK): boolean {
  return liveSecs > 0 && liveSecs >= recSecs - slack
}

/** Elias: "the line should only show once things actually register". A phone hands the page its microphone before
 *  real sound flows (its audio input still starting, the page's audio still waking up): the samples are exact zeros,
 *  and anything said then is lost. A real microphone is never exactly silent, so the first sample that isn't zero is
 *  the moment speech is really kept: only then does the wave (the signal to start talking) show. */
export function sounds(samples: ArrayLike<number>): boolean {
  for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return true
  return false
}

/** how long the getting-ready state waits for that first sound before it shows the wave anyway (a muted microphone
 *  gives only zeros; Done then says nothing was heard) */
export const SOUND_WAIT = 4000

/** how long the microphone stays on after Done, so the last word said as Done is tapped still gets in */
export const TAIL_KEEP = 250

/** how long a microphone asked for on the mic's press (warmMic) waits for the tap that uses it */
const WARM_KEEP = 1500
let early: { at: number; stream: Promise<MediaStream> } | null = null

/** SHEP-334: the microphone is asked for as the finger lands on the mic (pointerdown), not when it lifts (click), so it
 *  is on that much sooner: people start talking at once. Unused within WARM_KEEP (a scroll, not a tap), it stops. The
 *  microphone isn't kept on between dictations: a phone would show its recording sign all the time. */
export function warmMic() {
  if (!canDictate() || (early && performance.now() - early.at < WARM_KEEP)) return
  let stream: Promise<MediaStream>
  try {
    stream = navigator.mediaDevices.getUserMedia({ audio: MIC })
  } catch {
    return
  }
  stream.catch(() => undefined)
  const mine = (early = { at: performance.now(), stream })
  setTimeout(() => {
    if (early !== mine) return
    early = null
    stream.then((st) => st.getTracks().forEach((t) => t.stop()), () => undefined)
  }, WARM_KEEP)
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

/** how long the microphone may take to answer before the page says the browser is asking: a real prompt waits for a
 *  person (seconds), an allowed microphone answers well before (it was asked for as the finger landed: warmMic) */
export const ASK_WAIT = 1200

/** The microphone's permission, where the browser can say it without asking (navigator.permissions): 'granted',
 *  'prompt' or 'denied'; null where it can't. */
export async function micPermission(): Promise<PermissionState | null> {
  try {
    const p = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
    return p?.state ?? null
  } catch {
    return null
  }
}

/** set once the browser said 'prompt' and the microphone came anyway, with no hint needed: on this device that answer
 *  is not to be believed (the installed app on Android said 'prompt' on every start, though allowed long ago) */
const PROMPT_LIES = 'shepherdr.micPromptLies'
export const promptLies = {
  get(): boolean {
    try { return localStorage.getItem(PROMPT_LIES) === '1' } catch { return false }
  },
  set() {
    try { localStorage.setItem(PROMPT_LIES, '1') } catch { /* private mode: asked again next time */ }
  },
}

/** "Allow the microphone" only while the browser's prompt is really on screen, waiting for the person. SHEP-334: it
 *  once showed on every press; in 3.2.14 it flashed again on every start in the installed Android app, whose browser
 *  answered 'prompt' though the microphone was allowed, and the hint then stayed up until the first real sound.
 *  Now: never when 'granted'; never when 'denied' (the microphone refuses at once and the error says how to allow it);
 *  never where 'prompt' has proved untrue before (promptLies); else only once the microphone still hasn't answered
 *  after `wait` (a granted one answers sooner; a prompt waits for the person). `answered` says whether it has; `ask`
 *  shows it. Returns a stop for the wait. */
export function askWhen(perm: Promise<PermissionState | null>, answered: () => boolean, ask: () => void, wait = ASK_WAIT,
  lies: () => boolean = promptLies.get): () => void {
  let t: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  void perm.then((p) => {
    if (stopped || answered() || p === 'granted' || p === 'denied' || (p === 'prompt' && lies())) return
    t = setTimeout(() => { if (!stopped && !answered()) ask() }, wait)
  }, () => undefined)
  return () => { stopped = true; if (t) clearTimeout(t) }
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
 *  `timing` (tests, the proof) hears each step after Done: 'live' or 'upload' and how many ms Done to words took.
 *  Phases: 'asking' only when the browser really asks for the microphone (askWhen), 'given' once the microphone is
 *  handed over (any hint goes at once: a stream is proof it is allowed), 'on' from the first real sound (sounds),
 *  'writing' after Done. Before 'on' the surface is wordless: starting. */
export type Phase = 'asking' | 'given' | 'on' | 'writing'

export function dictate(end: (text: string | null) => void, fail: (why: string) => void = () => undefined,
  timing: (how: 'live' | 'upload', ms: number) => void = () => undefined,
  /** what the surface shows: the browser asking for the microphone, the microphone given (no hint, still getting
   *  ready), listening, writing it down */
  phase: (p: Phase) => void = () => undefined,
  /** the person's own words (spaces, machines): the writing is biased towards them (core/voice.js vocabulary) */
  words: string[] = []): Dictation {
  current?.cancel()
  const startedAt = performance.now()
  let state = 'on' as 'on' | 'finishing' | 'over'
  let mic: MediaStream | null = null
  // made here, inside the tap, so a phone lets it run (see audioContext)
  let ctx: AudioContext | null = audioContext()
  let rec: MediaRecorder | null = null
  let upload: AbortController | null = null
  const chunks: Blob[] = []
  // the microphone's 16 kHz samples not sent yet (sent about every 100 ms, and the rest at Done); tapped: all of them
  let pending: Uint8Array[] = [], size = 0, tapped = 0
  // when the recording started (the live words must cover it all: wholeLive), and whether the microphone is still on
  // heardAt: the first real sound (the wave shows from then: the person speaks only after it)
  let recAt = 0, heardAt = 0, hearing = true
  let poll: ReturnType<typeof setInterval> | null = null, giveUp: ReturnType<typeof setTimeout> | null = null
  /** sound really flows: the wave shows, and from now on every word is kept */
  const soundCame = () => {
    if (heardAt || state !== 'on') return
    heardAt = performance.now()
    if (poll) clearInterval(poll)
    if (giveUp) clearTimeout(giveUp)
    poll = giveUp = null
    phase('on')
  }
  const flush = () => {
    if (!size) return
    const all = new Uint8Array(size); let at = 0
    for (const p of pending) { all.set(p, at); at += p.length }
    pending = []; size = 0
    live?.send(all)
  }
  let live: ReturnType<typeof liveSession> | null = null
  try {
    live = typeof WebSocket !== 'undefined' ? liveSession(liveTokenFor(), undefined, words) : null
  } catch {
    live = null
  }
  // the live words' audio module loads now, while the browser opens the microphone, not after (SHEP-334: the tap that
  // started late missed the opening words)
  let loaded: Promise<void> | null = null
  try {
    if (live && ctx?.audioWorklet) {
      tapUrl ??= URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }))
      loaded = ctx.audioWorklet.addModule(tapUrl)
      loaded.catch(() => undefined)
    }
  } catch {
    loaded = null
  }
  // the microphone and the wave stop as soon as you're done: only the writing is left
  const quiet = () => {
    hearing = false
    if (poll) clearInterval(poll)
    if (giveUp) clearTimeout(giveUp)
    poll = giveUp = null
    mic?.getTracks().forEach((t) => t.stop())
    ctx?.close().catch(() => undefined)
    ctx = null
    level = null
  }
  const over = () => state === 'over'
  let stopAsk = () => undefined as void
  const close = (text: string | null) => {
    if (over()) return
    state = 'over'
    stopAsk()
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
      const q = words.length ? `?${new URLSearchParams(words.map((w) => ['word', w]))}` : ''
      const x = await fetch(`api/dictate${q}`, { method: 'POST', body: audio, signal: a.signal, headers: { 'x-shepherdr': '1', 'content-type': audio.type } })
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
      if (!rec || rec.state === 'inactive' || !heardAt) return failed(mic ? SAY.empty : SAY.notYet)
      phase('writing')
      const done = performance.now()
      // the microphone hears a moment more (the last word as Done is tapped), then stops
      setTimeout(() => {
        if (over()) return
        // from the first sound: nothing can be said before the wave shows
        const recSecs = (performance.now() - (heardAt || recAt)) / 1000
        const audio = recording()
        flush()
        quiet()
        // live words only when they heard the whole recording; else (a tap that started late, a phone's silent tap)
        // the recording, which has it all, is written down
        const said = live && !live.broken && wholeLive(tapped / (16000 * 2), recSecs) ? () => live!.finish() : null
        void afterDone(said, async () => uploaded(await audio), over, (how) => timing(how, performance.now() - done)).then((r) => {
          if (!r) return
          if ('error' in r) failed(r.error)
          else close(r.text)
        })
      }, TAIL_KEEP)
    },
    cancel() {
      if (state === 'over') return
      if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop() } catch { /* gone */ } }
      close(null)
    },
  }
  current = self
  // the microphone asked for as the mic was pressed (warmMic), else now
  const warm = early && performance.now() - early.at < WARM_KEEP ? early.stream : null
  early = null
  const asked = warm ?? navigator.mediaDevices?.getUserMedia({ audio: MIC })
  if (!asked) {
    failed(SAY.noMic)
    return self
  }
  let answered = false
  const perm = micPermission()
  stopAsk = askWhen(perm, () => answered || state !== 'on', () => phase('asking'))
  asked
    .then(async (stream) => {
      answered = true
      stopAsk()
      if (state !== 'on') return stream.getTracks().forEach((t) => t.stop())
      // the browser said 'prompt' yet the microphone came with no prompt answered: don't believe it here again
      void perm.then((p) => { if (p === 'prompt' && performance.now() - startedAt < ASK_WAIT) promptLies.set() })
      phase('given')
      mic = stream
      rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      rec.start(1000)
      recAt = performance.now()
      // the recording runs whatever the audio below does: it is what Done uploads when the live words can't come.
      // The wave waits for the first real sound (sounds): the meter or the live words' tap, whichever hears it first
      giveUp = setTimeout(soundCame, SOUND_WAIT)
      const c = ctx
      if (!c) {
        soundCame()
        return live?.close()
      }
      try {
        const src = c.createMediaStreamSource(stream)
        level = meter(c)
        src.connect(level)
        // the wave's meter is pulled by the graph on its own (a silent path out), whatever the live words do: in 3.2.3
        // only the live words' tap led out, and the audio was made to run only after their module loaded, so a module
        // that failed or hung could leave the wave reading nothing (a flat row of dots)
        const hush = c.createGain()
        hush.gain.value = 0
        level.connect(hush).connect(c.destination)
        const meterNode = level
        const buf = new Float32Array(meterNode.fftSize)
        poll = setInterval(() => {
          meterNode.getFloatTimeDomainData(buf)
          if (sounds(buf)) soundCame()
        }, 20)
        // the live words: the microphone's samples, 16 kHz, to the socket as they come (kept until it opens), the tap
        // joined before the audio is made to run, so it hears from the first sample the audio gives; a module that
        // fails or takes too long only drops the live words (Done uploads the recording)
        const ready = live && loaded ? await Promise.race([loaded.then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), RESUME_WAIT))]) : false
        if (state !== 'on' || ctx !== c) return
        if (live && ready) {
          const tap = new AudioWorkletNode(c, 'shepherdr-tap')
          const down = to16k(c.sampleRate)
          tap.port.onmessage = (e) => {
            if (!hearing || over()) return
            if (!heardAt && sounds(e.data as Float32Array)) soundCame()
            const pcm: Uint8Array = down(e.data as Float32Array)
            pending.push(pcm); size += pcm.length; tapped += pcm.length
            if (size >= 3200) flush()
          }
          src.connect(tap)
          // pulled by the graph on every browser, silent
          const mute = c.createGain()
          mute.gain.value = 0
          tap.connect(mute).connect(c.destination)
        } else live?.close()
        await running(c)
      } catch {
        // no meter to hear the first sound with: the wave shows now, as before
        if (!poll) soundCame()
        // the wave still moves when only the live words failed
        void running(c)
        // no wave or live words (a failed worklet): Done uploads the recording
        live?.close()
      }
    })
    .catch((e) => {
      answered = true
      failed(micError(e))
    })
  return self
}
