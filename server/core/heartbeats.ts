import { findCoreSpace } from './space-names.ts'
import { Heartbeats, firstChecklist } from '../heartbeat.ts'
import { timeWords, nextWords, runWords, timeRule } from '../common/trigger.ts'
import { Refusal } from './client.ts'
import type { CoreSource } from './source.ts'
import type { CoreAgent, CoreSpace } from './model.ts'

/** A checklist is product data, never a remotely mounted instruction file. */
export class CoreHeartbeats {
  readonly model: Heartbeats
  constructor(private source: CoreSource) {
    this.model = new Heartbeats({ initial: role => firstChecklist(role).replace(/\bherdr\b/g, 'core'), read: () => source.store.get('meta', 'heartbeats') ?? {}, write: value => source.store.set('meta', 'heartbeats', value),
      readChecklist: place => source.store.get<string>('heartbeat-list', place), writeChecklist: (place, text) => source.store.set('heartbeat-list', place, text) })
  }
  role(space: CoreSpace) { return !space.home ? 'space' : space.machine === this.source.localMachineId() ? 'main' : 'home' }
  read(space: CoreSpace) { return this.model.read(space.id, this.role(space)) }
  write(space: CoreSpace, text: string) {
    if (Buffer.byteLength(text) > 64 * 1024) throw new Refusal('Keep the heartbeat checklist under 64 KiB')
    this.model.write(space.id, text.trim() ? text : '')
    this.source.emit('snapshot')
  }
  cli(agent: CoreAgent, args: string[], stdin?: string) {
    const set = args[1] === 'set', name = args[set ? 2 : 1]
    const space = name ? findCoreSpace(this.source, agent.machine, name) : this.source.space(agent.space)
    if (!space || space.machine !== agent.machine) throw new Refusal('Choose a space on this machine')
    if (set) {
      if (agent.role !== 'coordinator') throw new Refusal('Only a coordinator can change a heartbeat checklist')
      if (typeof stdin !== 'string') throw new Refusal(`Give the whole new HEARTBEAT.md on stdin: heartbeat set < file. Empty stops the heartbeat. This start’s current command is ${agent.command || 'the launch-provisioned shepherdr helper'}; an older helper cannot forward this input.`)
      this.write(space, stdin)
      return stdin.trim() ? `${space.name}'s HEARTBEAT.md is saved.` : `${space.name}'s HEARTBEAT.md is empty now: no heartbeat until it has a checklist again.`
    }
    const rule = this.source.settings.get('heartbeat.when', space.id) || timeRule('FREQ=MINUTELY;INTERVAL=30'), zone = this.source.automations.zone()
    const last = this.model.last(space.id), next = this.model.next(space.id, rule, zone)
    return [`Heartbeat: ${timeWords(rule, zone)}`, `Last: ${last ? runWords(last, zone) : 'Not run yet'}`, `Next: ${(space.mode === 'autopilot' && next !== undefined ? [runWords(next, zone)] : nextWords(rule, zone)).join(' · ') || 'off'}${space.mode === 'autopilot' ? ' once idle' : ' (Autopilot is off)'}`, '', this.read(space)].join('\n')
  }
}
