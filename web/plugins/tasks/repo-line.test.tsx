import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

// SHEP-348: a task row's repo line says worktree and branch (its icon), and its pull request with one mark for its
// checks; the task's page has a strip under its title with the rest; a tap on the line opens the task at that strip.

// the formatted words need a browser (DOMPurify): here they are drawn as they are
mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const { getState, setUI } = await import('@client/kernel.ts')
const { GitStrip, RepoLine, openAtStrip, prState } = await import('./client.tsx')
const { IC } = await import('@client/icons.ts')

const snap: Snapshot = { ...snapshot(), machines: [snapshot().machines[0]!] }
const shop = { name: 'shop', folder: '/Users/sam/dev/shop', short: '~/dev/shop', repo: true }
const base = { id: 'SHOP-1', name: 'A task', place: 'p:mac-mini:shop', status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1 } as Task
const pr = (x: Partial<NonNullable<Task['pr']>> = {}) => ({ number: 1313, url: 'https://github.com/example/shop/pull/1313', ...x })

// the six example states of the design page
const SIX: Record<string, Task> = {
  branch: { ...base, work: shop, repo: 'branch', worktree: true, branch: 'task/tap-sizes', base: 'main' },
  running: { ...base, work: shop, repo: 'branch', worktree: true, branch: 'task/swap-sides', base: 'main', pr: pr({ checks: 'running' }) },
  failed: { ...base, work: shop, repo: 'branch', worktree: true, branch: 'task/links', base: 'main', pr: pr({ number: 1318, checks: 'failed' }) },
  merged: { ...base, status: 'done', state: 'done', merged: true, work: shop, repo: 'branch', worktree: true, branch: 'task/reactions', base: 'main', pr: pr({ number: 1314, checks: 'passed' }) },
  here: { ...base, work: shop, repo: 'folder' },
  research: { ...base, work: undefined },
}
const line = (t: Task) => renderToStaticMarkup(<RepoLine snap={snap} t={t} />)
const strip = (t: Task) => renderToStaticMarkup(<GitStrip t={t} />)
const icon = (n: keyof typeof IC) => IC[n]
const text = (html: string) => html.replace(/<[^>]+>/g, '')

test('own worktree and branch, no pull request: the branch icon before the repo, nothing more', () => {
  const html = line(SIX.branch!)
  expect(html).toContain(icon('branch'))
  expect(html).not.toContain(icon('folder'))
  expect(text(html)).toBe('shop')
})

test('open pull request, checks running: "PR #1313" and the quiet running mark', () => {
  const html = line(SIX.running!)
  expect(html).toContain(icon('branch'))
  expect(text(html)).toBe('shop·PR #1313')
  expect(html).toContain(icon('checking'))
  expect(html).not.toContain('c-red')
  expect(html).not.toContain('c-ready')
})

test('checks failed: the mark is a red cross, the only colour on the line', () => {
  const html = line(SIX.failed!)
  expect(text(html)).toBe('shop·PR #1318')
  expect(html).toContain(`<svg class="i c-red" viewBox="0 0 20 20" aria-hidden="true">${icon('x')}</svg>`)
  expect(html.match(/c-(red|ready|ask|working)/g)).toEqual(['c-red'])
})

test('checks passed: a green check', () => {
  const html = line({ ...SIX.running!, pr: pr({ checks: 'passed' }) })
  expect(html).toContain(`<svg class="i c-ready" viewBox="0 0 20 20" aria-hidden="true">${icon('check')}</svg>`)
})

test('merged: "Merged #1314" with the merged icon, no checks mark', () => {
  const html = line(SIX.merged!)
  expect(text(html)).toBe('shop·Merged #1314')
  expect(html).toContain(icon('merged'))
  expect(html).not.toContain(icon('check'))
})

test('works here, in the folder itself: the folder icon stays', () => {
  const html = line(SIX.here!)
  expect(html).toContain(icon('folder'))
  expect(html).not.toContain(icon('branch'))
  expect(text(html)).toBe('shop')
})

test('research, nothing to show: no line at all', () => {
  expect(line(SIX.research!)).toBe('')
  expect(strip(SIX.research!)).toBe('')
})

test('a pull request word for each state', () => {
  expect(Object.fromEntries(Object.entries(SIX).map(([k, t]) => [k, prState(t)]))).toEqual({ branch: null, running: 'running', failed: 'failed', merged: 'merged', here: null, research: null })
  expect(prState({ ...SIX.running!, pr: pr({ closed: true }) })).toBe('closed')
  expect(prState({ ...SIX.running!, pr: pr() })).toBe('open')
})

test('the strip: full branch, its base, the pull request with checks and a GitHub link, and its own worktree', () => {
  const html = strip(SIX.failed!)
  expect(html).toContain('data-card="strip:SHOP-1"')
  expect(text(html)).toContain('task/linksfrom main')
  expect(text(html)).toContain('PR #1318checks failed')
  expect(html).toContain('href="https://github.com/example/shop/pull/1313"')
  expect(html).toContain('aria-label="Pull request 1318 on GitHub"')
  expect(text(html)).toContain('In its own worktree')
})

test('the strip with no pull request yet, merged, and in the folder itself', () => {
  expect(text(strip(SIX.branch!))).toContain('No pull request yet')
  expect(text(strip(SIX.merged!))).toContain('PR #1314merged')
  expect(strip(SIX.merged!)).toContain(icon('merged'))
  const here = text(strip(SIX.here!))
  expect(here).toBe('Works in the folder itself, no branch')
  expect(text(strip({ ...SIX.branch!, worktree: false }))).toContain('In the folder, on its own branch')
})

test('a tap on the repo line opens the task at its strip, and the strip shows it was the target', () => {
  setUI({ task: null, jump: null })
  let stopped = false
  const el = RepoLine({ snap, t: SIX.failed! }) as ReactElement<{ onClick: (e: { stopPropagation: () => void }) => void; role: string }>
  expect(el.props.role).toBe('link')
  el.props.onClick({ stopPropagation: () => { stopped = true } })
  // the row's own click (open the task, at its newest message) does not run too
  expect(stopped).toBe(true)
  expect(getState().ui.task).toBe('SHOP-1')
  expect(getState().ui.jump).toBe('strip:SHOP-1')
  expect(strip(SIX.failed!)).toContain('class="gstrip jump"')
  setUI({ jump: null })
  expect(strip(SIX.failed!)).toContain('class="gstrip"')
  openAtStrip(SIX.branch!)
  expect(getState().ui.jump).toBe('strip:SHOP-1')
  setUI({ task: null, jump: null })
})

test('the line keeps the row comfortable to tap and its icons sized to the line', () => {
  const css = readFileSync(new URL('../../src/ds.css', import.meta.url), 'utf8')
  expect(css).toMatch(/@media \(pointer:coarse\)\{\.rline::after\{content:"";position:absolute;inset:/)
  expect(css).toMatch(/\.rline \.i\{flex:none;width:calc\(var\(--secl\) - 4px\)/)
})
