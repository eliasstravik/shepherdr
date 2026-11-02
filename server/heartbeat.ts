// Shared heartbeat state and prompts, with explicit product storage.
import { nextRun } from './common/trigger.ts'
/** the checklist a coordinator starts with, by what it does: a space's work; a home space's its machine's too; the
 *  main machine's home space's every machine's overview too */
export function firstChecklist(role: 'space' | 'home' | 'main') {
  const machine = ['Disk, memory and load: clean up only what is safely finished, pause tasks only when it struggles.', 'Spaces whose tasks are stuck, or that have queued work and room to start it.']
  const items =
    role === 'space'
      ? [
          'Tasks stuck or stalled: look at their chat, then nudge them, stop them or tell the human.',
          'Main red on GitHub: one small fix-forward task, unless one is at work.',
          'Queued or To do tasks that may start now: start them.',
          'Ready tasks whose brief says they merge themselves but haven’t: see them through.',
          'Live links the human uses still answer.',
        ]
      : role === 'home'
        ? machine
        : [...machine, 'Anything waiting on the human across machines: alert only what can’t wait.', 'A machine whose herdr stopped answering, or whose home space went quiet.']
  return ['# Heartbeat', '', 'What to check each heartbeat. Edit it in Settings → Autopilot, or ask your coordinator to.', '', ...items.map((x) => `- ${x}`), '', '## Goals', '', '- (this place’s goals, for the coordinator to keep in mind)', ''].join('\n')
}

interface Beat {
  /** the last heartbeat, or when it went on Autopilot: the next is the time rule's first after it */
  last?: number
  /** news its event rules let wait for the next heartbeat, oldest first */
  held?: string[]
}

/** news kept for the next heartbeat, at most */
const HELD = 30

export class Heartbeats {
  private s: Record<string, Beat>
  constructor(private storage: { read(): Record<string, Beat>; write(value: Record<string, Beat>): void; initial?(role: 'space' | 'home' | 'main'): string; readChecklist(place: string): string | undefined; writeChecklist(place: string, text: string): void }) { this.s = storage.read() }

  private save() {
    this.storage.write(this.s)
  }

  private of(place: string) {
    return (this.s[place] ??= {})
  }

  /** its HEARTBEAT.md: the first checklist for its role until there is one (written: `keep`) */
  read(place: string, role: 'space' | 'home' | 'main', keep = false) {
    const saved = this.storage.readChecklist(place)
    if (saved !== undefined) return saved
    const first = this.storage.initial?.(role) ?? firstChecklist(role)
    if (keep) this.write(place, first)
    return first
  }

  write(place: string, text: string) {
    this.storage.writeChecklist(place, text.endsWith('\n') || !text ? text : `${text}\n`)
  }

  last(place: string) {
    return this.s[place]?.last
  }

  /** Autopilot went on: the first heartbeat is the time rule's first from now. Off: forgotten */
  switched(place: string, on: boolean, now = Date.now()) {
    if (on) this.of(place).last = now
    else delete this.s[place]
    this.save()
  }

  /** the next heartbeat by its time rule (in a zone), or nothing (no time rule, or it is over) */
  next(place: string, rule: string, zone: string, now = Date.now()) {
    return nextRun(rule, zone, this.s[place]?.last ?? now)
  }

  /** is a heartbeat due: its time rule's first run after the last has come. One first seen starts counting now. Whether the coordinator is idle is the caller's to say. */
  due(place: string, rule: string, zone: string, now = Date.now()) {
    const b = this.of(place)
    if (!b.last) {
      b.last = now
      this.save()
      return false
    }
    const at = nextRun(rule, zone, b.last)
    return at !== undefined && at <= now
  }

  /** news that waits for the next heartbeat */
  hold(place: string, line: string) {
    const b = this.of(place)
    b.held = [...(b.held ?? []), line].slice(-HELD)
    this.save()
  }

  held(place: string) {
    return this.s[place]?.held ?? []
  }

  /** the heartbeat prompt, with the news that waited; it counts as given. None when its checklist is empty and no news
   *  waits: the rule starts again. */
  beat(place: string, role: 'space' | 'home' | 'main', now = Date.now()): string | undefined {
    // on disk from now on, as the human and the coordinator see and edit it
    const list = this.read(place, role, true).trim()
    const b = this.of(place)
    const held = b.held ?? []
    b.last = now
    delete b.held
    this.save()
    return list || held.length ? heartbeatPrompt(list, held) : undefined
  }
}

/** the fixed heartbeat prompt, with the checklist itself in it: the coordinator may run on another machine than the
 *  file */
export function heartbeatPrompt(list: string, held: string[] = []) {
  return [
    list
      ? `Heartbeat. Go through your HEARTBEAT.md: act on what needs it, by your Autopilot rules and any limits it sets. Don't redo or repeat old work from earlier in this chat. To change it: shepherdr heartbeat set.\n\nYour HEARTBEAT.md:\n${list}`
      : 'Heartbeat. Your HEARTBEAT.md is empty: only the news below.',
    ...(held.length ? [`News since the last heartbeat, which your trigger let wait (act on it by your Autopilot rules):\n${held.map((x) => `- ${x}`).join('\n')}`] : []),
    'If nothing needs you, reply with only <no-reply>heartbeat: nothing to do</no-reply>.',
  ].join('\n\n')
}
