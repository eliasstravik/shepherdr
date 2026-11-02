import { describe, expect, test } from 'bun:test'
import { Settings, setForTask } from '../server/common/settings.ts'
import { privatePrompt } from '../server/common/prompts.ts'

const settings = () => new Settings({ everywhere: {}, machine: {}, spaces: {} })

describe('private instructions', () => {
  test('each role uses space > machine > Everywhere; empty suppresses, reset inherits', () => {
    const s = settings()
    for (const role of ['coordinator', 'task', 'reviewer'] as const) {
      const key = `${role}.instructions`
      expect(s.set(key, `${role} everywhere`).ok).toBe(true)
      expect(s.set(key, `${role} machine`, 'machine').ok).toBe(true)
      expect(s.set(key, `${role} space`, { space: 'one' }).ok).toBe(true)
      expect(s.instructions(role, 'one')).toBe(`Private instructions for ${role} (from space one):\n${role} space`)
      expect(s.get(key, 'two')).toBe(`${role} machine`)
      s.set(key, '', { space: 'one' })
      expect(s.instructions(role, 'one')).toEndWith('\n(none)')
      s.set(key, null, { space: 'one' })
      expect(s.instructions(role, 'one')).toContain(`${role} machine`)
      s.set(key, null, 'machine')
      expect(s.instructions(role, 'one')).toContain(`${role} everywhere`)
      expect('error' in setForTask(`${key}=private`)).toBe(true)
    }
  })

  test('remote adoption carries only Everywhere and preserves machine/space rules', () => {
    const main = settings(), remote = settings()
    main.set('task.instructions', 'Use plain words.\nKeep it short.')
    remote.set('task.instructions', 'Remote only.', 'machine')
    remote.set('reviewer.instructions', 'Review local data paths.', { space: 'one' })
    expect(remote.adopt(main.everywhere())).toBe(true)
    expect(remote.get('task.instructions')).toBe('Remote only.')
    remote.set('task.instructions', null, 'machine')
    expect(remote.instructions('task', 'one')).toContain('Use plain words.\nKeep it short.')
    expect(remote.instructions('reviewer', 'one')).toContain('Review local data paths.')
    expect(remote.adopt(main.everywhere())).toBe(false)
  })

  test('the compact settings section exposes scope, explicit blank and reset without putting rules in brief wording', () => {
    const s = settings()
    s.set('task.instructions', 'Personal rule.')
    s.set('task.instructions', '', { space: 'one' })
    const pages = s.sections([], [], null, 'box', ['one'])
    const p = pages.find((p) => p.name === 'Private instructions' && p.level === 'p:box:one')!
    expect(p.told).toBe(true)
    expect(p.rows).toHaveLength(3)
    expect(p.rows.find((r) => r.key === 'task.instructions')).toMatchObject({ value: '', multiline: true, inherits: { value: 'Personal rule.', from: 'Everywhere' } })
    expect(p.note).toContain('Saving leaves running agents alone')
    expect(p.rows.every((r) => !r.line)).toBe(true)
    expect(s.set('task.instructions', 'x'.repeat(16001)).ok).toBe(false)
    expect(s.set('task.instructions', 'bad\0text').ok).toBe(false)
  })

  test('prompts keep reviewer rules separate and state privacy, replacement and precedence', () => {
    const s = settings()
    s.set('coordinator.instructions', 'Coordinator only.')
    s.set('task.instructions', 'Task only.')
    s.set('reviewer.instructions', 'Reviewer only.')
    const coordinator = privatePrompt(s.instructions('coordinator'))
    expect(coordinator).toContain('Coordinator only.')
    expect(coordinator).not.toContain('Task only.')
    expect(coordinator).not.toContain('Reviewer only.')
    const task = privatePrompt(s.instructions('task'), s.instructions('reviewer'))
    expect(task).not.toContain('Coordinator only.')
    expect(task).toContain('Reviewer handoff only')
    expect(task).toContain('every fresh reviewer prompt')
    expect(task).toContain('Explicit human instructions and the task brief win')
    expect(task).toContain('Never copy private instructions into git')
    expect(task).toContain('Read and follow the repository/team AGENTS.md, CLAUDE.md and REVIEW.md alongside')
    expect(task).toContain('replaces earlier private instruction snapshots, including when empty')
  })
})
