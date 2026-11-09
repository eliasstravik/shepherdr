// The call's audio: the microphone streams to the server, which talks with the voice agent (a realtime speech
// service); its spoken replies come back and play here. The call itself is not saved anywhere.
//
// SHEP-102, a phone call that goes on with the screen locked, as far as the web lets it (each step harmless where a
// browser ignores it): the page tells iOS it is a call (navigator.audioSession "play-and-record": WebKit lets an
// AudioContext of such a session play on in the background), plays the agent through a real <audio> element (a media
// element is never stopped for being in the background, and gives the lock screen its controls), shows the call on
// the lock screen (Media Session: hang up, mute), starts its audio again after an interruption, takes the microphone
// again if the phone ended it, and never ends the call for the page being hidden. If the socket drops anyway, the
// server holds the call (service/voice.ts HOLD_MS) and the page goes back to it on its own, then the agent says it's
// back; nothing said before is lost.
import { levelOf, meter, TALKING, type Sample } from '@client/meter.ts'
import { chimePcm } from '@core/voice.js'

let ws: WebSocket | null = null
let mic: MediaStream | null = null
let ctx: AudioContext | null = null
let node: ScriptProcessorNode | null = null
let micIn: MediaStreamAudioSourceNode | null = null
/** the agent's voice plays through this element when the browser lets it (else the AudioContext's own output) */
let out: HTMLAudioElement | null = null
let muted = false
let playAt = 0
/** meters on your microphone and on the agent's voice */
let yours: AnalyserNode | null = null
let theirs: AnalyserNode | null = null
/** what the call is doing, besides the agent speaking (which the playing audio tells) */
let phase: 'connecting' | 'listening' | 'thinking' | 'working' | 'reconnecting' = 'connecting'
let phaseAt = 0
/** SHEP-113: while working, what it does, in plain words ("checking tasks") */
let doing = ''
/** the server's id for this call: a dropped socket goes back to it */
let callId: string | null = null
/** until when a dropped socket keeps trying (a little under the server's hold) */
let retryUntil = 0
let retries = 0
let retry: ReturnType<typeof setTimeout> | null = null
/** the call's handlers, for a socket opened again */
let on: Handlers | null = null
/** what the lock screen's buttons do (toggleCall sets them) */
let controls: Controls | null = null

const RATE = 16000
/** how long a dropped call keeps trying to get back (the server holds it 60 s) */
export const RETRY_MS = 55_000

/** onEnded: the call ended by itself (why: in plain words, "the connection was lost"), or after the person's yes (no why) */
type Handlers = { chatKey: string | null; onError: (message: string) => void; onNav: (nav: Nav) => NavAck | Promise<NavAck>; onOpen: () => void; onEnded: (why: string | null) => void }
/** the lock screen's call controls: hang up, and mute (on: true mutes) */
export type Controls = { title: string; hangUp: () => void; mute: (on: boolean) => void }

function toPcm16(input: Float32Array, from: number): ArrayBuffer {
  const ratio = from / RATE
  const out = new Int16Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out.buffer
}

function play(buf: ArrayBuffer) {
  if (buf.byteLength % 2 || buf.byteLength > 512 * 1024) return false
  if (!ctx) { if (waiting.reduce((bytes, item) => bytes + item.byteLength, 0) + buf.byteLength > 512 * 1024) return false; waiting.push(buf); return true }
  if (sources.length >= 128 || playAt - ctx.currentTime > 30) return false
  const pcm = new Int16Array(buf)
  const audio = ctx.createBuffer(1, pcm.length, RATE)
  const ch = audio.getChannelData(0)
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
  const src = ctx.createBufferSource()
  src.buffer = audio
  src.connect(theirs ?? ctx.destination)
  playAt = Math.max(playAt, ctx.currentTime)
  src.start(playAt)
  playAt += audio.duration
  sources.push(src)
  src.onended = () => (sources = sources.filter((x) => x !== src))
  return true
}

