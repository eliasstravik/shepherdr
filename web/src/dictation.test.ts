import { describe, expect, test } from 'bun:test'
import { afterDone, askWhen, heard, liveSession, micError, MIC, SAY, wholeLive } from './dictation.ts'

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
    expect(heard(502, '<html>Bad gateway</html>')).toEqual({ error: "Shepherdr couldn't write it down (error 502)." })
    expect(heard(200, '{}')).toEqual({ error: "Shepherdr couldn't write it down (error 200)." })
    expect(heard(0, '')).toEqual({ error: "Shepherdr couldn't be reached." })
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
  test('3: nothing is shown while you speak; the socket asks for written text with the person’s words (SHEP-334)', async () => {
    const f = fakeSocket()
    const live = liveSession(Promise.resolve('tok'), f.make, ['root', 'vm-demo'])
    await Bun.sleep(0)
    f.open()
    const u = new URL(f.s.url)
    expect(u.searchParams.get('no_verbatim')).toBe('true')
    expect(u.searchParams.getAll('keyterms')).toEqual(expect.arrayContaining(['Shepherdr', 'herdr-core', 'root', 'vm-demo']))
    // partials only run underneath: the session has no way to show them
    f.say({ message_type: 'partial_transcript', text: 'Add a can' })
    expect(Object.keys(live)).not.toContain('words')
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

// SHEP-307: on a phone the microphone's tap gave the live session no audio, so it answered with no words, and that empty
// answer was taken as the result: the recording was never uploaded and the box got nothing, with nothing said
describe('after Done', () => {
  const upload = (r: { text: string } | { error: string }) => {
    const calls: number[] = []
    return { calls, f: async () => { calls.push(1); return r } }
  }
  test('live words that say something are the result, and nothing is uploaded', async () => {
    const u = upload({ text: 'from the upload' })
    const how: string[] = []
    expect(await afterDone(async () => ' Add a button. ', u.f, undefined, (h) => how.push(h))).toEqual({ text: 'Add a button.' })
    expect(u.calls.length).toBe(0)
    expect(how).toEqual(['live'])
  })
  test('an empty live answer falls back to uploading the recording', async () => {
    for (const empty of ['', '   ']) {
      const u = upload({ text: 'Add a dark mode.' })
      const how: string[] = []
      expect(await afterDone(async () => empty, u.f, undefined, (h) => how.push(h))).toEqual({ text: 'Add a dark mode.' })
      expect(u.calls.length).toBe(1)
      expect(how).toEqual(['upload'])
    }
  })
  test('no live words, a failed or a thrown live session: the upload', async () => {
    expect(await afterDone(null, upload({ text: 'a' }).f)).toEqual({ text: 'A.' })
    expect(await afterDone(async () => null, upload({ text: 'b' }).f)).toEqual({ text: 'B.' })
    expect(await afterDone(() => Promise.reject(new Error('socket')), upload({ text: 'c' }).f)).toEqual({ text: 'C.' })
  })
  test('an empty final result says nothing was heard, never nothing at all', async () => {
    expect(await afterDone(async () => '', upload({ text: '' }).f)).toEqual({ error: SAY.silence })
    expect(await afterDone(null, upload({ text: ' ' }).f)).toEqual({ error: SAY.silence })
  })
  test("the upload's own failure is what is said", async () => {
    const key = 'Dictation needs an ElevenLabs key in Settings › Secrets.'
    expect(await afterDone(async () => '', upload({ error: key }).f)).toEqual({ error: key })
    expect(await afterDone(null, () => Promise.reject(new Error('x')))).toEqual({ error: SAY.unreached })
  })
  test('4: the words come back clean, whichever way they came (SHEP-334)', async () => {
    const said = 'so um I think the the button is too small. No, wait, the box'
    expect(await afterDone(async () => said, upload({ text: 'x' }).f)).toEqual({ text: 'So I think the box.' })
    expect(await afterDone(null, upload({ text: 'uh send it to Anna, sorry, Bob' }).f)).toEqual({ text: 'Send it to Bob.' })
    // only fillers: nothing was heard, never an empty box
    expect(await afterDone(async () => 'um', upload({ text: 'uh' }).f)).toEqual({ error: SAY.silence })
  })
  test('5: live words and the upload can both answer, but only one writes', async () => {
    const u = upload({ text: 'From the upload.' })
    expect(await afterDone(async () => 'From the live words.', u.f)).toEqual({ text: 'From the live words.' })
    expect(u.calls.length).toBe(0)
  })
  test('cancelled meanwhile: nothing comes back and nothing is uploaded', async () => {
    let over = false
    const u = upload({ text: 'x' })
    expect(await afterDone(async () => { over = true; return '' }, u.f, () => over)).toBe(null)
    expect(u.calls.length).toBe(0)
  })
  test('a live session that never answers is bounded, then uploads', async () => {
    const make = () => { const s: any = { readyState: 1, send() {}, close() {} }; setTimeout(() => s.onopen?.(), 0); return s as WebSocket }
    const live = liveSession(Promise.resolve('tok'), make)
    await Bun.sleep(5)
    expect(await afterDone(() => live.finish(30), upload({ text: 'late' }).f)).toEqual({ text: 'Late.' })
  })
  test('a WebSocket that throws ends the live session at once, so the recording is uploaded', async () => {
    const live = liveSession(Promise.resolve('tok'), () => { throw new Error('SecurityError') })
    await Bun.sleep(0)
    expect(live.broken).toBe(true)
    expect(await live.finish(1000)).toBe(null)
  })
})

describe("the mic's failures, in plain words", () => {
  test('each way the microphone fails says what went wrong', () => {
    expect(micError({ name: 'NotAllowedError' })).toBe(SAY.blocked)
    expect(micError({ name: 'SecurityError' })).toBe(SAY.blocked)
    expect(micError({ name: 'NotFoundError' })).toBe(SAY.noMic)
    expect(micError({ name: 'NotReadableError' })).toBe(SAY.busy)
    expect(micError(null)).toBe(SAY.noStart)
  })
  test('the words are plain: no codes or names, each a full sentence', () => {
    for (const w of [SAY.blocked, SAY.noMic, SAY.busy, SAY.noStart, SAY.asking, SAY.notYet, SAY.empty, SAY.unreached, SAY.slow, SAY.silence]) {
      expect(w).toMatch(/^[A-Z].*\.$/)
      expect(w).not.toMatch(/Error|AudioContext|worklet|WebSocket|token|undefined/)
    }
    expect(SAY.empty).toContain('empty')
    expect(SAY.silence).toContain('Nothing was heard')
  })
})

// SHEP-334: "it first always shows Allow mic for some reason. I believe I have allowed it."
describe('1: "Allow the microphone" only when the browser really asks', () => {
  const watch = (perm: PermissionState | null, answeredAfter: number | null, wait = 40) => {
    let asked = -1
    const t0 = Date.now()
    const answered = () => answeredAfter !== null && Date.now() - t0 >= answeredAfter
    askWhen(Promise.resolve(perm), answered, () => { asked = Date.now() - t0 }, wait)
    return () => asked
  }
  test('allowed: never, however slow the microphone is', async () => {
    const asked = watch('granted', null)
    await Bun.sleep(80)
    expect(asked()).toBe(-1)
  })
  test('not yet allowed or blocked: at once', async () => {
    for (const p of ['prompt', 'denied'] as const) {
      const asked = watch(p, null)
      await Bun.sleep(5)
      expect(asked()).toBeGreaterThanOrEqual(0)
      expect(asked()).toBeLessThan(30)
    }
  })
  test('a browser that can’t say: only when the microphone hasn’t answered after a moment', async () => {
    const fast = watch(null, 10)
    await Bun.sleep(80)
    expect(fast()).toBe(-1)
    const slow = watch(null, null)
    await Bun.sleep(80)
    expect(slow()).toBeGreaterThanOrEqual(40)
  })
  test('stopped (the microphone answered, or cancelled): never', async () => {
    let asked = false
    const stop = askWhen(Promise.resolve(null), () => false, () => { asked = true }, 20)
    stop()
    await Bun.sleep(50)
    expect(asked).toBe(false)
  })
})

// SHEP-334: "in the beginning, it loses some words". The live words' tap started after the recording (its audio module
// loaded and a phone's audio resumed only once the microphone was on), so speech from 0 ms reached the recording but not
// the live words, and Done took the live words.
describe('the opening words are never lost', () => {
  test('a clip that starts speaking at 0 ms: live words that missed its start are not taken; the recording is', async () => {
    // 5 s recorded from the first sample; the tap joined 0.8 s late and heard 4.2 s
    expect(wholeLive(4.2, 5.0)).toBe(false)
    const u = { calls: 0 }
    const said = wholeLive(4.2, 5.0) ? async () => 'we should send this to the repo.' : null
    const r = await afterDone(said, async () => { u.calls++; return { text: 'So I think we should send this to the repo.' } })
    expect(r).toEqual({ text: 'So I think we should send this to the repo.' })
    expect(u.calls).toBe(1)
  })
  test('live words that heard it all are taken (fast), within a tap’s small lag', () => {
    expect(wholeLive(5.0, 5.0)).toBe(true)
    expect(wholeLive(4.8, 5.0)).toBe(true)
    expect(wholeLive(0, 0.1)).toBe(false)
  })
  test('the microphone isn’t gated: no noise suppression or echo cancellation to clip the first syllables', () => {
    expect(MIC.noiseSuppression).toBe(false)
    expect(MIC.echoCancellation).toBe(false)
  })
})
