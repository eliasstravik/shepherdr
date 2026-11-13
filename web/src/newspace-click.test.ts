import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// Run the dialog's actual pointer handler, as window tests run extracted methods. Collapsing the suggestions on
// pointerdown moves Create before pointerup: the browser clicks the backdrop instead, dismissing without a POST.
const source = readFileSync(new URL('../plugins/places/add.tsx', import.meta.url), 'utf8')
const handler = source.match(/onPointerDown=\{(\(e\) => listOpen[^\n]+?)\}>/)![1]
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const down = ${handler}`)
function press(ancestors: string[], listOpen = true, inInput = false) {
  let collapses = 0
  const input = { current: { closest: () => null } }
  const target = inInput ? input.current : {
    closest: (selector: string) => selector.split(',').some((s) => ancestors.includes(s.trim())) ? {} : null,
  }
  new Function('listOpen', 'input', 'shut', 'e', `${js}; down(e)`)(listOpen, input, () => collapses++, { target })
  return collapses
}

test('Create and other dialog buttons stay in place until their click finishes', () => {
  // Includes a nested icon or label: closest() must recognise the enclosing button too.
  expect(press(['button'])).toBe(0)
})
test('folder choices and typing keep their suggestions', () => {
  expect(press(['[data-folders]'])).toBe(0)
  expect(press([], true, true)).toBe(0)
})
test('pressing free space still dismisses suggestions', () => {
  expect(press([])).toBe(1)
  expect(press([], false)).toBe(0)
})