let sources: AudioBufferSourceNode[] = []
/** the agent's first words, when they come before the microphone is through */
let waiting: ArrayBuffer[] = []

/** what the voice agent asked to show (service/voice-tools.ts Nav), done by the page */
export type Nav = { kind: string; [k: string]: unknown }

/** SHEP-118, SHEP-124: whether a voice action that worked minimizes the full-screen call afterwards, so the person sees
 *  what it did: not the call's own view (call_view), not a screen look, and not an action that itself made the call
 *  full screen (a screen click on its Full screen button: it used to be minimized again at once) */
export function stepsAside(nav: Nav, ok: boolean, fullBefore: boolean, fullAfter: boolean) {
  if (!ok || nav.kind === 'call') return false
  if (nav.kind === 'screen' && nav.do === 'look') return false
  return !(fullAfter && !fullBefore)
}

/** what the page shows now, for the voice agent's "here" and "this task" (sent as it changes) */
export function sendWhere(where: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'where', ...where }))
}

/** what this page did with an open: it shows it now (ok), or why not; and what it shows now */
export type NavAck = { ok: boolean; why?: string; where?: Record<string, unknown>; did?: string; ask?: string; screen?: string }

/** WebKit's audio session (Safari 16.4+): "play-and-record" is a call, which iOS lets play and record in the background */
type AudioSessionLike = { type: string; state?: string; onstatechange: ((e: Event) => void) | null }
const audioSession = (): AudioSessionLike | null => (globalThis.navigator as unknown as { audioSession?: AudioSessionLike })?.audioSession ?? null

/** the call as the phone's audio session: a call (or back to the browser's own choice) */
export function setSession(call: boolean) {
  const s = audioSession()
  if (!s) return
  try {
    s.type = call ? 'play-and-record' : 'auto'
    // an interruption (a phone call, Siri) ended: the call's audio starts again
    s.onstatechange = call ? () => { if (s.state === 'active') wakeAudio() } : null
  } catch { /* an older WebKit: its own choice */ }
}

/** The lock screen and Control Center show the call with its own buttons: hang up, mute and unmute (a podcast's
 *  pause and play mute and unmute here, as a phone's call screen does). */
export function setLockScreen(c: Controls | null, isMuted = false) {
  const ms = (globalThis.navigator as Navigator | undefined)?.mediaSession
  if (!ms) return
  const set = (action: string, f: (() => void) | null) => { try { ms.setActionHandler(action as MediaSessionAction, f) } catch { /* not this browser's */ } }
  try {
    ms.metadata = c && typeof MediaMetadata !== 'undefined' ? new MediaMetadata({ title: 'Voice call', artist: c.title, album: 'Shepherdr' }) : null
    ms.playbackState = c ? 'playing' : 'none'
  } catch { /* no metadata here */ }
  set('hangup', c ? c.hangUp : null)
  set('stop', c ? c.hangUp : null)
  set('togglemicrophone', c ? () => c.mute(!muted) : null)
  set('pause', c ? () => c.mute(true) : null)
  set('play', c ? () => c.mute(false) : null)
  const m = ms as MediaSession & { setMicrophoneActive?: (on: boolean) => Promise<void> }
  if (c) m.setMicrophoneActive?.(!isMuted)?.catch?.(() => undefined)
}

/** the call's audio, going again: after an interruption, or the page back on screen */
function wakeAudio() {
  if (!ctx) return
  if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => undefined)
  if (out?.paused) out.play().catch(() => undefined)
  // the phone ended the microphone (an interruption it never gave back): take it again
  if (mic && mic.getAudioTracks().every((t) => t.readyState === 'ended')) void takeMic()
}

/** the microphone, asked for (none: no microphone or no permission; the call shows, nothing is heard) */
const askMic = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null)

