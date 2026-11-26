import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Job } from '@shared/types.ts'
import { ago, Jobs, jobsWords } from './jobs.tsx'

// #1560 (6): what an agent left running shows over the box, quiet when none

const NOW = Date.now()
const chat = (jobs?: Job[]) => ({ key: 'SHOP-1/worker', cli: 'claude', messages: [], ...(jobs ? { jobs } : {}) }) as Chat
const shell: Job = { id: 'b:1', kind: 'shell', title: 'Dev server', at: NOW - 90_000, command: 'bun run dev', stop: true, more: 'output' }
const helper: Job = { id: 'c:x', kind: 'child', title: 'shop-1-review', at: NOW - 5000, chat: 't:x', status: 'needs' }

test('nothing when no job runs', () => {
  expect(renderToStaticMarkup(<Jobs chat={chat()} />)).toBe('')
  expect(renderToStaticMarkup(<Jobs chat={chat([])} />)).toBe('')
  expect(renderToStaticMarkup(<Jobs chat={undefined} />)).toBe('')
})

test('one job: its own row, folded, with its age', () => {
  const html = renderToStaticMarkup(<Jobs chat={chat([shell])} />)
  expect(html).toContain('Dev server')
  expect(html).toContain('<span class="qm">1m</span>')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('Stop')
})

test('two or more fold into one line that opens to them', () => {
  const html = renderToStaticMarkup(<Jobs chat={chat([shell, helper])} />)
  expect(html).toContain('2 running in the background')
  expect(html).not.toContain('Dev server')
})

test('words and ages', () => {
  expect(jobsWords([shell, { ...helper, ended: NOW }])).toBe('1 running in the background')
  expect(jobsWords([{ ...helper, ended: NOW }])).toBe('1 finished in the background')
  expect(ago(NOW - 5000, NOW)).toBe('5s')
  expect(ago(NOW - 3 * 3600_000, NOW)).toBe('3h')
  expect(ago(NOW - 600_000, NOW + 999_999, NOW)).toBe('10m')
})
