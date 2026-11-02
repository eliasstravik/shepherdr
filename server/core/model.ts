import type { AgentRuntime, Mode } from '../../shared/types.ts'

export type AgentKind = 'claude' | 'codex'
export interface CoreSpace {
  id: string
  name: string
  machine: string
  folder: string
  home?: boolean
  base: string
  prefix: string
  mode: Mode
  added: number
  removed?: number
}
export interface CoreAgent {
  chat: string
  space: string
  machine: string
  role: 'coordinator' | 'task' | 'reviewer'
  kind: AgentKind
  model?: string
  effort?: string
  /** the speed asked for at launch, normal or fast; none: the CLI's own */
  speed?: string
  runtime?: AgentRuntime
  terminal?: string
  pid?: number
  launch: string
  grant: string
  hook: string
  command?: string
  browser?: { namespace: string; session: string; profile: string }
  transcript?: string
  transcriptFormat?: 'codex-exec'
  session?: string
  started: number
  activityAt?: number
  state: 'starting' | 'idle' | 'working' | 'blocked'
  permission?: string
  /** The native permission mode it last ran on outside plan mode. */
  permissionMode?: string
  /** App-private contained launch metadata. Labels and request bodies never establish this ownership. */
  pilot?: { run: string; home: string; captures: string; pending?: boolean }
}
export interface AgentHook {
  id: string
  event: string
  at: number
  session?: string
  transcript?: string
  transcriptFormat?: 'codex-exec'
  agent?: string
  model?: string
  tool?: string
  /** the native permission mode */
  mode?: string
  /** the CLI's id of this tool call */
  use?: string
  /** toolHash of the tool call's input */
  input?: string
  /** the CLI's id of this turn */
  turn?: string
}
