import type { SettingSection } from '../../shared/types.ts'
import { TABLE } from '../../shared/models.ts'
import { pilotHosts, type CorePilotConfig } from './pilot-policy.ts'
import { timeRule } from '../common/trigger.ts'
import type { CoreSettings } from './settings.ts'
import { kindOf } from './settings.ts'

export const PILOT_SETTINGS: SettingSection = {
  name: 'Autopilot', about: 'One brief, a wake-up schedule and an isolated agent. Turning it on replaces the coordinator and keeps this chat. Access and limits apply to its workers too.', rows: [
    { group: 'Wake-up', label: 'When', key: 'heartbeat.when', value: timeRule('FREQ=MINUTELY;INTERVAL=30') },
    { group: 'Wake-up', label: 'Events', key: 'heartbeat.on', value: 'all news' },
    { group: 'Agent', label: 'Agent', key: 'autopilot.agent', value: 'inherit', options: ['inherit', 'Claude Code', 'Codex'] },
    { group: 'Agent', label: 'Model', key: 'autopilot.model', value: 'inherit', text: true },
    { group: 'Agent', label: 'Effort', key: 'autopilot.effort', value: 'inherit', options: ['inherit', 'default', ...new Set([...TABLE.claude.efforts, ...TABLE.codex.efforts])] },
    { group: 'Access and limits', label: 'Permission profile', key: 'autopilot.access', value: 'Isolated workspace', options: ['Isolated workspace'] },
    { group: 'Access and limits', label: 'Network hosts (HTTPS)', key: 'autopilot.hosts', value: 'api.openai.com, chatgpt.com, auth.openai.com, api.anthropic.com, platform.claude.com', text: true },
    { group: 'Access and limits', label: 'Available secrets (names)', key: 'autopilot.secrets', value: '', text: true },
    { group: 'Access and limits', label: 'Human approval required', key: 'autopilot.approvals', value: 'merge', options: ['merge', 'none'] },
    { group: 'Access and limits', label: 'Shared HTTPS allowance', key: 'autopilot.traffic', value: 'off', num: { min: 1, max: 1000000, off: true, unit: 'MiB' } },
    { group: 'Access and limits', label: 'Shared reported tokens', key: 'autopilot.tokens', value: 'off', num: { min: 1, max: 1000000000, off: true } },
    { group: 'Access and limits', label: 'Shared runtime', key: 'autopilot.runtime', value: 'off', num: { min: 1, max: 10080, off: true, unit: 'min' } },
    { group: 'Access and limits', label: 'Maximum parallel tasks', key: 'autopilot.parallel', value: '3', num: { min: 1, max: 200 } },
  ],
}
export function corePilotConfig(settings: CoreSettings, level: string): CorePilotConfig {
  const get = (key: string) => settings.get(`autopilot.${key}`, level), base = settings.agent('coordinator', level)
  const kind = get('agent') === 'inherit' ? base.kind : kindOf(get('agent'))
  if (!kind) throw Error('Choose Claude Code or Codex')
  const raw = get('model'), model = raw === 'inherit' ? base.model : raw === 'default' || !raw ? undefined : settings.catalog(kind, level).models.find(item => item.id === raw || item.label === raw)?.id ?? raw
  const requested = get('effort'), effort = requested === 'inherit' ? base.effort : requested === 'default' ? undefined : requested
  const catalog = settings.catalog(kind, level), offered = catalog.models.find(item => item.id === model)?.efforts ?? catalog.efforts
  if (model && catalog.models.length && !catalog.models.some(item => item.id === model)) throw Error('Choose an available Autopilot model, or default')
  if (effort && !offered.includes(effort)) throw Error('Choose an effort supported by this Autopilot agent and model')
  const num = (key: string) => { const value = get(key); return value === 'off' ? undefined : parseFloat(value) }
  return { harness: { kind, model, effort }, reviewer: settings.agent('reviewer', level), hosts: pilotHosts(get('hosts').split(/[\s,]+/).filter(Boolean)), secrets: get('secrets').split(/[\s,]+/).filter(Boolean), approvals: get('approvals') === 'none' ? [] : ['merge'],
    parallel: num('parallel') ?? 3, traffic: num('traffic') === undefined ? undefined : num('traffic')! * 1048576, tokens: num('tokens'), runtime: num('runtime') === undefined ? undefined : num('runtime')! * 60000 }
}
