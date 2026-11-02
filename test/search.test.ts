import { describe, expect, test } from 'bun:test'
import { DemoWorld } from '../server/demo/world.ts'
import { searchChats, searchExcerpt, searchResults } from '../plugins/keyboard/search-data.ts'
import { findIn } from '../plugins/chat/days.ts'
import type { Chat, Message } from '../shared/types.ts'

const all = { kind: 'all' } as const
const pName = (snap: ReturnType<DemoWorld['snapshot']>, id: string) => snap.places.find(p => p.id === id)!.name

describe('unified search identities, scope and privacy', () => {
  test('all machine homes with duplicate names stay separate and have machine context', () => {
    const snap = new DemoWorld().snapshot()
    const homes = searchResults(snap, all, 'home', {}).filter(h => h.kind === 'Spaces')
    expect(homes.length).toBeGreaterThan(1)
    expect(new Set(homes.map(h => h.key)).size).toBe(homes.length)
    expect(new Set(homes.map(h => h.context)).size).toBe(homes.length)
    for (const h of homes) expect(h.place).toBe(snap.places.find(p => p.id === h.place)!.id)
  })

  test('chat, space, machine and everywhere broaden the same private sources without duplicates', () => {
    const snap = new DemoWorld().snapshot()
    const t = snap.tasks.find(t => t.agent)!
    const chat = t.agent!.chat
    expect(searchChats(snap, { kind: 'chat', id: chat }).map(c => c.key)).toEqual([chat])
    const space = searchChats(snap, { kind: 'space', id: t.place })
    expect(space.every(c => c.place === t.place)).toBe(true)
    expect(space.map(c => c.key)).toContain(chat)
    const results = searchResults(snap, all, `${pName(snap, t.place)} ${t.name}`, {})
    expect(results.some(h => h.task === t.id)).toBe(true)
    const p = snap.places.find(p => p.id === t.place)!
    const machine = searchChats(snap, { kind: 'machine', id: p.machine })
    expect(machine.length).toBeGreaterThanOrEqual(space.length)
    const global = searchChats(snap, all)
    expect(global.length).toBeGreaterThan(machine.length)
    expect(new Set(global.map(c => c.key)).size).toBe(global.length)
  })

  test('message matching has chat-search parity and keeps the exact chat and message ids', () => {
    const snap = new DemoWorld().snapshot()
    const c = searchChats(snap, all)[0]
    const messages: Message[] = [
      { id: 'link', who: 'agent', text: 'See **the** [docs](https://hidden-address.example)' },
      { id: 'file', who: 'you', file: { name: 'the docs.pdf', path: '/private/unsearchable' } },
      { id: 'question', who: 'agent', question: { id: 'q', title: 'The docs ready?', kind: 'Question', choices: [], to: 'agent' } },
      { id: 'waiting', who: 'you', text: 'the docs', waiting: true },
      { id: 'late', who: 'agent', text: `${'Intro '.repeat(100)}the docs at the end`, at: 10 },
    ]
    const chats = { [c.key]: { key: c.key, cli: 'Codex', messages } }
    const hits = searchResults(snap, { kind: 'chat', id: c.key }, 'THE DOCS', chats).filter(h => h.kind === 'Messages')
    expect(hits.map(h => h.message).sort()).toEqual(findIn(messages, 'THE DOCS').sort())
    expect(hits.every(h => h.chat === c.key)).toBe(true)
    expect(hits.find(h => h.message === 'late')?.label).toContain('the docs')
    expect(searchResults(snap, all, 'hidden-address', chats).filter(h => h.kind === 'Messages')).toEqual([])
    expect(searchResults(snap, all, 'unsearchable', chats).filter(h => h.kind === 'Messages')).toEqual([])
  })

  test('secret cards, tool output and settings values are never indexed; empty search omits blank records', () => {
    const snap = new DemoWorld().snapshot()
    const c = searchChats(snap, all)[0]
    const chats: Record<string, Chat> = { [c.key]: { key: c.key, cli: 'Codex', messages: [
      { id: 'secret', who: 'agent', secret: { id: 'secret', name: 'PRIVATE_TOKEN', why: 'hidden-needle', levels: [] } },
      { id: 'empty', who: 'agent' },
    ] } }
    Object.defineProperty(snap, 'settings', { get() { throw new Error('Search must never inspect secret settings') } })
    const results = searchResults(snap, all, '', chats)
    expect(results.some(h => h.kind === 'Messages')).toBe(false)
    expect(searchResults(snap, all, 'hidden-needle', chats)).toEqual([])
    expect(searchResults(snap, all, 'PRIVATE_TOKEN', chats)).toEqual([])
  })

  test('archived tasks are found by brief words, keep their identity, and stay out of empty search', () => {
    const snap = new DemoWorld().snapshot()
    const task = snap.tasks[0]
    task.archived = Date.now()
    task.desc = 'needle-in-archived-brief'
    expect(searchResults(snap, all, task.desc, {}).find(h => h.task === task.id)?.context).toContain('Archived')
    expect(searchResults(snap, all, '', {}).some(h => h.task === task.id)).toBe(false)
  })

  test('all matches remain available for paging and newest messages come first', () => {
    const snap = new DemoWorld().snapshot()
    const c = searchChats(snap, all)[0]
    const messages = Array.from({ length: 65 }, (_, n): Message => ({ id: `page-${n}`, who: 'agent', text: `paging needle ${n}`, at: n + 1 }))
    const hits = searchResults(snap, all, 'paging needle', { [c.key]: { key: c.key, cli: 'Codex', messages } }).filter(h => h.kind === 'Messages')
    expect(hits).toHaveLength(65)
    expect(hits[0].message).toBe('page-64')
    expect(searchExcerpt('A'.repeat(500) + 'target word', 'target')).toContain('target word')
  })
})

test('search preserves literal identifiers and code while stripping surrounding emphasis', () => {
  const messages: Message[] = [
    { id: 'native', who: 'agent', text: 'UNREAD_AFTER_OK and _private_var' },
    { id: 'code', who: 'agent', text: 'Call `__init__` or `a*b`.' },
    { id: 'format', who: 'agent', text: '_some words_ and __other words__' },
  ]
  expect(findIn(messages, 'UNREAD_AFTER_OK')).toEqual(['native'])
  expect(findIn(messages, '_private_var')).toEqual(['native'])
  expect(findIn(messages, '__init__')).toEqual(['code'])
  expect(findIn(messages, 'a*b')).toEqual(['code'])
  expect(findIn(messages, 'some words and other words')).toEqual(['format'])
})
