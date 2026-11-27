import { expect, test } from 'bun:test'
import { heldStep, signOf, stepWords } from './typing.ts'
import type { Chat, Message, TurnActivity } from '@shared/types.ts'

const msgs = (...m: Partial<Message>[]) => m.map((x, i) => ({ id: `m${i}`, who: 'agent', ...x })) as Message[]
const chat = (c: Partial<Chat>, messages: Message[] = msgs({ who: 'you', text: 'do it' })) => ({ key: 'p:sp1', cli: 'claude', messages, ...c }) as Chat
const turn = (t: Partial<TurnActivity> = {}) => ({ id: 't1', at: 1, rows: [], steps: 0, ...t }) as TurnActivity
const step = (doing: string, title = '') => ({ kind: 'run', doing, title, target: '' }) as unknown as TurnActivity['now']

test('a working agent with nothing written yet shows the sign alone, no step', () => {
  expect(signOf(chat({ working: true }))).toEqual({ step: '' })
})

test('the step it is on: its status line first, else the tool it runs', () => {
  expect(signOf(chat({ working: true, doing: 'Changing the checkout button', live: turn({ now: step('Running bun test') }) }))).toEqual({ step: 'Changing the checkout button' })
  expect(signOf(chat({ working: true, live: turn({ now: step('Running bun test') }) }))).toEqual({ step: 'Running tests' })
  expect(signOf(chat({ working: true, live: turn({ now: step('', 'Ran bun test') }) }))).toEqual({ step: 'Running tests' })
  expect(signOf(chat({ working: true, live: turn() }))).toEqual({ step: '' })
})

test('one line: breaks in a step become spaces', () => {
  expect(signOf(chat({ working: true, doing: 'Writing\n  tests ' }))?.step).toBe('Writing tests')
})

test('between words: after a reply mid-turn it stays below it while the next step runs', () => {
  expect(signOf(chat({ working: true, live: turn({ now: step('Reading app.ts') }) }, msgs({ who: 'you', text: 'go' }, { text: 'On it.' })))).toEqual({ step: 'Reading app.ts' })
})

test('gone when the turn ends, with or without words', () => {
  expect(signOf(chat({ working: false }, msgs({ who: 'you', text: 'go' }, { text: 'Done.' })))).toBeNull()
  expect(signOf(chat({ working: false }))).toBeNull()
  expect(signOf(chat({ working: true, live: turn({ end: 2 }), background: true }))).toBeNull()
})

test('gone when the agent stopped, crashed or finished', () => {
  expect(signOf(chat({ working: true, notice: 'ended' }))).toBeNull()
  expect(signOf(chat({ working: true, notice: 'gone' }))).toBeNull()
  expect(signOf(chat({ working: true, finished: true, live: turn() }))).toBeNull()
})

test('not for background work alone, nor while its question waits on you', () => {
  expect(signOf(chat({ working: true, background: true }))).toBeNull()
  expect(signOf(chat({ working: true, live: turn() }, msgs({ text: 'Which one?', question: { options: [] } as unknown as Message['question'] })))).toBeNull()
  expect(signOf(undefined)).toBeNull()
})

test('a queued question leaves the working sign up while the agent keeps going', () => {
  const c = chat({ cli: 'codex', working: true, doing: 'Running bun test' },
    msgs({ question: { id: 'q', title: 'Which one?', kind: 'Question', to: 'p:sp1', choices: [], queued: true } }))
  expect(signOf(c, 'Needs a repo decision')).toEqual({ step: 'Running tests' })
})

// SHEP-357: the step beside the sign reads as words, never a command line
test("a task's own status line wins over the tool it runs", () => {
  expect(signOf(chat({ working: true, doing: "Running python3 - <<'EOF' p='web" }), 'Checking the message box')).toEqual({ step: 'Checking the message box' })
  expect(signOf(chat({ working: true, doing: 'Reading app.ts' }), '  ')).toEqual({ step: 'Reading app.ts' })
})

