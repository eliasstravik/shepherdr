// What an agent does, calmly and in plain words: each step as what it did, a turn's steps as a few rows, the step it is
// on, its background work, and their output read only when opened. Words, rows, folding, and a chat built from logs in
// each CLI's exact format.
import { describe, expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { glance, jobsWords, rowsOf, say, testResult, took, words } from '../shared/activity.ts'
import { activityOf, cutOutput, lineOf, stepsNow } from '../server/activity.ts'
import { ClaudeReader, readerFor } from '../server/common/readers/index.ts'
import { notices } from '../server/common/readers/claude.ts'
import { claudeStep, codexItem, commandSay, commandWords } from '../server/common/readers/steps.ts'
import type { Step } from '../shared/types.ts'
import type { LogEvent } from '../server/common/readers/types.ts'

process.env.SHEPHERDR_HOME ??= mkdtempSync(join(tmpdir(), 'shep-act-'))

describe('words', () => {
  test('an action said as a command reads done and doing; a word that is no verb stays', () => {
    expect(say('Check the task list')).toEqual({ title: 'Checked the task list', doing: 'Checking the task list', wants: 'Wants to check the task list' })
    expect(say('Run tests')).toEqual({ title: 'Ran tests', doing: 'Running tests', wants: 'Wants to run tests' })
    expect(say('Clone the repo and find the log code')).toEqual({ title: 'Cloned the repo and found the log code', doing: 'Cloning the repo and finding the log code', wants: 'Wants to clone the repo and find the log code' })
    expect(say('Stop the demo').title).toBe('Stopped the demo')
    expect(say('Copy files').title).toBe('Copied files')
    expect(say('TypeScript check')).toEqual({ title: 'TypeScript check', doing: 'TypeScript check', wants: 'Wants to: TypeScript check' })
  })
  test('a command in words, never its command line: the agent’s description first, else what it runs', () => {
    const t = (command: string, description?: string) => claudeStep('Bash', { command, description })!
    expect(t('~/.shepherdr/helper/bin/shepherdr task list 2>&1 | grep -E "^SHE" | grep -vE "x"')).toMatchObject({ step: 'run', title: 'Checked the task list', doing: 'Checking the task list' })
    expect(t('cd /w && git status').title).toBe('Checked git status')
    expect(t('bun run test changed')).toMatchObject({ title: 'Ran tests', test: true })
    expect(t('bun test webhook', 'Run the webhook tests')).toMatchObject({ title: 'Ran the webhook tests', test: true, detail: 'bun test webhook' })
    expect(t('rg -n "review" src')).toMatchObject({ step: 'search', title: 'Searched for “review”' })
    expect(t('sed -n 1,80p src/app.ts')).toMatchObject({ step: 'read', title: 'Read app.ts', target: 'app.ts' })
    expect(t('python3 - <<EOF\nprint(1)\nEOF').title).toBe('Ran a script')
    expect(t('frobnicate --all').title).toBe('Ran frobnicate')
    expect(t('bash -lc "git status"')).toMatchObject({ title: 'Checked git status', detail: 'bash -lc "git status"' })
    expect(t('python3 -c "print(123)"').title).toBe('Ran a script')
    expect(t('cat README.md | rg "bun test"').title).toBe('Read README.md')
    expect(commandSay('gh pr checks 48')).toMatchObject({ step: 'web', title: 'Checked the pull request’s checks' })
  })
  test('other tools in words: edits count their lines, searches quote, subagents say what they do', () => {
    expect(claudeStep('Edit', { file_path: '/w/src/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' })).toMatchObject({ step: 'edit', title: 'Edited a.ts', target: 'a.ts', added: 2, removed: 1, detail: '/w/src/a.ts' })
    expect(claudeStep('Grep', { pattern: 'review' })).toMatchObject({ step: 'search', title: 'Searched the code for “review”' })
    expect(claudeStep('Read', { file_path: '/w/shot.png' })?.title).toBe('Looked at shot.png')
    expect(claudeStep('Agent', { description: 'Review the signature fix' })?.title).toBe('Asked a subagent to review the signature fix')
    expect(claudeStep('WebFetch', { url: 'https://example.com/docs' })?.title).toBe('Read example.com/docs')
    expect(claudeStep('mcp__github__get_pr', {})?.title).toBe('Used get pr')
    expect(claudeStep('AskUserQuestion', {})).toBeUndefined()
  })
  test('a test run’s outcome from its output', () => {
    expect(testResult(' 558 pass\n 0 fail\n')).toBe('558 passed')
    expect(testResult('Tests: 2 failed, 39 passed, 41 total')).toBe('2 failed, 39 passed')
    expect(testResult('===== 12 passed in 0.3s =====')).toBe('12 passed')
    expect(testResult('no counts here')).toBeUndefined()
  })
  test('a turn’s steps as rows: files read or changed in one row each; the rows that say most at a glance', () => {
    let i = 0
    const s = (said: ReturnType<typeof claudeStep>, x: Partial<Step> = {}): Step => {
      const { step, ...w } = said!
      return { id: `s${++i}`, kind: step, tool: 'x', at: i, end: i, ...w, ...x }
    }
    const steps = [
      s(claudeStep('Read', { file_path: '/w/a.ts' })),
      s(claudeStep('Bash', { command: 'shepherdr task list' })),
      s(claudeStep('Read', { file_path: '/w/b.ts' })),
      s(claudeStep('Edit', { file_path: '/w/app.ts', old_string: 'x', new_string: 'y\nz' })),
      s(claudeStep('Edit', { file_path: '/w/panel.tsx', old_string: 'p', new_string: 'q' })),
      s(claudeStep('Edit', { file_path: '/w/app.ts', old_string: '', new_string: 'w' })),
      s(claudeStep('Bash', { command: 'bun test' }), { result: '41 passed' }),
      s(claudeStep('Bash', { command: 'shepherdr task list' })),
    ]
    expect(rowsOf([s(claudeStep('Read', { file_path: '/w/src/index.ts' })), s(claudeStep('Read', { file_path: '/w/test/index.ts' }))])[0].text).toBe('Read 2 files: index.ts, index.ts')
    const rows = rowsOf(steps)
    expect(rows.map((r) => [r.kind, r.text, r.added, r.removed, r.steps.length])).toEqual([
      ['read', 'Read 2 files: a.ts, b.ts', undefined, undefined, 2],
      ['run', 'Checked the task list', undefined, undefined, 2],
      ['edit', 'Edited 2 files: app.ts, panel.tsx', 4, 2, 3],
      ['run', 'Ran tests: 41 passed', undefined, undefined, 1],
    ])
    const g = glance(rows)
    expect(g.more).toBe(1)
    expect(g.rows.map((r) => r.text)).toEqual(['Checked the task list', 'Edited 2 files: app.ts, panel.tsx', 'Ran tests: 41 passed'])
  })
  test('background work counted: agents work, shells run', () => {
    expect(jobsWords({ agent: 2 })).toBe('2 subagents working')
    expect(jobsWords({ agent: 1, headless: 1 })).toBe('2 subagents working')
    expect(jobsWords({ shell: 1 })).toBe('1 shell running')
    expect(jobsWords({ agent: 1, shell: 2 })).toBe('1 subagent · 2 shells')
  })
  test('times', () => {
    expect(took(42_000)).toBe('42s')
    expect(took(252_000)).toBe('4m 12s')
    expect(took(252_000, false)).toBe('4m')
    expect(took(3_780_000)).toBe('1h 3m')
  })
  test('a command without its cd into the worktree; output without colours, its last lines', () => {
    expect(commandWords('cd /w/x && bun test\nmore')).toBe('bun test')
    expect(commandWords("cd '/w/a b'; ls")).toBe('ls')
    const many = Array.from({ length: 450 }, (_, i) => `\x1b[32mline ${i}\x1b[0m`).join('\n')
    const c = cutOutput(many)
    expect(c.cut).toBe(true)
    expect(c.output.split('\n')).toHaveLength(400)
    expect(c.output.endsWith('line 449')).toBe(true)
  })
})

describe('steps that have not run', () => {
  const steps: LogEvent[] = [
    { kind: 'turn-start', id: 't', at: 0 },
    { kind: 'step', id: 'a', at: 1, step: 'edit', tool: 'Edit', ...words('Edit a.ts', 'a.ts') },
    { kind: 'step-end', id: 'a', at: 2 },
    { kind: 'step', id: 'b', at: 3, step: 'edit', tool: 'Edit', ...words('Edit b.ts', 'b.ts') },
    { kind: 'step', id: 'c', at: 4, step: 'run', tool: 'Bash', ...words('Create empty hello.txt') },
  ]
  test('held at a permission card a step says what it wants, and never groups with what is done', () => {
    const { open } = activityOf(steps)
    expect(lineOf(open!, false, true).rows.map((r) => r.text)).toEqual(['Edited a.ts', 'Wants to edit b.ts', 'Wants to create empty hello.txt'])
    expect(stepsNow(open!, true).map((s) => s.unrun)).toEqual([undefined, true, true])
  })
  test('once it runs it says what it is doing, and once over what it did', () => {
    const { open } = activityOf(steps)
    expect(lineOf(open!, true).rows.at(-1)!.text).toBe('Creating empty hello.txt')
    expect(lineOf(activityOf([...steps, { kind: 'step-end', id: 'c', at: 5 }]).open!).rows.at(-1)!.text).toBe('Created empty hello.txt')
  })
  test('a step refused never says it was done, and is no error', () => {
    const { open } = activityOf([...steps, { kind: 'step-end', id: 'c', at: 5, failed: true, refused: 'you' }])
    const line = lineOf(open!, true)
    expect(line.rows.at(-1)).toMatchObject({ text: 'Wanted to create empty hello.txt' })
    expect(line.failed).toBeUndefined()
  })
  test('a step logged before these words came says what it was doing', () => {
    const { open } = activityOf([{ kind: 'step', id: 'old', at: 1, step: 'run', tool: 'Bash', title: 'Ran it', doing: 'Running it', target: '' }])
    expect(lineOf(open!, false, true).rows[0].text).toBe('Running it')
  })
})

describe('folding', () => {
  const step = (id: string, at: number, x: Partial<Extract<LogEvent, { kind: 'step' }>> = {}): LogEvent => ({ kind: 'step', id, at, step: 'run', tool: 'Bash', title: `Ran ${id}`, doing: `Running ${id}`, target: '', ...x })
  test('steps fold by turn; a stand-in goes once over; the turn on now shows its step', () => {
    const { turns, open } = activityOf([
      { kind: 'turn-start', id: 't1', at: 0 },
      { kind: 'user', id: 'u1', at: 0, text: 'go' },
      step('s1', 1),
      { kind: 'step-end', id: 's1', at: 3, failed: true },
      step('s2', 4, { step: 'read' }),
      { kind: 'step-end', id: 's2', at: 5 },
      step('w', 6),
      { kind: 'step-end', id: 'w', at: 7, drop: true },
      { kind: 'agent', id: 'a1', at: 8, text: 'done' },
      { kind: 'turn-end', id: 'e1', at: 9 },
      { kind: 'turn-start', id: 't2', at: 10 },
      step('s3', 11, { step: 'edit', title: 'Edited a.ts', doing: 'Editing a.ts', target: 'a.ts' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ id: 't1', at: 0, end: 9, asked: 'u1', reply: 'a1' })
    expect(lineOf(turns[0])).toMatchObject({ id: 't1', at: 0, end: 9, steps: 2, failed: 1, now: undefined, rows: [{ text: 'Ran s1', failed: 1 }, { text: 'Ran s2' }] })
    expect(lineOf(open!, true)).toMatchObject({ id: 't2', end: undefined, steps: 1, now: { id: 's3', doing: 'Editing a.ts' } })
  })
  test('background work lasts until it says it is over, within its session', () => {
    const job = (id: string, at: number): LogEvent => ({ kind: 'job', id, at, job: 'shell', title: id, output: `/t/${id}.output` })
    expect(activityOf([job('a', 1), job('b', 2), { kind: 'job-end', id: 'a', at: 3 }]).jobs.map((j) => j.id)).toEqual(['b'])
    expect(activityOf([job('a', 1), { kind: 'session', id: 's', at: 2, sessionId: 'x' }]).jobs).toEqual([])
  })
})

/* ---------- logs in each CLI's format ---------- */

const S = 'b1f0c2d4-0000-4000-8000-000000000009'
let n = 0
const ts = () => new Date(Date.parse('2026-10-27T10:00:00Z') + n++ * 1000).toISOString()
const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd: '/work/app', sessionId: S, version: '2.1.310' }
const user = (uuid: string, content: unknown, extra: object = {}) => ({ parentUuid: null, ...base, type: 'user', message: { role: 'user', content }, uuid, timestamp: ts(), ...extra })
const said = (uuid: string, id: string, block: object, stop: string | null = null, extra: object = {}) => ({
  parentUuid: null,
  ...base,
  message: { model: 'claude-opus-5-5', id, type: 'message', role: 'assistant', content: [block], stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } },
  type: 'assistant',
  uuid,
  timestamp: ts(),
  ...extra,
})
const use = (uuid: string, tool: string, name: string, input: object, extra: object = {}) => said(uuid, `msg_${uuid}`, { type: 'tool_use', id: tool, name, input }, 'tool_use', extra)
const result = (uuid: string, tool: string, content: string, r: object = {}, extra: object = {}) =>
  user(uuid, [{ tool_use_id: tool, type: 'tool_result', content, is_error: false }], { toolUseResult: r, sourceToolAssistantUUID: 'x', ...extra })
const typed = { origin: { kind: 'human' }, promptSource: 'typed' }
const notice = (uuid: string, body: string) => ({
  parentUuid: null,
  ...base,
  attachment: { type: 'queued_command', prompt: `<task-notification>\n${body}\n</task-notification>`, commandMode: 'task-notification', origin: { kind: 'task-notification', producer: 'session-task' }, timestamp: ts() },
  type: 'attachment',
  uuid,
  timestamp: ts(),
})
const turnEnd = (uuid: string) => ({ parentUuid: null, ...base, type: 'system', subtype: 'turn_duration', durationMs: 1, timestamp: ts(), uuid })

describe('claude reader: steps and background work', () => {
  const parse = (objs: object[], reader = readerFor('claude')!) => reader.parse(objs.map((o, i) => ({ text: JSON.stringify(o), offset: i * 100 })), '/logs/p/S.jsonl')
  test('successful native TaskStop ends only its matching job; failed or mismatched results do not', () => {
    const ev = parse([
      use('a1', 'start', 'Bash', { command: 'sleep 120', run_in_background: true }),
      result('u1', 'start', 'Command running in background', { backgroundTaskId: 'wait1' }),
      use('a2', 'stop-failed', 'TaskStop', { task_id: 'wait1' }),
      result('u2', 'stop-failed', 'Could not stop task', { task_id: 'wait1', message: 'Could not stop task' }),
      use('a3', 'stop-wrong', 'TaskStop', { task_id: 'other' }),
      result('u3', 'stop-wrong', 'Wrong task', { task_id: 'wait1', message: 'Successfully stopped task: wait1 (sleep 120)' }),
      use('a4', 'stop-ok', 'TaskStop', { task_id: 'wait1' }),
      result('u4', 'stop-ok', 'Stopped', { task_id: 'wait1', task_type: 'local_bash', command: 'sleep 120', message: 'Successfully stopped task: wait1 (sleep 120)' }),
    ])
    expect(ev.filter(e => e.kind === 'job-end')).toEqual([{ kind: 'job-end', id: 'wait1', at: expect.any(Number) }])
    expect(activityOf(ev).jobs).toEqual([])
  })
  test('a tool call is a step, its result ends it and says where its output is; the question tool and a subagent’s calls are none', () => {
    const ev = parse([
      user('u1', 'Fix it', typed),
      use('a1', 'toolu_1', 'Bash', { command: 'cd /work/app && bun test', description: 'Run the tests' }),
      result('u2', 'toolu_1', '3 pass'),
      use('a2', 'toolu_2', 'Read', { file_path: '/work/app/src/a.ts' }),
      use('a3', 'toolu_3', 'AskUserQuestion', { questions: [{ question: 'Which?', options: [] }] }),
      use('a4', 'toolu_4', 'Bash', { command: 'ls' }, { isSidechain: true }),
      use('a5', 'toolu_5', 'mcp__github__get_pr', {}),
    ])
    const steps = ev.filter((e) => e.kind === 'step' || e.kind === 'step-end')
    expect(steps).toEqual([
      { kind: 'step', id: 'toolu_1', at: expect.any(Number), step: 'run', tool: 'Bash', title: 'Ran the tests', doing: 'Running the tests', wants: 'Wants to run the tests', target: '', test: true, detail: 'cd /work/app && bun test' },
      { kind: 'step-end', id: 'toolu_1', at: expect.any(Number), failed: undefined, out: { file: '/logs/p/S.jsonl', offset: 200 }, result: '3 passed' },
      { kind: 'step', id: 'toolu_2', at: expect.any(Number), step: 'read', tool: 'Read', title: 'Read a.ts', doing: 'Reading a.ts', wants: 'Wants to read a.ts', target: 'a.ts', detail: '/work/app/src/a.ts' },
      { kind: 'step', id: 'toolu_5', at: expect.any(Number), step: 'other', tool: 'get_pr', title: 'Used get pr', doing: 'Using get pr', wants: 'Wants to use get pr', target: '' },
    ])
  })
  test('a shell, a subagent and a monitor in the background are jobs until their notice says they are over', () => {
    const ev = parse([
      use('a1', 'toolu_1', 'Bash', { command: 'bun run test', run_in_background: true }),
      result('u1', 'toolu_1', 'Command running in background with ID: bsh1. Output is being written to: /tmp/c/x/S/tasks/bsh1.output. You will be notified.', { backgroundTaskId: 'bsh1' }),
      use('a2', 'toolu_2', 'Agent', { description: 'Review the fix', prompt: 'Review', run_in_background: true }),
      result('u2', 'toolu_2', 'Async agent launched successfully.', { isAsync: true, status: 'async_launched', agentId: 'ag1', description: 'Review the fix' }),
      use('a3', 'toolu_3', 'Monitor', { command: 'gh pr checks 3 --watch', description: 'CI' }),
      result('u3', 'toolu_3', 'Monitor started (task bm1).', { taskId: 'bm1' }),
      notice('n1', '<task-id>ag1</task-id>\n<status>completed</status>\n<summary>Agent "Review the fix" is waiting on its own background work</summary>'),
      notice('n2', '<task-id>bsh1</task-id>\n<output-file>/tmp/c/x/S/tasks/bsh1.output</output-file>\n<status>completed</status>\n<summary>Background command "bun run test" completed (exit code 0)</summary>'),
    ])
    const jobs = ev.filter((e) => e.kind === 'job' || e.kind === 'job-end')
    expect(jobs).toEqual([
      { kind: 'job', id: 'bsh1', at: expect.any(Number), job: 'shell', title: 'Running tests', step: 'toolu_1', output: '/tmp/c/x/S/tasks/bsh1.output' },
      { kind: 'job', id: 'ag1', at: expect.any(Number), job: 'agent', title: 'Review the fix', step: 'toolu_2', log: '/logs/p/S/subagents/agent-ag1.jsonl' },
      { kind: 'job', id: 'bm1', at: expect.any(Number), job: 'monitor', title: 'CI', step: 'toolu_3', output: '/tmp/c/x/S/tasks/bm1.output' },
      // the subagent waits on work of its own: not over
      { kind: 'job-end', id: 'bsh1', at: expect.any(Number) },
    ])
    expect(notices('<task-notification><task-id>x</task-id></task-notification>')).toEqual([{ id: 'x', output: undefined, over: false }])
  })
  test("a subagent's own log: its steps", () => {
    const ev = parse([use('a1', 'toolu_1', 'Grep', { pattern: 'mute' }, { isSidechain: true, agentId: 'ag1' }), result('u1', 'toolu_1', 'call.ts', {}, { isSidechain: true })], new ClaudeReader(true))
    expect(ev.map((e) => e.kind)).toEqual(['session', 'step', 'step-end'])
  })
})

const codexLine = (type: string, payload: object) => ({ timestamp: ts(), type, payload })

describe('codex reader: steps and background work', () => {
  test('items logged once over are steps; the call that ran them goes once over; subagents are jobs', () => {
    const ev = readerFor('codex')!.parse(
      [
        codexLine('response_item', { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'text(await tools.exec_command({cmd:"cat src/a.ts"}))' }),
        codexLine('event_msg', { type: 'item_completed', started_at_ms: 1000, completed_at_ms: 1200, item: { type: 'CommandExecution', id: 'exec-1', command: ['/bin/bash', '-lc', 'cat src/a.ts'], parsed_cmd: [{ type: 'read', cmd: 'cat src/a.ts', name: 'a.ts', path: 'src/a.ts' }], status: 'completed', exit_code: 0 } }),
        codexLine('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 'exec-2', command: ['/bin/bash', '-lc', 'bun test'], parsed_cmd: [{ type: 'unknown', cmd: 'bun test' }], status: 'completed', exit_code: 1 } }),
        codexLine('response_item', { type: 'custom_tool_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'done' }] }),
        codexLine('event_msg', { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'call_9', kind: 'started', agent_thread_id: 'th-1', agent_path: '/root/review_fix' } }),
        codexLine('event_msg', { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'call_9', kind: 'completed', agent_thread_id: 'th-1', agent_path: '/root/review_fix' } }),
      ].map((o, i) => ({ text: JSON.stringify(o), offset: i * 100 })),
      '/codex/r.jsonl',
    )
    const { turns, open, jobs } = activityOf(ev)
    const steps = [...turns, ...(open ? [open] : [])].flatMap((t) => t.steps)
    expect(steps.map((s) => [s.kind, s.title, !!s.failed])).toEqual([
      ['read', 'Read a.ts', false],
      ['run', 'Ran tests', true],
      ['agent', 'Asked a subagent: review fix', false],
    ])
    expect(steps[0]).toMatchObject({ at: 1000, end: 1200, where: { file: '/codex/r.jsonl', offset: 100 } })
    expect(ev.filter((e) => e.kind === 'job' || e.kind === 'job-end').map((e) => `${e.kind}:${e.id}`)).toEqual(['job:th-1', 'job-end:th-1'])
    expect(jobs).toEqual([])
    expect(codexItem({ type: 'FileChange', changes: { '/w/a.ts': { unified_diff: '@@\n-x\n+y\n+z' }, '/w/b.ts': {} } })).toMatchObject({ step: 'edit', title: 'Edited 2 files: a.ts, b.ts', added: 2, removed: 1 })
    expect(codexItem({ type: 'CommandExecution', command: ['bash', '-lc', 'bun test'], aggregated_output: ' 3 pass\n 1 fail' })).toMatchObject({ title: 'Ran tests', result: '1 failed, 3 passed' })
  })
})

/* ---------- a chat built from a log ---------- */
