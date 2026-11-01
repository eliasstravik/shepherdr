// What a CLI's own log file says, in one shape for every CLI. One reader per CLI turns its log into these.
// Readers keep only what the chat shows: what the human typed, the agent's replies, the CLI's own questions, where a
// session starts, and its tool steps and background work cut down to a few words each (the chat folds them into one
// line per turn; their output stays in the log, read again from where it is only when the human opens one).
import type { AgentRuntime, Job, StepKind, StepWords } from '../../../shared/types.ts'

/** where a step's raw output is: a line of a log file */
export interface OutputAt {
  file: string
  offset: number
}

export interface CliChoice {
  label: string
  description?: string
}

/** One question of a CLI's own question tool (Claude Code AskUserQuestion, Codex request_user_input). */
export interface CliQuestionItem {
  header?: string
  question: string
  options: CliChoice[]
  multiSelect: boolean
  /** the CLI accepts a typed answer ("Other") */
  allowCustom: boolean
}

export type LogEvent =
  | { kind: 'runtime'; id: string; at: number; file: string; replace?: boolean; runtime: AgentRuntime }

  /** a new log file (session) starts */
  | { kind: 'session'; id: string; at: number; sessionId: string; file?: string }
  /** something the human (or Shepherdr on their behalf) typed */
  | { kind: 'user'; id: string; at: number; text: string }
  /** a reply the agent wrote (markdown). Can come again with the same id and longer text when the CLI writes the rest
   * of that reply after a read: keep the latest per id. */
  | { kind: 'agent'; id: string; at: number; text: string }
  /** the CLI asks the human through its own question tool; id is the tool call id */
  | { kind: 'question'; id: string; at: number; tool: string; items: CliQuestionItem[] }
  /** the question with this tool call id got its answer */
  | { kind: 'answered'; id: string; at: number }
  /** tokens one model call used (input, cached input and output together); ids are unique per call, so they sum */
  | { kind: 'usage'; id: string; at: number; tokens: number }
  /** the agent's turn began: your message, news, or (Claude Code) its background work woke it */
  | { kind: 'turn-start'; id: string; at: number }
  /** the agent's turn ended (the CLI wrote its end-of-turn marker) */
  | { kind: 'turn-end'; id: string; at: number; aborted?: boolean }
  /** the model's provider cut the turn off: its words, and the CLI's own code and HTTP status for it where it has them
   *  (retry.ts decides what it means) */
  | { kind: 'error'; id: string; at: number; text: string; code?: string; status?: number }
  /** a tool call of the agent itself (not a subagent's): what kind, its tool, what it did in words. A CLI that logs a
   *  step only once it is over sends it with its end (and a test run's outcome) */
  | ({ kind: 'step'; id: string; at: number; step: StepKind; tool: string; end?: number; failed?: boolean; result?: string; out?: OutputAt } & StepWords)
  /** the step with this id is over; where its output is; a test run's outcome. `drop`: it only stood for the steps its CLI logs one by one
   *  once over (Codex's code mode runs several commands in one call): it goes, they stay. `refused`: it never ran, as
   *  the human said no, in the terminal or on its card, or the CLI denied it itself */
  | { kind: 'step-end'; id: string; at: number; failed?: boolean; out?: OutputAt; drop?: boolean; result?: string; refused?: 'you' | 'cli' }
  /** work it started in the background: a subagent, a shell, a monitor. `log` is a subagent's own log, `output` a
   *  shell's output file; `step` the step that started it */
  | { kind: 'job'; id: string; at: number; job: Job['kind']; title: string; step?: string; log?: string; output?: string }
  /** that background work is over (done, failed or stopped) */
  | { kind: 'job-end'; id: string; at: number }

export interface Reader {
  /** herdr's agent kind this reader is for: claude, codex, pi */
  cli: string
  /**
   * Parses complete lines of a log file. `lines` never contains a partial last line; ids must be stable across
   * re-reads of the same file (derived from the log's own ids, or file offset when it has none).
   */
  parse(lines: { text: string; offset: number }[], file: string): LogEvent[]
  /** added: forget what was read of this file (it was truncated or replaced and is read again from the start) */
  reset?(file: string): void
}
