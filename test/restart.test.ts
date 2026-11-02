// What a restart says and offers: the hint once Settings say other than what an agent runs on, a harness in words,
// and what an agent taking over on another CLI is told.
import { describe, expect, test } from 'bun:test'
import { fitHarness, harnessProblem, harnessWords, launchHarness, pickSpeed, restartInfo, recentChat, restartHint, sameHarness } from '../server/common/restart.ts'
import { setModels, TABLE } from '../server/common/models.ts'
import { restartLine, resumedLine } from '../server/common/prompts.ts'

describe('the restart hint', () => {
  test('says the first that differs: the CLI, the model, the effort', () => {
    expect(restartHint({ kind: 'claude' }, undefined, { kind: 'codex' })).toEqual({ on: 'Claude Code', want: 'Codex' })
    expect(restartHint({ kind: 'claude', model: 'Opus 5.5' }, undefined, { kind: 'claude', model: 'claude-sonnet-5-5' })).toEqual({ on: 'Opus 5.5', want: 'Sonnet 5.5' })
    expect(restartHint({ kind: 'claude', effort: 'high' }, undefined, { kind: 'claude' })).toEqual({ on: 'high effort', want: 'default effort' })
    expect(restartHint({ kind: 'claude', model: '' }, undefined, { kind: 'claude', model: 'claude-opus-5-5' })).toEqual({ on: "Claude Code's default model", want: 'Opus 5.5' })
  })

  test('none while they agree, a model by its name or id, a level as its model takes it', () => {
    expect(restartHint({ kind: 'claude', model: 'Opus 5.5', effort: 'high' }, undefined, { kind: 'claude', model: 'claude-opus-5-5', effort: 'high' })).toBeUndefined()
    expect(restartHint({ kind: 'claude', model: '', effort: '' }, undefined, { kind: 'claude' })).toBeUndefined()
    expect(sameHarness({ kind: 'claude', effort: 'ultra' }, { kind: 'claude', effort: 'max' })).toBe(true)
  })

  test('none while Settings say what they said when it started: a pick of its own is no change of Settings', () => {
    // started on Settings' Opus, then switched to Sonnet in the chat's + menu
    expect(restartHint({ kind: 'claude', model: 'Sonnet 5.5' }, { kind: 'claude', model: 'claude-opus-5-5' }, { kind: 'claude', model: 'claude-opus-5-5' })).toBeUndefined()
    // Settings changed since
    expect(restartHint({ kind: 'claude', model: 'Sonnet 5.5' }, { kind: 'claude', model: 'claude-opus-5-5' }, { kind: 'codex' })).toEqual({ on: 'Claude Code', want: 'Codex' })
  })
})

describe('a harness', () => {
  test('in words, and as Shepherdr passes it', () => {
    expect(harnessWords({ kind: 'codex' })).toBe('Codex')
    expect(harnessWords({ kind: 'claude', model: 'sonnet', effort: 'high' })).toBe('Claude Code (Sonnet 5.5, high)')
    expect(harnessWords({ kind: 'claude', effort: 'xhigh' })).toBe('Claude Code (xhigh)')
    expect(fitHarness({ kind: 'claude', model: 'Opus 5.5', effort: 'default' })).toEqual({ kind: 'claude', model: 'claude-opus-5-5' })
    expect(fitHarness({ kind: 'claude', model: 'default', effort: '' })).toEqual({ kind: 'claude' })
  })
})

describe('what the agent is told', () => {
  test('another CLI takes over: who ran it, a task its commits and changes, the chat so far', () => {
    const chat = recentChat(
      [
        { id: '1', who: 'you', text: 'The brief', at: 1 },
        { id: '2', who: 'you', text: 'Use blue', at: 2 },
        { id: '3', who: 'agent', text: 'On it', at: 3 },
        { id: '4', who: 'agent', card: { id: 'c', text: 'Restarted' }, at: 4 },
      ] as never,
      'Claude Code',
      'The brief',
    )
    expect(chat).toBe('Human: Use blue\n\nClaude Code: On it')
    const task = restartLine({ from: 'Claude Code', to: 'Codex (GPT-6-Sol, high)', chat, commits: 'a1 Add x', changes: '' })
    expect(task).toContain('restarted this task on Codex (GPT-6-Sol, high). Claude Code ran it until now')
    expect(task).toContain('same worktree and branch')
    expect(task).toContain('Commits on the branch so far:\na1 Add x')
    expect(task).toContain('Uncommitted changes:\nnone')
    expect(task).toContain('Human: Use blue')
    const coord = restartLine({ from: 'Claude Code', to: 'Codex', chat })
    expect(coord).toContain('restarted this chat on Codex')
    expect(coord).not.toContain('Commits')
  })

  test('its own CLI resumes: carry on, or say nothing', () => {
    expect(resumedLine('Claude Code (Opus 5.5, high)')).toContain('<no-reply>restarted</no-reply>')
  })
})

