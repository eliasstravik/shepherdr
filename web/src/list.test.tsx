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
  // mini: several spaces, one archived; vm: its home space and one, and a warning mark; pi: its home space only
  places: [place('home', 'mini', { home: true }), place('shop', 'mini'), place('blog', 'mini'), place('old', 'mini', { archived: true }), place('vmh', 'vm', { home: true, name: 'home', unnamed: true }), place('garden', 'vm'), place('pih', 'pi', { home: true, name: 'home', unnamed: true })],
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
const part = (html: string, machine: string) => html.slice(html.indexOf(`data-heading="m:${machine}"`)).split('data-heading="m:')[1]!

test('Everything has no filter and no plus; every machine heading has both, the one with a warning mark too', () => {
  const html = draw()
  const everything = html.slice(html.indexOf('Everything'), html.indexOf('data-heading="m:'))
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
  expect(part(html, 'mini')).toContain('aria-label="Show which spaces on mini (on)"')
  expect(part(html, 'mini')).toContain('class="fdot"')
  expect(part(html, 'mini')).toContain('>Archived<')
  // the others keep their own: vm still shows its active space, unmarked
  expect(part(html, 'vm')).toContain('data-project="garden"')
  expect(part(html, 'vm')).toContain('aria-label="Show which spaces on vm"')
  expect(part(html, 'vm')).not.toContain('fdot')
  // a machine with none to show says so, and keeps its heading (and so its filter); its home space is no archived one
  expect(part(html, 'pi')).toContain('No archived spaces.')
  expect(part(html, 'pi')).not.toContain('data-project="pih"')
})

test("every other machine's home space is its first row, as ~; this computer's is Everything, never a row (SHEP-429)", () => {
  setUI({ shown: {} })
  const html = draw()
  for (const [m, id] of [['vm', 'vmh'], ['pi', 'pih']] as const) {
    const it = part(html, m)
    expect(it).toContain(`data-project="${id}"`)
    expect(it).toContain(`aria-label="~ on ${m}"`)
    expect(it).toContain(`aria-label="More for ~ on ${m}"`)
    expect(it).not.toContain('>home<')
  }
  // vm's home row before its other space
  expect(part(html, 'vm').indexOf('data-project="vmh"')).toBeLessThan(part(html, 'vm').indexOf('data-project="garden"'))
  expect(part(html, 'mini')).not.toContain('data-project="home"')
})

test("a machine's home space carries the # icon like any space, its name still ~; Everything keeps layers", async () => {
  const { IC } = await import('./icons.ts')
  const html = draw()
  const row = (id: string) => html.slice(html.indexOf(`data-project="${id}"`)).split('data-project=')[1]!
  for (const id of ['vmh', 'pih']) {
    expect(row(id)).toContain(IC.hash)
    expect(row(id)).not.toContain(IC.folder)
  }
  expect(html.slice(0, html.indexOf('data-machine='))).toContain(IC.layers)
})

test("a machine's home space is a space like any other: named, it shows its name with #; archived, it leaves the list", () => {
  const named = { ...snap, places: snap.places.map((p) => (p.id === 'vmh' ? { ...p, name: 'vm-box', unnamed: undefined } : p.id === 'pih' ? { ...p, archived: true } : p)) }
  const html = renderToStaticMarkup(<List snap={named} />)
  expect(part(html, 'vm')).toContain('>vm-box<')
  expect(part(html, 'vm')).toContain('aria-label="More for vm-box"')
  expect(part(html, 'vm')).not.toContain('aria-label="~ on vm"')
  expect(part(html, 'pi')).not.toContain('data-project="pih"')
  setUI({ shown: { pi: 'Archived' } })
  expect(part(renderToStaticMarkup(<List snap={named} />), 'pi')).toContain('data-project="pih"')
})

