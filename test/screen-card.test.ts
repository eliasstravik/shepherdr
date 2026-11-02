// Screens as Claude Code 2.1 and Codex 0.163 draw them, whatever a later version adds: the reader knows no prompt by name.
import { expect, test } from 'bun:test'
import { pressKeys, readScreen, sameScreen, screenText } from '../server/common/screen-card.ts'

const LOGO = `Welcome to Claude Code v2.1.308
..........................................................

     *                                       █████▓▓░
       █████████      *
.......█ █   █ █..........................................
`

test('a theme picker: no numbers, the tick beside the cursor', () => {
  const screen = readScreen(`${LOGO}
 Let's get started.

 Choose the text style that looks best with your terminal
 To change this later, run /theme

     Auto (match terminal)
 ❯ ✔ Dark mode
     Light mode
     Dark mode (colorblind-friendly)

 ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  1  function greet() {
  2 -  console.log("Hello, World!");
`)
  expect(screen.choices.map(choice => choice.label)).toEqual(['Auto (match terminal)', 'Dark mode', 'Light mode', 'Dark mode (colorblind-friendly)'])
  expect(screen.at).toBe(1)
  expect(screen.words).toBe("Let's get started.\n\nChoose the text style that looks best with your terminal\nTo change this later, run /theme")
})

test('the tick stays with its choice when the cursor moves away', () => {
  const screen = readScreen(`Pick one\n\n ❯   Auto\n   ✔ Dark mode\n     Light mode\n`)
  expect(screen.choices.map(choice => choice.label)).toEqual(['Auto', 'Dark mode', 'Light mode'])
  expect(screen.at).toBe(0)
})

test('folder trust keeps the screen order, so its default stays first', () => {
  const screen = readScreen(`${LOGO}
──────────────────────────────────
 Accessing workspace:

 /home/you/new-repo

 Quick safety check: Is this a project you created or one you trust?

 Claude Code'll be able to read, edit, and execute files here.

 Security guide

 ❯ No, exit
   Yes, I trust this folder

 Enter to confirm · Esc to cancel
`)
  expect(screen.choices).toEqual([{ label: 'No, exit' }, { label: 'Yes, I trust this folder' }])
  expect(screen.at).toBe(0)
  expect(screen.words).toContain('Quick safety check')
  expect(screen.words).not.toContain('Welcome')
})

test('numbered choices lose their numbers and keep what is written under them', () => {
  const screen = readScreen(`  Welcome to Codex, OpenAI's command-line coding agent

  Sign in with ChatGPT to use Codex as part of your paid plan
  or connect an API key for usage-based billing

> 1. Sign in with ChatGPT
     Usage included with Plus, Pro, Business, and Enterprise plans

  2. Sign in with Device Code
     Sign in from another device with a one-time code

  3. Provide your own API key
     Pay for what you use

  Press enter to continue
`)
  expect(screen.choices).toEqual([
    { label: 'Sign in with ChatGPT', description: 'Usage included with Plus, Pro, Business, and Enterprise plans' },
    { label: 'Sign in with Device Code', description: 'Sign in from another device with a one-time code' },
    { label: 'Provide your own API key', description: 'Pay for what you use' },
  ])
  expect(screen.words).toContain('Sign in with ChatGPT to use Codex')
})

test('the cursor need not start on the first choice', () => {
  const screen = readScreen(`  Hooks need review\n  9 hooks are new or changed.\n\n  1. Review hooks\n› 2. Trust all and continue\n  3. Continue without trusting (hooks won't run)\n\n  enter confirm · esc skip\n`)
  expect(screen.choices.map(choice => choice.label)).toEqual(['Review hooks', 'Trust all and continue', "Continue without trusting (hooks won't run)"])
  expect(screen.at).toBe(1)
})

