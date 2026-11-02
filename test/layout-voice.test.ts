import { describe, expect, test } from 'bun:test'
import { layout } from './layout.ts'

const { browser, server } = await layout()
describe.skipIf(!browser)('voice connection failures', () => {
  for (const reason of ['close', 'audio', 'context'] as const) test(`a ${reason} failure ends the call with a useful message`, async () => {
    const page = await browser!.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, permissions: ['microphone'] })
    try {
      await page.addInitScript(reason => {
        if (reason === 'context') Object.defineProperty(window, 'AudioContext', { value: function () { throw Error('Audio unavailable') } })
        const Native = window.WebSocket
        const state = window as unknown as { voiceSocket: { onclose?(): void; onmessage?(event: { data: ArrayBuffer }): void }; voiceTracks: MediaStreamTrack[] }
        class VoiceSocket {
          readyState = Native.OPEN
          bufferedAmount = 0
          binaryType = 'arraybuffer'
          onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
          onclose: (() => void) | null = null
          onerror: (() => void) | null = null
          send() {}
          close() { this.onclose?.() }
        }
        window.WebSocket = new Proxy(Native, { construct(Target, args) {
          if (!String(args[0]).includes('/api/voice')) return new Target(...args as [string])
          const socket = new VoiceSocket(); state.voiceSocket = socket as unknown as typeof state.voiceSocket; return socket
        } })
        const microphone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = async options => { const stream = await microphone(options); state.voiceTracks = stream.getTracks(); return stream }
      }, reason)
      await page.goto(`http://127.0.0.1:${server!.port}/?place=vm-str/home`)
      await page.getByRole('button', { name: 'Voice call', exact: true }).click()
      if (reason !== 'context') await page.getByRole('button', { name: 'End call', exact: true }).waitFor()
      await page.waitForFunction(() => !!(window as unknown as { voiceTracks?: MediaStreamTrack[] }).voiceTracks?.length)
      if (reason !== 'context') await page.evaluate(reason => {
        const socket = (window as unknown as { voiceSocket: { onclose?(): void; onmessage?(event: { data: ArrayBuffer }): void } }).voiceSocket
        if (reason === 'close') socket.onclose?.()
        else socket.onmessage?.({ data: new ArrayBuffer(512 * 1024 + 2) })
      }, reason)
      await page.getByText(reason === 'close' ? /The voice call disconnected/ : reason === 'context' ? /Audio could not start/ : /Voice audio could not keep up/).waitFor()
      expect(await page.getByRole('button', { name: 'End call', exact: true }).count()).toBe(0)
      expect(await page.evaluate(() => (window as unknown as { voiceTracks: MediaStreamTrack[] }).voiceTracks.every(track => track.readyState === 'ended'))).toBe(true)
    } finally { await page.close() }
  })
})
