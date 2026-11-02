// The demo's agent activity: a finished turn's steps, a turn that runs now, and background work (a reviewer subagent,
// a test run, a headless reviewer) with what each does. Times count back from when the demo started.
import { glance, rowsOf } from '../../shared/activity.ts'
import type { ActivityAnswer, ActivityAsk, Job, Step, TurnActivity } from '../../shared/types.ts'
import { claudeStep, codexItem, commandSay, type Said } from '../common/readers/steps.ts'

const T0 = Date.now()
const ago = (s: number) => T0 - s * 1000

/** a step in the words the live readers give it: a Claude Code tool call, or a Codex command */
const step = (id: string, said: Said | undefined, tool: string, at: number, took: number | null = 2, x: Partial<Step> = {}): Step => {
  const { step: kind, ...w } = said!
  return { id, kind, tool, ...w, at: ago(at), end: took === null ? undefined : ago(at - took), output: took !== null, ...x }
}
const claude = (id: string, tool: string, input: object, at: number, took?: number | null, x?: Partial<Step>) => step(id, claudeStep(tool, input), tool, at, took, x)
const codex = (id: string, cmd: string, at: number, took?: number | null, x?: Partial<Step>) => step(id, commandSay(cmd), 'exec_command', at, took, x)
const read = (id: string, path: string, at: number, took?: number | null) => step(id, codexItem({ type: 'CommandExecution', command: `sed -n 1,200p ${path}`, parsed_cmd: [{ type: 'read', path }] }), 'exec_command', at, took)

const EDIT = { file_path: '/w/gtm/server/webhook.ts', old_string: 'if (sig !== expected) return 401', new_string: "const a = Buffer.from(sig)\nconst b = Buffer.from(expected)\nif (a.length !== b.length || !timingSafeEqual(a, b)) return 401" }

const STEPS: Record<string, Step[]> = {
  // GTM-15: the fix, its check and a reviewer subagent
  'gtm15-t1': [
    claude('s1', 'Grep', { pattern: 'verifySignature', path: '/w/gtm/server' }, 900),
    claude('s2', 'Read', { file_path: '/w/gtm/server/webhook.ts' }, 896),
    claude('s3', 'Read', { file_path: '/w/gtm/test/webhook.test.ts' }, 893),
    claude('s4', 'Read', { file_path: '/w/gtm/server/crypto.ts' }, 890),
    claude('s5', 'Edit', EDIT, 870, 1),
    claude('s6', 'Edit', { file_path: '/w/gtm/test/webhook.test.ts', old_string: '', new_string: "test('accepts a re-encoded body', async () => {\n  expect(await post(reencoded)).toBe(200)\n})" }, 850, 1),
    claude('s7', 'Bash', { command: 'bun test webhook 2>&1 | tail -20', description: 'Run the webhook tests' }, 840, 9, { failed: true, result: '1 failed, 1 passed' }),
    claude('s8', 'Read', { file_path: '/w/gtm/server/raw-body.ts' }, 820),
    claude('s9', 'Edit', { file_path: '/w/gtm/server/webhook.ts', old_string: 'const body = JSON.stringify(req.body)', new_string: 'const body = await rawBody(req)' }, 800, 1),
    claude('s10', 'Bash', { command: 'bun test webhook 2>&1 | tail -20', description: 'Run the webhook tests' }, 790, 8, { result: '3 passed' }),
    claude('s11', 'Agent', { description: 'Review the signature fix', prompt: 'Review the diff on this branch for what it broke.' }, 770, 140),
    claude('s12', 'Bash', { command: 'bun run typecheck', description: 'Check the types' }, 620, 12),
    claude('s13', 'Bash', { command: 'git add -A && git commit -m "Constant-time signature check"' }, 600, 1),
  ],
  // the gtm coordinator: a look at its tasks
  'gtm-t1': [
    claude('c1', 'Bash', { command: '~/.shepherdr/helper/bin/shepherdr task list 2>&1 | grep -E "^GTM" | grep -vE "done"' }, 3000, 1),
    claude('c2', 'Bash', { command: 'gh pr checks 48', description: 'Check GTM-15’s pull request checks' }, 2995, 3),
    claude('c3', 'Read', { file_path: '/w/gtm/HEARTBEAT.md' }, 2990, 1),
  ],
  // HP-202: what it did before this turn
  'hp202-t1': [
    codex('h1', 'rg "mute" plugins/voice', 1500),
    read('h2', 'plugins/voice/call.ts', 1495),
    read('h3', 'plugins/voice/client.tsx', 1490),
    read('h4', 'plugins/voice/server.ts', 1485),
  ],
  // HP-202: the turn that runs now
  'hp202-live': [
    read('l1', 'plugins/voice/call.ts', 300),
    codex('l2', 'rg "track.stop" plugins', 290),
    read('l3', 'plugins/voice/voice.ts', 280),
    step('l4', codexItem({ type: 'FileChange', changes: { 'plugins/voice/call.ts': { unified_diff: '@@\n-  track.stop()\n+  track.enabled = false\n+  muted = true' } } }), 'apply_patch', 200, 1),
    { ...step('l5', { step: 'agent', title: 'Asked a subagent: Review the mute fix', doing: 'Asking a subagent: Review the mute fix', target: '' }, 'spawn_agent', 190, 1), job: 'j1', output: false },
    codex('l6', 'bun run test voice', 120, 1, { job: 'j2' }),
    read('l7', 'test/mute.test.ts', 14, null),
  ],
  // the reviewer subagent's own steps
  j1: [
    read('r1', 'plugins/voice/call.ts', 180),
    read('r2', 'plugins/voice/voice.ts', 170),
    codex('r3', 'rg "onended" plugins/voice', 150),
    read('r4', 'test/call.test.ts', 20, null),
  ],
}

