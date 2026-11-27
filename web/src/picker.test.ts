import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Catalog } from '@shared/types.ts'
import { AgentLine, choiceList, pickerRows, PickSummary, samePick, type Pick } from './picker.tsx'

// SHEP-333: the agent picker's rows are all one kind: a label, what is picked and a chevron, each opening its own list.
// Effort and Speed used to be segmented switches beside them.

const cat: Catalog = {
  machine: 'here',
  agents: [
    {
      id: 'claude',
      name: 'Claude Code',
      installed: true,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      perms: [
        { id: 'default', label: 'Ask', about: 'Asks before edits' },
        { id: 'bypass', label: 'Bypass', about: 'Never asks' },
      ],
      permDefault: 'default',
      defaultModel: 'big',
      models: [
        { id: 'big', name: 'Big 1', speeds: ['regular', 'fast', 'ultrafast'] },
        { id: 'small', name: 'Small 1', efforts: ['low', 'high'] },
      ],
    },
    { id: 'plain', name: 'Plain', installed: true, efforts: [], perms: [], models: [{ id: 'one', name: 'One' }] },
  ],
}

const pick: Pick = { agent: 'claude', model: 'big', effort: 'medium', fast: false, perm: 'bypass' }

test('Update appears only when the effective choice differs', () => {
  const now = { ...pick, perm: null }
  expect(samePick(now, { ...now, fast: undefined, perm: 'default' }, cat)).toBe(true)
  expect(samePick(now, { ...now, model: 'big-version', label: 'Big 1' }, cat)).toBe(true)
  for (const changed of [{ fast: 'ultrafast' as const }, { effort: 'high' }, { model: 'small' }, { perm: 'bypass' }, { agent: 'plain' }])
    expect(samePick(now, { ...now, ...changed }, cat)).toBe(false)
})

test('every choice is a row, in the order Agent, Model, Effort, Speed, Permissions', () => {
  expect(pickerRows(pick, cat)).toEqual([
    { f: 'agent', label: 'Agent', value: 'Claude Code' },
    { f: 'model', label: 'Model', value: 'Big 1' },
    { f: 'effort', label: 'Effort', value: 'Medium' },
    { f: 'speed', label: 'Speed', value: 'Standard' },
    { f: 'mode', label: 'Permissions', value: 'Bypass' },
  ])
})

test('Standard is always available, while only supported faster tiers appear', () => {
  expect(pickerRows({ ...pick, model: 'small' }, cat).map((r) => r.f)).toEqual(['agent', 'model', 'effort', 'speed', 'mode'])
  expect(pickerRows({ agent: 'plain' }, cat).map((r) => r.f)).toEqual(['agent', 'model', 'speed'])
  expect(choiceList('speed', { ...pick, model: 'small' }, cat).items.map((x) => x.label)).toEqual(['Standard'])
})

test("the Effort row opens a list of the model's own levels, with the picked one on", () => {
  const all = choiceList('effort', pick, cat)
  expect(all.title).toBe('Effort · Big 1')
  expect(all.items.map((x) => x.label)).toEqual(['Low', 'Medium', 'High', 'Xhigh', 'Max'])
  expect(all.items.filter((x) => x.on).map((x) => x.id)).toEqual(['medium'])
  expect(all.items.find((x) => x.id === 'xhigh')!.pick).toEqual({ ...pick, effort: 'xhigh' })
  expect(choiceList('effort', { ...pick, model: 'small', effort: 'high' }, cat).items.map((x) => x.label)).toEqual(['Low', 'High'])
})

test('the Speed row opens Standard, Fast and Ultra-fast', () => {
  const s = choiceList('speed', { ...pick, fast: true }, cat)
  expect(s.items.map((x) => [x.label, x.on])).toEqual([['Standard', false], ['Fast', true], ['Ultra-fast', false]])
  expect(s.items[2]!.pick.fast).toBe('ultrafast')
  expect(s.items[0]!.pick.fast).toBe(false)
  expect(pickerRows({ ...pick, fast: 'ultrafast' }, cat).find((r) => r.f === 'speed')!.value).toBe('Ultra-fast')
})

test('summaries and the message box capitalize effort and show one bolt per faster tier', () => {
  for (const [fast, name, count] of [[false, '', 0], [true, 'Fast', 1], ['ultrafast', 'Ultra-fast', 2]] as const) {
    const chosen = { ...pick, effort: 'xhigh', fast }
    const summary = renderToStaticMarkup(createElement(PickSummary, { pick: chosen, cat }))
    const composer = renderToStaticMarkup(createElement(AgentLine, { pick: chosen, machine: cat.machine, onClick: () => {} }))
    expect(summary).toContain('>Big 1</span>')
    expect(summary).toContain('> · Xhigh</span>')
    expect(composer).toContain('>Xhigh</span>')
    expect(summary.match(/class="i s16"/g) ?? []).toHaveLength(count)
    expect(composer.match(/class="i s16"/g) ?? []).toHaveLength(count + 1) // includes the chevron
    expect(summary).not.toContain('>Standard<')
    expect(composer).not.toMatch(/>\s*(?:Standard|Fast|Ultra-fast)\s*</)
    if (name) {
      expect(summary).toContain(`role="img" aria-label="${name}"`)
      expect(composer).toContain(`, ${name}. Change`)
    } else {
      expect(summary).not.toContain('speed-bolts')
      expect(composer).not.toContain('Standard')
    }
  }
})

test('the Permissions row opens the same kind of list, each mode with its line', () => {
  const m = choiceList('mode', pick, cat)
  expect(m.items.map((x) => [x.label, x.sub, x.on])).toEqual([['Ask', 'Asks before edits', false], ['Bypass', 'Never asks', true]])
  expect(m.items[0]!.pick.perm).toBe('default')
})
