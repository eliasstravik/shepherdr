// Shared Settings-block formatting for the unchanged demo screens.
import { OLD_HEADS, SET_BY, SETTINGS_HEAD, type SetBy } from '../../shared/brief.ts'
/** the How tasks work settings, as a brief's Settings block says them */
export interface Ways {
  /** the brief asks for a fresh-eyes review before it merges; how is the task agent's own call */
  review: boolean
  /** the least severity a finding needs to be fixed (SEVERITIES), and how many rounds of review at most */
  mustFix: string
  rounds: number
  merge: string
  /** shepherdr merge waits for GitHub's checks on the pull request; else the task's own quick checks are enough */
  waitChecks: boolean
}

/** the CLI, model and effort the brief suggests for its review; nothing for a CLI's own default */
export interface Reviewer {
  kind: string
  model?: string
  effort?: string
}

const REVIEWER_NAME: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'pi' }

/** "a headless Codex or a Codex subagent (its default model and effort)", "… Claude Code … (model opus, high effort)" */
export function reviewerWords(r: Reviewer) {
  const name = REVIEWER_NAME[r.kind] ?? r.kind
  const who = `a headless ${name} or a ${name} subagent`
  if (!r.model && !r.effort) return `${who} (its default model and effort)`
  return `${who} (${[r.model ? `model ${r.model}` : 'its default model', r.effort ? `${r.effort} effort` : 'its default effort'].join(', ')})`
}

/** a reviewer's tags for its findings, the worst first */
export const SEVERITIES = ['critical', 'major', 'minor', 'trivial']

/** the Settings block's lines, by the settings each comes from (Settings → How tasks work shows each under its row) */
export type Said = 'review' | 'reviewer' | 'mustFix' | 'rounds' | 'merge' | 'agent'

/** what a brief's Settings block says: How tasks work, who reviews, the agent it runs on (only so it knows), and who
 *  set the lines that differ from Shepherdr's own */
export interface Told {
  ways: Ways
  reviewer?: Reviewer
  agent?: Reviewer
  by?: Partial<Record<Said, SetBy>>
}

const plural = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

/** "Claude Code (its default model and effort)", "Codex (model gpt-5.5, high effort)" */
function onWords(r: Reviewer) {
  const name = REVIEWER_NAME[r.kind] ?? r.kind
  if (!r.model && !r.effort) return `${name} (its default model and effort)`
  return `${name} (${[r.model ? `model ${r.model}` : 'its default model', r.effort ? `${r.effort} effort` : 'its default effort'].join(', ')})`
}

/** the Settings block's lines, each with what it comes from: plain words, each with its value first */
export function settingsLines(id: string, t: Told): { said: Said; text: string }[] {
  const w = t.ways
  const fix = SEVERITIES.slice(0, Math.max(1, SEVERITIES.indexOf(w.mustFix) + 1))
  const merge =
    w.merge === 'ask me first'
      ? `ask me first. Ask the human first, and merge (shepherdr merge ${id}) once they say yes.`
      : w.waitChecks
        ? `after GitHub checks. Merge it yourself once it works and GitHub's checks pass (shepherdr checks ${id}, then shepherdr merge ${id}).`
        : `on its own. Merge it yourself once it works (shepherdr merge ${id}). Don't wait for GitHub's checks.`
  // every line shows, review off too: nothing hidden, an override included
  const lines: { said: Said; text: string }[] = [
    { said: 'review', text: w.review ? 'Review: on. Have your change reviewed by fresh eyes before it merges.' : "Review: off. No review; the lines on reviewing below don't apply." },
    ...(t.reviewer ? [{ said: 'reviewer' as const, text: `Reviewer: ${reviewerWords(t.reviewer)}.` }] : []),
    { said: 'mustFix', text: `Must fix: ${w.mustFix}. Findings are tagged ${SEVERITIES.join('/')}; fix ${fix.length === SEVERITIES.length ? 'all of them' : plural(fix)}${w.rounds > 1 ? ', then review again' : ''}.` },
    { said: 'rounds', text: w.rounds > 1 ? `Review rounds: ${w.rounds}. Stop when a round finds none to fix, at most ${w.rounds} rounds.` : 'Review rounds: 1. One round, no review again.' },
  ]
  lines.push({ said: 'merge', text: `Merge: ${merge}` })
  if (t.agent) lines.push({ said: 'agent', text: `Agent: ${onWords(t.agent)}. Only so you know what you run on.` })
  return lines.map((l) => (t.by?.[l.said] ? { ...l, text: `${l.text} (${SET_BY[t.by[l.said]!]})` } : l))
}

/** a brief split into the coordinator's words and the Settings block Shepherdr ended it with (empty when it has none) */
export function splitBrief(desc: string): [work: string, how: string] {
  const i = [SETTINGS_HEAD, ...OLD_HEADS].map((h) => desc.lastIndexOf(h)).find((x) => x >= 0) ?? -1
  return i < 0 ? [desc, ''] : [desc.slice(0, i).trimEnd(), desc.slice(i)]
}

/**
 * The Settings block that ends every new task's brief: the human's defaults from Settings, one line each, each marked
 * where it differs from Shepherdr's own and by whom; nothing on how to do the work. The coordinator's words come first
 * and win where they differ, so a wish for one task needs no setting changed.
 */
export function settingsBlock(id: string, t: Told) {
  return `${SETTINGS_HEAD}\n${settingsLines(id, t).map((l) => `- ${l.text}`).join('\n')}`
}


export function restartLine(o: { from: string; to: string; chat: string; commits?: string; changes?: string }) {
  const task = o.commits !== undefined
  return [
    `Restarted: the human restarted this ${task ? 'task' : 'chat'} on ${o.to}. ${o.from} ran it until now; you carry on from here, in the same ${task ? 'worktree and branch' : 'folder'}. Look at what is there and go on from it, don't start over.`,
    ...(task ? [`Commits on the branch so far:\n${o.commits || 'none'}`, `Uncommitted changes:\n${o.changes || 'none'}`] : []),
    ...(o.chat ? [`The chat so far, latest last:\n\n${o.chat}`] : []),
    `If you were in the middle of something, carry on; else reply in one short line that you are here and end your turn.`,
  ].join('\n\n')
}



export function resumedLine(on: string) {
  return `The human restarted you on ${on}, with your session as it was. If you were in the middle of something, carry on where you left off; else reply with only <no-reply>restarted</no-reply>.`
}

export function privatePrompt(own: string, reviewer?: string): string {
  return [
    'Private instruction snapshot for this start. This replaces earlier private instruction snapshots, including when empty. Read and follow the repository/team AGENTS.md, CLAUDE.md and REVIEW.md alongside these supplemental rules. Never edit, replace or create repository instruction files to install these rules. Explicit human instructions and the task brief win over private rules; if private and team rules conflict, explain and ask rather than silently overriding either. Never copy private instructions into git, briefs, reports or GitHub. These fields are not a secret store.',
    own,
    ...(reviewer === undefined ? [] : [
      'Reviewer handoff only: the next block applies to reviewers, not to you as the task agent. Include this reviewer block and the precedence/privacy rules above in every fresh reviewer prompt (headless or subagent), alongside the brief and repository rules. This is the snapshot from your latest start; restart this task agent to refresh it after Settings changes. Do not pass your task-only private rules to reviewers.',
      reviewer,
    ]),
  ].join('\n\n')
}
