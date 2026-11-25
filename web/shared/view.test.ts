import { expect, test } from 'bun:test'
import type { Snapshot, Task } from './types.ts'
import { artifactsIn, doneWords, isEverything, isHomeSpace, tasksIn, etaOf, folderName, folderOf, headerWhere, leftShort, leftWords, listOf, needsCount, placeOf, ringOf, nowGroups, spaceLabel, spaceName, spacesOf, statusWord, headLine, taskLine, taskWhen, tstate } from './view.ts'

const task = (x: Partial<Task>): Task => ({ id: 'T-1', name: 'A task', place: 'shop', status: 'work', state: 'work', on: 'mini', created: '', age: '', ...x })

test('a status is worked out from facts first, then the agent\'s report', () => {
  expect(tstate(task({ status: 'done', archived: 1 }))).toBe('archived')
  expect(tstate(task({ status: 'merging' }))).toBe('working')
  expect(tstate(task({ status: 'ready' }))).toBe('ready')
  expect(tstate(task({ status: 'need' }))).toBe('ask')
  expect(tstate(task({ status: 'todo', stopped: { by: 'error' } }))).toBe('ask')
  expect(tstate(task({ status: 'queued' }))).toBe('next')
  expect(tstate(task({ status: 'todo' }))).toBe('next')
})

test('the words: Ready for review, Stopped in red, Stopped by you, Waiting for the desktop', () => {
  expect(statusWord(task({ status: 'ready' }))).toEqual({ word: 'Ready for review', tone: 'ready' })
  expect(statusWord(task({ status: 'need', stopped: { by: 'error', why: 'It crashed' } }))).toEqual({ word: 'Stopped', tone: 'red' })
  expect(statusWord(task({ status: 'need', stopped: { by: 'you' } })).word).toBe('Stopped by you')
  expect(statusWord(task({ status: 'work', waitsDesktop: true })).word).toBe('Waiting for the desktop')
  expect(statusWord(task({ status: 'merging' })).word).toBe('Merging')
})

test('a finished task says how it ended', () => {
  expect(doneWords(task({ status: 'done', merged: true, doneNote: '1 link fixed' }))).toBe('Done and merged · 1 link fixed')
  expect(doneWords(task({ status: 'done', branch: 'task/x' }))).toBe('Done · not merged')
  expect(doneWords(task({ status: 'done', repo: 'folder' }))).toBe('Done')
  expect(doneWords(task({ status: 'done', quiet: 'nothing' }))).toBe('Done · nothing to do')
  expect(doneWords(task({ status: 'done', quiet: 'told', doneNote: 'told you in Everything' }))).toBe('Done · told you in Everything')
  // the status line's word alone
  expect(statusWord(task({ status: 'done', merged: true, doneNote: '1 link fixed' })).word).toBe('Done and merged')
  expect(statusWord(task({ status: 'done', branch: 'b' })).word).toBe('Done · not merged')
})

test('a row\'s second line: nothing for a plain task not started yet', () => {
  expect(taskLine(task({ status: 'todo' }))).toBe('')
  expect(taskLine(task({ status: 'queued', afterTitle: 'Fix typo' }))).toBe('Starts after Fix typo')
  expect(taskLine(task({ status: 'need', report: { msg: 'Which provider?' } }))).toBe('Which provider?')
  expect(taskLine(task({ status: 'need', blocked: 'prompt' }))).toBe('Waiting at a prompt')
  expect(taskLine(task({ status: 'work', schedule: 'Morning brief' }))).toBe('Started by its schedule')
})

test('the time left is the agent\'s own, short under the icon: 59m, 1h, 2h, nothing when unknown', () => {
  expect(leftShort(59)).toBe('59m')
  expect(leftShort(13)).toBe('13m')
  expect(leftShort(60)).toBe('1h')
  expect(leftShort(120)).toBe('2h')
  expect(leftShort(0)).toBe('<1m')
  expect(leftShort(null)).toBe('')
  expect(leftShort(undefined)).toBe('')
  expect(leftWords(10)).toBe('10 min left')
  expect(leftWords(null)).toBe('')
  // only while it works: none waiting on you, none finished, none when it gave none
  expect(etaOf(task({ status: 'work', report: { msg: '', progress: 50, eta: 13 } }))).toBe(13)
  expect(etaOf(task({ status: 'work', report: { msg: '', progress: 50 } }))).toBeNull()
  expect(etaOf(task({ status: 'need', report: { msg: '', progress: 50, eta: 13, paused: true } }))).toBeNull()
  expect(etaOf(task({ status: 'ready', report: { msg: '', eta: 13 } }))).toBeNull()
  // the row's right: a Working row's time sits under its icon, not there; a Needs you row's wait does
  const now = 1_000_000_000
  expect(taskWhen(task({ status: 'work', report: { msg: '', progress: 50, eta: 10 } }), now)).toBe('')
  expect(taskWhen(task({ status: 'need', needsAt: now - 2 * 3_600_000 }), now)).toBe('2h')
})

