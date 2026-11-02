import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startVoice, type VoiceTools } from '../server/voice.ts'
import { coreEnvironment } from '../server/core/config.ts'
import { CoreSource } from '../server/core/source.ts'
import type { CoreSpace } from '../server/core/model.ts'

const tools: VoiceTools = { name: 'demo', send: async () => 'Sent', read: async () => 'Recent chat', overview: async () => 'Overview', onReply: () => () => {} }

test('voice transports exact PCM bytes, authenticates private calls, and deduplicates provider tools', async () => {
  const emitted: (string | ArrayBuffer)[] = [], upstream: string[] = [], sends: string[] = []
  let closed = false, requests = 0
  const socket = { readyState: WebSocket.OPEN, bufferedAmount: 0, onopen: undefined, onmessage: undefined, onclose: undefined, onerror: undefined, send: (raw: string) => upstream.push(raw), close: () => { closed = true } } as unknown as WebSocket
  const bridge = startVoice({ ...tools, send: async (text, _to, command) => { sends.push(command!); return text } }, { send: value => emitted.push(value), close: () => { closed = true } }, {
    key: async () => 'test-voice-key-1234', agent: () => undefined, saveAgent() {}, socket: () => socket,
    fetch: async (_url, init) => {
      requests++
      expect(init?.redirect).toBe('error')
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        expect(body.platform_settings.auth.enable_auth).toBe(true)
        expect(body.platform_settings.privacy).toEqual({ record_voice: false, retention_days: 0 })
        return Response.json({ agent_id: 'agent_test' })
      }
      return Response.json({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?token=test' })
    },
  })
  try {
    for (let turn = 0; !socket.onopen && turn < 20; turn++) await Bun.sleep(0)
    socket.onopen!(new Event('open'))
    expect(requests).toBe(2)
    await socket.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type: 'audio', audio_event: { audio_base_64: Buffer.from([1, 2, 3, 4]).toString('base64') } }) }))
    const audio = emitted.find(value => value instanceof ArrayBuffer) as ArrayBuffer
    expect([...new Uint8Array(audio)]).toEqual([1, 2, 3, 4])
    const event = new MessageEvent('message', { data: JSON.stringify({ type: 'client_tool_call', client_tool_call: { tool_call_id: 'tool_1', tool_name: 'send_message', parameters: { text: 'Hello' } } }) })
    await Promise.all([socket.onmessage!(event), socket.onmessage!(event)])
    expect(sends).toHaveLength(1)
    expect(sends[0]).toStartWith('voice-')
    expect(upstream.filter(raw => JSON.parse(raw).type === 'client_tool_result')).toHaveLength(2)
    bridge.audio(new Uint8Array([5, 6]).buffer)
    expect(upstream.some(raw => JSON.parse(raw).user_audio_chunk === 'BQY=')).toBe(true)
    bridge.audio(new ArrayBuffer(65537))
    expect(closed).toBe(true)
  } finally { bridge.end() }
})

test('a hung-up call cannot create a provider agent and missing keys stay out of the network', async () => {
  let network = 0, close = 0
  const runtime = { key: async () => null, agent: () => undefined, saveAgent() {}, fetch: async () => { network++; return Response.json({}) } }
  const first = startVoice(tools, { send() {}, close: () => { close++ } }, runtime)
  first.end(); await Bun.sleep(0)
  expect(network).toBe(0)
  const errors: string[] = []
  startVoice(tools, { send: value => errors.push(String(value)), close: () => { close++ } }, runtime)
  await Bun.sleep(0)
  expect(network).toBe(0)
  expect(errors.join()).toContain('ELEVENLABS_API_KEY')
  expect(close).toBe(2)
})

test('voice tools resolve machine-qualified chats and use the same durable send receipt', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-voice-')), source = new CoreSource({ home, port: 17887, binary: 'hc', session: 'test', socket: '/unused' })
  const machine = source.localMachineId(), local = { id: `p:${machine}:demo`, name: 'demo', machine } as CoreSpace
  source.store.set('space', local.id, local); source.store.set('space', 'p:other:demo', { id: 'p:other:demo', name: 'demo', machine: 'other' })
  source.core.current.connected = true
  source.machineConnected = () => true
  const sent: { cid?: string; chat: string }[] = []
  source.act = async action => { if (action.type === 'send') sent.push(action); return { waiting: true } }
  try {
    const tool = source.voices.tools(local.id)
    await expect(tool.send('Hello', 'demo', 'voice-test-send')).rejects.toThrow('Several chats')
    expect(await tool.send('Hello', local.id, 'voice-test-send')).toContain('Saved')
    expect(sent).toMatchObject([{ cid: 'voice-test-send', chat: local.id }])
    source.machineConnected = () => false
    await expect(tool.read()).rejects.toThrow('unavailable')
  } finally { source.stop(); source.mailbox.close(); source.store.close(); rmSync(home, { recursive: true, force: true }) }
})


test('the server voice key is not forwarded to a core daemon or its agents', () => {
  const previous = process.env.ELEVENLABS_API_KEY
  process.env.ELEVENLABS_API_KEY = 'synthetic-server-voice-key'
  try { expect(coreEnvironment({ home: '/tmp/unused', port: 17887, binary: 'hc', session: 'test', socket: '/unused' }).ELEVENLABS_API_KEY).toBeUndefined() }
  finally { if (previous === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = previous }
})

test('malformed provider events close with a useful error instead of rejecting an event callback', async () => {
  for (const data of ['null', '{"type":"client_tool_call"}']) {
    let closed = false
    const errors: string[] = []
    const socket = { readyState: WebSocket.OPEN, bufferedAmount: 0, onmessage: undefined, send() {}, close() { closed = true } } as unknown as WebSocket
    const bridge = startVoice(tools, { send: value => errors.push(String(value)), close: () => { closed = true } }, { key: async () => 'test-key-12345', agent: () => 'existing_agent', saveAgent() {}, fetch: async () => Response.json({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation' }), socket: () => socket })
    try {
      for (let turn = 0; !socket.onmessage && turn < 20; turn++) await Bun.sleep(0)
      await socket.onmessage!(new MessageEvent('message', { data }))
      expect(closed).toBe(true)
      expect(errors.join()).toContain('could not be read')
    } finally { bridge.end() }
  }
})
