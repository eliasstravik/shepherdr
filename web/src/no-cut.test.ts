// Text gets the room there is (SHEP-356): names and titles wrap to a second line before they are cut, and the message
// box's agent line drops other things before its model or effort.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Task } from '@shared/types.ts'
import * as V from '@shared/view.ts'
import * as Pk from './picker.tsx'

// by name from the modules, so the same file runs as a before-check on an older build (each test then fails alone)
const { taskLine } = V
const afterWords = (t: Partial<Task>): string => (V as any).afterWords(t)
const fitAgentLine = (el: HTMLElement): number => (Pk as any).fitAgentLine(el)

const css = readFileSync(new URL('./ds.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (sel: string) => css.split('}').filter((r) => r.split('{')[0]!.split(',').map((s) => s.trim()).includes(sel)).map((r) => r.split('{').pop()!).join(';')

test("the chat header's space name has all the room its buttons leave: no cap beside an empty title", () => {
  expect(css).not.toMatch(/\.ttl>\.tbtn\{[^}]*max-width:60%/)
  // it never shrinks for the folder beside it (SHEP-360), only to the header's own width; the folder gives way
  expect(rule('.ttl>.tbtn')).toContain('flex:none;max-width:100%')
  expect(rule('.hpath')).toContain('min-width:44px')
})

test("a task row's title and its line under it wrap to two lines before they are cut, in the panel, on cards and on a phone", () => {
  for (const sel of ['.row.tk .l1', '.row.tk .l2:not(.rline)', '.tile>.l1', '.banner .n:not(button)', '.hd .ttl>.t1:only-child']) {
    expect(rule(sel)).toContain('-webkit-line-clamp:2')
    expect(rule(sel)).toContain('white-space:normal')
  }
  // a chat banner grows to its two lines
  expect(rule('.banner')).toContain('min-height:max(40px,var(--row))')
  // its whole-banner button still fills it, top to bottom (a tap anywhere on it)
  expect(rule('.banner>button.n')).toContain('align-self:stretch')
})

test("a space's name in the list is one line, cut with an ellipsis like a machine's: never two lines or a break at a hyphen", () => {
  expect(rule('.rowx[data-project]>.row>.n')).toBe('')
  for (const prop of ['overflow:hidden', 'text-overflow:ellipsis', 'white-space:nowrap']) expect(rule('.row .n')).toContain(prop)
  expect(css).not.toMatch(/\.rowx\[data-project\][^{]*\{[^}]*line-clamp/)
})

test("the list never scrolls sideways, and on a touch layout it is wide enough for a short machine name beside its buttons", () => {
  expect(rule('.side')).toContain('overflow-x:hidden')
  expect(rule('.app')).toContain('--sidec:max(var(--side-min),var(--side-w,var(--side)))')
  expect(rule('.app.tap')).toContain('--side-min:232px')
  expect(rule('.shell')).toContain('grid-template-columns:var(--sidec) minmax(0,1fr)')
})

const task = (x: Partial<Task>): Task => ({ id: 'T-1', name: 'Release', place: 'shop', status: 'queued', state: 'queued', on: 'mini', created: '', age: '', ...x })

test("Up next says what it waits for short: one task by its title, several by their count", () => {
  const long = 'Desktop tab: starts by itself and says why when it cannot show'
  expect(taskLine(task({ afterTitle: long }))).toBe(`Starts after ${long}`)
  expect(taskLine(task({ afterTitle: long, afterMore: 5 }))).toBe('Starts after 6 tasks')
  expect(afterWords({ afterTitle: 'Fix typo', afterMore: 1 })).toBe('Starts after 2 tasks')
  expect(afterWords({})).toBe('')
})

/** a fake agent line: `need` px of words, `room` px to put them in; each drop frees its px */
function line(need: number, room: number, free: Record<string, number> = { logo: 26, chev: 22, perm: 40 }) {
  const el = { dataset: {} as Record<string, string>, clientWidth: room, querySelectorAll: () => [] as never[] }
  Object.defineProperty(el, 'scrollWidth', { get: () => need - (el.dataset.drop ?? '').split(' ').filter(Boolean).reduce((s, d) => s + (free[d] ?? 0), 0) })
  return el as unknown as HTMLElement
}

test("the message box's agent line keeps the model and effort whole: logo, chevron, then mode go first", () => {
  expect((Pk as any).AGENT_DROPS).toEqual(['logo', 'chev', 'perm'])
  const roomy = line(200, 240)
  expect(fitAgentLine(roomy)).toBe(0)
  expect(roomy.dataset.drop).toBe('')
  // a phone with tap-sized buttons: 20 px short drops the logo only
  const phone = line(200, 180)
  expect(fitAgentLine(phone)).toBe(1)
  expect(phone.dataset.drop).toBe('logo')
  expect(fitAgentLine(line(200, 160))).toBe(2)
  expect(fitAgentLine(line(200, 120))).toBe(3)
  // the effort is cut only once all three are gone
  const tiny = line(200, 60)
  expect(fitAgentLine(tiny)).toBe(3)
  expect(tiny.dataset.drop).toBe('logo chev perm')
})
