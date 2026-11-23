import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { listOf } from '@shared/view.ts'

// SHEP-342: the filter and New space sit on each machine's heading, not on Everything. Each machine has its own
// filter, and its plus opens New space with that machine already picked.

const { getState, setUI } = await import('./kernel.ts')
const { closeAll, layersNow } = await import('./overlay.tsx')
// New space's fields need a live snapshot and a catalog: while a test here runs they show what they were given (every
// other test file gets the real ones)
const picker = await import('./picker.tsx')
let fake = false
mock.module('./picker.tsx', () => ({
  ...picker,
  MachineField: (p: Parameters<typeof picker.MachineField>[0]) => (fake ? <i data-picked-machine={p.value} /> : picker.MachineField(p)),
  AgentField: (p: Parameters<typeof picker.AgentField>[0]) => (fake ? null : picker.AgentField(p)),
  pickFor: (...a: Parameters<typeof picker.pickFor>) => (fake ? null : picker.pickFor(...a)),
}))
const { List } = await import('./list.tsx')

beforeEach(() => {
  fake = true
})
afterEach(() => {
  fake = false
  setUI({ shown: {} })
  closeAll()
})

const place = (id: string, machine: string, x = {}) => ({ id, name: id, machine, level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x })
const snap: Snapshot = {
  name: '',
  host: 'mini',
  user: '',
  everything: 'home',
  // mini: several spaces, one archived; vm: one, and a warning mark; pi: none
  places: [place('home', 'mini', { home: true }), place('shop', 'mini'), place('blog', 'mini'), place('old', 'mini', { archived: true }), place('garden', 'vm')],
  machines: [
    { id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' },
    { id: 'm:vm', machine: 'vm', name: 'vm', status: 'off', unreachableSince: '14:02' },
    { id: 'm:pi', machine: 'pi', name: 'pi', status: 'idle' },
  ],
  tasks: [],
  automations: {},
  artifacts: [],
  asks: {},
  needs: [],
  settings: [],
  sections: [],
}

const draw = () => renderToStaticMarkup(<List snap={snap} />)
/** the markup from a machine's heading to the next one */
const part = (html: string, machine: string) => html.slice(html.indexOf(`data-machine="${machine}"`)).split('data-machine=')[1]!

test('Everything has no filter and no plus; every machine heading has both, the one with a warning mark too', () => {
  const html = draw()
  const everything = html.slice(html.indexOf('Everything'), html.indexOf('data-machine='))
  expect(everything).not.toContain('Show which spaces')
  expect(everything).not.toContain('aria-label="New"')
  for (const m of ['mini', 'vm', 'pi']) {
    expect(part(html, m)).toContain(`aria-label="Show which spaces on ${m}"`)
    expect(part(html, m)).toContain(`aria-label="New space on ${m}"`)
  }
  expect(part(html, 'vm')).toContain(`aria-label="vm: Can&#x27;t reach. Open Machines"`)
  // New space is on the headings now, not at the foot
  expect(html).not.toContain('>New space<')
})

test("a machine's filter shows only that machine's spaces as it says, and marks itself", () => {
  setUI({ shown: { mini: 'Archived', pi: 'Archived' } })
  const html = draw()
  expect(part(html, 'mini')).toContain('old')
  expect(part(html, 'mini')).not.toContain('data-project="shop"')
  expect(part(html, 'mini')).toMatch(/aria-label="Show which spaces on mini"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Show which spaces on mini"/)
  expect(part(html, 'mini')).toContain('>Archived<')
  // the others keep their own: vm still shows its active space, unmarked
  expect(part(html, 'vm')).toContain('data-project="garden"')
  expect(part(html, 'vm')).not.toContain('aria-pressed="true"')
  // a machine with none to show says so, and keeps its heading (and so its filter)
  expect(part(html, 'pi')).toContain('No archived spaces.')
})

test("a machine's plus opens New space with that machine picked", () => {
  // the heading's plus, found in the drawn tree and pressed
  const find = (n: ReactNode, label: string): ReactElement<{ onClick: () => void }> | undefined => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.map((c) => find(c, label)).find(Boolean)
    const el = n as ReactElement<{ label?: string; children?: ReactNode }>
    if (el.props.label === label) return el as ReactElement<{ onClick: () => void }>
    if (typeof el.type === 'function' && el.type.name === 'MachineHead') return find((el.type as (p: unknown) => ReactNode)(el.props), label)
    return find(el.props.children, label)
  }
  const html = renderToStaticMarkup(<Probe />)
  expect(html).toBe('')
  function Probe() {
    find((List as (p: { snap: Snapshot }) => ReactNode)({ snap }), 'New space on vm')!.props.onClick()
    return null
  }
  const [form] = layersNow()
  expect(form?.label).toBe('New space')
  expect(renderToStaticMarkup(<>{form!.render(() => {})}</>)).toContain('data-picked-machine="vm"')
})

test('the list keeps every machine, each with its own filter and how many it has archived', () => {
  const ms = listOf(snap, (m) => (m === 'mini' ? 'All' : 'Active'))
  expect(ms.map((m) => [m.machine.machine, m.filter, m.archived])).toEqual([
    ['mini', 'All', 1],
    ['vm', 'Active', 0],
    ['pi', 'Active', 0],
  ])
  expect(ms[0]!.spaces.map((p) => p.id)).toEqual(['shop', 'blog', 'old'])
  // a machine with nothing archived stays in the archived view (its heading holds its filter)
  expect(listOf(snap, 'Archived').map((m) => m.spaces.length)).toEqual([1, 0, 0])
})

test("picking in a machine's filter menu changes that machine only, Active puts it back", async () => {
  const { filterMenu } = await import('./list.tsx')
  const pick = (label: string) => {
    filterMenu(null as unknown as Element, 'mini', 'mini', 1)
    const [menu] = layersNow()
    expect(menu?.label).toBe('Show which spaces on mini')
    const tree = menu!.render(() => closeAll()) as ReactElement<{ children: ReactNode[] }>
    const rows = (tree.props.children[1] as ReactElement<{ label: string; value?: string; onClick: () => void }>[])
    if (label === 'Archived') expect(rows.find((r) => r.props.label === 'Archived')!.props.value).toBe('1')
    rows.find((r) => r.props.label === label)!.props.onClick()
  }
  setUI({ shown: { vm: 'All' } })
  pick('Archived')
  expect(getState().ui.shown).toEqual({ vm: 'All', mini: 'Archived' })
  pick('Active')
  expect(getState().ui.shown).toEqual({ vm: 'All' })
})
