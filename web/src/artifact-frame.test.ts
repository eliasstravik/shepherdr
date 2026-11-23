import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// SHEP-340: an artifact's page filled only 320px of the panel, so a long page seemed to end after its first lines.
// The frame sits in a box (it holds the mark-up layer); the panel's .scroll must stretch that box, and the box the frame.
// A browser check (the proof) measures it; this keeps the rules and the markup they hang on from drifting apart again.
const css = readFileSync(join(import.meta.dir, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const page = readFileSync(join(import.meta.dir, '../plugins/artifacts/client.tsx'), 'utf8')
const rule = (sel: string) => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css)
  return m ? Object.fromEntries(m[1]!.split(';').filter(Boolean).map((d) => d.split(':').map((x) => x.trim()) as [string, string])) : null
}

test('the frame is the box\'s only child and the box is the panel\'s', () => {
  expect(page).toMatch(/<div className="pagebox">\s*<iframe (?:key=[^>]*? )?ref=\{frame\} className="page"/)
  expect(page).toMatch(/<PaneFrame[\s\S]*?flush[\s\S]*?<Page a=\{a\}/)
})

test('the panel stretches the box, the box stretches the frame: it fills the whole height', () => {
  expect(rule('.scroll:has(>.pagebox)')).toMatchObject({ padding: '0', display: 'flex' })
  expect(rule('.pagebox')).toMatchObject({ flex: '1', display: 'flex', 'min-height': '0' })
  const frame = rule('.page')!
  expect(frame.flex).toBe('1')
  // a percent height of a box with no set height is the frame's 150px default (cut to its 320px floor): never again
  expect(frame.height).toBeUndefined()
  // and nothing else still hangs a rule on the frame as the panel's direct child
  expect(css).not.toContain(':has(>.page)')
})