const OUTPUT: Record<string, string> = {
  s5: '@@ -41,1 +41,3 @@\n-  if (sig !== expected) return 401\n+  const a = Buffer.from(sig)\n+  const b = Buffer.from(expected)\n+  if (a.length !== b.length || !timingSafeEqual(a, b)) return 401',
  s6: "@@ -30,0 +30,3 @@\n+test('accepts a re-encoded body', async () => {\n+  expect(await post(reencoded)).toBe(200)\n+})",
  s9: '@@ -38,1 +38,1 @@\n-  const body = JSON.stringify(req.body)\n+  const body = await rawBody(req)',
  l4: '@@ -12,1 +12,2 @@\n-  track.stop()\n+  track.enabled = false\n+  muted = true',
  s7: '$ bun test webhook\n\nwebhook.test.ts:\n✓ accepts a signed body\n✗ accepts a re-encoded body\n  expected 200, got 401\n\n 1 pass\n 1 fail',
  s10: '$ bun test webhook\n\nwebhook.test.ts:\n✓ accepts a signed body\n✓ accepts a re-encoded body\n✓ refuses a wrong signature\n\n 3 pass\n 0 fail',
  c1: 'GTM-15  Fix webhook signature check   working\nGTM-16  Lead scoring by ICP           to do\nGTM-17  Weekly outbound report        to do',
  j2: '$ bun run test voice\n\ntest/voice.test.ts:\n✓ starts a call\n✓ mute keeps the call\n✓ unmute sends audio again\n✓ hang up ends the call\n\ntest/layout-voice.test.ts:\n✓ call bar at phone width\n✓ call bar on desktop\n… running layout-voice',
}

/** a turn as the chat shows it: its rows, from its steps */
export function demoTurn(id: string, live = false): TurnActivity {
  const steps = STEPS[id]
  const last = steps.at(-1)!
  return {
    id,
    at: steps[0].at - 4000,
    end: live ? undefined : (last.end ?? last.at) + 3000,
    ...glance(rowsOf(steps)),
    steps: steps.length,
    now: live ? last : undefined,
    failed: steps.filter((s) => s.failed).length || undefined,
  }
}

/** HP-202's background work while its turn runs */
export function demoJobs(): Job[] {
  return [
    { id: 'j1', kind: 'agent', title: 'Review the mute fix', at: ago(190), now: 'Reading call.test.ts', more: 'steps' },
    { id: 'j2', kind: 'shell', title: 'Running tests', at: ago(120), now: '… running layout-voice', more: 'output' },
  ]
}

export function demoActivity(a: ActivityAsk): ActivityAnswer {
  if (a.what === 'turn') return STEPS[a.id] ? { steps: STEPS[a.id] } : { error: 'That turn is gone.' }
  if (a.what === 'job') return STEPS[a.id] ? { steps: STEPS[a.id] } : OUTPUT[a.id] ? { output: OUTPUT[a.id] } : { error: 'That job has ended.' }
  return { output: OUTPUT[a.id] ?? '(no output)' }
}
