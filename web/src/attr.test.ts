import { describe, expect, test } from 'bun:test'
import { attr } from './attr.ts'

describe('attr', () => {
  test('leaves plain keys alone', () => {
    expect(attr('p:vm-demo/sp1')).toBe('p:vm-demo/sp1')
  })
  test('escapes quotes, backslashes and line breaks so the selector stays one string', () => {
    expect(attr('a"b\\c\nd')).toBe('a\\"b\\\\c\\a d')
  })
})