test("the main machine has its own ~ row too, first, with the full menu; Everything stays the top row (3.2.8)", () => {
  setUI({ shown: {} })
  // the service lists it right after Everything
  const withTilde = { ...snap, places: [snap.places[0]!, place('tilde', 'mini', { home: true, name: 'home', unnamed: true }), ...snap.places.slice(1)] }
  const html = renderToStaticMarkup(<List snap={withTilde} />)
  const mini = part(html, 'mini')
  expect(mini).toContain('data-project="tilde"')
  expect(mini).toContain('aria-label="~ on mini"')
  expect(mini).toContain('aria-label="More for ~ on mini"')
  expect(mini.indexOf('data-project="tilde"')).toBeLessThan(mini.indexOf('data-project="shop"'))
  expect(mini).not.toContain('data-project="home"')
  expect(html.slice(0, html.indexOf('data-machine='))).toContain('Everything')
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
    // one MenuGroup ("Show"), its rows its children: the Tasks filter's rhythm (SHEP-354)
    const tree = menu!.render(() => closeAll()) as ReactElement<{ cap: string; children: ReactNode }>
    expect(tree.props.cap).toBe('Show')
    const rows = tree.props.children as ReactElement<{ label: string; value?: string; onClick: () => void }>[]
    if (label === 'Archived') expect(rows.find((r) => r.props.label === 'Archived')!.props.value).toBe('1')
    rows.find((r) => r.props.label === label)!.props.onClick()
  }
  setUI({ shown: { vm: 'All' } })
  pick('Archived')
  expect(getState().ui.shown).toEqual({ vm: 'All', mini: 'Archived' })
  pick('Active')
  expect(getState().ui.shown).toEqual({ vm: 'All' })
})

// Rename a machine: long-press (right click on a desktop) on its heading opens its menu: Rename, back to its own name
// once renamed, Machine settings. The first line shows the real name; the rename goes to the service as "m:<machine>".
const renamed: Snapshot = { ...snap, machines: [{ id: 'm:mini', machine: 'mini', name: 'Studio', ownName: 'This computer', status: 'idle', here: true }, { id: 'm:vm', machine: 'vm', name: 'Dev box', ownName: 'vm', status: 'idle' }, { id: 'm:pi', machine: 'pi', name: 'pi', ownName: 'pi', status: 'idle' }] }
const menuOf = async (key: string, s: Snapshot) => {
  const { machineMenu } = await import('./list.tsx')
  machineMenu(null, key, s)
  const [menu] = layersNow()
  const tree = menu!.render(() => closeAll()) as ReactElement<{ rows: { label: string; run: () => void }[]; top?: ReactNode }>
  return { menu: menu!, rows: tree.props.rows, top: renderToStaticMarkup(<>{tree.props.top}</>) }
}

test("a machine's menu: Rename and Machine settings, its real name on the first line", async () => {
  const { menu, rows, top } = await menuOf('pi', renamed)
  expect(menu.label).toBe('pi')
  expect(rows.map((r) => r.label)).toEqual(['Rename', 'Machine settings'])
  expect(top).toContain('>pi<')
})

test('a renamed machine shows both names, and can go back to its own', async () => {
  const sent: unknown[] = []
  const was = globalThis.fetch
  globalThis.fetch = (async (_u: string, o: { body: string }) => (sent.push(JSON.parse(o.body)), new Response('{"ok":true}'))) as unknown as typeof fetch
  try {
    const vm = await menuOf('vm', renamed)
    expect(vm.menu.label).toBe('Dev box')
    expect(vm.top).toContain('>Dev box<')
    expect(vm.top).toContain('>vm<')
    expect(vm.rows.map((r) => r.label)).toEqual(['Rename', 'Use its own name (vm)', 'Machine settings'])
    vm.rows[1]!.run()
    // this computer: its host name beside the given one
    const here = await menuOf('mini', renamed)
    expect(here.top).toContain('mini · this computer')
    // Rename opens the small dialog; Save sends the machine's real key
    here.rows[0]!.run()
    const [form] = layersNow()
    expect(form?.label).toBe('Rename')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toEqual([{ type: 'rename', id: 'm:vm', name: '' }])
  } finally {
    globalThis.fetch = was
  }
})

