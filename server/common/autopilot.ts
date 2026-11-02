// Trusted run ownership and limits. None of this state is mounted into an isolated agent.
import { CHAT_KINDS, chatProblem } from './readers/index.ts'
import type { Harness } from './restart.ts'

export const AUTOPILOT_KINDS = CHAT_KINDS.filter((k) => ['claude', 'codex', 'pi'].includes(k))
export interface PilotConfig {
  harness: Harness
  reviewer?: Harness
  hosts: string[]
  secrets: string[]
  approvals: string[]
  traffic?: number
  tokens?: number
  runtime?: number
  parallel: number
}
export interface PilotRun {
  id: string
  place: string
  config: PilotConfig
  started: number
  state: 'starting' | 'on' | 'stopping' | 'stopped' | 'failed' | 'workers'
  error?: string
  tasks: string[]
  traffic?: number
  used: number
  last?: { at: number; reason: string; outcome: string; ended?: number }
}
export function pilotProblem(kind: string) {
  return chatProblem(kind) ?? (!AUTOPILOT_KINDS.includes(kind) ? `${kind} has no isolated Autopilot adapter.` : undefined)
}
export function hostList(text: string): string[] {
  const hosts = [...new Set(text.split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()))]
  if (hosts.some((s) => !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(s))) throw new Error('Use exact public host names, separated by commas. No wildcards, URLs or local addresses.')
  return hosts
}
