// Settings: the app's few defaults, set at three levels: Everywhere, each machine, and each space;
// the most specific one set wins (space > machine > Everywhere > Shepherdr's own). Task agents have none of their
// own: "How tasks work" is the Settings block Shepherdr adds to the end of every new task's brief (prompts.ts
// settingsBlock), who reviews its change among them, and "Agents" is which agent, model and effort each kind of agent
// starts with. A coordinator changes either for one task, in its brief and with task add's flags (--set).
// Settings come in two groups: what agents are told (only words in their prompts) and how Shepherdr runs (the rest).
// Fixed demo settings model. Production persistence and agent availability come from CoreSettings.
import { AUTOPILOT_KINDS, hostList, pilotProblem, type PilotConfig } from './autopilot.ts'
import { modelArg } from './models.ts'
import { CHAT_KINDS, chatProblem } from './readers/index.ts'
import { cpus, totalmem } from 'node:os'
import { NOTIFY, NOTIFY_DEFAULT, NOTIFY_KEY } from '../../shared/alerts.ts'
import type { SettingSection, TriggerRow } from '../../shared/types.ts'
import { readJson, writeJson } from '../store.ts'
import type { SetBy } from '../../shared/brief.ts'
import { settingsBlock, settingsLines, SEVERITIES, type Said, type Ways } from './prompts.ts'
import { effortFor, effortsOf, findModel, knowsModels, LEVELS, modelsOf } from './models.ts'
import { eventRules, eventsText, eventWords, nextWords, OWN_ZONE, timeRule, timeWords, validZone, type EventRule } from './trigger.ts'

/** every agent kind herdr can start (interactive chat requires runtime log discovery and a reader) */
const FALLBACK_KINDS = ['pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode', 'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli', 'qwen', 'letta', 'maki', 'muse']

// GitHub Copilot by its full name, not to be taken for the Copilot mode
const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'pi', opencode: 'OpenCode', qodercli: 'Qoder', agy: 'Antigravity', omp: 'Oh My Pi', mastracode: 'Mastra Code', copilot: 'GitHub Copilot' }
const nameOf = (kind: string) => NAMES[kind] ?? kind[0].toUpperCase() + kind.slice(1)
const KINDS = ['claude', 'codex', 'pi'] // Fixed historical demo catalog; production uses CoreSettings.
// chat-readable kinds first, then the rest as herdr lists them
const ORDER = [...CHAT_KINDS, ...KINDS.filter((k) => !CHAT_KINDS.includes(k))].filter((k) => KINDS.includes(k))

export const CLIS: string[] = ORDER.map(nameOf)
export const CHAT_CLIS = ORDER.filter((kind) => CHAT_KINDS.includes(kind)).map(nameOf)
export const KIND: Record<string, string> = Object.fromEntries(ORDER.map((k) => [nameOf(k), k]))
export const CLI_NAME: Record<string, string> = Object.fromEntries(ORDER.map((k) => [k, nameOf(k)]))

/** a CLI by its name or its herdr kind, any case ("Codex", "codex"): its kind */
export function kindOf(cli: string): string | undefined {
  const c = cli.trim().toLowerCase()
  return ORDER.find((k) => k === c || nameOf(k).toLowerCase() === c)
}

/** the effort words a setting may hold: each CLI and model takes its own few of them (models.ts), the rest becoming the
 *  nearest it has */
export const EFFORTS = ['default', ...LEVELS]

export { effortFor }

/** the CLIs a brief's Review line may suggest for a task's review */
export const REVIEWERS = ['Codex', 'Claude Code', 'pi']

/** Autopilot's heartbeat (Settings → Autopilot): its trigger, a time rule as kept ('off': none) and the news that
 *  wakes it at once, and the time zone of every time rule */
export interface Heartbeat {
  time: string
  on: EventRule[]
  zone: string
}

/** Autopilot's heartbeat by default: every 30 minutes, all day */
export const HEARTBEAT_RULE = timeRule('FREQ=MINUTELY;INTERVAL=30')

/** the heartbeat's few ready-made rules in Settings; anything else, the coordinator writes */
export const HEARTBEAT_PRESETS = [
  { label: '15 min', value: timeRule('FREQ=MINUTELY;INTERVAL=15') },
  { label: '30 min', value: HEARTBEAT_RULE },
  { label: '1 hour', value: timeRule('FREQ=HOURLY') },
  { label: 'Workdays', value: timeRule('FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,10,11,12,13,14,15,16,17;BYDAY=MO,TU,WE,TH,FR') },
]

/** the news that wakes a coordinator on Autopilot at once, ready-made: all of it, or none (it waits for the heartbeat) */
const NEWS_PRESETS = [
  { label: 'All news', value: 'all news' },
  { label: 'None: it waits', value: 'none' },
]

/** the agents Settings picks a CLI, model and effort for */
type Role = 'task' | 'coordinator' | 'reviewer' | 'backup'
const ROLES: Role[] = ['task', 'coordinator', 'reviewer', 'backup']

/** a count or a threshold: any number from min to max (step 1: whole numbers), kept with its unit ("7 days", "80%");
 *  off: it may be off too ("off"), zero: 0 is off */
export interface Num {
  min: number
  max: number
  step?: number
  /** the unit after the number, plural and singular ("days", "day"); none: a bare number */
  unit?: string
  one?: string
  off?: boolean
  zero?: boolean
}

type Row = { label: string; key: string; value: string; options?: string[]; text?: boolean; multiline?: boolean; fixed?: boolean; group?: string; num?: Num }
/** the levels a section's defaults may be set at (all three when none): a machine's capacity has no space level;
 *  alerts and voice are one for all */
type Section = { name: string; about?: string; rows: Row[]; levels?: LevelKind[]; told?: boolean; prompt?: boolean }

/** when this machine's tasks may start, and when its coordinator hears that the machine struggles (health.ts) */
export interface MachineLimits {
  /** tasks at work at once */
  max: number | null
  /** new tasks wait while the 1-minute load is over this many times the cores, or this much memory is in use (%);
   *  none: not limited by load */
  startLoad: number | null
  startMemory: number | null
  /** the coordinator is told when the load stays over this many times the cores for 2 minutes, memory or a disk is
   *  fuller than this (%), or herdr stops answering; null: that one is off */
  alertLoad: number | null
  alertMemory: number | null
  alertDisk: number | null
  alertHerdr: boolean
}

