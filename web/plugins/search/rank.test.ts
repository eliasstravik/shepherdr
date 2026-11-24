// The palette's rows (SHEP-470): empty, recent picks first, then actions on what is in focus, then commands; typed, every
// item by its fuzzy match, a recent one a little higher; "> " only commands, "# " only spaces, "@ " only tasks.
import { expect, test } from 'bun:test'
import { byWords, rank } from './client.tsx'

const item = (key: string, kind: string, label: string, sub?: string) => ({ key, kind, label, sub, run: () => undefined }) as never
const all = {
  commands: [item('cmd:tasks.open', 'Command', 'Open Tasks'), item('cmd:shortcuts.settings', 'Command', 'Open Settings'), item('cmd:space.new', 'Command', 'New space')],
  actions: [item('task-act:1:Rename', 'Action', 'Rename', 'Fix login')],
  things: [item('space:shop', 'Space', 'shop'), item('task:1', 'Task', 'Fix login', 'shop'), item('task:2', 'Task', 'Open the shop', 'shop')],
}
const labels = (g: { label?: string; items: { label: string }[] }[]) => g.map((x) => [x.label ?? '', x.items.map((i) => i.label)])

test('empty: recent first, then the task in focus, then commands', () => {
  expect(labels(rank('', all, ['space:shop', 'cmd:space.new']))).toEqual([
    ['Recent', ['shop', 'New space']],
    ['Fix login', ['Rename']],
    ['Commands', ['Open Tasks', 'Open Settings']],
  ])
})

test('typed: ranked by match across everything; a recent pick a little higher', () => {
  const r = rank('open', all, [])[0].items.map((i) => i.label)
  expect(r.slice(0, 3).sort()).toEqual(['Open Settings', 'Open Tasks', 'Open the shop'])
  expect(r).not.toContain('Fix login')
  expect(rank('open', all, ['task:2'])[0].items[0].label).toBe('Open the shop')
  expect(rank('zzz', all, [])[0].items).toEqual([])
})

test('a prefix keeps to one kind', () => {
  expect(rank('>open', all, [])[0].items.map((i) => i.label).sort()).toEqual(['Open Settings', 'Open Tasks'])
  expect(rank('# ', all, [])[0].items.map((i) => i.label)).toEqual(['shop'])
  expect(rank('@fix', all, [])[0].items.map((i) => i.label)).toEqual(['Fix login'])
})

test('other words count only by their starts: "pref" finds Open Settings, scattered letters do not', () => {
  expect(byWords('pref', 'General preferences options')).toBe(300)
  expect(byWords('sto', 'Go to pane panel list show')).toBe(-1)
  const withWords = { ...all, commands: [{ key: 'cmd:s', kind: 'Command', label: 'Open Settings', words: 'preferences', run: () => undefined }] as never[] }
  expect(rank('pref', withWords, [])[0].items.map((i) => i.label)).toEqual(['Open Settings'])
})
