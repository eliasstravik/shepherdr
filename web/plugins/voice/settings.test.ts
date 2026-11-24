// Settings › Voice: the state in a few words under "ElevenLabs key", and which messages lead there
import { describe, expect, test } from 'bun:test'
import { needsKey, stateWords, type Check } from './settings.tsx'
import * as V from '../../../core/voice.js'

const c = (state: Check['state'], from?: string): Check => ({ ok: state === 'works', says: '', state, from })

describe('Settings › Voice', () => {
  test('the state under the key, from the test and the kept secret', () => {
    expect(stateWords(null, false, true)).toBe('Checking…')
    expect(stateWords(null, false, false)).toBe('Not added')
    expect(stateWords(c('works', 'here'), true, false)).toBe('Works')
    expect(stateWords(c('works', 'file'), false, false)).toBe('Works · from an old file')
    expect(stateWords(c('refused'), true, false)).toBe("Doesn't work")
    expect(stateWords(c('none'), false, false)).toBe('Not added')
    expect(stateWords(c('unreachable'), true, false)).toBe("Added · can't check now")
  })
  test("a Talk or a dictation without a key is led to this page", () => {
    expect(needsKey((V as any).NO_KEY)).toBe(true)
    expect(needsKey((V as any).noKeyOn('mini'))).toBe(true)
    expect(needsKey((V as any).DICTATE_NO_KEY)).toBe(true)
    expect(needsKey("Can't reach ElevenLabs.")).toBe(false)
  })
})