const CORES: Num = { min: 0.1, max: 20, step: 0.05, unit: '× cores' }
const PCT: Num = { min: 1, max: 100, unit: '%' }

const agentRows = (group: string, role: string, cli: string[], model: string, effort: string): Row[] => [
  { group, label: 'Agent', key: `${role}.agent`, value: cli[0], options: cli },
  { group, label: 'Model', key: `${role}.model`, value: model, text: true },
  { group, label: 'Effort', key: `${role}.effort`, value: effort, options: [...EFFORTS] },
]

/** the Settings page of Autopilot's heartbeat */
export const AUTOPILOT = 'Autopilot'

/** settings from before review was on or off and waiting for GitHub's checks a way to merge: as they are now */
function upgrade(v: Values): Values {
  const out = { ...v }
  // the heartbeat's interval and quiet hours, from before its trigger: one time rule (heartbeats() made it, with what
  // the levels above set)
  if (out['heartbeat.every'] || out['heartbeat.quiet']) {
    const rule = fromEvery(out['heartbeat.every'] ?? '30 min', out['heartbeat.quiet'] ?? 'off')
    if (rule) out['heartbeat.when'] ??= rule
    delete out['heartbeat.every']
    delete out['heartbeat.quiet']
  }
  if (/^[1-9]\d* rounds?$/.test(out['brief.review'] ?? '')) out['brief.review'] = 'on'
  if (out['brief.waitChecks'] === 'on' && out['brief.merge'] !== 'ask me first') out['brief.merge'] = 'after GitHub checks'
  return out
}

/** values kept under their old words: read as today's */
const OLD_VALUES: Record<string, Record<string, string>> = { 'brief.merge': { 'by itself': 'on its own', 'after your yes': 'ask me first' } }

export const CATALOG: Section[] = [
  {
    name: 'Private instructions',
    prompt: true,
    about: 'Personal rules kept outside your repos. Each role follows space → machine → Everywhere; an empty value means no private rules. Adds to team rules; explicit human instructions win. New starts or restarts only. No secrets here.',
    rows: [
      { label: 'Coordinators', key: 'coordinator.instructions', value: '', multiline: true },
      { label: 'Task agents', key: 'task.instructions', value: '', multiline: true },
      { label: 'Reviewers', key: 'reviewer.instructions', value: '', multiline: true },
    ],
  },
  {
    // what Shepherdr adds to the end of every new task's brief
    name: 'How tasks work',
    told: true,
    about: "Each new task's brief ends with these in its Settings block, each as the line shown. To change one for a single task, tell its coordinator.",
    rows: [
      // on: the brief's Review line asks the task's agent for a fresh-eyes review before it merges
      { label: 'Review', key: 'brief.review', value: 'on', options: ['on', 'off'] },
      // the reviewer tags each finding; the agent fixes those at or above this one and reviews again, at most so many
      // rounds. Only words in the Review line: what counts as which is the skill's and the reviewer's judgment
      { label: 'Must fix', key: 'review.mustFix', value: 'major', options: [...SEVERITIES] },
      { label: 'Review rounds', key: 'review.rounds', value: '3 rounds', num: { min: 1, max: 10, unit: 'rounds', one: 'round' } },
      // on its own: once its own quick checks pass; GitHub's run on (pull request, main), and main's going red is told
      // to its coordinator (engine.watchMain). After GitHub checks: shepherdr merge waits for them
      { label: 'Merge', key: 'brief.merge', value: 'on its own', options: ['on its own', 'after GitHub checks', 'ask me first'] },
      // only words in the brief's Reviewer line: the task's agent has its change reviewed however it sees fit
      ...agentRows('Reviewer', 'reviewer', [...REVIEWERS], 'default', 'default'),
    ],
  },
  {
    // which agent (CLI), model and effort each kind of agent starts with
    name: 'Agents',
    about: "What each kind of agent starts with. Default is the agent's own model or effort. Backup takes a task over when its agent can't go on. Chat choices need a chat log reader; other installed CLIs cannot show replies here. Headless review is separate.",
    rows: [
      ...agentRows('Tasks', 'task', [...CHAT_CLIS], 'default', 'default'),
      ...agentRows('Coordinators', 'coordinator', [...CHAT_CLIS], 'default', 'default'),
      // a backup agent takes a task over where its agent can't go on (engine.ts cantGoOn)
      { group: 'Backup', label: 'Agent', key: 'task.fallback', value: 'Codex', options: ['off', ...CHAT_CLIS] },
      { group: 'Backup', label: 'Model', key: 'backup.model', value: 'default', text: true },
      { group: 'Backup', label: 'Effort', key: 'backup.effort', value: 'default', options: [...EFFORTS] },
    ],
  },
  {
    // Done tasks put themselves in their place's Archived view this long after they finished (engine.autoArchive)
    name: 'Tasks',
    about: 'Done tasks move to their place\'s Archived list after this long.',
    rows: [{ label: 'Archive Done after', key: 'tasks.archiveAfter', value: '7 days', num: { min: 1, max: 3650, unit: 'days', one: 'day', off: true } }],
  },
  {
    name: AUTOPILOT,
    about: 'One brief, a wake-up schedule and an isolated agent. Turning it on replaces the coordinator and keeps this chat. Access and limits apply to its workers too.',
    rows: [
      { group: 'Wake-up', label: 'When', key: 'heartbeat.when', value: HEARTBEAT_RULE },
      { group: 'Wake-up', label: 'Events', key: 'heartbeat.on', value: 'all news' },
      { group: 'Agent', label: 'Agent', key: 'autopilot.agent', value: 'inherit', options: ['inherit', ...AUTOPILOT_KINDS.map(nameOf)] },
      { group: 'Agent', label: 'Model', key: 'autopilot.model', value: 'inherit', text: true },
      { group: 'Agent', label: 'Effort', key: 'autopilot.effort', value: 'inherit', options: ['inherit', ...EFFORTS] },
      { group: 'Access and limits', label: 'Permission profile', key: 'autopilot.access', value: 'Isolated workspace', options: ['Isolated workspace'] },
      { group: 'Access and limits', label: 'Network hosts (HTTPS)', key: 'autopilot.hosts', value: 'api.openai.com, chatgpt.com, api.anthropic.com', text: true },
      { group: 'Access and limits', label: 'Available secrets (names)', key: 'autopilot.secrets', value: '', text: true },
      { group: 'Access and limits', label: 'Human approval required', key: 'autopilot.approvals', value: 'merge', options: ['merge', 'none'] },
      { group: 'Access and limits', label: 'Shared HTTPS allowance', key: 'autopilot.traffic', value: 'off', num: { min: 1, max: 1000000, off: true, unit: 'MiB' } },
      { group: 'Access and limits', label: 'Shared reported tokens', key: 'autopilot.tokens', value: 'off', num: { min: 1, max: 1000000000, off: true } },
      { group: 'Access and limits', label: 'Shared runtime', key: 'autopilot.runtime', value: 'off', num: { min: 1, max: 10080, off: true, unit: 'min' } },
      { group: 'Access and limits', label: 'Maximum parallel tasks', key: 'autopilot.parallel', value: '3', num: { min: 1, max: 200 } },
    ],
  },
  {
    // each machine's own: when its tasks may start (engine.release holds the rest as Queued) and when its coordinator
    // hears that it struggles (health.ts). Load is the 1-minute load average, in multiples of the machine's cores
    name: 'Machine',
    levels: ['all', 'machine'],
    about: "When a machine starts more tasks, and when its coordinator hears that it struggles. Set one machine's own to fit its cores and memory.",
    rows: [
      { group: 'Working tasks', label: 'Max tasks working at once', key: 'machine.maxTasks', value: '10', num: { min: 1, max: 200 } },
      { group: 'Working tasks', label: 'Wait while CPU load is over', key: 'machine.startLoad', value: '1× cores', num: CORES },
      { group: 'Working tasks', label: 'Wait while memory is over', key: 'machine.startMemory', value: '80%', num: PCT },
      { group: 'Tell its coordinator when', label: 'CPU load stays over (2 min)', key: 'machine.alertLoad', value: '1.5× cores', num: { ...CORES, off: true } },
      { group: 'Tell its coordinator when', label: 'Memory is over', key: 'machine.alertMemory', value: '90%', num: { ...PCT, off: true } },
      { group: 'Tell its coordinator when', label: 'Disk is over', key: 'machine.alertDisk', value: '90%', num: { ...PCT, off: true } },
      { group: 'Tell its coordinator when', label: 'herdr stops answering', key: 'machine.alertHerdr', value: 'on', options: ['on', 'off'] },
    ],
  },
  {
    // a task's shared browser closes after this long with no agent command and no one watching it in its Browser panel
    // (browser.ts closeIdle); its sign-ins stay, and the next command or a look starts it again
    name: 'Browser',
    about: "A task's browser closes after this long with no agent using it and no one watching it, so it stops using CPU. Sign-ins stay; the agent's next command or opening the Browser panel starts it again.",
    rows: [{ label: 'Close idle browser after', key: 'browser.idleClose', value: '10 min', num: { min: 1, max: 1440, unit: 'min', off: true } }],
  },
  {
    // what buzzes from each place's coordinator chat (shared/alerts.ts notifies); a machine's or space's own is set from its row's menu
    name: 'Notify',
    about: "Which alerts a place's coordinator chat sends you. All: every new message too. Needs me: its questions and alerts. Off: none, and its row stays quiet. Tasks alert you either way. A place can set its own from its menu in the sidebar.",
    rows: [{ label: 'Notify', key: NOTIFY_KEY, value: NOTIFY_DEFAULT, options: [...NOTIFY] }],
  },
  {
    // the zone every time rule's times are in: Autopilot's heartbeats and automations
    name: 'Time zone',
    levels: ['all'],
    about: 'The time zone of every schedule: heartbeats and automations, on every machine.',
    rows: [{ label: 'Time zone', key: 'time.zone', value: OWN_ZONE, text: true }],
  },
  {
    name: 'Alerts and voice',
    levels: ['all'],
    about: 'The same on every machine and space.',
    rows: [
      { label: 'Alerts on', key: 'alerts', value: 'No device yet', options: ['Add this device'] },
      { label: 'Voice agent', key: 'voice.service', value: 'ElevenLabs', options: ['ElevenLabs'] },
    ],
  },
]

