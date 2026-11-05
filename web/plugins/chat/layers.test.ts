import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// SHEP-6: the chat's floating bits (the Latest pill z-10, the drop note z-20, a message's menu z-21) once sat over the
// places drawer (z-5) that slides in over the chat. The chat's root is its own stacking context, so whatever covers
// the chat covers them too, whatever their z.
test('the chat root keeps its floating layers inside it', () => {
  const src = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  const root = src.match(/data-drop[\s\S]*?className="([^"]*)"/)
  expect(root).not.toBeNull()
  expect(root![1].split(/\s+/)).toContain('isolate')
})
