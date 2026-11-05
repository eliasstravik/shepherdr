import { describe, expect, test } from 'bun:test'
import { heard, micError } from './dictation.ts'

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