/** the CLI a role's agent runs, by these settings: its herdr kind; nothing for an unset backup */
const roleKind = (role: Role, get: (key: string) => string) => kindOf(get(role === 'backup' ? 'task.fallback' : `${role}.agent`)) ?? (role === 'backup' ? undefined : 'claude')

/** a role's Model and Effort rows as its CLI has them, by these settings (r.value is the row's own): a pick of its
 *  models and of the levels its model takes, each showing what it starts with (a level the model lacks shows as the
 *  nearest it has); a CLI that can't list its models takes any id; one Shepherdr passes neither to picks its own */
export function agentRow(r: Row, get: (key: string) => string): Row {
  const [role, what] = r.key.split('.') as [Role, string]
  if (!ROLES.includes(role) || (what !== 'model' && what !== 'effort')) return r
  const kind = roleKind(role, get)
  const c = kind ? modelsOf(kind) : undefined
  if (!kind || !c) return { ...r, value: kind ? `${CLI_NAME[kind] ?? kind}'s own` : 'off', fixed: true, text: false }
  const stored = get(`${role}.model`)
  const model = findModel(kind, stored)
  if (what === 'model') {
    if (!c.models.length) return { ...r, value: stored }
    const labels = c.models.map((m) => m.label)
    return { ...r, text: false, value: model?.label ?? 'default', options: ['default', ...labels, ...(model && !labels.includes(model.label) ? [model.label] : [])] }
  }
  const levels = effortsOf(kind, stored)
  if (!levels.length) return { ...r, value: 'none', fixed: true }
  return { ...r, value: effortFor(kind, r.value, stored) ?? 'default', options: ['default', ...levels] }
}

const ROWS = CATALOG.flatMap((s) => s.rows)
const KEYS = ROWS.map((r) => r.key)

export function defaultOf(key: string) {
  return ROWS.find((r) => r.key === key)?.value
}

/** a level defaults are set at: Everywhere, this machine, or one of its spaces */
export type LevelKind = 'all' | 'machine' | 'space'
export type Level = 'all' | 'machine' | { space: string }