/** the microphone into the call: the one just asked for, or again when the phone ended it */
async function takeMic(given?: MediaStream | null) {
  const c = ctx
  if (!c) return given?.getTracks().forEach((t) => t.stop())
  const stream = given === undefined ? await askMic() : given
  if (ctx !== c) return stream?.getTracks().forEach((t) => t.stop())
  mic?.getTracks().forEach((t) => t.stop())
  micIn?.disconnect()
  mic = stream
  if (!stream) return
  for (const t of stream.getAudioTracks()) t.onended = () => { if (mic === stream && document.visibilityState === 'visible') void takeMic() }
  micIn = c.createMediaStreamSource(stream)
  if (!yours) yours = meter(c)
  micIn.connect(yours)
  if (!node) {
    node = c.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) => {
      if (muted || ws?.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 1024 * 1024) return dropped(ws)
      ws.send(toPcm16(e.inputBuffer.getChannelData(0), c.sampleRate))
    }
    node.connect(c.destination)
  }
  micIn.connect(node)
}

/** where the agent's voice goes: a playing <audio> element when the browser lets it, else the AudioContext's output */
async function voiceOut(c: AudioContext, into: AudioNode) {
  if (typeof c.createMediaStreamDestination !== 'function' || typeof Audio === 'undefined') return into.connect(c.destination)
  const dest = c.createMediaStreamDestination()
  const el = new Audio()
  el.setAttribute('playsinline', '')
  el.autoplay = true
  el.srcObject = dest.stream
  try {
    await el.play()
  } catch {
    return into.connect(c.destination)
  }
  if (ctx !== c) return el.pause()
  out = el
  into.connect(dest)
  // the phone paused it (an interruption): playing again once it lets
  el.onpause = () => { if (out === el) setTimeout(() => { if (out === el) el.play().catch(() => undefined) }, 500) }
}

/** The call's socket: the first, or again after a drop (resume: back to the call the server holds). */
function connect(resume: boolean) {
  const h = on
  if (!h) return
  // SHEP-105: a call with Shepherdr; chat, the chat whose call button started it (its "here" until the screen shows one)
  const q = new URLSearchParams()
  if (h.chatKey) q.set('chat', h.chatKey)
  if (resume && callId) q.set('resume', callId)
  const url = new URL(`api/voice${q.size ? `?${q}` : ''}`, location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  const sock = (ws = new WebSocket(url))
  sock.binaryType = 'arraybuffer'
  sock.onopen = () => h.onOpen()
  sock.onmessage = async (e) => {
    if (ws !== sock) return
    if (e.data instanceof ArrayBuffer) {
      // its voice: done thinking (a word before a tool, "On it.", leaves it working)
      if (phase === 'thinking' || phase === 'connecting') phase = 'listening'
      if (!play(e.data)) { stopCall(); h.onError('Voice audio could not keep up. Start a new call.') }
      return
    }
    const m = JSON.parse(String(e.data)) as { type: string; id?: number | string; message?: string; state?: typeof phase; doing?: string; nav?: Nav; text?: string; why?: string }
    if (m.type === 'call' && typeof m.id === 'string') callId = m.id
    // back on the call: as it was, the agent says so
    if (m.type === 'resumed') { retryUntil = 0; retries = 0; phase = 'listening'; phaseAt = Date.now(); wakeAudio() }
    // the voice agent asked to show something: shown here, on this very page, and said back (the agent says it's on
    // screen only then)
    if (m.type === 'nav' && m.nav) {
      let ack: NavAck
      try { ack = await h.onNav(m.nav) } catch (err) { ack = { ok: false, why: (err as Error)?.message || 'it failed on the page' } }
      if (typeof m.id === 'number' && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'navved', id: m.id, ...ack }))
    }
    if (m.type === 'state' && m.state) {
      if (m.state !== phase || m.state !== 'working' || m.doing !== doing) phaseAt = Date.now()
      phase = m.state
      doing = m.state === 'working' && typeof m.doing === 'string' ? m.doing.slice(0, 60) : ''
    }
    // you talked over it: what it was about to say is dropped
    if (m.type === 'interrupt') {
      sources.forEach((s) => s.stop())
      sources = []
      waiting = []
      playAt = 0
      phase = 'listening'
    }
    if (m.type === 'error') { ws = null; h.onError(m.message ?? 'The voice call could not start.') }
    if (m.type === 'ended') { over = true; overWhy = typeof m.why === 'string' ? m.why.slice(0, 200) : null }
  }
  sock.onclose = () => dropped(sock)
}

