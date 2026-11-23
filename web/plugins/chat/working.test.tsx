import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message, TurnActivity } from '@shared/types.ts'

// the formatted words need a browser (DOMPurify): here they are drawn as they are; every other export stays the real one
const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { WorkingSign } = await import('./client.tsx')

// SHEP-343: the working sign is three dots in an agent-side speech bubble, the step quiet beside it, never inside.

const msgs = (...m: Partial<Message>[]) => m.map((x, i) => ({ id: `m${i}`, who: 'agent', ...x })) as Message[]
const chat = (c: Partial<Chat>, messages: Message[] = msgs({ who: 'you', text: 'do it' })) => ({ key: 'p:sp1', cli: 'claude', messages, ...c }) as Chat
const turn = (t: Partial<TurnActivity> = {}) => ({ id: 't1', at: 1, rows: [], steps: 0, ...t }) as TurnActivity
const draw = (c: Chat) => renderToStaticMarkup(<WorkingSign chat={c} />)
const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')

test('working with nothing new: three dots inside an agent bubble', () => {
  const html = draw(chat({ working: true }))
  expect(html).toContain('class="wsign"')
  expect(html).toMatch(/<span class="b wbub"[^>]*><span class="wdots"><i><\/i><i><\/i><i><\/i><\/span><\/span>/)
  expect(html).toContain('aria-label="Working"')
  expect(html).not.toContain('wstep')
})

test('the step stays quiet text beside the bubble, not inside it', () => {
  const html = draw(chat({ working: true, doing: '1 shell still running', live: turn() }))
  expect(html).toMatch(/<\/span><\/span><span class="wstep">1 shell still running<\/span><\/div>$/)
  expect(html.slice(html.indexOf('wbub'), html.indexOf('wstep'))).not.toContain('shell')
})

test('gone when words arrive and the turn ends', () => {
  expect(draw(chat({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' })))).toBe('')
  expect(renderToStaticMarkup(<WorkingSign chat={undefined} />)).toBe('')
})

test('the bubble has the agent bubble look: .b, its height sized to the dots, left aligned', () => {
  expect(css).toMatch(/\.b\{[^}]*border-radius:18px;background:var\(--raised\)/)
  expect(css).toMatch(/\.wbub\{[^}]*height:36px;padding:0 14px/)
  expect(css).toMatch(/\.wdots i\{[^}]*animation:rise/)
  expect(css).toMatch(/\.wdots i:nth-child\(2\)\{animation-delay:\.15s\}\.wdots i:nth-child\(3\)\{animation-delay:\.3s\}/)
})

test('reduced motion: no bounce, a calm fade in turn, and the bubble fades in without moving', () => {
  const block = css.split('\n').find((l) => l.startsWith('@media(prefers-reduced-motion:reduce)') && l.includes('.wdots')) ?? ''
  expect(block).toContain('.wdots i{animation:calm')
  expect(block).toContain('.wsign{animation-name:fade}')
  expect(css).toMatch(/@keyframes fade\{from\{opacity:0\}\}/)
})