const kindOfLevel = (l: Level): LevelKind => (typeof l === 'string' ? l : 'space')
const levelsOf = (key: string): LevelKind[] => CATALOG.find((s) => s.rows.some((r) => r.key === key))?.levels ?? ['all', 'machine', 'space']

type Values = Record<string, string>
export interface Stored {
  everywhere: Values
  machine: Values
  spaces: Record<string, Values>
}

/** the defaults you set, at their levels */
export class Settings {
  private d: Stored

  /** seed: these values, kept only in memory (the demo's) */
  constructor(private seed?: Stored) {
    const raw = (seed ?? readJson<Record<string, unknown>>('settings.json', {})) as Record<string, unknown>
    const keep = (v: unknown) => Object.fromEntries(Object.entries(upgrade((v ?? {}) as Values)).filter(([k, x]) => KEYS.includes(k) && typeof x === 'string' && !refuse(k, x))) as Values
    if (raw.everywhere) {
      // the space level was the project level before spaces came (read here too: Settings may start before migrate.ts)
      const spaces = (raw.spaces ?? raw.projects ?? {}) as Record<string, unknown>
      heartbeats([raw.everywhere as Values, (raw.machine ?? {}) as Values], Object.values(spaces) as Values[])
      this.d = { everywhere: keep(raw.everywhere), machine: keep(raw.machine), spaces: Object.fromEntries(Object.entries(spaces).map(([k, v]) => [k, keep(v)])) }
      // settings no longer kept (Autopilot's old limits and wake picks) leave the file too
      if (JSON.stringify(this.d) !== JSON.stringify(raw)) this.save()
      return
    }
    // settings.json once held one level, set Everywhere (and before that scopes, many task settings and one CLI for
    // every agent): its values go to All machines, but a machine's capacity was each machine's own and stays so
    const all = (typeof raw.all === 'object' && raw.all ? raw.all : raw) as Record<string, unknown>
    const one = all.agent ?? all['coordinator.agent'] ?? (typeof all['worker.agent'] === 'string' ? all['worker.agent'].split(' · ')[0] : undefined)
    if (typeof one === 'string') {
      all['task.agent'] ??= one
      all['coordinator.agent'] ??= one
    }
    for (const [k, old] of Object.entries(OLD_VALUES)) if (typeof all[k] === 'string' && old[all[k]]) all[k] = old[all[k]]
    const old = keep(all)
    const mine = (k: string) => k.startsWith('machine.')
    this.d = {
      everywhere: Object.fromEntries(Object.entries(old).filter(([k]) => !mine(k))),
      machine: Object.fromEntries(Object.entries(old).filter(([k]) => mine(k))),
      spaces: {},
    }
  }

  private save() {
    if (!this.seed) writeJson('settings.json', this.d)
  }

  /** the values set at one level */
  private at(l: Level): Values {
    return l === 'all' ? this.d.everywhere : l === 'machine' ? this.d.machine : (this.d.spaces[l.space] ?? {})
  }

  /** a key's value at a level and where it comes from: that level, one above it, or Shepherdr's own default */
  pick(key: string, l: Level = 'machine'): { value: string; from: LevelKind | 'default' } {
    const ok = levelsOf(key)
    const chain: Level[] = l === 'all' ? ['all'] : l === 'machine' ? ['machine', 'all'] : [l, 'machine', 'all']
    for (const x of chain) {
      const v = ok.includes(kindOfLevel(x)) ? this.at(x)[key] : undefined
      if (v !== undefined) return { value: v, from: kindOfLevel(x) }
    }
    return { value: defaultOf(key) ?? '', from: 'default' }
  }

  /** a key's value for a space of this machine (none: the machine's own) */
  get(key: string, space?: string): string {
    return this.pick(key, space ? { space } : 'machine').value
  }

  /** set (or with null, unset) a value at a level (Everywhere when none); refused values say why */
  set(key: string, value: string | null, l: Level = 'all'): { ok: boolean; error?: string } {
    if (!KEYS.includes(key)) return { ok: false, error: `No setting ${key}` }
    if (!levelsOf(key).includes(kindOfLevel(l))) return { ok: false, error: levelsOf(key).includes('machine') ? `${key} is set Everywhere or for one machine, not a space.` : `${key} is set Everywhere only.` }
    if (value !== null) {
      const chat = key === 'task.agent' || key === 'coordinator.agent' || key === 'autopilot.agent' && value !== 'inherit' || (key === 'task.fallback' && value.trim().toLowerCase() !== 'off')
      const err = refuse(key, value) ?? (chat ? chatProblem(kindOf(value) ?? value) : undefined) ?? this.unfit(key, value, l)
      if (err) return { ok: false, error: err }
      const num = numOf(key)
      // a number is kept with its unit, however it was written ("13", "1.5x", "80 %")
      if (num) value = numValue(num, value)!
      else if (key === 'heartbeat.when') value = timeRule(value)
      else if (key === 'heartbeat.on') value = eventsText(eventRules(value))
      else if (key === 'time.zone') value = value.trim()
      // a CLI is kept by its name, however it was written
      else if (key === 'task.fallback' && value.trim().toLowerCase() === 'off') value = 'off'
      else if ((key.endsWith('.agent') || key === 'task.fallback') && value !== 'inherit') value = CLI_NAME[kindOf(value)!]
    }
    const at = typeof l === 'object' ? (this.d.spaces[l.space] ??= {}) : this.at(l)
    if (value === null) delete at[key]
    else at[key] = value
    if (typeof l === 'object' && !Object.keys(at).length) delete this.d.spaces[l.space]
    this.save()
    return { ok: true }
  }

  /** the Everywhere level, as the main machine hands it to the others */
  everywhere(): Values {
    return { ...this.d.everywhere }
  }

  /** take the main machine's Everywhere level (this one is not the main one) */
  adopt(all: Values) {
    const next = Object.fromEntries(Object.entries(all).filter(([k, v]) => KEYS.includes(k) && typeof v === 'string' && !refuse(k, v)))
    if (JSON.stringify(next) === JSON.stringify(this.d.everywhere)) return false
    this.d.everywhere = next
    this.save()
    return true
  }