/** SHEP-173: a muted call sends nothing; a word now and then keeps every hop (the service, the proxy) from taking the
 *  socket for idle */
setInterval(() => { if (on && ws?.readyState === WebSocket.OPEN) try { ws.send('{"type":"keep"}') } catch { /* gone */ } }, 20_000)

/** the voice agent ended the call (the person said yes, or a limit): no error, its last words play out */
let over = false
/** why it ended by itself, in plain words (none: the person said yes) */
let overWhy: string | null = null

/** The socket went. The agent's goodbye: its last words play out. Else the call holds on the server: back to it
 *  quietly (sooner once the page is on screen or online again), until it's clearly gone. */
function dropped(sock: WebSocket) {
  if (ws !== sock || !on) return
  const h = on
  ws = null
  try { sock.close() } catch { /* gone already */ }
  if (over) {
    muted = true
    const left = ctx ? Math.max(0, playAt - ctx.currentTime) : 0
    const why = overWhy
    setTimeout(() => { if (on === h) { stopCall(); h.onEnded(why) } }, Math.min(10000, left * 1000 + 300))
    return
  }
  // never got going: nothing to go back to
  if (!callId) { stopCall(); h.onError('The voice connection failed.'); return }
  phase = 'reconnecting'
  phaseAt = Date.now()
  if (!retryUntil) retryUntil = Date.now() + RETRY_MS
  if (Date.now() > retryUntil) { stopCall(); h.onEnded('the connection was lost'); return }
  // what it was saying is gone (the agent says again what was missed)
  sources.forEach((s) => s.stop())
  sources = []
  playAt = 0
  retry = setTimeout(() => { retry = null; if (on === h && !ws) connect(true) }, Math.min(4000, 250 * 2 ** retries++))
}

/** the page is on screen or online again: a call that is getting back tries now, and its audio wakes */
function comeBack() {
  if (!on) return
  wakeAudio()
  if (!ws && phase === 'reconnecting') {
    if (retry) clearTimeout(retry)
    retry = null
    connect(true)
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && comeBack())
  addEventListener('online', comeBack)
  addEventListener('pageshow', comeBack)
}


export async function startCall(chatKey: string | null, onError: (message: string) => void = () => undefined, onNav: (nav: Nav) => NavAck | Promise<NavAck> = () => ({ ok: false, why: 'this page can\'t open things' }), onOpen: () => void = () => undefined, onEnded: (why: string | null) => void = () => undefined, lock: Controls | null = null) {
  stopCall()
  const h: Handlers = { chatKey, onError, onNav, onOpen, onEnded }
  on = h
  controls = lock
  over = false
  overWhy = null
  // a call, to the phone: before the microphone, so its audio is set up as one from the start
  setSession(true)
  connect(false)
  // The microphone first, then the audio: an iPhone sets its sound up for playing only when the audio comes first,
  // and the microphone then sends silence. Its voice waits until the audio is there.
  const stream = await askMic()
  // the call ended while the phone asked for the microphone
  if (on !== h) return stream?.getTracks().forEach((t) => t.stop())
  const c = (ctx = new AudioContext())
  c.resume().catch(() => undefined)
  // a phone that locks or takes a call interrupts it: going again as soon as it may
  c.onstatechange = () => { if (ctx === c && c.state !== 'running' && c.state !== 'closed') setTimeout(wakeAudio, 300) }
  theirs = meter(c)
  await takeMic(stream)
  if (on !== h) return
  await voiceOut(c, theirs)
  if (on !== h) return
  setLockScreen(controls, muted)
  for (const audio of waiting.splice(0)) if (!play(audio)) { stopCall(); onError('Voice audio could not keep up. Start a new call.'); break }
}