test('the ring shows the share done in every unfinished state; Ready and Done show the check', () => {
  const r = (x: Partial<Task>) => ringOf(task(x))
  expect(r({ status: 'work', report: { msg: '', progress: 40 } })).toMatchObject({ kind: 'ring', tone: 'working', pct: 40 })
  expect(r({ status: 'work' })).toMatchObject({ kind: 'ring', tone: 'working', pct: null })
  expect(r({ status: 'need', report: { msg: '', progress: 70, paused: true } })).toMatchObject({ kind: 'ring', tone: 'ask', pct: 70, mark: 'tint' })
  expect(r({ status: 'need', stopped: { by: 'error' }, report: { msg: '', progress: 30 } })).toMatchObject({ kind: 'ring', tone: 'red', pct: 30, mark: 'stop' })
  expect(r({ status: 'todo', stopped: { by: 'you' }, report: { msg: '', progress: 55 } })).toMatchObject({ kind: 'ring', tone: 'ask', pct: 55, mark: 'stop' })
  // up next and scheduled: a solid empty ring (no mark); waiting for Start: dotted
  expect(r({ status: 'queued' })).toMatchObject({ kind: 'ring', tone: 'mute', pct: 0, label: 'Up next' })
  expect(r({ status: 'queued' }).mark).toBeUndefined()
  expect(r({ status: 'scheduled' }).mark).toBeUndefined()
  expect(r({ status: 'todo' })).toMatchObject({ kind: 'ring', tone: 'mute', pct: 0, mark: 'unstarted', label: 'Not started' })
  expect(r({ status: 'todo', started: 1 }).mark).toBeUndefined()
  expect(r({ status: 'ready', report: { msg: '', progress: 100 } })).toMatchObject({ kind: 'check', tone: 'ready' })
  expect(r({ status: 'merging' })).toMatchObject({ kind: 'check', tone: 'ready' })
  expect(r({ status: 'done' })).toMatchObject({ kind: 'check', tone: 'mute' })
  // out of range is held in 0-100, and the label says the share
  expect(r({ status: 'work', report: { msg: '', progress: 140 } }).pct).toBe(100)
  expect(r({ status: 'work', report: { msg: '', progress: 40 } }).label).toBe('Working, 40% done')
})

const snap = (x: Partial<Snapshot>): Snapshot => ({ name: '', host: 'mini', user: '', places: [], machines: [], tasks: [], automations: {}, artifacts: [], asks: {}, needs: [], settings: [], ...x })
const place = (id: string, machine: string, x = {}) => ({ id, name: id, machine, level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x })