  /** the CLI a role's agent runs at a level: its herdr kind; nothing for an unset backup */
  kindOf(role: Role, l: Level = 'machine'): string | undefined {
    return roleKind(role, (k) => this.pick(k, l).value)
  }

  /** why a model or effort doesn't fit the role's CLI (or its model) at a level: it lists what does */
  private unfit(key: string, value: string, l: Level): string | undefined {
    const [role, what] = key.split('.') as [Role, string]
    if (!ROLES.includes(role) || (what !== 'model' && what !== 'effort') || value.trim().toLowerCase() === 'default') return undefined
    const kind = this.kindOf(role, l)
    if (!kind || !modelsOf(kind)) return undefined
    if (what === 'model') return knowsModels(kind) && !findModel(kind, value) ? `${CLI_NAME[kind]} has no model ${value}. Pick one of: default · ${modelsOf(kind)!.models.map((m) => m.label).join(' · ')}.` : undefined
    const model = this.pick(`${role}.model`, l).value
    const levels = effortsOf(kind, model)
    if (levels.includes(value.trim().toLowerCase())) return undefined
    return levels.length ? `${findModel(kind, model)?.label ?? CLI_NAME[kind]} takes ${['default', ...levels].join(' · ')}.` : `${findModel(kind, model)?.label ?? CLI_NAME[kind]} has no effort levels.`
  }

  /** what every new brief is told about how to work, for a space (none: this machine), with what the coordinator set
   *  for one task (task add --set) on top */
  ways(space?: string, set: Values = {}): Ways {
    return this.waysAt(space ? { space } : 'machine', set)
  }

  private waysAt(l: Level, set: Values = {}): Ways {
    const get = (key: string) => set[key] ?? this.pick(key, l).value
    const merge = get('brief.merge')
    const rounds = Number.parseInt(get('review.rounds'), 10)
    return {
      review: get('brief.review') !== 'off',
      mustFix: get('review.mustFix'),
      rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 3,
      merge: merge === 'ask me first' ? merge : 'on its own',
      waitChecks: merge === 'after GitHub checks',
    }
  }

  /** who set each line of a brief's Settings block that differs from Shepherdr's own default, for a space (none: this
   *  machine): the coordinator for this one task (set), else the most specific level it comes from */
  setBy(space?: string, set: Values = {}): Partial<Record<Said, SetBy>> {
    return this.setByAt(space ? { space } : 'machine', set)
  }

  private setByAt(l: Level, set: Values = {}): Partial<Record<Said, SetBy>> {
    const by = (...keys: string[]): SetBy | undefined => {
      if (keys.some((k) => k in set)) return 'task'
      const froms = keys.map((k) => ({ ...this.pick(k, l), key: k })).filter((p) => p.from !== 'default' && p.value !== defaultOf(p.key)).map((p) => p.from)
      return (['space', 'machine', 'all'] as const).find((f) => froms.includes(f))
    }
    const all: Record<Said, SetBy | undefined> = {
      review: by('brief.review'),
      reviewer: by('reviewer.agent', 'reviewer.model', 'reviewer.effort'),
      mustFix: by('review.mustFix'),
      rounds: by('review.rounds'),
      merge: by('brief.merge'),
      agent: by('task.agent', 'task.model', 'task.effort'),
    }
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as Partial<Record<Said, SetBy>>
  }

  /** A launch snapshot, with the same per-role inheritance as other settings. Never part of a task's saved brief. */
  instructions(role: 'coordinator' | 'task' | 'reviewer', space?: string): string {
    const p = this.pick(`${role}.instructions`, space ? { space } : 'machine')
    const scope = { all: 'Everywhere', machine: 'this machine', space: `space ${space}`, default: 'default' }[p.from]
    return `Private instructions for ${role} (from ${scope}):\n${p.value.trim() || '(none)'}`
  }

  /** Autopilot's heartbeat at a level */
  heartbeat(l: Level = 'machine'): Heartbeat {
    return { time: this.pick('heartbeat.when', l).value, on: eventRules(this.pick('heartbeat.on', l).value), zone: this.zone() }
  }

  pilot(space?: string): PilotConfig {
    const get = (key: string) => this.get(`autopilot.${key}`, space)
    const base = this.harness('coordinator', space)
    const kind = get('agent') === 'inherit' ? base.kind : kindOf(get('agent'))!
    const problem = pilotProblem(kind)
    if (problem) throw new Error(problem)
    const model = get('model') === 'inherit' ? base.model : modelArg(kind, get('model'))
    if (model && knowsModels(kind) && !findModel(kind, model)) throw new Error(`Choose a model for ${CLI_NAME[kind]}, or set its Autopilot model to default.`)
    const effort = get('effort') === 'inherit' ? base.effort : get('effort') === 'default' ? undefined : get('effort')
    if (effort && !effortsOf(kind, model).includes(effort)) throw new Error(`${CLI_NAME[kind]} does not support ${effort} effort with this model.`)
    const num = (key: string) => Number.parseFloat(get(key)) || undefined
    return { harness: { kind, model, effort }, reviewer: this.harness('reviewer', space), hosts: hostList(get('hosts')), secrets: get('secrets').split(/[\s,]+/).filter(Boolean), approvals: get('approvals') === 'none' ? [] : ['merge'], traffic: num('traffic') ? num('traffic')! * 1048576 : undefined, tokens: num('tokens'), runtime: num('runtime') ? num('runtime')! * 60000 : undefined, parallel: num('parallel') ?? 3 }
  }

  /** the time zone of every time rule */
  zone() {
    return this.pick('time.zone', 'all').value
  }

  /** how long a task's shared browser may sit idle before it closes, in ms, at a level; null: it never does */
  idleClose(l: Level = 'machine'): number | null {
    const n = Number.parseFloat(this.pick('browser.idleClose', l).value)
    return Number.isFinite(n) && n > 0 ? n * 60_000 : null
  }

  /** when this machine's tasks may start, and when its coordinator is told it struggles, as numbers */
  machine(l: 'all' | 'machine' = 'machine'): MachineLimits {
    const get = (key: string) => this.pick(key, l).value
    const num = (key: string) => {
      const n = Number.parseFloat(get(key))
      return Number.isFinite(n) && n > 0 ? n : null
    }
    return {
      max: Math.max(1, Math.round(num('machine.maxTasks') ?? 10)),
      startLoad: num('machine.startLoad'),
      startMemory: num('machine.startMemory'),
      alertLoad: num('machine.alertLoad'),
      alertMemory: num('machine.alertMemory'),
      alertDisk: num('machine.alertDisk'),
      alertHerdr: get('machine.alertHerdr') !== 'off',
    }
  }

