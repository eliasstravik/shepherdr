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
  expect(html).toMatch(/class="rxc pending"[^>]*aria-pressed="false"/)
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

test('sizes: a readable emoji, a chip from the shared size tokens with a 44 px tap area, a pop only with motion', () => {
  const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')
  const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''
  expect(rule('.rxc')).toContain('height:calc(var(--chip) - 4px)')
  expect(Number(rule('.rxc .e').match(/font-size:(\d+)px/)?.[1])).toBeGreaterThanOrEqual(18)
  expect(rule('.rxc::after')).toContain('inset:-8px')
  expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.rxc\.pop\{animation:none\}/)
})

test('placement: just under the bubble, never over it, on its inner edge both sides, no ring, an even gap', () => {
  const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')
  const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? ''
  const gap = (r: string) => r.match(/(?:^|;)gap:(\d+)px/)?.[1]
  // under the bubble, with the same small gap the list keeps between messages, so the next one sits as evenly
  expect(rule('.rxs')).toContain('margin-top:4px')
  expect(rule('.rxs')).not.toMatch(/margin-top:-/)
  expect(rule('.rxs').match(/margin-top:(\d+)px/)?.[1]).toBe(gap(rule('.msgs')))
  // no side padding: the chips line up with the bubble's edge, left for the agent's, right for yours
  expect(rule('.rxs')).not.toContain('padding-inline')
  expect(rule('.bmv')).toContain('justify-items:start')
  expect(rule('.bw.mine>.bmv')).toContain('justify-items:end')
  expect(rule('.bw.mine .rxs')).toContain('justify-content:flex-end')
  // inside the column, never clipped past it
  expect(css).toContain('.bw>.bmv>.rxs{max-width:100%}')
  // a quiet fill, no ring around the chip
  for (const sel of ['.rxc', '.rxc[aria-pressed="true"]']) {
    expect(rule(sel)).not.toContain('box-shadow')
    expect(rule(sel)).not.toContain('var(--canvas)')
  }
  expect(rule('.rxc')).toContain('background:var(--control)')
  expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.rxc\.pop\{animation:none\}/)
})
