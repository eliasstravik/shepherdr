import { Refusal } from './client.ts'
import type { Parsed } from '../common/args.ts'
const FLAGS: Record<string, string> = { agent: 'agent', 'task.agent': 'agent', model: 'model', 'task.model': 'model', effort: 'effort', 'task.effort': 'effort', reviewer: 'reviewer', 'reviewer.agent': 'reviewer', 'reviewer.model': 'reviewer-model', 'reviewer.effort': 'reviewer-effort' }
const SETTINGS: Record<string, string> = { review: 'brief.review', 'brief.review': 'brief.review', merge: 'brief.merge', 'brief.merge': 'brief.merge', mustfix: 'review.mustFix', 'must-fix': 'review.mustFix', 'review.mustfix': 'review.mustFix', rounds: 'review.rounds', 'review-rounds': 'review.rounds', 'review.rounds': 'review.rounds' }
export const mergeWords = (policy: 'ask' | 'checks' | 'auto') => policy === 'ask' ? 'ask the human first' : policy === 'checks' ? 'after GitHub checks' : 'on its own'
/** Same one-task aliases and precedence as 2.0: repeated --set values override the corresponding flags. */
export function taskOptions(parsed: Parsed) {
  const allowed = ['brief', 'desc', 'space', 'base', 'after', 'later', 'agent', 'model', 'effort', 'reviewer', 'reviewer-model', 'reviewer-effort', 'set']
  const unknown = [...Object.keys(parsed.opts), ...parsed.flags].find(name => !allowed.includes(name))
  if (unknown) throw new Refusal(`Task add takes no --${unknown}`)
  const bare = [...parsed.flags].find(name => name !== 'later')
  if (bare) throw new Refusal(`--${bare} needs a value`)
  const settings: Record<string, string> = {}
  for (const pair of parsed.opts.set ?? []) {
    const eq = pair.indexOf('='), key = pair.slice(0, eq).trim().toLowerCase(), value = pair.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (eq < 1 || !value || !Object.hasOwn(FLAGS, key) && !Object.hasOwn(SETTINGS, key)) throw new Refusal('--set takes a one-task key=value: review, review.mustFix, review.rounds, merge, agent, model, effort or reviewer settings')
    if (Object.hasOwn(FLAGS, key)) (parsed.opts[FLAGS[key]] ??= []).push(value)
    else settings[SETTINGS[key]] = value
  }
  return validateTaskSettings(settings)
}
export function validateTaskSettings(settings: Record<string, string>) {
  const values = { ...settings }
  for (const [key, value] of Object.entries(values)) {
    const count = typeof value === 'string' && value.match(/^(\d+(?:[.,]\d+)?)\s*(?:rounds?)?$/), rounds = count ? Number(count[1].replace(',', '.')) : NaN
    const valid = key === 'brief.review' ? ['on', 'off'].includes(value)
      : key === 'brief.merge' ? ['ask me first', 'after GitHub checks', 'on its own'].includes(value)
      : key === 'review.mustFix' ? ['critical', 'major', 'minor', 'trivial'].includes(value)
      : key === 'review.rounds' ? Number.isInteger(rounds) && rounds >= 1 && rounds <= 10 : false
    if (!valid) throw new Refusal(`Invalid one-task setting ${key}: ${key === 'review.rounds' ? 'choose 1 to 10 rounds' : 'use a value offered in Settings'}`)
    if (key === 'review.rounds') values[key] = `${rounds} ${rounds === 1 ? 'round' : 'rounds'}`
  }
  return values
}