  /** the CLI, model and effort tasks or coordinators start with, or tasks are reviewed by, for a space (none: this
   *  machine); nothing for a CLI's own default */
  harness(role: 'task' | 'coordinator' | 'reviewer', space?: string): { kind: string; model?: string; effort?: string } {
    return this.harnessAt(role, space ? { space } : 'machine')
  }

  private harnessAt(role: 'task' | 'coordinator' | 'reviewer', l: Level) {
    const kind = this.kindOf(role, l)!
    return { kind, ...this.modelAt(role, kind, l) }
  }

  /** a role's model and effort as its CLI takes them, for a space (none: this machine): one it doesn't have is its
   *  own default, a level its model lacks the nearest it has; nothing for the CLI's own */
  modelOf(role: Role, kind?: string, space?: string): { model?: string; effort?: string } {
    const l: Level = space ? { space } : 'machine'
    return this.modelAt(role, kind ?? this.kindOf(role, l), l)
  }

  private modelAt(role: Role, kind: string | undefined, l: Level): { model?: string; effort?: string } {
    const stored = this.pick(`${role}.model`, l).value
    if (!kind) return {}
    const model = stored === 'default' ? undefined : knowsModels(kind) ? findModel(kind, stored)?.id : modelsOf(kind) ? stored : undefined
    return { model, effort: effortFor(kind, this.pick(`${role}.effort`, l).value, model) }
  }

  /** every key with its value for a space (none: this machine) and where it comes from, as shepherdr show prints
   *  them */
  lines(space?: string, host = 'this machine') {
    const l: Level = space ? { space } : 'machine'
    const name = { space: 'this space', machine: host, all: 'Everywhere', default: 'default' }
    const keys = (told: boolean) =>
      CATALOG.filter((s) => !!(s.told || s.prompt) === told).flatMap((s) => s.rows.filter((r) => r.key !== 'alerts').map((r) => {
        const p = this.pick(r.key, l)
        // a trigger in words, as the human hears it; the rule as kept under it, for an agent to change
        const words = this.words(r.key, p.value)
        return words ? `${r.key.padEnd(22)} ${words.trim()}  (${name[p.from]})\n${''.padEnd(23)}as written: ${p.value}` : `${r.key.padEnd(22)} ${p.value}  (${name[p.from]})`
      }))
    return `What agents are told (private launch instructions and new briefs):\n${keys(true).join('\n')}\n\nHow Shepherdr runs:\n${keys(false).join('\n')}`
  }

  /** a trigger setting in plain words, on a line after its value; nothing for the others */
  words(key: string, value: string) {
    if (key === 'heartbeat.when') {
      const next = nextWords(value, this.zone())
      return `\n${''.padEnd(23)}${timeWords(value, this.zone())}${next.length ? `; next ${next.join(', ')}` : ''}`
    }
    return key === 'heartbeat.on' ? `\n${''.padEnd(23)}${eventWords(eventRules(value))}` : ''
  }

  /** a trigger row as Settings shows it: in words, its next runs, and its few ready-made picks */
  private triggerRow(key: string, value: string): { trigger?: TriggerRow } {
    if (key === 'heartbeat.when') return { trigger: { words: timeWords(value, this.zone()), next: nextWords(value, this.zone()), presets: HEARTBEAT_PRESETS } }
    if (key === 'heartbeat.on') return { trigger: { words: eventWords(eventRules(value)), next: [], presets: NEWS_PRESETS } }
    return {}
  }

