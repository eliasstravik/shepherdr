// A slash command typed in a chat (server/common/commands.ts): what counts as one, which start another session, and a
// menu or view it opened in the terminal, read off screens captured from Claude Code 2.1.310.
import { describe, expect, test } from 'bun:test'
import { modelCommand } from '../shared/types.ts'
import { isCommand, leftAtPrompt, sameCommand, startsSession, viewNote, viewOnScreen } from '../server/common/commands.ts'

describe('a slash command', () => {
  test('is a /name and its arguments, as typed; a path or plain words are not', () => {
    for (const t of ['/clear', '/model sonnet', ' /compact keep the plan ', '/review the login page\nand the footer', '/plugin:skill', '/skill:x go']) expect(isCommand(t)).toBe(true)
    for (const t of ['/home/me/app is broken', 'run /clear', '/', '/ clear', '//x', '/9']) expect(isCommand(t)).toBe(false)
  })

  test('the log names it its own way: /new and /reset are /clear to Claude Code', () => {
    expect(sameCommand('/new', '/clear')).toBe(true)
    expect(sameCommand('/compact keep it short', '/compact')).toBe(true)
    expect(sameCommand('/model', '/usage')).toBe(false)
  })

  test('one still in the input did not run; one that ran shows above an empty input', () => {
    const box = (input: string) => `❯ Reply with one word\n● one\n${'─'.repeat(40)}\n❯ ${input}\n${'─'.repeat(40)}\n  ⏵⏵ bypass permissions on\n`
    expect(leftAtPrompt(box('/new'), '/new')).toBe(true)
    // the CLI's list of commands under it changes nothing
    expect(leftAtPrompt(`${box('/new')}  /new      Clear the conversation\n  /next     …\n`, '/new')).toBe(true)
    expect(leftAtPrompt(`❯ /new\n${box('')}`, '/new')).toBe(false)
    // a menu it opened is no input
    expect(leftAtPrompt(MODEL, '/model')).toBe(false)
    expect(leftAtPrompt('› /status\n\n  Weekly limit: 100% left\n\n› Ask Codex to do anything\n', '/status')).toBe(false)
  })

  test('each CLI has its own that go on in another session', () => {
    expect(startsSession('claude', '/clear')).toBe(true)
    expect(startsSession('claude', '/resume 36ebdb93')).toBe(true)
    expect(startsSession('claude', '/compact')).toBe(false)
    expect(startsSession('codex', '/new')).toBe(true)
    expect(startsSession('pi', '/new')).toBe(true)
    expect(startsSession('codex', '/model')).toBe(false)
  })
})

const MODEL = `     /context all to expand
❯ /model
  ⎿  Kept model as Opus 5.5 (default)
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Select model
   Switch between Claude models. Your pick becomes the default for new sessions.

   ❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for everyday, complex tasks
     2.  Opus 5.5                 For complex work and everyday tasks
     3.  Sonnet 5.5               Most efficient for simpler tasks

   ● High effort ←/→ to adjust
   Enter to set as default · s to use this session only · Esc to cancel

`

const USAGE = `❯ /usage
   Current session
   ██████▌                                            13% used
   Resets 3:49pm (UTC)

   Usage credits are off · /usage-credits to turn them on

   Esc to cancel
`

const PROMPT = `❯ /context
  ⎿  Context Usage
     31.5k tokens
────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle)
`

describe('a menu or view it opened', () => {
  test('what it shows comes into the chat, without the hints under it', () => {
    expect(viewOnScreen(MODEL, '/model')).toBe(
      'Select model\nSwitch between Claude models. Your pick becomes the default for new sessions.\n\n❯ 1.  Default (recommended) ✔  Opus 5.5 · Best for everyday, complex tasks\n  2.  Opus 5.5                 For complex work and everyday tasks\n  3.  Sonnet 5.5               Most efficient for simpler tasks\n\n● High effort ←/→ to adjust',
    )
    expect(viewOnScreen(USAGE, '/usage')).toBe('Current session\n██████▌                                            13% used\nResets 3:49pm (UTC)\n\nUsage credits are off · /usage-credits to turn them on')
  })

  test("Codex's menu under its transcript: only the menu, not the messages above it", () => {
    const codex = '  >_ OpenAI Codex (v0.163.0)\n\n› Reply with only the word: two\n\n• two\n\n  Worked for 1s • 13:57\n\n  Select Model and Effort\n\n› 1. GPT-6.1-Sol (current)  Latest workhorse model.\n  2. GPT-6-Luna             Fast and affordable.\n\n  Press enter to select, or esc to go back\n'
    expect(viewOnScreen(codex, '/model')).toBe('  Select Model and Effort\n\n› 1. GPT-6.1-Sol (current)  Latest workhorse model.\n  2. GPT-6-Luna             Fast and affordable.')
  })

  test('back at its prompt, or at work, there is none', () => {
    expect(viewOnScreen(PROMPT, '/context')).toBeUndefined()
    expect(viewOnScreen('✻ Working… (esc to interrupt)\n', '/review')).toBeUndefined()
  })

  test('the note says it is closed; a menu is picked by typing the choice after the command', () => {
    expect(viewNote('/model', viewOnScreen(MODEL, '/model')!)).toContain('type your choice after the command, like `/model …`')
    const usage = viewNote('/usage', viewOnScreen(USAGE, '/usage')!)
    expect(usage).toStartWith('`/usage` opened this in the terminal:\n\n```\nCurrent session')
    expect(usage).toEndWith('Closed it, so your next message goes in.')
  })
})

describe('/model', () => {
  test('is caught with or without a name, in any case, and nothing else is', () => {
    expect(modelCommand('/model')).toBe('')
    expect(modelCommand(' /model sonnet ')).toBe('sonnet')
    expect(modelCommand('/MODEL Opus 5.5')).toBe('Opus 5.5')
    for (const t of ['/models', '/model-x', 'use /model sonnet', '/usage', 'model']) expect(modelCommand(t)).toBeUndefined()
  })
})
