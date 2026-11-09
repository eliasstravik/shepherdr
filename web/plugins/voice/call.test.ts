// SHEP-102: a call on a phone goes on with the screen locked, as far as the web lets it. Bun has no browser, so a fake
// one stands in (an iPhone's Safari as WebKit's own code says it behaves): what the page asks of it is what is checked.
// That a real iPhone then keeps the microphone and the voice going is not provable here.
import { beforeEach, expect, test } from 'bun:test'

// the fake browser, set before call.ts is loaded (it listens to the page's visibility)
const listeners: Record<string, (() => void)[]> = {}
const doc = { visibilityState: 'visible', addEventListener: (e: string, f: () => void) => (listeners[e] ??= []).push(f) }
const fire = (e: string) => (listeners[e] ?? []).forEach((f) => f())
Object.assign(globalThis, {
  document: doc,
  location: { href: 'https://box.example.ts.net/shepherdr/' },
  addEventListener: doc.addEventListener,
})

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  bufferedAmount = 0
  sent: unknown[] = []
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string | URL) { this.url = String(url); FakeSocket.all.push(this) }
  send(x: unknown) { this.sent.push(typeof x === 'string' ? JSON.parse(x) : x) }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.() }
  open() { this.readyState = 1; this.onopen?.() }
  say(m: object) { this.onmessage?.({ data: JSON.stringify(m) }) }
}

const node = () => ({ connected: [] as unknown[], connect(to: unknown) { this.connected.push(to) }, disconnect() {}, fftSize: 0, getFloatTimeDomainData() {} })
class FakeContext {
  static last: FakeContext
  state = 'running'
  currentTime = 0
  sampleRate = 48000
  resumed = 0
  destination = { name: 'speaker' }
  onstatechange: (() => void) | null = null
  dest = { stream: { name: 'voice-stream' }, ...node() }
  constructor() { FakeContext.last = this }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  createAnalyser() { return node() }
  createMediaStreamSource() { return node() }
  createScriptProcessor() { return { ...node(), onaudioprocess: null } }
  createMediaStreamDestination() { return this.dest }
  createBuffer(_c: number, n: number) { const data = new Float32Array(n); return { duration: n / 16000, getChannelData: () => data } }
  played: { buffer: { duration: number; getChannelData: () => Float32Array } | null; connected: unknown[]; started: boolean }[] = []
  createBufferSource() { const src = { ...node(), buffer: null, started: false, start() { this.started = true }, stop() {}, onended: null }; this.played.push(src as any); return src }
}

let playRefused = false
class FakeAudio {
  static all: FakeAudio[] = []
  paused = true
  srcObject: unknown = null
  autoplay = false
  onpause: (() => void) | null = null
  attrs: Record<string, string> = {}
  constructor() { FakeAudio.all.push(this) }
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  play() { if (playRefused) return Promise.reject(new Error('NotAllowedError')); this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
}

const handlers: Record<string, (() => void) | null> = {}
const mediaSession = { metadata: null as unknown, playbackState: 'none', mic: null as boolean | null,
  setActionHandler(a: string, f: (() => void) | null) { handlers[a] = f },
  setMicrophoneActive(on: boolean) { this.mic = on; return Promise.resolve() } }
const audioSession = { type: 'auto', state: 'active', onstatechange: null as (() => void) | null }
const track = () => ({ readyState: 'live', onended: null as (() => void) | null, stop() { this.readyState = 'ended' } })
let mics = 0
const tracks: ReturnType<typeof track>[] = []
Object.assign(globalThis, {
  WebSocket: FakeSocket,
  AudioContext: FakeContext,
  Audio: FakeAudio,
  MediaMetadata: class { constructor(public init: object) {} },
  navigator: {
    audioSession,
    mediaSession,
    mediaDevices: { getUserMedia: async () => { mics++; const t = track(); tracks.push(t); return { getTracks: () => [t], getAudioTracks: () => [t] } } },
  },
})

const call = await import('./call.ts')
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { call.stopCall(); FakeSocket.all = []; FakeAudio.all = []; playRefused = false; mics = 0 })

const errors: string[] = []
const endedWhy: (string | null)[] = []
let hungUp = 0
const mutes: boolean[] = []
async function start() {
  const p = call.startCall('p:h1', (m) => errors.push(m), undefined, undefined, (why) => endedWhy.push(why), { title: 'the Home Assistant', hangUp: () => hungUp++, mute: (on) => mutes.push(on) })
  const ws = FakeSocket.all.at(-1)!
  ws.open()
  ws.say({ type: 'call', id: 'call-1' })
  await p
  return ws
}

