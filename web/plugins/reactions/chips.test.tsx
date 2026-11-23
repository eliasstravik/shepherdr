import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '@shared/types.ts'
import { chipLabel, chipsOf, togglesFor } from './chips.ts'
import { Chips } from './client.tsx'

// SHEP-332: reactions as chips on the bubble's edge, a count when both of you picked one, one reaction each.

const chat: Chat = { key: 'c', messages: [], cli: 'claude' }
const msg = (reactions: Message['reactions']): Message => ({ id: 'm1', who: 'agent', text: 'hi', reactions })

test('one chip per emoji, with a count when you both picked it, and yours marked', () => {
  expect(chipsOf([{ emoji: '👍', by: 'both' }, { emoji: '👀', by: 'them' }])).toEqual([
    { emoji: '👍', count: 2, mine: true, pending: false },
    { emoji: '👀', count: 1, mine: false, pending: false },
  ])
  expect(chipsOf(undefined)).toEqual([])
})

test('the chips draw as buttons: the emoji, the count only above one, yours pressed', () => {
  const html = renderToStaticMarkup(<Chips msg={msg([{ emoji: '👍', by: 'both' }, { emoji: '👀', by: 'them', pending: true }])} chat={chat} />)
  expect(html).toContain('class="rxs"')
  expect((html.match(/<button/g) ?? []).length).toBe(2)
  expect(html).toContain('<span class="n">2</span>')
  expect(html).toMatch(/class="rxc"[^>]*aria-pressed="true"/)
  expect(html).toMatch(/class="rxc rx-pending"[^>]*aria-pressed="false"/)
  // none when there are none
  expect(renderToStaticMarkup(<Chips msg={msg([])} chat={chat} />)).toBe('')
})

test('a tap on yours takes it back; another emoji changes yours; the agent\'s alone adds the same', () => {
  expect(togglesFor([{ emoji: '👍', by: 'me' }], '👍')).toEqual(['👍'])
  expect(togglesFor([{ emoji: '👍', by: 'me' }], '❤️')).toEqual(['👍', '❤️'])
  expect(togglesFor([{ emoji: '👀', by: 'them' }], '👀')).toEqual(['👀'])
  expect(togglesFor(undefined, '🎉')).toEqual(['🎉'])
  expect(chipLabel({ emoji: '👍', count: 2, mine: true, pending: false })).toContain('remove')
})

test('sizes: a pill that hugs its emoji with a 44 px tap area, a pop only with motion (measured in a real layout by test/test_reaction_chip.py)', () => {
  const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')
  const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''
  expect(rule('.rxc')).toContain('height:28px')
  expect(rule('.rxc')).toContain('flex:none')
  expect(rule('.rxs')).toContain('width:max-content')
  expect(rule('.rxc::after')).toContain('inset:-13px -2px -8px') // 13 + 28 + 8 = 49: a bar just below may take a few
  expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.rxs>\.rxc\.rx-new\{animation:none\}/)
})

test('the chip\'s state classes are its own: none is a class the rest of the app styles (3.2.4: "pop", the menu\'s)', () => {
  const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')
  const src = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  const states = [...(src.match(/cx\('rxc',(.*?)\)\}/)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map((m) => m[1])
  expect(states.sort()).toEqual(['rx-new', 'rx-pending'])
  for (const c of states) {
    // every selector naming it names the chip too
    for (const m of css.matchAll(new RegExp(`[^{}]*\\.${c}(?![\\w-])[^{}]*\\{`, 'g'))) expect(m[0]).toContain('.rxc.' + c)
  }
})
