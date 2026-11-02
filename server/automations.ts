// Automations, as OpenClaw's cron jobs: a space's task template (a title, a brief, and the agent, model and effort it
// starts with) and its trigger (trigger.ts): a time rule, event rules (a task is added, is ready, went wrong, needs you,
// is merged, stalls; main goes red), or both. Each run adds a new task with a fresh agent of its own; it never runs in
// the coordinator's chat (that is Autopilot's heartbeat, heartbeat.ts, on the same kind of trigger).
import { randomUUID } from 'node:crypto'
import type { Automation as AutomationView } from '../shared/types.ts'
import { eventsText, fromSchedule, matches, nextRun, nextWords, triggerWords, type EventRule, type Happened, type Trigger } from './common/trigger.ts'

/** the task each run adds */
export interface Template {
  title: string
  desc?: string
  /** the agent, model and effort its task starts with; none: Settings' */
  agent?: { kind?: string; model?: string; effort?: string }
}

export interface Automation {
  id: string
  /** the space place its tasks are added to */
  place: string
  name: string
  trigger: Trigger
  task: Template
  /** off: paused (a once rule turns itself off once it ran) */
  on: boolean
  /** when it was made, or its time rule last changed: its first run is the rule's first after it */
  since?: number
  /** its last run by its time rule: the next is the rule's first after it (a run on an event or by hand moves it not) */
  timed?: number
  last?: number
  /** its latest runs, oldest first: when, and the task it added or why it couldn't */
  runs?: { at: number; task?: string; error?: string }[]
}

/** runs kept for each automation */
const RUNS = 10

/** an automation from before triggers (schedule: "daily 9:00", cron…; when: an event), as it is now: once, on reading
 *  automations.json. One whose schedule can't be read is dropped */
function upgrade(a: Automation & { schedule?: string; when?: string }): Automation | undefined {
  if (!a.schedule && !a.when) return a
  const { schedule, when, ...rest } = a
  const time = schedule ? fromSchedule(schedule) : undefined
  if (schedule && !time) return undefined
  // a once not run yet that was due while Shepherdr was down still runs, as it did before
  const since = time?.startsWith('once ') && !a.last ? { since: 0 } : {}
  return { ...rest, ...since, trigger: { ...(time ? { time } : {}), ...(when ? { on: [{ event: when as EventRule['event'] }] } : {}) } }
}

/** what saved automations look like now: only task ones, with a trigger */
const kept = (a: Automation | undefined): a is Automation => !!a?.task?.title && !!(a.trigger?.time || a.trigger?.on?.length)

/** a space's name from its place id (p:<machine>:<space>) */
const spaceOf = (place: string) => place.split(':').slice(2).join(':')

export class Automations {
  list: Automation[]

  constructor(private persistence: { read(): (Automation & { schedule?: string; when?: string })[]; write(list: Automation[]): void }) {
    const raw = persistence.read()
    this.list = raw.map(upgrade).filter(kept)
    if (raw.some((a) => a.schedule || a.when) || this.list.length !== raw.length) this.save()
  }

  save() {
    this.persistence.write(this.list)
  }

  find(place: string, name: string) {
    return this.list.find((y) => y.place === place && y.name === name)
  }

  /** a new one, or one of the same name made again (its runs are kept) */
  add(a: Pick<Automation, 'place' | 'name' | 'trigger' | 'task'>, now = Date.now()) {
    check(a)
    const was = this.find(a.place, a.name)
    const x: Automation = { id: was?.id ?? randomUUID().slice(0, 8), on: true, ...a, since: now, ...(was?.runs ? { runs: was.runs } : {}) }
    this.list = [...this.list.filter((y) => y !== was), x]
    this.save()
    return x
  }

