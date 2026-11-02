import type { LogEvent } from '../common/readers/types.ts'
import type { AgentHook } from './model.ts'

/** What an agent's own records say it moved past: one tool call (use), or its whole turn. */
export interface NativeEnd { at: number; reason: string; use?: string; sub?: string; prompt?: boolean; turn?: string; quiet?: boolean }
/** The part of a waiting card that evidence is matched against. */
export interface NativeCall { id?: string; at?: number; tool?: string; hash?: string; turn?: string; sub?: string; native?: unknown }

const ANSWERED = 'Answered in the terminal', DECLINED = 'Declined or interrupted in the terminal', TIMED_OUT = 'Timed out in the CLI and was denied'
const INTERRUPTED = 'Interrupted in the terminal', MOVED_ON = 'The agent moved on in the terminal'
export const CANCELLED = DECLINED, STOPPED = 'Agent stopped; ask again after restarting it'
const KEEP = 64

export function hookEnd(event: AgentHook): NativeEnd | undefined {
  const at = event.at
  if ((event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') && event.use) return { at, use: event.use, reason: ANSWERED }
  if (event.event === 'Stop') return { at, sub: event.agent, quiet: true, reason: MOVED_ON }
  if (event.event === 'SubagentStop' && event.agent) return { at, sub: event.agent, reason: MOVED_ON }
  if (event.event === 'SessionEnd') return { at, sub: event.agent, reason: STOPPED }
  // Text typed into a running turn is no turn change: only a later turn's prompt says the card's turn is over.
  if (event.event === 'UserPromptSubmit') return { at, sub: event.agent, prompt: true, turn: event.turn, reason: MOVED_ON }
}
export function logEnd(event: LogEvent): NativeEnd | undefined {
  if (event.kind === 'step-end') return { at: event.at, use: event.id, reason: event.refused === 'cli' ? TIMED_OUT : event.refused ? DECLINED : ANSWERED }
  if (event.kind === 'answered') return { at: event.at, use: event.id, reason: ANSWERED }
  if (event.kind === 'turn-end') return event.aborted ? { at: event.at, reason: INTERRUPTED } : { at: event.at, quiet: true, reason: MOVED_ON }
}

/** Evidence stays until later, as a card can arrive after what ended it when a machine reconnects. */
export class NativeEnds {
  private calls = new Map<string, Map<string, NativeCall>>()
  private ends = new Map<string, NativeEnd[]>()
  called(launch: string, use: string, call: NativeCall) {
    const calls = this.calls.get(launch) ?? new Map<string, NativeCall>()
    this.calls.set(launch, calls); calls.set(use, call)
    if (calls.size > KEEP) calls.delete(calls.keys().next().value!)
  }
  ended(launch: string, end: NativeEnd) {
    const ends = this.ends.get(launch) ?? []
    this.ends.set(launch, ends); ends.push(end)
    if (ends.length > KEEP) ends.shift()
  }
  /** The tool call a card waits on. Each card holds on to its own, oldest first, so identical calls never trade results. */
  private call(launch: string, card: NativeCall) {
    const calls = this.calls.get(launch), ends = this.ends.get(launch) ?? []
    for (const [use, call] of calls ?? []) if (call.id === card.id) return use
    for (const [use, call] of calls ?? []) {
      // Claude's question and plan tools run alone, and it fills in their input after the call.
      if (call.id || call.sub !== card.sub || call.tool !== card.tool || call.hash !== card.hash && !card.native) continue
      if (ends.some(end => end.use === use && end.at < (card.at ?? 0))) continue
      call.id = card.id
      return use
    }
  }
  /** Why this card is over, if its call or its turn is. A Codex turn can end by itself with the approval still pending
   *  (a long call only yields), so there a quiet end counts only with something typed between the card and it. */
  over(launch: string, card: NativeCall, kind?: string) {
    const use = this.call(launch, card), ends = this.ends.get(launch) ?? []
    const typed = (quiet: NativeEnd) => ends.some(end => end.prompt && end.at > (card.at ?? 0) && end.at <= quiet.at && end.sub === card.sub)
    for (const end of ends) {
      if (end.at < (card.at ?? 0) || end.quiet && kind === 'codex' && !typed(end)) continue
      if (end.use ? end.use === use : end.at > (card.at ?? 0) && end.sub === card.sub && !(end.prompt && end.turn && end.turn === card.turn)) return end.reason
    }
  }
  forget(launch: string) { this.calls.delete(launch); this.ends.delete(launch) }
}