test('a table of rows reads as choices, its columns closed up', () => {
  const screen = readScreen(`  Event                 Installed   Review\n\n› PreToolUse            1           1\n  PermissionRequest     1           1\n↓\n  t trust all · enter review · esc close\n`)
  expect(screen.choices.map(choice => choice.label)).toEqual(['PreToolUse · 1 · 1', 'PermissionRequest · 1 · 1'])
})

test('a list with no cursor mark is no menu, and a box is not in the way', () => {
  const screen = readScreen(`╭────────╮\n│ Security notes:                │\n│ 1. Claude can make mistakes.   │\n│ 2. Only use it with code you trust │\n╰────────╯\n\n Press Enter to continue…\n`)
  expect(screen.choices).toEqual([{ label: 'Continue' }])
  expect(screen.words).toContain('1. Claude can make mistakes.')
  expect(screen.words).not.toContain('│')
  expect(screen.words).not.toContain('Press Enter')
})

test('an empty message box is no menu', () => {
  expect(readScreen(`  ● Done\n\n────────\n❯ \n────────\n  ? for shortcuts\n`).choices).toEqual([])
  expect(readScreen(`  Tip: try it\n\n› Ask Codex to do anything\n\n  GPT default · ~/repo\n`).choices).toEqual([])
})

test('a link wrapped at the screen edge comes back whole, however far it is from the words', () => {
  const start = 'https://claude.com/cai/oauth/authorize?code=true&client_id=' + 'a'.repeat(21), width = start.length
  const screen = readScreen(`  Browser didn't open? Use the url below to sign in (c to copy)\n\n${start}\nb&state=c\n\n\n Paste code here if prompted >\n`, width)
  expect(screen.choices).toEqual([])
  expect(screen.words).toContain('Paste code here')
  expect(screen.words).toContain(`${start}b&state=c`)
})

test('a blank screen says nothing', () => {
  expect(readScreen('\n\n')).toEqual({ words: '', choices: [], at: 0 })
})

test('a spinner, a timer or the cursor leave a screen the same; other words do not', () => {
  expect(sameScreen('⠋ Starting (3s)\n› 1. Yes\n  2. No')).toBe(sameScreen('⠙ Starting (5s)\n  1. Yes\n› 2. No'))
  expect(sameScreen('Trust this folder?')).not.toBe(sameScreen('Hooks need review'))
})

test('what a tap checks: a spinner or the menu cursor may move, every other mark on the screen counts', () => {
  expect(screenText('⠋ Plan 1\n› 1. Yes\n  2. No')).toBe(screenText('⠙ Plan 1\n  1. Yes\n› 2. No'))
  expect(screenText('│ ✳ Plan 1\n ❯ ✔ Yes\n     No')).toBe(screenText('│ ✶ Plan 1\n   ✔ Yes\n ❯   No'))
  for (const [one, other] of [
    ['Plan 1', 'Plan 2'], ['/repo/a-b', '/repo/a/b'], ['/repo/🔒', '/repo/🚀'], ['/repo/a─b', '/repo/a━b'], ['/repo/a✔', '/repo/a✓'],
    ['/repo/✳a', '/repo/✶a'], ['✳a', '✶a'], ['⠁ means allow access', '⠃ means allow access'], ['a  b', 'a b'], ['one\ntwo', 'one two'], ['✔ Dark mode', '✓ Dark mode'], ['Use port 80 ❯ 81', 'Use port 80 › 81'],
    ['> quoted', '→ quoted'], ['> /repo/a\n> /repo/b', '  /repo/a\n  /repo/b'], ['> /repo/a\n\n ❯ Yes\n   No', '  /repo/a\n\n ❯ Yes\n   No'],
  ]) expect(screenText(one)).not.toBe(screenText(other))
})

test('a choice is reached with arrows from where the cursor is, then taken', () => {
  expect(pressKeys(1, 1)).toEqual(['enter'])
  expect(pressKeys(0, 2)).toEqual(['down', 'down', 'enter'])
  expect(pressKeys(2, 1)).toEqual(['up', 'enter'])
})