export function muteCall(isMuted: boolean) {
  muted = isMuted
  const ms = (globalThis.navigator as Navigator | undefined)?.mediaSession as (MediaSession & { setMicrophoneActive?: (on: boolean) => Promise<void> }) | undefined
  ms?.setMicrophoneActive?.(!isMuted)?.catch?.(() => undefined)
}

export type CallPhase = 'connecting' | 'listening' | 'thinking' | 'working' | 'speaking' | 'reconnecting'

/** what the call is doing now: the agent speaking whenever its voice is still playing */
export function callPhase(): CallPhase {
  if (phase === 'reconnecting') return phase
  if (ctx && playAt > ctx.currentTime + 0.05) return 'speaking'
  // thinking that never led to words goes back to listening; a tool gives up after 30 s (its timeout)
  if (phase === 'thinking' && Date.now() - phaseAt > 20000) return 'listening'
  if (phase === 'working' && Date.now() - phaseAt > 35000) return 'listening'
  return phase
}

/** SHEP-113: while working, what it does in plain words ("checking tasks"), else "" */
export const callDoing = () => (callPhase() === 'working' ? doing : '')

/** for the wave: whoever is louder right now, the agent first (your mic hears it a little too) */
export function callSample(): Sample {
  const agent = levelOf(theirs)
  const you = muted ? 0 : levelOf(yours)
  if (agent > TALKING && agent >= you * 0.8) return { level: agent, who: 'agent' }
  if (you > TALKING) return { level: you, who: 'you' }
  return { level: Math.max(agent, you), who: null }
}

/** SHEP-173: the end chime, as the call's last sound: through the call's own audio (its <audio> element plays on in
 *  the background on a phone), then that audio closes. No call audio (it never started): a fresh one, if allowed. */
export const CHIME_MS = 700
function chimeThenClose(c: AudioContext | null, el: HTMLAudioElement | null, into: AudioNode | null) {
  let audio = c
  if (!audio || audio.state === 'closed') {
    try { audio = new AudioContext() } catch { audio = null }
    into = null
  }
  const close = () => {
    if (el) { el.onpause = null; el.pause(); el.srcObject = null }
    audio?.close().catch(() => undefined)
    if (c && c !== audio) c.close().catch(() => undefined)
  }
  if (!audio) return close()
  try {
    audio.resume().catch(() => undefined)
    const pcm = chimePcm(RATE) as Int16Array
    const buf = audio.createBuffer(1, pcm.length, RATE)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const src = audio.createBufferSource()
    src.buffer = buf
    src.connect(into ?? audio.destination)
    src.start()
  } catch { return close() }
  setTimeout(close, CHIME_MS)
}

export function stopCall() {
  const was = on
  on = null
  if (retry) clearTimeout(retry)
  retry = null
  node?.disconnect()
  micIn?.disconnect()
  mic?.getTracks().forEach((t) => t.stop())
  // what it was still saying stops; the chime plays, then the audio closes
  sources.forEach((s) => { try { s.stop() } catch { /* not started */ } })
  if (was) chimeThenClose(ctx, out, theirs)
  else {
    if (out) { out.onpause = null; out.pause(); out.srcObject = null }
    ctx?.close().catch(() => undefined)
  }
  const closing = ws
  ws = null
  // the person ended it: the server ends it now rather than holding it for the page to come back
  try { if (closing?.readyState === WebSocket.OPEN) closing.send(JSON.stringify({ type: 'end' })) } catch { /* gone */ }
  closing?.close()
  if (was) { setLockScreen(null); setSession(false) }
  node = null
  micIn = null
  mic = null
  out = null
  ctx = null
  yours = null
  theirs = null
  sources = []
  waiting = []
  playAt = 0
  muted = false
  phase = 'connecting'
  doing = ''
  callId = null
  retryUntil = 0
  retries = 0
  controls = null
  over = false
  overWhy = null
}