test('a raw command becomes the tool at work in plain words', () => {
  expect(signOf(chat({ working: true, doing: "Running python3 - <<'EOF' p='web/src/ds.css'…" }))).toEqual({ step: 'Running a script' })
  expect(stepWords('Running bun test')).toBe('Running tests')
  expect(stepWords('Running cd web && bun run build')).toBe('Building')
  expect(stepWords('Running git status')).toBe('Using git')
  expect(stepWords('Running gh pr view 12')).toBe('Using GitHub')
  expect(stepWords('Running ls')).toBe('Looking through files')
  expect(stepWords('Running sed -n 1,20p web/src/ds.css')).toBe('Looking through files')
  expect(stepWords('Running npm install')).toBe('Installing packages')
  expect(stepWords('Running HOME=/tmp/x ./bin/thing --flag')).toBe('Running a command')
  expect(stepWords('Started bun web/demo/serve.ts 7799')).toBe('Started a command in the background')
  expect(stepWords("Watching tail -f log | grep 'x'")).toBe('Watching a command')
})

test('words a person or the tool wrote stay as they are', () => {
  expect(stepWords('Running the build')).toBe('Running the build')
  expect(stepWords('Running unit tests')).toBe('Running unit tests')
  expect(stepWords('Reading app.ts')).toBe('Reading app.ts')
  expect(stepWords('Editing checkout.css')).toBe('Editing checkout.css')
  expect(stepWords('Run the auth tests')).toBe('Run the auth tests')
  expect(stepWords('Searching for “working sign”')).toBe('Searching for “working sign”')
  expect(stepWords('Waiting for a helper')).toBe('Waiting for a helper')
})

test('a pattern, a glob or other code reads as the tool, not the code', () => {
  expect(stepWords('Searching for “wsign\\|wbub”')).toBe('Searching the code')
  expect(stepWords('Looking for web/**/*.tsx')).toBe('Looking for files')
  expect(stepWords('Using tool <x> --all')).toBe('Working')
})

test('no step shows any shell characters, whatever the command', () => {
  for (const c of ["python3 - <<'EOF'", 'a && b', 'x | y', 'FOO=1 bar', 'node -e "x"', 'echo $HOME', '`date`', './run.sh --fast'])
    expect(stepWords(`Running ${c}`)).not.toMatch(/[<>|&$`='"]|--|\.\//)
})

test('heldStep keeps the last named step while the sign shows, Thinking before any, and forgets it with the sign', () => {
  expect(heldStep('p:h', { step: '' })).toBe('Thinking')
  expect(heldStep('p:h', { step: 'Reading app.ts' })).toBe('Reading app.ts')
  expect(heldStep('p:h', { step: '' })).toBe('Reading app.ts')
  expect(heldStep('p:other', { step: '' })).toBe('Thinking')
  expect(heldStep('p:h', null)).toBe('')
  expect(heldStep('p:h', { step: '' })).toBe('Thinking')
})

// SHEP-430: a step from an earlier turn never shows in the next, even when the sign was off screen as that turn ended
// (its heldStep(null) never ran), in a space's chat and in a task's
for (const key of ['p:sp1', 't:shop/SHOP-2']) {
  test(`two turns with different steps: the second never shows the first's line (${key})`, () => {
    const one = msgs({ who: 'you', text: 'first' })
    const first = chat({ key, working: true, doing: 'Read what the redesign delivered' }, one)
    expect(heldStep(key, signOf(first), first)).toBe('Read what the redesign delivered')
    // between its tools the step it was on still reads true
    expect(heldStep(key, signOf({ ...first, doing: '' }), first)).toBe('Read what the redesign delivered')
    // the person's next message starts a new turn: nothing named yet reads Thinking, never the old step
    const two = msgs({ who: 'you', text: 'first' }, { text: 'done' }, { who: 'you', text: 'another thing' })
    const second = chat({ key, working: true }, two)
    expect(heldStep(key, signOf(second), second)).toBe('Thinking')
    expect(heldStep(key, signOf({ ...second, doing: 'Reading app.ts' }), second)).toBe('Reading app.ts')
    expect(heldStep(key, signOf(second), second)).toBe('Reading app.ts')
    heldStep(key, null)
  })
}
