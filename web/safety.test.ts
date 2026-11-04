// What the web may run by itself (reads) and what it never runs a second time (the window's
// background work). `bun test web/` runs this.
import { expect, test } from 'bun:test'
import { classify, allowedWrite } from './safety.ts'
import { FIND, LOG } from '../mods/chat/log.js'

const read = (...argv: string[]) => expect(classify(argv, '')).toBe('read')
const write = (...argv: string[]) => expect(classify(argv, '')).toBe('write')

test('the chat reads its agent log', () => {
  read('sh', '-c', FIND, 'chat', 'claude', '123')
  read('sh', '-c', LOG, 'log', 'tail', '/x.jsonl', '0')
})

test('lists and status are reads', () => {
  read('herdr-task', '--on', 'vm', 'list', '--all', '--json')
  read('/home/x/.config/herdr-app/mods/tasks/bin/herdr-task', 'auto', 'list', '--all', '--json')
  read('git', '--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch')
  read('hc', 'read', 't7')
  read('herdr-artifact', 'where', '--folder', '/x')
})

test("the window's background work is never run from the web", () => {
  write('herdr-task', 'tick', '--json')
  write('herdr-task', '--on', 'vm', 'scheduler', '--ensure', '--json')
  write('sh', '-c', 'mkdir -p "$1/open" "$1/req" && touch "$1/open/$2"', 'x', '/d', 't1')
  write('sh', '-c', 'find "$1" -name "pasted-*" -mmin +1440 -delete 2>/dev/null; true', 'x', '/d')
  write('sh', '-c', 'cd "$1/req" || exit 0; for f in *.json; do kill -0 "$p" || rm -f "$f"; done', 'x', '/d')
  write('hc', 'kill', 't7')
  write('hc', 'label', 't7', 'herdr.chat=p1')
})

test('commands that only look like reads', () => {
  write('git', '-c', 'core.pager=sh -c evil', 'log')
  write('git', 'diff', '--output=/tmp/x')
  write('find', '/', '-fprint', '/tmp/x')
  write('sh', '-c', 'echo hi > /tmp/x')
  write('sh', '-c', 'eval "$1"', 'x', 'rm -rf /')
  write('command', 'rm', '-rf', '/')
})

test("the person's actions after a tap", () => {
  expect(allowedWrite(['hc', 'send', 't7', 'hello'], '')).toBe(true)
  expect(allowedWrite(['herdr-task', '--on', 'vm', 'accept', 'X-1'], '')).toBe(true)
  expect(allowedWrite(['hc', 'label', 't7', 'herdr.chat.read=4'], '')).toBe(true)
  expect(allowedWrite(['hc', 'label', 't7', 'herdr.chat=p1'], '')).toBe(false)
  expect(allowedWrite(['hc', 'kill', 't7'], '')).toBe(false)
  expect(allowedWrite(['herdr-task', 'tick'], '')).toBe(false)
})