describe('visible launch settings and supported restart choices', () => {
  test('a restart keeps the speed it was on unless one is picked; only offered speeds pass', () => {
    expect(pickSpeed(undefined, 'fast')).toBe('fast')
    expect(pickSpeed('normal', 'fast')).toBe('normal')
    expect(pickSpeed('', 'fast')).toBeUndefined()
    expect(() => pickSpeed('ludicrous')).toThrow('Choose Normal or Fast')
    expect(restartInfo({ role: 'task', on: { kind: 'codex', speed: 'fast' }, want: { kind: 'codex' }, kinds: ['codex', 'pi'], working: false })).toMatchObject({ on: { speed: 'fast' }, clis: [{ kind: 'codex', speeds: ['normal', 'fast'] }, { kind: 'pi' }] })
  })
  test('both roles keep recorded launch separate from inherited Settings', () => {
    for (const role of ['task', 'coordinator'] as const) {
      const info = restartInfo({ role, on: { kind: 'codex' }, want: { kind: 'claude', model: 'sonnet', effort: 'high' }, kinds: ['claude', 'codex'], working: true })
      expect(info.on).toEqual({ kind: 'codex' })
      expect(info.want).toEqual({ kind: 'claude', model: 'claude-sonnet-5-5', effort: 'high' })
      expect(info.clis.find((c) => c.kind === 'claude')).toMatchObject({ defaultModel: 'claude-opus-5-5', defaultEffort: 'medium' })
    }
  })
  test('launch metadata matches CLI flags, including unsupported and rounded effort', () => {
    expect(launchHarness({ kind: 'gemini', model: 'saved-only', effort: 'high' })).toEqual({ kind: 'gemini' })
    expect(launchHarness({ kind: 'codex', model: 'gpt-6-luna', effort: 'ultra' })).toEqual({ kind: 'codex', model: 'gpt-6-luna', effort: 'max' })
    expect(launchHarness({ kind: 'claude', model: 'default', effort: 'default' })).toEqual({ kind: 'claude' })
  })
  test('recognized older launch models remain selectable with their own effort defaults', () => {
    const old = { id: 'claude-opus-old', label: 'Older Opus', efforts: ['low', 'high'], effort: 'high' }
    setModels('claude', { ...TABLE.claude!, others: [old] })
    try {
      const info = restartInfo({ role: 'task', on: { kind: 'claude', model: old.id }, want: { kind: 'claude' }, kinds: ['claude'], working: false })
      expect(info.clis[0]!.models).toContainEqual({ id: old.id, label: old.label, efforts: old.efforts, defaultEffort: 'high' })
      expect(info.clis[0]!.models!.find((m) => m.id === 'claude-fable-5-1')?.defaultEffort).toBe('high')
      expect(harnessProblem({ kind: 'claude', model: old.id })).toBeUndefined()
    } finally { setModels('claude', undefined) }
  })
  test('unavailable models, cross-CLI models, and unsupported effort are refused instead of rounded', () => {
    expect(harnessProblem({ kind: 'codex', model: 'retired-model' })).toContain('no available model')
    expect(harnessProblem({ kind: 'codex', model: 'claude-opus-5-5' })).toContain('no available model')
    expect(harnessProblem({ kind: 'codex', model: 'gpt-6-luna', effort: 'ultra' })).toContain('does not support')
    expect(harnessProblem({ kind: 'gemini', effort: 'high' })).toContain('does not support')
    expect(harnessProblem({ kind: 'gemini', model: 'default', effort: 'default' })).toContain('no chat log reader')
    expect(harnessProblem({ kind: 'pi', model: 'provider/model', effort: 'high' })).toBeUndefined()
    expect(harnessProblem({ kind: 'codex', effort: 'high' })).toBeUndefined()
  })
})

test('restart offers readable chat kinds, including when the current agent has no reader', () => {
  const info = restartInfo({ role: 'task', on: { kind: 'agy' }, want: { kind: 'codex' }, kinds: ['agy', 'gemini', 'cursor', 'claude', 'codex', 'pi'], working: false })
  expect(info.on.kind).toBe('agy')
  expect(info.clis.map((c) => c.kind)).toEqual(['claude', 'codex', 'pi'])
  expect(harnessProblem({ kind: 'agy' })).toContain('Headless review support is separate')
})
