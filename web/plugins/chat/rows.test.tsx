import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { endedLine } = await import('./client.tsx')

// The rows at the bottom of a chat: a task's row keeps its time left clear of its title, a closed ask's line says what
// closed and shows once, and the message box has no empty spot after its +.

test('a closed ask says what closed; a bare or doubled line does not show', () => {
  expect(endedLine('Fix login · Run: npm test · Allowed in the chat', '')).toBe('Fix login · Run: npm test · Allowed in the chat')
  expect(endedLine('', '')).toBeNull()
  expect(endedLine('  ', 'x')).toBeNull()
  expect(endedLine('Fix login · Run: npm test · Allowed', 'Fix login · Run: npm test · Allowed')).toBeNull()
  expect(endedLine('Fix login · Run: npm test · Declined', 'Fix login · Run: npm test · Allowed')).toBe('Fix login · Run: npm test · Declined')
})

test("a chat's task row gives the ring and its time their own room, and the title truncates", () => {
  const css = readFileSync(join(import.meta.dir, '../../src/ds.css'), 'utf8')
  // the ring is held to 16px only without a time beside it: with one ("8m") it would spill over the title
  expect(css).not.toContain('.msgs>.ref>.tring{width:16px}')
  expect(css).toContain('.msgs>.ref>.tring:not(.tside){width:16px}')
  expect(css).toMatch(/\.msgs>\.ref>\.rt\{[^}]*text-overflow:ellipsis/)
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(src).toContain('<span className="rt">{title}</span>')
})

test("an agent's logo that can't load leaves no empty square after the +", () => {
  const ui = readFileSync(join(import.meta.dir, '../../src/ui.tsx'), 'utf8')
  expect(ui).toContain('onError={() => setLost(src)}')
  expect(ui).toContain('if (src && lost === src) return null')
})
