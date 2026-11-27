import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { expandPicked, mentionItems, takeItem, taskFor, typed, withMentions, type Got, type Item } from './mentions.tsx'

// GitHub #1552: # and @ in the message box open the space and task picker again, and what is picked goes to the agent
// as the links the renderer and the templates know.

const task = (id: string, name: string, place: string, status: Task['status'] = 'work', more: Partial<Task> = {}) => ({ id, name, place, status, on: id.includes(':') ? id.split(':')[0] : 'vm-a', ...more }) as Task
const snap = {
  host: 'vm-a',
  places: [
    { id: 'sp1', name: 'shop', machine: 'vm-a', chat: 'p:sp1' },
    { id: 'sp2', name: 'cafe', machine: 'vm-a', chat: 'p:sp2' },
    { id: 'vm-b/sp9', name: 'blog', machine: 'vm-b', chat: 'p:vm-b/sp9' },
  ],
  machines: [{ key: 'vm-b', name: 'vm-b' }],
  tasks: [
    task('SHOP-1', 'Fix login', 'sp1'),
    task('SHOP-2', 'Old thing', 'sp1', 'done'),
    task('CAFE-4', 'New menu', 'sp2', 'need', { taskFolder: '~/dev/cafe' }),
    task('vm-b:BLOG-7', 'Write post', 'vm-b/sp9'),
  ],
} as unknown as Snapshot
const got: Got = {
  from: 'vm-a',
  checked: 1,
  spaces: [
    { id: 'sp1', name: 'shop', route: '', machine: 'vm-a', target: 'sp1' },
    { id: 'sp2', name: 'cafe', route: '', machine: 'vm-a', target: 'sp2' },
  ],
}

test('# or @ at a word start opens its list; inside a word or after a space it does not', () => {
  expect(typed('#')).toEqual({ kind: '#', q: '' })
  expect(typed('ask #ca')).toEqual({ kind: '#', q: 'ca' })
  expect(typed('ping @sh')).toEqual({ kind: '@', q: 'sh' })
  expect(typed('mail a@b')).toBeNull()
  expect(typed('# Title ')).toBeNull()
  expect(typed('see#x')).toBeNull()
})

test('# lists the spaces this agent reaches, filtered as you type', () => {
  expect(mentionItems(snap, 'sp1', '#', '', got).map((i) => i.key)).toEqual(['s:sp1', 's:sp2'])
  expect(mentionItems(snap, 'sp1', '#', 'ca', got).map((i) => i.kind === 'space' && i.space.name)).toEqual(['cafe'])
  // before the agent's list comes: nothing yet (the list says it is looking)
  expect(mentionItems(snap, 'sp1', '#', '', null)).toEqual([])
})

test('@ lists the tasks in spaces it reaches, waiting on you first and Done last; another machine it cannot reach is left out', () => {
  expect(mentionItems(snap, 'sp1', '@', '', got).map((i) => i.key)).toEqual(['t:CAFE-4', 't:SHOP-1', 't:SHOP-2'])
  expect(mentionItems(snap, 'sp1', '@', 'menu', got).map((i) => i.key)).toEqual(['t:CAFE-4'])
  // before the list comes: the chat's own space's tasks
  expect(mentionItems(snap, 'sp1', '@', '', null).map((i) => i.key)).toEqual(['t:SHOP-1', 't:SHOP-2'])
})

test('a pick puts the short form in the box, and at send the agent gets the full links', () => {
  const [cafe] = mentionItems(snap, 'sp1', '#', 'ca', got)
  const a = takeItem('p:sp1', 'ask #ca', ' about it', cafe)
  expect(a).toEqual({ text: 'ask #cafe about it', caret: 10 })
  const menu = mentionItems(snap, 'sp1', '@', 'menu', got)[0] as Item & { kind: 'task' }
  const b = takeItem('p:sp1', `${a.text} and @me`, '', menu)
  expect(b.text).toBe('ask #cafe about it and @CAFE-4 ')
  expect(expandPicked('p:sp1', b.text)).toBe('ask [#cafe](space:sp2) about it and [@New menu](task:CAFE-4?folder=~/dev/cafe) ')
  // picks are spent at send: typed again by hand, it goes as typed
  expect(expandPicked('p:sp1', '#cafe')).toBe('#cafe')
})

test('a task in this chat\'s own space leaves its folder out', () => {
  const fix = mentionItems(snap, 'sp1', '@', 'fix', got)[0]
  takeItem('x', '@fix', '', fix)
  expect(expandPicked('x', '@SHOP-1 ')).toBe('[@Fix login](task:SHOP-1) ')
  expect(fix.kind === 'task' && fix.pick).toEqual({ ref: 'SHOP-1', route: '', folder: '', title: 'Fix login' })
})

test('task links prefer the chat space and machine, and respect a picked route', () => {
  const other = task('vm-b:SHOP-1', 'Fix checkout', 'vm-b/sp9')
  const collision = { ...snap, tasks: [other, ...snap.tasks] }
  expect(taskFor(collision, 'SHOP-1', 'sp1', false)?.name).toBe('Fix login')
  expect(taskFor(collision, 'SHOP-1', 'sp2', false)?.name).toBe('Fix login')
  expect(taskFor(collision, 'SHOP-1', 'vm-b/sp9', false)?.name).toBe('Fix checkout')
  expect(taskFor(collision, 'vm-b/SHOP-1', 'sp1')?.name).toBe('Fix checkout')
  expect(taskFor(collision, 'vm-b>elsewhere/SHOP-1', 'sp1')).toBeUndefined()
  expect(taskFor(collision, 'SHOP-1', undefined, false)).toBeUndefined()
})

test('your own message shows a picked space and task as links, not their raw form', () => {
  const html = renderToStaticMarkup(<p>{withMentions('ask [#cafe](space:sp2) about [@New menu](task:CAFE-4?folder=~/dev/cafe)', (t, k) => [<span key={k}>{t}</span>])}</p>)
  expect(html).toContain('>#cafe</a>')
  expect(html).toContain('>New menu</a>')
  expect(html).not.toContain('space:')
  expect(html).not.toContain('task:')
})

test('the message box keeps its # and @ list and expands picks at send', () => {
  const box = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  expect(box).toContain('useMentions(key,')
  expect(box).toContain('{ment.list}')
  expect(box).toContain('if (ment.onKey(e)) return')
  expect(box).toContain('expandPicked(key, t)')
})