test("the heading opens the menu on a right click, never from its filter or plus; links keep the real name", async () => {
  const { headHold } = await import('./list.tsx')
  const h = headHold('vm')
  let stopped = false
  const ev = (inButton: boolean) => ({ target: { closest: (q: string) => (inButton && q === '.ib' ? {} : null) }, currentTarget: { querySelector: () => null }, preventDefault: () => (stopped = true) })
  h.onContextMenu(ev(true) as never)
  expect(stopped).toBe(false)
  expect(layersNow()).toEqual([])
  // the heading carries the real key whatever it is called
  const html = renderToStaticMarkup(<List snap={renamed} />)
  expect(html).toContain('data-machine="vm"')
  expect(html).toContain('data-heading="m:vm"')
  expect(html).toContain('>Dev box<')
})

// SHEP-438: a tap on a machine's name folds its spaces; folded, it shows what they need and keeps the open one in sight
test("a folded machine hides its spaces, says so on its name, and rolls up what they need", () => {
  const needy = { ...snap, places: snap.places.map((p) => (p.id === 'garden' || p.id === 'vmh' ? { ...p, needs: true } : p)) }
  setUI({ shut: { 'm:vm': true }, at: 'home' })
  try {
    const vm = part(renderToStaticMarkup(<List snap={needy} />), 'vm')
    expect(vm).toContain('aria-expanded="false"')
    expect(vm).not.toContain('data-project="garden"')
    expect(vm).not.toContain('data-project="vmh"')
    expect(vm).toContain('<span class="cnt">2</span>')
    // the others stay open
    const mini = part(renderToStaticMarkup(<List snap={needy} />), 'mini')
    expect(mini).toContain('aria-expanded="true"')
    expect(mini).toContain('data-project="shop"')
  } finally {
    setUI({ shut: {}, at: '' })
  }
})

test('the open space stays in sight under its folded machine, and its own count is not counted twice', () => {
  const needy = { ...snap, places: snap.places.map((p) => (p.id === 'garden' || p.id === 'vmh' ? { ...p, needs: true } : p)) }
  setUI({ shut: { 'm:vm': true }, at: 'garden' })
  try {
    const vm = part(renderToStaticMarkup(<List snap={needy} />), 'vm')
    expect(vm).toContain('data-project="garden"')
    expect(vm).not.toContain('data-project="vmh"')
    expect(vm.split('data-project')[0]).toContain('<span class="cnt">1</span>')
  } finally {
    setUI({ shut: {}, at: '' })
  }
})

test("fold flips one machine's state on this device, beside the groups' (ui.shut, kept across loads)", async () => {
  const { fold } = await import('./list.tsx')
  setUI({ shut: { g1: true } })
  try {
    fold('m:vm')
    expect(getState().ui.shut).toEqual({ g1: true, 'm:vm': true })
    fold('m:vm')
    expect(getState().ui.shut).toEqual({ g1: true })
  } finally {
    setUI({ shut: {} })
  }
})

test('a dragged order shows at once; a machine it does not name (new) stays last', async () => {
  const { inMachineOrder } = await import('./list.tsx')
  const keys = ['mini', 'vm', 'pi', 'new']
  expect(inMachineOrder(keys, (k) => k, ['pi', 'mini', 'vm'])).toEqual(['pi', 'mini', 'vm', 'new'])
  expect(inMachineOrder(keys, (k) => k, null)).toEqual(keys)
})

test('every row of a machine carries its key, so dragging its heading takes them along', () => {
  setUI({ at: '' })
  const html = renderToStaticMarkup(<List snap={snap} />)
  expect(html).toContain('data-project="garden" data-machine="vm"')
  expect(html).toContain('data-project="shop" data-machine="mini"')
  // the keyboard way to move it, for those who don't drag
  expect(part(html, 'vm')).toContain('aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"')
})