  /** change some of what it is: a new time rule or new event rules take the old ones' place */
  edit(place: string, name: string, c: { name?: string; time?: string; on?: EventRule[]; task?: Partial<Template> }, now = Date.now()) {
    const a = this.find(place, name)
    if (!a) throw new Error(`No automation “${name}” here`)
    if (c.name && c.name !== name && this.find(place, c.name)) throw new Error(`There is an automation “${c.name}” already`)
    const trigger: Trigger = { ...a.trigger }
    if (c.time !== undefined) {
      if (c.time === 'off') delete trigger.time
      else trigger.time = c.time
    }
    if (c.on !== undefined) {
      if (c.on.length) trigger.on = c.on
      else delete trigger.on
    }
    const next: Automation = { ...a, ...(c.name ? { name: c.name } : {}), trigger, task: { ...a.task, ...c.task } }
    check(next)
    Object.assign(a, next)
    // a new time rule counts from now: a once that ran, given a new time, runs again
    if (c.time !== undefined) {
      a.since = now
      delete a.timed
    }
    this.save()
    return a
  }

  pause(place: string, name: string, on: boolean) {
    const a = this.find(place, name)
    if (!a) throw new Error(`No automation “${name}” here`)
    a.on = on
    this.save()
    return a
  }

  remove(place: string, name: string) {
    const before = this.list.length
    this.list = this.list.filter((y) => !(y.place === place && y.name === name))
    this.save()
    return before !== this.list.length
  }

  /** the rows a place's Tasks lists at the bottom, paused ones too: its trigger in words, with its next runs */
  view(place: string, zone: string, now = Date.now()): AutomationView[] {
    return this.list
      .filter((a) => a.place === place)
      .map((a) => ({
        name: a.name,
        when: triggerWords(a.trigger, zone, now),
        what: a.task.title,
        ...(a.task.desc ? { brief: a.task.desc } : {}),
        on: a.on,
        ...(a.trigger.time ? { time: a.trigger.time } : {}),
        ...(a.trigger.on?.length ? { events: eventsText(a.trigger.on) } : {}),
        next: a.on ? nextWords(a.trigger.time, zone, now) : [],
        runs: [...(a.runs ?? [])].reverse(),
      }))
  }

  /** the next time an automation runs by its time rule, after its last run by it (or since it was made); none: never */
  next(a: Automation, zone: string, now = Date.now()) {
    return nextRun(a.trigger.time, zone, a.timed ?? a.since ?? now)
  }

  /** time rules due now */
  dueNow(zone: string, now = Date.now()) {
    return this.list.filter((a) => {
      if (!a.on || !a.trigger.time) return false
      // one first seen (made before since was kept) counts from its last run, or from now
      if (a.timed === undefined && a.since === undefined) {
        a.since = a.last ?? now
        this.save()
      }
      const at = this.next(a, zone, now)
      return at !== undefined && at <= now
    })
  }

  /** the ones something that happened sets off: by default only what happens in their own space (a machine's health:
   *  the machine they run on) */
  on(h: Happened, place: string) {
    const own = (a: Automation) => (h.event === 'health' ? undefined : spaceOf(a.place))
    return this.list.filter((a) => a.on && a.trigger.on?.length && matches(a.trigger.on.map((r) => ({ ...r, space: r.space ?? own(a) })), { ...h, space: h.space ?? spaceOf(place) }))
  }

  /** it ran (timed: by its time rule): the task it added, or why it couldn't. A once is over once it ran on time. */
  fired(a: Automation, r: { task?: string; error?: string }, now = Date.now(), timed = false) {
    a.last = now
    if (timed) a.timed = now
    a.runs = [...(a.runs ?? []), { at: a.last, ...r }].slice(-RUNS)
    if (timed && a.trigger.time?.startsWith('once ') && !a.trigger.on?.length) a.on = false
    this.save()
  }
}

/** why an automation can't be as it is */
function check(a: Pick<Automation, 'trigger' | 'task'>) {
  if (!a.trigger?.time && !a.trigger?.on?.length) throw new Error('An automation needs --when "<time rule>" or --on "<events>", or both')
  if (!a.task?.title?.trim()) throw new Error('An automation needs the title of the task it adds: --task "<title>"')
}
