// The call's audio: the microphone streams to the server, which talks with the voice agent (a realtime speech
// service); its spoken replies come back and play here. The call itself is not saved anywhere.
import { levelOf, meter, TALKING, type Sample } from '@client/meter.ts'

let ws: WebSocket | null = null
let mic: MediaStream | null = null
let ctx: AudioContext | null = null
let node: ScriptProcessorNode | null = null
let muted = false
let playAt = 0
/** meters on your microphone and on the agent's voice */
let yours: AnalyserNode | null = null
let theirs: AnalyserNode | null = null
/** what the call is doing, besides the agent speaking (which the playing audio tells) */
let phase: 'connecting' | 'listening' | 'thinking' = 'connecting'
let phaseAt = 0

const RATE = 16000

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

export async function startCall(chatKey: string, onError: (message: string) => void = () => undefined) {
  stopCall()
  const url = new URL(`api/voice?chat=${encodeURIComponent(chatKey)}`, location.href)
  url.protocol = url.protocol.replace('http', 'ws')
  ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      phase = 'listening'
      if (!play(e.data)) { stopCall(); onError('Voice audio could not keep up. Start a new call.') }
      return
    }
    const m = JSON.parse(String(e.data)) as { type: string; message?: string; state?: typeof phase }
    if (m.type === 'state' && m.state) {
      phase = m.state
      phaseAt = Date.now()
    }
    // you talked over it: what it was about to say is dropped
    if (m.type === 'interrupt') {
      sources.forEach((s) => s.stop())
      sources = []
      waiting = []
      playAt = 0
      phase = 'listening'
    }
    if (m.type === 'error') onError(m.message ?? 'The voice call could not start.')
  }
  // The microphone first, then the audio: an iPhone sets its sound up for playing only when the audio comes first,
  // and the microphone then sends silence. Its voice waits until the audio is there.
  const call = ws
  call.onclose = () => { if (ws === call) { stopCall(); onError('The voice call disconnected. Start a new call.') } }
  call.onerror = () => { if (ws === call) { stopCall(); onError('The voice connection failed. Start a new call.') } }
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  } catch {
    /* no microphone (or no permission): the call shows, nothing is heard */
  }
  // the call ended while the phone asked for the microphone
  if (ws !== call) return stream?.getTracks().forEach((t) => t.stop())
  mic = stream
  const c = (ctx = new AudioContext())
  c.resume().catch(() => undefined)
  theirs = meter(c)
  theirs.connect(c.destination)
  if (stream) {
    const src = c.createMediaStreamSource(stream)
    yours = meter(c)
    src.connect(yours)
    node = c.createScriptProcessor(4096, 1, 1)
    node.onaudioprocess = (e) => {
      if (muted || ws?.readyState !== WebSocket.OPEN) return
      if (ws.bufferedAmount > 1024 * 1024) { stopCall(); onError('Voice connection is too slow. Start a new call.'); return }
      ws.send(toPcm16(e.inputBuffer.getChannelData(0), c.sampleRate))
    }
    src.connect(node)
    node.connect(c.destination)
  }
  for (const audio of waiting.splice(0)) if (!play(audio)) { stopCall(); onError('Voice audio could not keep up. Start a new call.'); break }
}

export function muteCall(on: boolean) {
  muted = on
}

/** what the call is doing now: the agent speaking whenever its voice is still playing */
export function callPhase(): 'connecting' | 'listening' | 'thinking' | 'speaking' {
  if (ctx && playAt > ctx.currentTime + 0.05) return 'speaking'
  // thinking that never led to words goes back to listening
  if (phase === 'thinking' && Date.now() - phaseAt > 20000) return 'listening'
  return phase
}

/** for the wave: whoever is louder right now, the agent first (your mic hears it a little too) */
export function callSample(): Sample {
  const agent = levelOf(theirs)
  const you = muted ? 0 : levelOf(yours)
  if (agent > TALKING && agent >= you * 0.8) return { level: agent, who: 'agent' }
  if (you > TALKING) return { level: you, who: 'you' }
  return { level: Math.max(agent, you), who: null }
}

export function stopCall() {
  node?.disconnect()
  mic?.getTracks().forEach((t) => t.stop())
  ctx?.close().catch(() => undefined)
  const closing = ws
  ws = null
  closing?.close()
  node = null
  mic = null
  ctx = null
  ws = null
  yours = null
  theirs = null
  sources = []
  waiting = []
  playAt = 0
  muted = false
  phase = 'connecting'
}