test("the list: machines as headings, another machine's home space a space like any, groups next, archived by the filter", () => {
  const s = snap({
    everything: 'home',
    places: [place('home', 'mini', { home: true }), place('shop', 'mini'), place('blog', 'mini', { archived: true }), place('vmhome', 'vm', { home: true, unnamed: true }), place('garden', 'vm')],
    machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'off', unreachableSince: '14:02' }],
    sections: [{ id: 's:1', name: 'Store', machine: 'mini', spaces: ['shop', 'blog'] }],
  })
  const active = listOf(s, 'Active')
  expect(active.map((m) => m.machine.name)).toEqual(['mini', 'vm'])
  expect(active[0]!.groups[0]!.spaces.map((p) => p.id)).toEqual(['shop'])
  expect(active[1]!.spaces.map((p) => p.id)).toEqual(['vmhome', 'garden'])
  expect(active[1]!.warn).toBe("Can't reach")
  // every machine's home space: vm's is one of its spaces, first; mini's is Everything, never a row of its own
  expect(active[0]!.spaces.map((p) => p.id)).not.toContain('home')
  expect(listOf(s, 'Archived')[1]!.spaces).toEqual([])
  expect(spaceLabel(s, 'vmhome')).toBe('~ on vm')
  // named, it shows its name as any space; archived, it moves to the Archived filter
  const named = { ...s, places: s.places.map((p) => (p.id === 'vmhome' ? { ...p, name: 'box', unnamed: undefined, archived: true } : p)) }
  expect(spaceLabel(named, 'vmhome')).toBe('#box')
  expect(spaceName(named, named.places[3]!)).toBe('box')
  expect(listOf(named, 'Active')[1]!.spaces.map((p) => p.id)).toEqual(['garden'])
  expect(listOf(named, 'Archived')[1]!.spaces.map((p) => p.id)).toEqual(['vmhome'])
  expect(listOf(named, 'Archived')[1]!.archived).toBe(1)
  expect(spaceLabel(s, 'home')).toBe('Everything')
  expect(spaceName(s, s.places[3]!)).toBe('~')
  expect(placeOf(s, 'vmhome')?.id).toBe('vmhome')
  expect(spacesOf(s).map((p) => p.id)).toEqual(['shop', 'blog', 'vmhome', 'garden'])
  expect(listOf(s, 'Archived')[0]!.spaces.map((p) => p.id)).toEqual(['blog'])
  expect(listOf(s, 'All')[0]!.groups[0]!.spaces.map((p) => p.id)).toEqual(['shop', 'blog'])
})

test('needs you: a space\'s tasks under Needs you and Ready for review, and its own chat asking', () => {
  const s = snap({
    everything: 'home',
    places: [place('home', 'mini', { home: true }), place('shop', 'mini', { needs: true }), place('blog', 'mini')],
    tasks: [task({ id: 'a', status: 'need' }), task({ id: 'b', status: 'ready' }), task({ id: 'c', status: 'work' }), task({ id: 'd', status: 'ready', place: 'blog' }), task({ id: 'e', status: 'need', archived: 1 })],
  })
  expect(needsCount(s, 'shop')).toBe(3)
  expect(needsCount(s, 'blog')).toBe(1)
  expect(needsCount(s, 'home')).toBe(4)
  expect(nowGroups(s.tasks).map((g) => [g.name, g.tasks.length])).toEqual([['Needs you', 3], ['Working', 1], ['Up next', 0], ['Done', 0], ['Archived', 1]])
})

test("a space's folder: home as ~, the whole path, another machine named (SHEP-302)", () => {
  const snap = { host: 'mini', machines: [{ id: 'm:vm-b', machine: 'vm-b', name: 'Build box', status: 'idle' }] } as unknown as Snapshot
  expect(folderOf(snap, { machine: 'mini', where: '~/dev/shop', folder: '/Users/sam/dev/shop' })).toEqual({ short: '~/dev/shop', full: '/Users/sam/dev/shop', machine: null })
  expect(folderOf(snap, { machine: 'vm-b', where: '~/clients/acme/shop', folder: '/home/sam/clients/acme/shop' })).toEqual({ short: '~/clients/acme/shop', full: '/home/sam/clients/acme/shop', machine: 'Build box' })
  // a trailing slash, and an older service that sends only `where`
  expect(folderOf(snap, { machine: 'mini', where: '~/dev/shop/' })).toMatchObject({ short: '~/dev/shop', full: '~/dev/shop' })
  expect(folderOf(snap, { machine: 'mini', where: '/' })).toMatchObject({ short: '/', full: '/' })
  // a machine Shepherdr doesn't list by name: its key
  expect(folderOf(snap, { machine: 'vm-c', where: '~/x' }).machine).toBe('vm-c')
})

test('a folder shows as its path, never a made-up name', () => {
  expect(folderName('~')).toBe('~')
  expect(folderName('/')).toBe('/')
  expect(folderName('')).toBe('/')
  expect(folderName('~/dev/shop')).toBe('~/dev/shop')
  expect(folderName('/srv/app')).toBe('/srv/app')
})