  /** the pages of every level this machine holds: Everywhere (the main machine's, which its others share), this
   *  machine, and each of its spaces. `checklist`: the HEARTBEAT.md of a level's place (its id), shown last under
   *  Autopilot */
  sections(devices: string[], machines: { name: string; state: string }[], plugins: SettingSection | null, host = 'this machine', spaces: string[] = [], name = host, checklist?: (place: string) => string, pushWarnings: string[] = []): SettingSection[] {
    const levels: { l: Level; id: string }[] = [
      { l: 'all', id: 'all' },
      { l: 'machine', id: `m:${host}` },
      ...spaces.map((space) => ({ l: { space } as Level, id: `p:${host}:${space}` })),
    ]
    const fromName = (f: LevelKind | 'default') => (f === 'machine' ? name : 'Everywhere')
    const above = (l: Level): Level | null => (l === 'all' ? null : l === 'machine' ? 'all' : 'machine')
    const rows = (s: Section, l: Level) => {
      // the words each row of How tasks work adds to a brief, as its Settings block has them at this level
      const told = s.told ? settingsLines('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) : []
      const text = (said: Said) => told.find((x) => x.said === said)?.text
      const lines: Record<string, string | undefined> = s.told
        ? { 'brief.review': text('review'), 'reviewer.agent': text('reviewer'), 'review.mustFix': text('mustFix'), 'review.rounds': text('rounds'), 'brief.merge': text('merge') }
        : {}
      return s.rows.map((r) => {
        if (r.key === 'alerts') return { ...r, value: devices.length ? devices.join(', ') : 'No device yet', warn: pushWarnings.length ? `${pushWarnings.length} device${pushWarnings.length === 1 ? '' : 's'} could not receive the last alert.\n${pushWarnings.slice(0, 3).join('\n')}${pushWarnings.length > 3 ? '\nMore details: shepherdr doctor' : ''}` : undefined }
        const p = this.pick(r.key, l)
        const here = p.from === kindOfLevel(l)
        const up = above(l)
        // set here: what a reset goes back to; not set here: where its value comes from
        const back = up ? this.pick(r.key, up) : { value: defaultOf(r.key) ?? '', from: 'default' as const }
        return {
          ...agentRow({ ...r, value: p.value }, (k) => this.pick(k, l).value),
          ...(lines[r.key] ? { line: lines[r.key] } : {}),
          ...this.triggerRow(r.key, p.value),
          ...(here ? { inherits: { value: back.value, from: back.from === 'default' && l === 'all' ? 'Default' : fromName(back.from) } } : l === 'all' ? {} : { from: fromName(p.from) }),
        }
      })
    }
    const note = (s: Section, l: Level) =>
      s.name === 'Private instructions'
        ? { noteTitle: 'When rules take effect', note: 'Used at the next start or restart. Saving leaves running agents alone. A resumed session may remember old rules: the new snapshot replaces those private rules. Task agents pass the reviewer snapshot from their own latest start to each review; restart the task agent to refresh it.' }
        : s.name === 'How tasks work'
          ? { note: settingsBlock('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) }
        : s.name === AUTOPILOT
          ? {}
          : s.name === 'Machine'
            ? machineNote(this.machine(l === 'all' ? 'all' : 'machine'))
            : {}
    // each space's own HEARTBEAT.md, after the heartbeat's rows: a file, not a default its levels pass down
    const withChecklist = (s: Section, list: SettingSection['rows'], id: string): SettingSection['rows'] =>
      s.name === AUTOPILOT && checklist && id.startsWith('p:') ? [{ label: 'Heartbeat', key: 'heartbeat.md', value: checklist(id), doc: true }, ...list] : list
    return [
      ...levels.flatMap(({ l, id }) =>
        CATALOG.filter((s) => (s.levels ?? ['all', 'machine', 'space']).includes(kindOfLevel(l))).map((s) => ({
          name: s.name,
          about: s.about,
          rows: withChecklist(s, rows(s, l), id),
          ...note(s, l),
          level: id,
          ...(s.levels?.length === 1 ? { global: true } : {}),
          ...(s.told || s.prompt ? { told: true } : {}),
          ...(l === 'all' ? {} : { machine: host }),
        })),
      ),
      ...(plugins ? [plugins] : []),
      { name: 'Machines', about: 'Every machine Shepherdr reaches, and how it is now.', rows: machines.map((m) => ({ label: m.name, key: '', value: m.state, fixed: true })) },
    ]
  }
}

/** the old heartbeat interval and quiet hours of each level, as one time rule there, filled in with what the levels
 *  above it set (a space's quiet hours keep Everywhere's 45 minutes); in place, before upgrade() reads each level */
function heartbeats(above: Values[], spaces: Values[]) {
  const KEYS = ['heartbeat.every', 'heartbeat.quiet']
  const chain = (levels: Values[]) => {
    const own = levels.at(-1)!
    if (!KEYS.some((k) => own[k]) || own['heartbeat.when']) return
    const of = (k: string) => [...levels].reverse().find((l) => l[k])?.[k]
    own['heartbeat.every'] ??= of('heartbeat.every') ?? '30 min'
    own['heartbeat.quiet'] ??= of('heartbeat.quiet') ?? 'off'
  }
  chain([above[0]])
  chain(above)
  for (const sp of spaces) if (sp) chain([...above, sp])
}

/** an old heartbeat interval ("30 min", "off") and quiet hours ("22:00-07:00") as a time rule: every so often, in the
 *  whole hours outside the quiet ones */
function fromEvery(every: string, quiet: string): string | undefined {
  if (every.trim().toLowerCase() === 'off') return 'off'
  const n = Number.parseInt(every, 10)
  if (!Number.isFinite(n) || n < 1) return undefined
  const q = quiet.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
  const [from, to] = q ? [+q[1] * 60 + +q[2], +q[3] * 60 + +q[4]] : [0, 0]
  const isQuiet = (t: number) => (from <= to ? t >= from && t < to : t >= from || t < to)
  // an hour with any quiet minute in it is left out: never a heartbeat in quiet hours
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => !q || !Array.from({ length: 60 }, (_, m) => h * 60 + m).some(isQuiet))
  try {
    return timeRule(`FREQ=MINUTELY;INTERVAL=${n}${q && hours.length ? `;BYHOUR=${hours.join(',')}` : ''}`)
  } catch {
    return undefined
  }
}

/** what Autopilot does on its own, and never does, as the human reads it under its Settings; coordinators read the
 *  same rules in their skill (skill/shepherdr-coordinator) */
const AUTOPILOT_DOES = [
  'Goes through its HEARTBEAT.md each heartbeat while idle, and says nothing when nothing needs it',
  "Answers task agents' questions it can answer from the brief or the space",
  'Has conflicts rebased and failed checks fixed',
  'Starts queued tasks and closes tasks whose work is over',
  'Adds small follow-up fix tasks for what reviews, proofs or a red main found',
  'Switches itself off and tells you why when things keep breaking',
]
const AUTOPILOT_NEVER = ['Deletes tasks', 'Changes Settings', 'Starts work nobody asked for', 'Force-pushes', 'Merges past a brief\'s "ask me first"']

/** under Autopilot's rows: what it does on its own, and never does */
export const autopilotNote = () => ({
  noteTitle: 'On its own it',
  note: `${AUTOPILOT_DOES.map((x) => `- ${x}`).join('\n')}\n\nIt never ${AUTOPILOT_NEVER.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join(', ').replace(/, ([^,]+)$/, ' or $1')}.`,
})

/** under a machine's rows: why the defaults are what they are, in this machine's own numbers */
export function machineNote(l: MachineLimits, cores = cpus().length, memGb = Math.round(totalmem() / 2 ** 30)) {
  const load = (x: number | null) => (x === null ? 'off' : `${+(x * cores).toFixed(1)}`)
  const gb = (pct: number | null) => (pct === null ? 'off' : `${Math.round((memGb * pct) / 100)} GB`)
  const now = [
    l.max !== null || l.startLoad !== null
      ? `New tasks wait${l.max !== null ? ` while ${l.max} are at work` : ''}${l.max !== null && l.startLoad !== null ? ', or' : ''}${l.startLoad !== null ? ` while the load is over ${load(l.startLoad)}` : ''}${l.startMemory !== null ? ` or over ${gb(l.startMemory)} of memory is in use` : ''}.`
      : '',
    `Its coordinator hears when the load stays over ${load(l.alertLoad)} for 2 minutes, memory passes ${gb(l.alertMemory)}, home or /tmp is over ${l.alertDisk === null ? 'off' : `${l.alertDisk}%`} full${l.alertHerdr ? ', or herdr stops answering' : ''}.`,
  ].filter(Boolean)
  return {
    noteTitle: 'Why these defaults',
    note: [
      `This machine has ${cores} cores and ${memGb} GB of memory. ${now.join(' ')}`,
      '',
      '- 10 tasks at once: agents run no tests on this machine (GitHub does), so each mostly waits on its model; past about 10 they start to slow each other down.',
      '- Load 1× cores to start: every core is busy then, so one more task only slows the rest.',
      "- Memory 80% to start: room for a test run's peak before the machine starts killing processes.",
      "- Load 1.5× cores for 2 minutes to alert: half again more work than cores, for longer than one test run's spike.",
      '- Memory and disk 90% to alert: close enough to full that something will soon fail.',
      '',
      'Waiting tasks show as Queued and start by themselves, oldest first; while load counts, one at a time, 30 seconds apart, so each one shows in the load. Only working tasks count. Shepherdr never pauses a running task: when told, the coordinator decides.',
    ].join('\n'),
  }
}

/** why a value can't be set, or nothing */
export function refuse(key: string, value: string): string | undefined {
  if (key === 'autopilot.agent' && value === 'inherit') return undefined
  if (key === 'autopilot.hosts') { try { hostList(value); return undefined } catch (e) { return (e as Error).message } }
  if (key === 'autopilot.secrets' && value.split(/[\s,]+/).filter(Boolean).some((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) return 'Use secret names separated by commas.'
  if (key.endsWith('.instructions') && (value.length > 16000 || value.includes('\0'))) return 'Use at most 16,000 characters, without null characters. Keep secrets in Secrets.'
  const cli = key === 'task.agent' || key === 'coordinator.agent' || key === 'autopilot.agent' && value !== 'inherit' || (key === 'task.fallback' && value.trim().toLowerCase() !== 'off')
  if (cli && !kindOf(value)) return `${value} is not an agent herdr can start.`
  if (key === 'reviewer.agent' && !REVIEWERS.includes(CLI_NAME[kindOf(value) ?? ''] ?? '')) return `Pick one of: ${REVIEWERS.join(' · ')}.`
  if (key.endsWith('.model') && !/^[\w.:/@[\] -]+$/.test(value.trim())) return 'Write a model id like claude-opus-5-5, or default.'
  const num = numOf(key)
  if (key === 'heartbeat.when' || key === 'heartbeat.on') {
    try {
      if (key === 'heartbeat.when') timeRule(value)
      else eventRules(value)
    } catch (e) {
      return (e as Error).message
    }
  }
  if (key === 'time.zone' && !validZone(value.trim())) return `${value} is no time zone: write one like Europe/Stockholm.`
  if (num && numValue(num, value) === undefined) return `Write a number from ${num.min} to ${num.max}${num.step ? '' : ' (whole)'}${num.unit ? `, in ${num.unit}` : ''}${num.off ? ', or off' : num.zero ? ' (0 is off)' : ''}.`
  const options = ROWS.find((r) => r.key === key)?.options
  if (options && !cli && key !== 'reviewer.agent' && key !== 'alerts' && key !== 'task.fallback' && !options.includes(value)) return `Pick one of: ${options.join(' · ')}.`
  return undefined
}

const numOf = (key: string) => ROWS.find((r) => r.key === key)?.num

/** task add's --set for one task: a How tasks work key by its Settings key or its short name, and the flag of task
 *  add's own the agent and reviewer keys stand for */
const ONE_TASK: Record<string, string> = { review: 'brief.review', merge: 'brief.merge', mustfix: 'review.mustFix', 'must-fix': 'review.mustFix', rounds: 'review.rounds', 'review-rounds': 'review.rounds' }
const FLAG_OF: Record<string, string> = { 'task.agent': 'agent', 'task.model': 'model', 'task.effort': 'effort', 'reviewer.agent': 'reviewer', 'reviewer.model': 'reviewer-model', 'reviewer.effort': 'reviewer-effort' }

/** one --set key=value: a How tasks work setting for this task as Settings keeps it, the task add flag it stands for
 *  (agent, model, effort, reviewer…), or why it can't be */
export function setForTask(pair: string): { key: string; value: string } | { flag: string; value: string } | { error: string } {
  const eq = pair.indexOf('=')
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
  const told = CATALOG.filter((x) => x.told).flatMap((x) => x.rows.map((r) => r.key))
  const short = name.toLowerCase()
  const key = told.find((k) => k.toLowerCase() === short) ?? ONE_TASK[short] ?? (FLAG_OF[`task.${short}`] && `task.${short}`) ?? (short === 'reviewer' ? 'reviewer.agent' : Object.keys(FLAG_OF).find((k) => k.toLowerCase() === short))
  if (eq < 1 || !key) return { error: `--set takes key=value, a key of: ${[...told.filter((k) => !FLAG_OF[k]), 'agent', 'model', 'effort', 'reviewer', 'reviewer.model', 'reviewer.effort'].join(', ')} (shepherdr show has them)` }
  if (FLAG_OF[key]) return { flag: FLAG_OF[key], value }
  const err = refuse(key, value)
  if (err) return { error: `--set ${name}: ${err}` }
  const num = numOf(key)
  return { key, value: num ? numValue(num, value)! : value }
}

/** a number as it is kept ("7 days", "1.5× cores", "off"), or nothing where it is no number in range */
export function numValue(n: Num, value: string): string | undefined {
  const v = value.trim().toLowerCase()
  if (v === 'off') return n.off || n.zero ? 'off' : undefined
  // its unit (or any word of it) may follow: "13", "13 tasks", "1.5x cores", "80 %"
  const m = v.match(/^(\d+(?:[.,]\d+)?)\s*(?:[×x%]|[a-z][a-z ]*)?\s*(?:cores?)?$/)
  if (!m) return undefined
  const x = Number(m[1].replace(',', '.'))
  if (n.zero && x === 0) return 'off'
  const step = n.step ?? 1
  if (x < n.min || x > n.max || Math.abs(Math.round(x / step) * step - x) > 1e-9) return undefined
  const unit = x === 1 && n.one ? n.one : n.unit
  return unit ? `${x}${unit.startsWith('×') || unit === '%' ? '' : ' '}${unit}` : String(x)
}

export { repositorySection } from './space-settings.ts'