test('the phone is told it is a call, before the microphone, and back to its own choice after', async () => {
  let typeAtMic = ''
  const ask = (globalThis.navigator as any).mediaDevices.getUserMedia
  ;(globalThis.navigator as any).mediaDevices.getUserMedia = async () => { typeAtMic = audioSession.type; return ask() }
  await start()
  ;(globalThis.navigator as any).mediaDevices.getUserMedia = ask
  expect(typeAtMic).toBe('play-and-record')
  call.stopCall()
  expect(audioSession.type).toBe('auto')
})

test("the agent's voice plays through a real <audio> element (kept playing in the background), or the speaker when refused", async () => {
  await start()
  const el = FakeAudio.all.at(-1)!
  expect(el.srcObject).toBe(FakeContext.last.dest.stream)
  expect(el.paused).toBe(false)
  expect(el.attrs.playsinline).toBe('')
  call.stopCall()
  // the end chime plays through it first (SHEP-173)
  await new Promise((r) => setTimeout(r, call.CHIME_MS + 50))
  expect(el.paused).toBe(true)
  // a browser that won't play it: the AudioContext's own output, as before
  playRefused = true
  await start()
  expect(FakeAudio.all.at(-1)!.paused).toBe(true)
  expect(FakeContext.last.dest.connected).toEqual([])
})

test('the lock screen shows the call; its hang up ends it, its mute and pause mute it', async () => {
  hungUp = 0
  mutes.length = 0
  await start()
  expect((mediaSession.metadata as any).init).toEqual({ title: 'Voice call', artist: 'the Home Assistant', album: 'Shepherdr' })
  expect(mediaSession.playbackState).toBe('playing')
  expect(mediaSession.mic).toBe(true)
  handlers.hangup!()
  handlers.togglemicrophone!()
  handlers.pause!()
  handlers.play!()
  expect(hungUp).toBe(1)
  expect(mutes).toEqual([true, true, false])
  call.muteCall(true)
  expect(mediaSession.mic).toBe(false)
  call.stopCall()
  expect(mediaSession.metadata).toBeNull()
  expect(handlers.hangup).toBeNull()
})

test('hiding the page never ends the call; an interrupted audio starts again', async () => {
  const ws = await start()
  doc.visibilityState = 'hidden'
  fire('visibilitychange')
  expect(ws.readyState).toBe(1)
  expect(ws.sent.some((m: any) => m?.type === 'end')).toBe(false)
  // iOS interrupts the audio (a lock, a phone call): it is resumed once allowed
  const ctx = FakeContext.last
  ctx.state = 'interrupted'
  ctx.onstatechange!()
  await new Promise((r) => setTimeout(r, 350))
  expect(ctx.resumed).toBeGreaterThan(1)
  const el = FakeAudio.all.at(-1)!
  el.paused = true
  doc.visibilityState = 'visible'
  fire('visibilitychange')
  expect(el.paused).toBe(false)
  // the audio session's interruption ended
  ctx.state = 'suspended'
  audioSession.onstatechange!()
  expect(ctx.state).toBe('running')
})

test('the phone ended the microphone: it is taken again once the page is back', async () => {
  await start()
  expect(mics).toBe(1)
  tracks.at(-1)!.readyState = 'ended'
  doc.visibilityState = 'visible'
  fire('visibilitychange')
  await settle()
  expect(mics).toBe(2)
  expect(tracks.at(-1)!.readyState).toBe('live')
  call.stopCall()
  expect(tracks.at(-1)!.readyState).toBe('ended')
})

test('the socket drops: the call goes back to it quietly, says Reconnecting meanwhile, no error', async () => {
  errors.length = 0
  const ws = await start()
  ws.close()
  expect(call.callPhase()).toBe('reconnecting')
  await new Promise((r) => setTimeout(r, 300))
  const again = FakeSocket.all.at(-1)!
  expect(again).not.toBe(ws)
  expect(again.url).toBe('wss://box.example.ts.net/shepherdr/api/voice?chat=p%3Ah1&resume=call-1')
  again.open()
  again.say({ type: 'resumed', id: 'call-1' })
  expect(call.callPhase()).toBe('listening')
  expect(errors).toEqual([])
  // back on screen while getting back: it tries at once rather than waiting
  again.close()
  const n = FakeSocket.all.length
  fire('visibilitychange')
  expect(FakeSocket.all.length).toBe(n + 1)
  expect(FakeSocket.all.at(-1)!.url).toContain('resume=call-1')
  // the call is gone on the server (SHEP-173: the service started again on an update): it ends, saying why in plain words
  endedWhy.length = 0
  FakeSocket.all.at(-1)!.open()
  FakeSocket.all.at(-1)!.say({ type: 'ended', why: 'the connection was lost' })
  FakeSocket.all.at(-1)!.close()
  await new Promise((r) => setTimeout(r, 400))
  expect(endedWhy).toEqual(['the connection was lost'])
  expect(errors).toEqual([])
})

