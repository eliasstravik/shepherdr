import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { artifactChecker, taskArtifactTitle, titleCase } from '../server/artifact-check.ts'

test('screenshots alone cannot pass validation without the explicit browser result', async () => {
  const home = mkdtempSync(join(tmpdir(), 'shep-art-check-'))
  try {
    const check = artifactChecker(home, async args => {
      for (const arg of args) if (arg.startsWith('screenshot ')) writeFileSync(arg.slice(11), 'test picture')
      return { ok: true, out: 'wrong output format', err: '' }
    }, html => html)
    expect((await check('<p>Example</p>')).errors).toContain('The browser did not return its validation result')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('task proof titles retain case with a core-qualified task ID', () => {
  expect(titleCase('probe/REMO-1: proof')).toBe('probe/REMO-1: Proof')
  expect(titleCase('SHE-301: proof')).toBe('SHE-301: Proof')
})

test('a task artifact title names the task before the kind, once, and keeps the name as it is', () => {
  const task = { id: 'vm-stravik/SHEP-2', localId: 'SHEP-2', name: 'Stop Goes in note on every send' }
  const full = 'SHEP-2: Stop Goes in note on every send · Proof'
  for (const title of ['Proof', 'proof', 'SHEP-2: Proof', 'SHEP-2: proof', 'SHEP-2 proof', 'shep-2 · proof', 'vm-stravik/SHEP-2: Proof', 'vm-stravik:SHEP-2: Proof',
    full, 'Proof for Stop Goes in note on every send', 'Stop Goes in note on every send: proof', 'stop goes in  NOTE on every send · proof', 'SHEP-2: Proof · Stop Goes in note on every send']) expect(taskArtifactTitle(title, task)).toBe(full)
  expect(taskArtifactTitle('SHEP-2', task)).toBe('SHEP-2: Stop Goes in note on every send')
  expect(taskArtifactTitle('Stop Goes in note on every send', task)).toBe('SHEP-2: Stop Goes in note on every send')
  expect(taskArtifactTitle('Notes on stop goes in note on every send for phones', task)).toBe('SHEP-2: Stop Goes in note on every send · Notes for phones')
  expect(taskArtifactTitle('SHEP-21: Proof', task)).toBe('SHEP-2: Stop Goes in note on every send · SHEP-21: Proof')
  expect(taskArtifactTitle('Migration from v1 to v2', { id: 'S-1', name: 'V1' })).toBe('S-1: Migration from V1 to v2')
  expect(taskArtifactTitle('S-1: v1 · Migration from v1 to v2', { id: 'S-1', name: 'v1' })).toBe('S-1: v1 · Migration from v1 to v2')
  expect(taskArtifactTitle('Report · weekly · usage', task)).toBe('SHEP-2: Stop Goes in note on every send · Report · weekly · usage')
  // a lowercase, code-like or short name is never recased, and part of another word is not the name
  expect(taskArtifactTitle('proof', { id: 'SHE-1', name: 'fix a.b (c-d) in iOS' })).toBe('SHE-1: fix a.b (c-d) in iOS · Proof')
  expect(taskArtifactTitle('SHE-1: fix a.b (c-d) in iOS - notes', { id: 'SHE-1', name: 'fix a.b (c-d) in iOS' })).toBe('SHE-1: fix a.b (c-d) in iOS · Notes')
  expect(taskArtifactTitle('Fixture report', { id: 'S-1', name: 'Fix' })).toBe('S-1: Fix · Fixture report')
  expect(taskArtifactTitle('Fix-up notes', { id: 'S-1', name: 'Fix' })).toBe('S-1: Fix · Fix-up notes')
  expect(taskArtifactTitle('Proof', { id: 'S-1', name: 'Proof' })).toBe('S-1: Proof')
})