test("a chat header's where: the folder, the machine only when it adds something, Everything too (SHEP-360)", () => {
  const snap = { host: 'mini', everything: 'ev', places: [{ id: 'ev', machine: 'mini', home: true }], machines: [{ id: 'm:mini', machine: 'mini', name: 'Mac mini', status: 'idle' }, { id: 'm:vm-b', machine: 'vm-b', name: 'Build box', status: 'idle' }] } as unknown as Snapshot
  // a named space here: its path alone, cut from its start when long
  expect(headerWhere(snap, { id: 'shop', machine: 'mini', where: '~/dev/shop', folder: '/Users/sam/dev/shop' })).toEqual({ path: '~/dev/shop', cut: true, full: '/Users/sam/dev/shop', machine: null })
  // on another machine: that machine
  expect(headerWhere(snap, { id: 'x', machine: 'vm-b', where: '~/clients/acme/shop', folder: '/home/sam/clients/acme/shop' })).toMatchObject({ path: '~/clients/acme/shop', machine: 'Build box' })
  // the root: / as it is, never cut
  expect(headerWhere(snap, { id: 'r', machine: 'vm-b', where: '/', folder: '/' })).toEqual({ path: '/', cut: false, full: '/', machine: 'Build box' })
  // Everything: ~ as it is, with the machine whose home it is
  expect(headerWhere(snap, { id: 'ev', machine: 'mini', where: '~', folder: '/Users/sam' })).toEqual({ path: '~', cut: false, full: '/Users/sam', machine: 'Mac mini' })
  // Everything from a service that sends no folder still says it
  expect(headerWhere(snap, { id: 'ev', machine: 'mini' })).toEqual({ path: '~', cut: false, full: '~', machine: 'Mac mini' })
  // another space with no folder: nothing
  expect(headerWhere(snap, { id: 'y', machine: 'mini' })).toBeNull()
})

test("the main machine's own ~ space: a space of its own beside Everything; its Tasks and Artifacts its home folder's (3.2.8)", () => {
  const s = snap({
    everything: 'home',
    places: [place('home', 'mini', { home: true }), place('shop', 'mini'), place('tilde', 'mini', { home: true, unnamed: true }), place('vmhome', 'vm', { home: true, unnamed: true })],
    machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'idle' }],
    tasks: [{ id: 'A-1', place: 'tilde' }, { id: 'A-2', place: 'home', also: ['tilde'] }, { id: 'A-3', place: 'shop' }] as Task[],
    artifacts: [{ id: 'a1', place: 'home', at: 2 }, { id: 'a2', place: 'shop', at: 1 }, { id: 'a3', place: 'vmhome', at: 3 }] as Snapshot['artifacts'],
  })
  expect(isEverything(s, 'home')).toBe(true)
  expect(isHomeSpace(s, s.places[2]!)).toBe(true)
  expect(isHomeSpace(s, s.places[0]!)).toBe(false)
  expect(listOf(s, 'Active')[0]!.spaces.map((p) => p.id)).toEqual(['shop', 'tilde'])
  expect(spaceLabel(s, 'tilde')).toBe('~ on mini')
  expect(spaceLabel(s, 'home')).toBe('Everything')
  // Everything keeps every machine's; the ~ space its own folder's
  expect(tasksIn(s, 'home').map((t) => t.id)).toEqual(['A-1', 'A-2', 'A-3'])
  expect(tasksIn(s, 'tilde').map((t) => t.id)).toEqual(['A-1', 'A-2'])
  expect(artifactsIn(s, 'tilde').map((a) => a.id)).toEqual(['a1'])
  expect(artifactsIn(s, 'vmhome').map((a) => a.id)).toEqual(['a3'])
  expect(artifactsIn(s, 'home').map((a) => a.id)).toEqual(['a3', 'a1', 'a2'])
})

// #1473: an open task's header says how it is doing, as its row in the list does, with the time left
test("an open task's header line: its row's words, else its state, and the time left", () => {
  expect(headLine(task({ report: { msg: 'Running the full tests', eta: 5 } }))).toBe('Running the full tests · 5 min left')
  expect(headLine(task({}))).toBe('Working')
  expect(headLine(task({ status: 'todo' }))).toBe('Up next')
  expect(headLine(task({ status: 'need', report: { msg: 'Needs a go for a screenshot' } }))).toBe('Needs a go for a screenshot')
  expect(headLine(task({ status: 'ready' }))).toBe('Ready for review')
})
