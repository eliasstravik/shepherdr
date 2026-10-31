import type { SettingRow, SettingSection, RestartCli } from '../../shared/types.ts'
import { SPEEDS, TABLE, nearest, parseCodex, type CliModels } from '../../shared/models.ts'
import type { CoreStore } from './store.ts'
import type { CoreFiles } from './files.ts'
import type { MachineLimits } from '../health.ts'
import { timeRule, timeWords, nextWords, eventRules, eventWords, validZone, OWN_ZONE } from '../common/trigger.ts'
import { PILOT_SETTINGS, corePilotConfig } from './pilot-settings.ts'
import { pilotHosts } from './pilot-policy.ts'
import type { AgentKind, CoreSpace } from './model.ts'
import { NOTIFY, NOTIFY_DEFAULT, NOTIFY_KEY } from '../../shared/alerts.ts'
import { MACHINE_CHECK, parseMachineCheck, sameCheck, type CliState, type MachineCheck } from './machine-check.ts'

export type Role = 'coordinator' | 'task' | 'reviewer' | 'backup'
export const CLI_NAME = { claude: 'Claude Code', codex: 'Codex' }
const names = CLI_NAME
export const kindOf = (word: string): AgentKind | undefined => Object.entries(names).find(([kind, name]) => [kind, name.toLowerCase()].includes(word.trim().toLowerCase()))?.[0] as AgentKind | undefined
const roleRows = (role: Role, group: string): SettingRow[] => [
  { group, key: `${role}.agent`, label: 'Agent', value: role === 'reviewer' ? 'Codex' : 'Claude Code', options: Object.values(names) },
  { group, key: `${role}.model`, label: 'Model', value: 'default', text: true },
  { group, key: `${role}.effort`, label: 'Effort', value: 'default', options: ['default', ...TABLE[role === 'reviewer' ? 'codex' : 'claude'].efforts] },
]
// Only implemented controls are offered. Remaining catalog sections stay on the parity checklist until wired.
const CATALOG: SettingSection[] = [
  PILOT_SETTINGS,
  { name: 'Tasks', about: "Done tasks move to their place's Archived list after this long.", rows: [{ label: 'Archive Done after', key: 'tasks.archiveAfter', value: '7 days', num: { min: 1, max: 3650, unit: 'days', one: 'day', off: true } }] },
  { name: 'Notify', about: "Which alerts a place's coordinator chat sends you. All: every new message too. Needs me: its questions and alerts. Off: none, and its row stays quiet. Tasks alert you either way. A place can set its own from its menu in the sidebar.", rows: [{ label: 'Notify', key: NOTIFY_KEY, value: NOTIFY_DEFAULT, options: [...NOTIFY] }] },
  { name: 'Machine', about: "When a machine starts more tasks, and when its coordinator hears that it struggles. Set one machine's own to fit its cores and memory.", rows: [
    { group: 'Working tasks', label: 'Max tasks working at once', key: 'machine.maxTasks', value: '10', num: { min: 1, max: 200 } },
    { group: 'Working tasks', label: 'Wait while CPU load is over', key: 'machine.startLoad', value: '1× cores', num: { min: 0.1, max: 20, step: 0.05, unit: '× cores' } },
    { group: 'Working tasks', label: 'Wait while memory is over', key: 'machine.startMemory', value: '80%', num: { min: 1, max: 100, unit: '%' } },
    { group: 'Tell its coordinator when', label: 'CPU load stays over (2 min)', key: 'machine.alertLoad', value: '1.5× cores', num: { min: 0.1, max: 20, step: 0.05, unit: '× cores', off: true } },
    { group: 'Tell its coordinator when', label: 'Memory is over', key: 'machine.alertMemory', value: '90%', num: { min: 1, max: 100, unit: '%', off: true } },
    { group: 'Tell its coordinator when', label: 'Disk is over', key: 'machine.alertDisk', value: '90%', num: { min: 1, max: 100, unit: '%', off: true } },
    { group: 'Tell its coordinator when', label: 'core stops answering', key: 'machine.alertHerdr', value: 'on', options: ['on', 'off'] },
  ] },
  { name: 'Alerts and voice', global: true, about: 'The same on every machine and space.', rows: [
    { label: 'Alerts on', key: 'alerts', value: 'No device yet', options: ['Add this device'] },
    { label: 'Voice agent', key: 'voice.service', value: 'ElevenLabs', options: ['ElevenLabs'] },
  ] },
  { name: 'Time zone', global: true, about: 'The time zone of every schedule: heartbeats and automations, on every machine.', rows: [{ label: 'Time zone', key: 'time.zone', value: OWN_ZONE, text: true }] },
  { name: 'Browser', about: "A task's browser closes after this long with no agent using it and no one watching it, so it stops using CPU. Sign-ins stay; the agent's next command or opening the Browser panel starts it again.", rows: [{ label: 'Close idle browser after', key: 'browser.idleClose', value: '10 min', num: { min: 1, max: 1440, unit: 'min', off: true } }] },
  { name: 'Private instructions', told: true, about: 'Personal rules kept outside your repos. Each role follows space → machine → Everywhere; an empty value means no private rules. Adds to team rules; explicit human instructions win. New starts or restarts only. No secrets here.', rows: [
    { key: 'coordinator.instructions', label: 'Coordinators', value: '', multiline: true },
    { key: 'task.instructions', label: 'Task agents', value: '', multiline: true },
    { key: 'reviewer.instructions', label: 'Reviewers', value: '', multiline: true },
  ] },
  { name: 'How tasks work', told: true, about: "Each new task's brief ends with these in its Settings block, each as the line shown. To change one for a single task, tell its coordinator.", rows: [
    { key: 'brief.review', label: 'Review', value: 'on', options: ['on', 'off'] },
    { key: 'review.mustFix', label: 'Must fix', value: 'major', options: ['critical', 'major', 'minor', 'trivial'] },
    { key: 'review.rounds', label: 'Review rounds', value: '3 rounds', num: { min: 1, max: 10, unit: 'rounds', one: 'round' } },
    { key: 'brief.merge', label: 'Merge', value: 'on its own', options: ['on its own', 'after GitHub checks', 'ask me first'] },
    ...roleRows('reviewer', 'Reviewer'),
  ] },
  { name: 'Agents', about: "What each kind of agent starts with. Default is the agent's own model or effort. Backup takes a task over when its agent can't go on. Chat choices need a chat log reader; other installed CLIs cannot show replies here. Headless review is separate.", rows: [...roleRows('task', 'Tasks'), ...roleRows('coordinator', 'Coordinators'),
    { group: 'Backup', key: 'task.fallback', label: 'Agent', value: 'Codex', options: ['off', ...Object.values(names)] },
    { group: 'Backup', key: 'backup.model', label: 'Model', value: 'default', text: true },
    { group: 'Backup', key: 'backup.effort', label: 'Effort', value: 'default', options: ['default', ...TABLE.codex.efforts] },
    ] },
]
const SECTION_ORDER = ['Private instructions', 'How tasks work', 'Agents', 'Tasks', 'Autopilot', 'Browser', 'Notify', 'Machine', 'Time zone', 'Alerts and voice']
CATALOG.sort((a, b) => SECTION_ORDER.indexOf(a.name) - SECTION_ORDER.indexOf(b.name))
const rows = CATALOG.flatMap(section => section.rows)
/** Settings whose default is a CLI the machine can really use, not a fixed name. */
const CHOSEN = new Set(['reviewer.agent', 'task.fallback'])
const CHECK_MS = 15 * 60_000, RETRY_MS = 60_000

