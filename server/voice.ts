// Provider transport with explicit private storage and credentials. Calls keep no audio or transcript.
import { createHash, randomUUID } from 'node:crypto'
const creating = new Map<string, Promise<string>>()
const API = 'https://api.elevenlabs.io/v1'
export interface VoiceRuntime { key(): Promise<string | null>; agent(key: string): string | undefined; saveAgent(key: string, id: string): void; fetch?(url: string, init?: RequestInit): Promise<Response>; socket?(url: string): WebSocket }
export interface VoiceTools {
  /** who the call is with */
  name: string
  /** send to this chat (or another agent, by name); says whether it went in or waits */
  send(text: string, to?: string, command?: string): Promise<string>
  /** recent chat of this agent (or another), plain */
  read(to?: string): Promise<string>
  /** every place, task and agent with its state */
  overview(): Promise<string>
  /** called when the agent you talk to writes a reply */
  onReply(fn: (text: string) => void): () => void
}

const PROMPT = `You are Shepherdr's voice agent. The human runs many coding agents from their phone and is talking to you hands-free. You pass what they ask to the agent they called ({{agent}}) as an ordinary message with send_message, word for word unless they ask you to rephrase; use the "to" field only when they name another agent. When a reply comes in, read it out briefly and naturally. To answer "where are you with that?" or "what needs me?", use read_chat or overview first. Keep everything short. Never make up what an agent said.`

