import { describe, expect, test } from 'bun:test'
import { heard, liveSession, micError } from './dictation.ts'

// SHEP-10: a failed transcription used to come back as no words at all, so nothing landed in the box and nothing said why
describe('what the service answered to a recording', () => {
  test('its words', () => {
    expect(heard(200, JSON.stringify({ text: 'add a dark mode' }))).toEqual({ text: 'add a dark mode' })
    expect(heard(200, JSON.stringify({ text: '' }))).toEqual({ text: '' })
  })
  test("the service's own reason when it couldn't write it down", () => {
    expect(heard(400, JSON.stringify({ error: 'Dictation needs an ElevenLabs key in Settings › Secrets.' }))).toEqual({ error: 'Dictation needs an ElevenLabs key in Settings › Secrets.' })
  })
  test('a page that is not its answer (a proxy, a crash) or no answer at all is an error, never empty words', () => {
    expect(heard(502, '<html>Bad gateway</html>')).toEqual({ error: "BossGoat couldn't write it down (error 502)." })
    expect(heard(200, '{}')).toEqual({ error: "BossGoat couldn't write it down (error 200)." })
    expect(heard(0, '')).toEqual({ error: "BossGoat couldn't be reached." })
  })
  test('a blocked microphone says how to allow it', () => {
    expect(micError({ name: 'NotAllowedError' })).toContain('allow it')
    expect(micError(new Error('x'))).toBe('The microphone couldn’t start.')
  })
})

// SHEP-63: the words are written live while you speak; Done only asks for the last ones
describe('the live words', () => {
  const fakeSocket = () => {
    const s: any = { readyState: 0, sent: [] as any[], url: '', send(m: string) { s.sent.push(JSON.parse(m)) }, close() { s.readyState = 3 } }
    const make = (url: string) => { s.url = url; return s as WebSocket }
    const open = () => { s.readyState = 1; s.onopen?.() }
    const say = (m: object) => s.onmessage?.({ data: JSON.stringify(m) })
    return { s, make, open, say }
  }
  test("audio before the socket opens is kept, then sent; Done's commit brings the last words", async () => {
    const f = fakeSocket()
    const live = liveSession(Promise.resolve('tok'), f.make)
    await Bun.sleep(0)
    live.send(new Uint8Array([1, 0, 2, 0]))
    expect(f.s.sent.length).toBe(0)
    f.open()
    expect(f.s.url).toContain('token=tok')
    expect(f.s.sent[0].audio_base_64).toBe(Buffer.from([1, 0, 2, 0]).toString('base64'))
    f.say({ message_type: 'committed_transcript', text: 'Add a' })
    const words = live.finish(1000)
    expect(f.s.sent.at(-1).commit).toBe(true)
    f.say({ message_type: 'committed_transcript', text: 'cancel button.' })
    expect(await words).toBe('Add a cancel button.')
  })
  test('no token, a dropped socket or no answer in time: null, so the recording is uploaded', async () => {
    expect(await liveSession(Promise.resolve(null), fakeSocket().make).finish(50)).toBe(null)
    const f = fakeSocket()
    const live = liveSession(Promise.resolve('tok'), f.make)
    await Bun.sleep(0)
    f.open()
    f.s.onclose()
    expect(live.broken).toBe(true)
    expect(await live.finish(50)).toBe(null)
    const g = fakeSocket()
    const slow = liveSession(Promise.resolve('tok'), g.make)
    await Bun.sleep(0)
    g.open()
    expect(await slow.finish(30)).toBe(null)
  })
})