/** Explicit store + machine identity; importing this module never reads the live installation. */
export class CoreSettings {
  private probing = new Set<string>()
  private tried = new Map<string, number>()
  private unchecked = new Set<string>()
  private saving = false
  constructor(private store: CoreStore, private files: CoreFiles, private spaces: () => CoreSpace[], private machineName: (id: string) => string, private changed: () => void) {}
  private chain(level = 'all'): string[] {
    if (level === 'all') return ['all']
    if (level.startsWith('m:')) return [level, 'all']
    const space = this.spaces().find(item => item.id === level)
    if (!space) throw new Error('No such settings level')
    return [space.id, `m:${space.machine}`, 'all']
  }
  pick(key: string, level = 'all'): { value: string; level: string } {
    for (const at of this.chain(level)) {
      const value = this.store.get<string>('settings', `${at}\0${key}`)
      if (value !== undefined) return { value, level: at }
    }
    return { value: this.fallback(key, level), level: 'default' }
  }
  private fallback(key: string, level: string): string {
    return CHOSEN.has(key) ? this.usableDefault(key, level) : rows.find(row => row.key === key)?.value ?? ''
  }
  /** The machines a level reaches: one, or every machine with a space for Everywhere. */
  private machinesAt(level: string) { return [...new Set(level === 'all' ? this.spaces().map(space => space.machine) : [this.machine(level)!])] }
  private cliAt(kind: AgentKind, machines: string[]): CliState | undefined {
    const states = machines.map(machine => this.store.get<MachineCheck>('machine-check', machine)?.cli[kind])
    return states.find(state => state && state !== 'ready') ?? (states.length && states.every(Boolean) ? 'ready' : undefined)
  }
  /** Another CLI than the task agent's, for fresh eyes and for a backup when its provider cuts out. A reviewer may fall
   *  back on the task agent's own CLI; a backup can't, as a task never fails over to the CLI it runs on. Only a machine
   *  never yet checked keeps the plain order: an answer it couldn't read proves nothing, so that CLI isn't picked. */
  private usableDefault(key: string, level: string, running?: AgentKind) {
    const own = running ?? kindOf(this.get('task.agent', level)) ?? 'claude', other: AgentKind = own === 'claude' ? 'codex' : 'claude', machines = this.machinesAt(level)
    const order = key === 'task.fallback' ? [other] : [other, own]
    // Everywhere only shows it: each space follows its own machine
    const pick = order.find(kind => machines.some(machine => this.cliAt(kind, [machine]) === 'ready')) ?? (machines.some(machine => !this.store.get('machine-check', machine)) ? other : undefined)
    return pick ? names[pick] : key === 'task.fallback' ? 'off' : names[own]
  }
  get(key: string, level = 'all') { return this.pick(key, level).value }
  set(key: string, value: string | null, level = 'all') {
    const row = rows.find(item => item.key === key)
    if (!row) throw new Error(`No setting ${key}`)
    this.chain(level)
    if (key === 'alerts') throw new Error('Use Add this device in Notifications to enable alerts')
    if (key.startsWith('voice.') && level !== 'all') throw new Error('Voice settings apply Everywhere')
    if (key.startsWith('machine.') && level !== 'all' && !level.startsWith('m:')) throw new Error('Machine limits apply Everywhere or to a machine')
    if (key === 'time.zone' && level !== 'all') throw new Error('Time zone applies Everywhere')
    if (value !== null) {
      if (typeof value !== 'string' || value.length > (row.multiline ? 32_000 : key === 'autopilot.hosts' ? 32768 : key === 'autopilot.secrets' ? 16384 : 512)) throw new Error('Setting is too long')
      if (key === 'time.zone') value = value.trim()
      if (key === 'time.zone' && !validZone(value)) throw new Error('Choose a valid time zone, such as Europe/Stockholm')
      if (key === 'heartbeat.when') value = timeRule(value)
      if (key === 'heartbeat.on') { eventRules(value) }
      if (key === 'autopilot.hosts') value = pilotHosts(value.split(/[\s,]+/).filter(Boolean)).join(', ')
      if (key === 'autopilot.secrets' && value.split(/[\s,]+/).filter(Boolean).some(name => !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) throw Error('Use secret names separated by commas')
      if (key.endsWith('.model') && !(key === 'autopilot.model' && value === 'inherit') && value !== 'default' && value) {
        const role = key.split('.')[0] as Role | 'autopilot', kind = this.agent(role, level).kind
        if (this.catalog(kind, level).models.length && !this.findModel(kind, value, level)) throw new Error('Choose a model offered by this agent')
      }
      if (key.endsWith('.agent') || key === 'task.fallback' && value.toLowerCase() !== 'off') {
        const kind = kindOf(value)
        if (!kind && !(key === 'autopilot.agent' && value === 'inherit')) throw new Error('Choose Claude Code or Codex')
        if (kind) value = names[kind]
      } else if (key === 'task.fallback' && value.toLowerCase() === 'off') value = 'off'
      else if (row.num) {
        if ((row.num.off || row.num.zero) && value === 'off') value = 'off'
        else {
          const match = value.match(/^(\d+(?:[.,]\d+)?)(.*)$/), number = Number(match?.[1]?.replace(',', '.')), unit = match?.[2]?.trim().replace(/^x(?=\s|$)/, '×')
          const step = row.num.step ?? 1
          if (!match || unit && ![row.num.unit, row.num.one].includes(unit) || number < row.num.min || number > row.num.max || Math.abs(Math.round(number / step) * step - number) > 1e-9) throw new Error(`Choose ${row.num.min} to ${row.num.max}${row.num.unit ? ' ' + row.num.unit : ''}${row.num.off ? ', or off' : ''}`)
          const suffix = number === 1 ? row.num.one || row.num.unit : row.num.unit
          value = row.num.zero && number === 0 ? 'off' : suffix ? `${number}${suffix.startsWith('×') || suffix === '%' ? '' : ' '}${suffix}` : String(number)
        }
      } else if (row.options && !key.endsWith('.effort') && !row.options.includes(value)) throw new Error('Choose one of the offered values')
      else if (key.endsWith('.effort') && value !== 'default' && !(key === 'autopilot.effort' && value === 'inherit')) {
        const role = key.split('.')[0] as Role, config = this.agent(role, level)
        if (!this.catalog(config.kind, level).efforts.includes(value)) throw new Error('This agent does not offer that effort')
      }
      this.store.set('settings', `${level}\0${key}`, value)
    } else this.store.delete('settings', `${level}\0${key}`)
    if (!this.saving) this.changed()
  }
  pilot(level: string) { return corePilotConfig(this, level) }
  agent(role: Role | 'autopilot', level: string): { kind: AgentKind; model?: string; effort?: string } {
    if (role === 'autopilot') {
      const base = this.agent('coordinator', level), kind = kindOf(this.get('autopilot.agent', level)) ?? base.kind
      const raw = this.get('autopilot.model', level), model = raw === 'inherit' ? base.model : raw === 'default' ? undefined : this.findModel(kind, raw, level)?.id ?? raw
      const effort = this.get('autopilot.effort', level)
      return { kind, model, effort: effort === 'inherit' ? base.effort : effort === 'default' ? undefined : effort }
    }
    return this.harness(role, kindOf(this.get(role === 'backup' ? 'task.fallback' : `${role}.agent`, level)) ?? (role === 'reviewer' || role === 'backup' ? 'codex' : 'claude'), level)
  }
  /** The backup of an agent running on this CLI: the saved one, else by the default's rule from that CLI, as the space's
   *  own default may have changed since it started. Nothing where backup is off. */
  backupFor(level: string, running: AgentKind) {
    const kind = kindOf(this.pick('task.fallback', level).level === 'default' ? this.usableDefault('task.fallback', level, running) : this.get('task.fallback', level))
    return kind && this.harness('backup', kind, level)
  }
  private harness(role: Role, kind: AgentKind, level: string) {
    const raw = this.get(`${role}.model`, level), catalog = this.catalog(kind, level)
    const model = raw === 'default' || !raw ? undefined : this.findModel(kind, raw, level)?.id ?? (!catalog.models.length ? raw : undefined)
    const effort = nearest(catalog.models.find(item => item.id === model)?.efforts ?? catalog.efforts, this.get(`${role}.effort`, level))
    return { kind, model, effort }
  }
  findModel(kind: AgentKind, value: string, level: string) {
    const catalog = this.catalog(kind, level), raw = value.toLowerCase()
    return [...catalog.models, ...catalog.others ?? []].find(item => item.id.toLowerCase() === raw || item.label.toLowerCase() === raw || kind === 'claude' && ['opus', 'sonnet', 'haiku', 'fable'].includes(raw) && item.id.includes(`-${raw}-`))
  }
  launch(role: Role, level: string, kind?: AgentKind) {
    const defaults = this.agent(role, level)
    return !kind || kind === defaults.kind ? defaults : { kind, model: undefined, effort: undefined }
  }
  instructions(role: Role, level: string) {
    const words = this.get(`${role}.instructions`, level)
    return `Private instruction snapshot for this start. This replaces earlier snapshots, including when empty. Explicit human instructions and the brief win over private rules; follow repository/team AGENTS.md, CLAUDE.md and REVIEW.md too. If private and team rules conflict, explain and ask. Never copy private instructions into git, briefs, reports or GitHub. No secrets here.\nPrivate instructions for ${role}:\n${words || '(none)'}\n`
  }
  checkedAgent(level: string, input: { kind: string; model?: string; effort?: string }) {
    const kind = kindOf(input.kind)
    if (!kind) throw Error('Choose Claude Code or Codex')
    const catalog = this.catalog(kind, level), raw = input.model
    const model = !raw || raw === 'default' ? undefined : this.findModel(kind, raw, level)?.id ?? (!catalog.models.length ? raw : undefined)
    if (raw && raw !== 'default' && !model) throw Error('Choose a model offered by this agent')
    const effort = input.effort === 'default' ? undefined : input.effort
    if (effort && !(catalog.models.find(item => item.id === model)?.efforts ?? catalog.efforts).includes(effort)) throw Error('This agent does not offer that effort')
    return { kind, model, effort }
  }
  saveAgent(role: Role | 'autopilot', level: string, input: { kind: string; model?: string; effort?: string }) {
    this.saving = true
    try {
      this.store.db.transaction(() => {
        this.set(`${role}.agent`, input.kind, level)
        this.set(`${role}.model`, input.model || 'default', level)
        this.set(`${role}.effort`, input.effort || 'default', level)
      })()
    } finally { this.saving = false }
    this.changed()
  }
  machineLimits(machine: string): MachineLimits {
    const level = `m:${machine}`, num = (key: string) => { const value = parseFloat(this.get(key, level)); return Number.isFinite(value) ? value : null }
    return { max: num('machine.maxTasks'), startLoad: num('machine.startLoad'), startMemory: num('machine.startMemory'), alertLoad: num('machine.alertLoad'), alertMemory: num('machine.alertMemory'), alertDisk: num('machine.alertDisk'), alertHerdr: this.get('machine.alertHerdr', level) !== 'off' }
  }
  private machine(level: string) { return level.startsWith('m:') ? level.slice(2) : this.spaces().find(item => item.id === level)?.machine }
  catalog(kind: AgentKind, level: string): CliModels {
    const machine = this.machine(level)
    return machine && this.store.get<CliModels>('models', `${machine}:${kind}`) || TABLE[kind]
  }
  clis(level: string): RestartCli[] {
    return (['claude', 'codex'] as const).map(kind => ({ kind, name: names[kind], ...this.catalog(kind, level), speeds: SPEEDS }))
  }
  /** Why a chosen reviewer or backup can't work: which CLI, and where. */
  private cliWarning(key: string, level: string) {
    const value = this.get(key, level), kind = kindOf(value), machines = this.machinesAt(level), what = key === 'reviewer.agent' ? 'Reviews' : 'A backup'
    const chosen = this.pick(key, level).level !== 'default'
    if (key === 'task.fallback' && !chosen) {
      const off = machines.filter(machine => this.usableDefault(key, level === 'all' ? `m:${machine}` : level) === 'off').map(machine => this.machineName(machine) || 'this machine')
      return off.length ? `No other signed-in CLI on ${off.join(', ')}, so tasks there have no backup.` : undefined
    }
    if (!kind) return undefined
    // left to the default on Everywhere, each machine has its own pick
    const bad = machines.flatMap(machine => {
      const cli = chosen || level !== 'all' ? kind : kindOf(this.usableDefault(key, `m:${machine}`)) ?? kind
      const state = this.cliAt(cli, [machine]) ?? (this.unchecked.has(machine) ? 'unchecked' : undefined)
      return state && state !== 'ready' ? [{ machine, cli, state }] : []
    })
    if (!bad.length) return undefined
    const lines = bad.map(({ machine, cli, state }) => `${names[cli]} is ${state === 'missing' ? 'not installed' : state === 'unchecked' ? 'not checked' : 'not signed in'} on ${this.machineName(machine) || 'this machine'}.`)
    return `${lines.join('\n')}\n${what} ${bad.every(item => item.state === 'unchecked') ? 'may not run there: the check failed' : "can't run there until that is fixed, or you choose another agent"}.`
  }
  /** Backup's own row is under Agents: How tasks work repeats it only to warn. */
  private backupRow(level: string): SettingRow[] {
    const warn = this.cliWarning('task.fallback', level)
    return warn ? [{ group: 'Backup', label: 'Agent', key: '', value: this.get('task.fallback', level), fixed: true, warn }] : []
  }
  /** Why Autopilot can't start in a space, by what launch needs; nothing where it can, or before its machine is checked. */
  pilotBlock(level: string): string | undefined {
    const space = this.spaces().find(item => item.id === level)
    if (!space) return undefined
    if (space.home) return "Autopilot needs a repository space. A home space can't run it."
    const check = this.store.get<MachineCheck>('machine-check', space.machine), where = this.machineName(space.machine) || 'this machine'
    const mac = this.get('autopilot.access', level) === 'Mac sandbox'
    if (check?.platform === 'Darwin' && !mac) return `Isolated workspace needs Linux. ${where} runs macOS: choose the Mac sandbox permission profile.`
    if (check?.platform === 'Linux' && mac) return `The Mac sandbox permission profile needs macOS. ${where} runs Linux.`
    if (check?.platform && check.platform !== 'Linux' && check.platform !== 'Darwin') return `Autopilot needs Linux or macOS. ${where} runs ${check.platform}.`
    if (!mac && check?.sandbox === 'missing') return `Autopilot needs bubblewrap, which is not installed on ${where}.`
    if (!mac && check?.sandbox === 'blocked') return `Autopilot's sandbox is blocked on ${where}: its user namespaces are off.`
    if (mac && [this.agent('autopilot', level).kind, kindOf(this.get('reviewer.agent', level))].includes('codex')) return "Codex can't run commands in the Mac sandbox yet. Choose Claude Code for Autopilot's agent and reviewer."
    const kind = this.agent('autopilot', level).kind, state = check?.cli[kind]
    if (state && state !== 'ready') return `Autopilot runs on ${names[kind]}, which is ${state === 'missing' ? 'not installed' : 'not signed in'} on ${where}.`
  }
  sections(devices: string[] = [], pushWarnings: string[] = []): SettingSection[] {
    const levels = ['all', ...new Set(this.spaces().map(space => `m:${space.machine}`)), ...this.spaces().map(space => space.id)]
    return levels.flatMap(level => CATALOG.filter(section => (!section.global || level === 'all') && (level === 'all' || section.name !== 'Time zone') && (section.name !== 'Machine' || level === 'all' || level.startsWith('m:'))).map(section => ({ ...section, level, machine: this.machine(level), rows: [...section.rows.map(row => {
      if (row.key === 'alerts') return { ...row, value: devices.length ? devices.join(', ') : 'No device yet', ...(pushWarnings.length ? { warn: `${pushWarnings.length} device${pushWarnings.length === 1 ? '' : 's'} could not receive the last alert.\n${pushWarnings.slice(0, 3).join('\n')}` } : {}) }
      const picked = this.pick(row.key, level), inherited = this.chain(level).slice(1).map(at => this.pick(row.key, at)).find(value => value.level !== 'default') ?? { value: this.fallback(row.key, level), level: 'default' }
      let dynamic = { ...row }
      if (CHOSEN.has(row.key)) { const warn = this.cliWarning(row.key, level); if (warn) dynamic.warn = warn }
      let value = picked.value
      if (/\.(model|effort)$/.test(row.key)) {
        const role = row.key.split('.')[0] as Role | 'autopilot', config = this.agent(role, level), catalog = this.catalog(config.kind, level)
        if (row.key.endsWith('.model')) {
          dynamic = { ...dynamic, text: !catalog.models.length, options: [...(role === 'autopilot' ? ['inherit'] : []), 'default', ...catalog.models.map(model => model.label)] }
          value = this.findModel(config.kind, picked.value, level)?.label ?? picked.value
          if (picked.value !== 'inherit' && picked.value !== 'default' && picked.value && !config.model) dynamic.warn = 'This model is unavailable for the selected agent. New starts use its default; choose a model or reset this value.'
        }
        else dynamic = { ...dynamic, options: [...(role === 'autopilot' ? ['inherit'] : []), 'default', ...(catalog.models.find(model => model.id === config.model)?.efforts ?? catalog.efforts)] }
      }
      if (row.key === 'heartbeat.when') dynamic.trigger = { words: timeWords(value, this.get('time.zone')), next: nextWords(value, this.get('time.zone')), presets: [{ label: '15 min', value: timeRule('FREQ=MINUTELY;INTERVAL=15') }, { label: '30 min', value: timeRule('FREQ=MINUTELY;INTERVAL=30') }, { label: '1 hour', value: timeRule('FREQ=HOURLY') }, { label: 'Workdays', value: timeRule('FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,10,11,12,13,14,15,16,17;BYDAY=MO,TU,WE,TH,FR') }] }
      if (row.key === 'heartbeat.on') dynamic.trigger = { words: eventWords(eventRules(value)), next: [], presets: [{ label: 'All news', value: 'all news' }, { label: 'None: it waits', value: 'none' }] }
      const words = (at: string) => at === 'default' ? 'Shepherdr’s default' : at === 'all' ? 'Everywhere' : at.startsWith('m:') ? this.machineName(at.slice(2)) : this.spaces().find(space => space.id === at)?.name || at
      return { ...dynamic, value, ...(picked.level === level ? { inherits: { value: inherited.value, from: words(inherited.level) } } : { from: words(picked.level) }) }
    }), ...(section.name === 'How tasks work' ? this.backupRow(level) : [])] })))
  }
  describe(level: string, name?: string) {
    const sections = CATALOG.filter(section => !name || section.name.toLowerCase() === name.toLowerCase())
    if (!sections.length) throw Error('Choose a settings section: ' + CATALOG.map(section => section.name).join(', '))
    const where = (at: string) => at === 'default' ? 'default' : at === 'all' ? 'Everywhere' : at.startsWith('m:') ? this.machineName(at.slice(2)) || at : this.spaces().find(space => space.id === at)?.name || at
    return sections.map(section => `${section.name}:\n${section.rows.filter(row => !row.key.endsWith('.instructions')).map(row => {
      const picked = this.pick(row.key, level)
      return `- ${row.group ? row.group + ' ' : ''}${row.label}: ${picked.value} (${row.key}; from ${where(picked.level)})`
    }).join('\n')}`).join('\n\n') + '\n'
  }
  /** Query the CLI on its own machine, through core only. No app startup dependency. */
  probe(machine: string) {
    this.check(machine)
    if (this.probing.has(machine)) return
    const saved = this.store.get<CliModels>('models', `${machine}:codex`)
    if (saved?.at && Date.now() - saved.at < 6 * 3_600_000) return
    this.probing.add(machine)
    void this.files.exec(machine, ['codex', 'debug', 'models'], undefined, undefined, 20).then(bytes => {
      const catalog = parseCodex(bytes.toString('utf8'))
      if (catalog) { this.store.set('models', `${machine}:codex`, { ...catalog, at: Date.now() }); this.changed() }
    }).catch(() => {}).finally(() => this.probing.delete(machine))
  }
  /** What the machine can run: a failed check keeps the last one, and never counts against a CLI. */
  private check(machine: string) {
    const key = `check:${machine}`, saved = this.store.get<MachineCheck>('machine-check', machine), now = Date.now()
    if (this.probing.has(key) || saved && now - saved.at < CHECK_MS || now - (this.tried.get(machine) ?? 0) < RETRY_MS) return
    this.probing.add(key)
    this.tried.set(machine, now)
    void this.files.exec(machine, ['sh', '-c', MACHINE_CHECK], undefined, undefined, 30).then(bytes => {
      const next = parseMachineCheck(bytes.toString('utf8'))
      if (!next) throw Error('No answer')
      this.store.set('machine-check', machine, next)
      if (!saved || !sameCheck(saved, next) || this.unchecked.delete(machine)) this.changed()
    }).catch(() => {
      if (saved || this.unchecked.has(machine)) return
      this.unchecked.add(machine); this.changed()
    }).finally(() => this.probing.delete(key))
  }
}
