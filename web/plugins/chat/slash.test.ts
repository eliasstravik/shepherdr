import { expect, test } from 'bun:test'
import type { Catalog } from '@shared/types.ts'
import { findModel } from '@client/picker.tsx'
import { modelTyped, slashItems, slashWord, type Command } from './slash.tsx'

// GitHub #1560: "/" in the message box lists the agent's own commands again, and /model opens the agent picker.

const list: Command[] = [
  { name: 'model', about: 'Choose the model' },
  { name: 'compact', about: 'Summarize' },
  { name: 'mcp', about: 'Manage MCP servers' },
  { name: 'ship', about: 'Your command' },
]

test('the list opens only while the whole message is one /word', () => {
  expect(slashWord('/')).toBe('')
  expect(slashWord('/mo')).toBe('mo')
  expect(slashWord('/model ')).toBeNull()
  expect(slashWord('see /tmp')).toBeNull()
  expect(slashWord('hi')).toBeNull()
})

test('names that start with what is typed come first, then names that contain it', () => {
  expect(slashItems(list, 'm').map((c) => c.name)).toEqual(['model', 'mcp', 'compact'])
  expect(slashItems(list, 'hip').map((c) => c.name)).toEqual(['ship'])
  expect(slashItems(list, 'tmp')).toEqual([])
  expect(slashItems(null, '')).toEqual([])
})

test('/model alone or with a name opens the picker; anything more goes to the agent', () => {
  expect(modelTyped('/model')).toBe('')
  expect(modelTyped(' /model sonnet ')).toBe('sonnet')
  expect(modelTyped('/MODEL')).toBe('')
  expect(modelTyped('/models')).toBeUndefined()
  expect(modelTyped('/model a b')).toBeUndefined()
  expect(modelTyped('use /model')).toBeUndefined()
})

const cat = {
  machine: 'vm-a',
  agents: [
    { id: 'claude', name: 'Claude Code', installed: true, efforts: [], perms: [], models: [{ id: 'opus', name: 'Opus 5.5' }, { id: 'sonnet', name: 'Sonnet 5.5' }] },
    { id: 'codex', name: 'Codex', installed: true, efforts: [], perms: [], models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }] },
    { id: 'pi', name: 'Pi', installed: false, efforts: [], perms: [], models: [{ id: 'sonic', name: 'Sonic' }] },
  ],
} as unknown as Catalog

test('/model <name> finds the model by id or name, the agent own first, then other installed agents', () => {
  expect(findModel(cat, 'claude', 'sonnet')).toEqual({ agent: 'claude', model: 'sonnet' })
  expect(findModel(cat, 'claude', 'Opus 5.5')).toEqual({ agent: 'claude', model: 'opus' })
  expect(findModel(cat, 'claude', 'son')).toEqual({ agent: 'claude', model: 'sonnet' })
  expect(findModel(cat, 'claude', 'gpt-5.5')).toEqual({ agent: 'codex', model: 'gpt-5.5' })
  expect(findModel(cat, 'codex', 'sonic')).toBeNull()
  expect(findModel(cat, 'claude', 'nope')).toBeNull()
})