test('End tells the server to end it now (not hold it for the page)', async () => {
  const ws = await start()
  call.stopCall()
  expect(ws.sent.at(-1)).toEqual({ type: 'end' })
  expect(ws.readyState).toBe(3)
})

test("a socket that never got a call (the server refused it) is an error at once, no retrying", async () => {
  errors.length = 0
  const p = call.startCall('p:h1', (m) => errors.push(m))
  FakeSocket.all.at(-1)!.close()
  await p
  expect(errors).toEqual(['The voice connection failed.'])
})

test('SHEP-113: the call shows Listening, Thinking, Working (what, in plain words) and Speaking from its real events', async () => {
  const ws = await start()
  ws.say({ type: 'state', state: 'listening' })
  expect([call.callPhase(), call.callDoing()]).toEqual(['listening', ''])
  ws.say({ type: 'state', state: 'thinking' })
  expect(call.callPhase()).toBe('thinking')
  ws.say({ type: 'state', state: 'working', doing: 'checking tasks' })
  expect([call.callPhase(), call.callDoing()]).toEqual(['working', 'checking tasks'])
  // its "On it." plays: Speaking while it plays, and still Working after (the tool runs on)
  const ctx = FakeContext.last
  ws.onmessage?.({ data: new Int16Array(1600).buffer })
  expect(call.callPhase()).toBe('speaking')
  ctx.currentTime = 1
  expect([call.callPhase(), call.callDoing()]).toEqual(['working', 'checking tasks'])
  // the tool's result: thinking about the answer, then listening once it's said
  ws.say({ type: 'state', state: 'thinking' })
  expect([call.callPhase(), call.callDoing()]).toEqual(['thinking', ''])
  ws.say({ type: 'state', state: 'listening' })
  expect(call.callPhase()).toBe('listening')
})

test('SHEP-124: a voice action minimizes the full-screen call, but not call_view, a look, or a click that opened it', async () => {
  const { stepsAside } = await import('./call.ts')
  // opening things while full screen: minimized, so the person sees it
  expect(stepsAside({ kind: 'artifact', artifact: 'a1' }, true, true, true)).toBe(true)
  expect(stepsAside({ kind: 'screen', do: 'click', ref: 'e3' }, true, true, true)).toBe(true)
  // failed: nothing changed
  expect(stepsAside({ kind: 'space', place: 'sp1' }, false, true, true)).toBe(false)
  // reading the screen changes nothing; call_view sets the view itself
  expect(stepsAside({ kind: 'screen', do: 'look' }, true, true, true)).toBe(false)
  expect(stepsAside({ kind: 'call', full: true }, true, false, true)).toBe(false)
  // the bug: a screen click on "Open the call full screen" went full screen, then was minimized at once
  expect(stepsAside({ kind: 'screen', do: 'click', ref: 'e9' }, true, false, true)).toBe(false)
})

// SHEP-173: a call never ends in silence: a short chime, through the call's own audio (its <audio> element, which a
// phone keeps playing in the background), then the audio closes.
test('SHEP-173: every end chimes through the call audio, then it closes', async () => {
  await start()
  const ctx = FakeContext.last
  const el = FakeAudio.all.at(-1)!
  call.stopCall()
  const chime = ctx.played.at(-1)!
  expect(chime.started).toBe(true)
  // through the voice's meter, so into the <audio> element: heard in the background too
  expect(chime.connected.length).toBe(1)
  expect(chime.connected[0]).not.toBe(ctx.destination)
  const pcm = chime.buffer!.getChannelData()
  expect(pcm.length / 16000).toBeGreaterThan(0.3)
  expect(Math.max(...pcm.map(Math.abs))).toBeGreaterThan(0.1)
  // still open while it plays; closed after
  expect([ctx.state, el.paused]).toEqual(['running', false])
  await new Promise((r) => setTimeout(r, call.CHIME_MS + 50))
  expect([ctx.state, el.paused]).toEqual(['closed', true])
})

test('SHEP-173: an end by itself says why (the limit, the line); after the person\'s yes it says nothing', async () => {
  endedWhy.length = 0
  let ws = await start()
  ws.say({ type: 'ended', why: 'it reached the 2-hour limit' })
  ws.close()
  await new Promise((r) => setTimeout(r, 400))
  ws = await start()
  ws.say({ type: 'ended' })
  ws.close()
  await new Promise((r) => setTimeout(r, 400))
  expect(endedWhy).toEqual(['it reached the 2-hour limit', null])
})