async function api(path: string, key: string, runtime: VoiceRuntime, init: RequestInit = {}) {
  const r = await (runtime.fetch ?? fetch)(`${API}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'xi-api-key': key, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`Voice provider request failed (${r.status})`)
  const reader = r.body?.getReader()
  if (!reader) throw Error('Voice provider returned no response')
  const chunks: Uint8Array[] = []; let bytes = 0
  for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw Error('Voice provider response exceeds the size limit') }; chunks.push(next.value) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** our voice agent at ElevenLabs, made once */
async function createAgent(key: string, runtime: VoiceRuntime): Promise<string> {
  const saved = runtime.agent(key)
  if (saved) return saved
  const tool = (name: string, description: string, props: Record<string, { type: string; description: string }>, required: string[]) => ({
    type: 'client',
    name,
    description,
    expects_response: true,
    response_timeout_secs: 20,
    parameters: { type: 'object', properties: props, required },
  })
  const body = {
    name: 'Shepherdr voice',
    conversation_config: {
      agent: {
        first_message: 'Hi, I’m listening.',
        language: 'en',
        prompt: {
          prompt: PROMPT,
          tools: [
            tool('send_message', 'Send the human’s words to an agent as a chat message.', { text: { type: 'string', description: 'What to send' }, to: { type: 'string', description: 'Another agent by name, only when the human names one' } }, ['text']),
            tool('read_chat', 'Read the recent chat and state of the agent on the call, or another one.', { to: { type: 'string', description: 'Another agent by name' } }, []),
            tool('overview', 'Every place, task and agent with its state: what needs the human, what is working.', {}, []),
          ],
        },
      },
      asr: { user_input_audio_format: 'pcm_16000' },
      tts: { agent_output_audio_format: 'pcm_16000' },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true } } },
      privacy: { record_voice: false, retention_days: 0 },
    },
  }
  const r = (await api('/convai/agents/create', key, runtime, { method: 'POST', body: JSON.stringify(body) })) as { agent_id: string }
  if (typeof r.agent_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(r.agent_id)) throw new Error('Voice provider returned an invalid agent')
  runtime.saveAgent(key, r.agent_id)
  return r.agent_id
}

async function agentId(key: string, runtime: VoiceRuntime) {
  const saved = runtime.agent(key)
  if (saved) return saved
  const hash = createHash('sha256').update(key).digest('hex')
  let pending = creating.get(hash)
  if (!pending) { pending = createAgent(key, runtime); creating.set(hash, pending) }
  try { const id = await pending; runtime.saveAgent(key, id); return id }
  finally { if (creating.get(hash) === pending) creating.delete(hash) }
}

/** one call: the browser's microphone in, the voice agent's speech out */
export function startVoice(tools: VoiceTools, out: { send(d: ArrayBuffer | string): void; close(): void; buffered?(): number }, runtime: VoiceRuntime) {
  let ws: WebSocket | null = null
  let ended = false
  let offReply: (() => void) | null = null
  const call = randomUUID(), receipts = new Map<string, { hash: string; result: Promise<{ result: string; is_error: boolean }> }>()
  let pending = 0
  const stop = () => { if (ended) return; ended = true; offReply?.(); offReply = null; ws?.close(); out.close() }
  const publish = (data: ArrayBuffer | string) => {
    if (ended) return
    if ((out.buffered?.() ?? 0) > 1024 * 1024) return stop()
    try { out.send(data) } catch { stop() }
  }
  const fail = (msg: string) => { publish(JSON.stringify({ type: 'error', message: msg })); stop() }
  ;(async () => {
    const key = await runtime.key()
    if (ended) return
    if (!key) return fail('Voice needs ELEVENLABS_API_KEY in Settings → Secrets.')
    if (!/^[a-zA-Z0-9_-]{10,256}$/.test(key)) return fail('The saved ElevenLabs key is not a valid API key; replace it in Settings → Secrets.')
    const id = await agentId(key, runtime)
    if (ended) return
    const { signed_url } = (await api(`/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(id)}`, key, runtime)) as { signed_url: string }
    if (ended) return
    const url = new URL(signed_url)
    if (url.protocol !== 'wss:' || url.hostname !== 'api.elevenlabs.io' || url.port || url.username || url.password) throw new Error('Voice provider returned an invalid connection')
    ws = runtime.socket ? runtime.socket(signed_url) : new WebSocket(signed_url)
    ws.onopen = () => {
      if (ended) { ws?.close(); return }
      ws!.send(
        JSON.stringify({
          type: 'conversation_initiation_client_data',
          dynamic_variables: { agent: tools.name },
          conversation_config_override: { agent: { prompt: { prompt: PROMPT.replace('{{agent}}', tools.name) }, first_message: `You're through to ${tools.name}. Go ahead.` } },
        }),
      )
      try {
        offReply = tools.onReply((text) => !ended && ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'user_message', text: `(${tools.name} replied in the chat: "${text}") Read this reply out, briefly.` })))
      } catch (e) { fail((e as Error).message); ws?.close() }
    }
    ws.onmessage = async (e) => {
      if (ended) return
      if (Buffer.byteLength(String(e.data)) > 2 * 1024 * 1024) { fail('Voice response exceeds the size limit'); ws?.close(); return }
      let m
      try { m = JSON.parse(String(e.data)) } catch { fail('Voice response could not be read'); ws?.close(); return }
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return fail('Voice response could not be read')
      if (m.type === 'ping') ws!.send(JSON.stringify({ type: 'pong', event_id: m.ping_event?.event_id }))
      // the screen shows what the call is doing: through, then thinking once you've said something
      else if (m.type === 'conversation_initiation_metadata') publish(JSON.stringify({ type: 'state', state: 'listening' }))
      else if (m.type === 'user_transcript') publish(JSON.stringify({ type: 'state', state: 'thinking' }))
      else if (m.type === 'audio' && m.audio_event?.audio_base_64) {
        if (typeof m.audio_event.audio_base_64 !== 'string') return fail('Voice audio could not be read')
        const audio = Buffer.from(m.audio_event.audio_base_64, 'base64')
        if (audio.length % 2) return fail('Voice audio was not PCM16')
        publish(Uint8Array.from(audio).buffer)
      }
      else if (m.type === 'interruption') publish(JSON.stringify({ type: 'interrupt' }))
      else if (m.type === 'client_tool_call') {
        const c = m.client_tool_call
        if (!c || typeof c !== 'object') return fail('Voice tool request could not be read')
        publish(JSON.stringify({ type: 'state', state: 'thinking' }))
        if (typeof c.tool_call_id !== 'string' || c.tool_call_id.length > 256) return fail('Voice tool identity is invalid')
        const hash = createHash('sha256').update(JSON.stringify([c.tool_name, c.parameters])).digest('hex')
        let receipt = receipts.get(c.tool_call_id)
        if (receipt && receipt.hash !== hash) return fail('Voice tool identity changed; start a new call')
        if (!receipt) {
          if (receipts.size >= 1000 || pending >= 8) return fail('Voice tools are busy; start a new call')
          pending++
          const result = (async () => {
            try {
              if (c.parameters?.to !== undefined && (typeof c.parameters.to !== 'string' || c.parameters.to.length > 512)) throw Error('Choose a chat by name')
              let text: string
              if (c.tool_name === 'send_message') {
                if (typeof c.parameters?.text !== 'string' || !c.parameters.text.trim() || c.parameters.text.length > 16000) throw Error('Send between one and 16000 characters')
                text = await tools.send(c.parameters.text, c.parameters.to, `voice-${call}-${createHash('sha256').update(c.tool_call_id).digest('hex').slice(0, 32)}`)
              } else if (c.tool_name === 'read_chat') text = await tools.read(c.parameters?.to)
              else if (c.tool_name === 'overview') text = await tools.overview()
              else throw Error('No such voice tool')
              return { result: text.slice(0, 32000), is_error: false }
            } catch (error) { return { result: (error as Error).message.slice(0, 1000), is_error: true } }
            finally { pending-- }
          })()
          receipt = { hash, result }; receipts.set(c.tool_call_id, receipt)
        }
        const result = await receipt.result
        if (ended || ws?.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ type: 'client_tool_result', tool_call_id: c.tool_call_id, ...result }))
      }
    }
    ws.onerror = () => fail('Voice connection failed; start a new call')
    ws.onclose = stop
  })().catch((e) => fail((e as Error).message))
  return {
    audio(d: ArrayBuffer) {
      if (d.byteLength > 64 * 1024 || (ws?.bufferedAmount ?? 0) > 1024 * 1024) { fail('Voice connection is too slow; start a new call'); ws?.close(); return }
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ user_audio_chunk: Buffer.from(d).toString('base64') }))
    },
    end: stop,
  }
}
