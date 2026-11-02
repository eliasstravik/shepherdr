// Reads a shepherdr command line: positional words and --options (repeatable ones collect into lists).
import { splitFacts, STATUS_MAX, SUMMARY_MAX, TITLE_MAX } from '../../shared/types.ts'

export interface Parsed {
  words: string[]
  opts: Record<string, string[]>
  flags: Set<string>
}

const FLAGS = new Set(['ordinary', 'other', 'multi', 'json', 'project-coordinator', 'off', 'help', 'force', 'archived', 'machine', 'later', 'save'])

export function parseArgs(args: string[]): Parsed {
  const words: string[] = []
  const opts: Record<string, string[]> = {}
  const flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
      if (eq > 0) (opts[name] ??= []).push(a.slice(eq + 1))
      else if (FLAGS.has(name) || i + 1 >= args.length || args[i + 1].startsWith('--')) flags.add(name)
      else (opts[name] ??= []).push(args[++i])
    } else words.push(a)
  }
  // --project, from before spaces, is --space
  if (opts.project) opts.space = [...(opts.space ?? []), ...opts.project]
  delete opts.project
  return { words, opts, flags }
}

export const one = (p: Parsed, name: string) => p.opts[name]?.at(-1)

/** a task's --summary and --facts: a facts line written at the summary's end comes apart; a summary past SUMMARY_MAX is
    refused, for its writer to make shorter (like a title past TITLE_MAX) */
export function summaryOpts(p: Parsed, rest: string[] = []): { said?: string; facts?: string } {
  const { said, facts } = splitFacts(one(p, 'summary') ?? rest.join(' '), one(p, 'facts')?.replace(/^\s*Facts:\s*/, ''))
  if (said.length > SUMMARY_MAX)
    throw new Error(
      `That summary is ${said.length} characters: write a shorter one, ${SUMMARY_MAX} at most, in plain words on what changed for the human. PR, commit, checks, review and what is not proven go in --facts "…"; more detail goes in your chat or your proof.`,
    )
  return { said: said || undefined, facts }
}
