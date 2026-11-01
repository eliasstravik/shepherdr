import { asEmoji, NAME_MAX, nameProblem, type Action, type Machine, type Place } from '../../shared/types.ts'
import { deleteSection, moveSpace, newSection, PINNED, renameSection, sectionProblem, setOrder, sortPlaces, type PlaceOrder, type SectionDefs } from '../../shared/order.ts'
import { one, parseArgs } from '../common/args.ts'
import { Refusal } from './client.ts'
import { coreSpaceName, findCoreSpace } from './space-names.ts'
import { CoreTaskProcesses } from './task-processes.ts'
import type { CoreAgent } from './model.ts'
import type { CoreSource } from './source.ts'

/** Sidebar organization is product metadata; it never renames a core machine or repository. */
export class CorePlaces {
  private removals = new Set<string>()
  constructor(private source: CoreSource) {}
  removing(place: string) { return this.removals.has(place) }
  names(machine: string, except?: string) {
    return this.source.store.all<import('./model.ts').CoreSpace>('space').filter(space => space.machine === machine && space.id !== except)
      .flatMap(space => [space.name, coreSpaceName(this.source, space), ...(space.home ? ['~', 'home'] : [])]).filter((name): name is string => !!name)
  }
  private idle(place: string) {
    const active = this.source.tasks.all().filter(task => task.place === place && (this.source.tasks.busy(task.id) || new CoreTaskProcesses(this.source).runningChildren(task) || task.workflow === 'working' || task.workflow === 'merging' ||
      this.source.agents.all().some(agent => agent.chat.startsWith(task.id + '/') && this.source.agents.terminal(agent)?.state !== 'finished' && this.source.status(agent) !== 'idle')))
    if (active.length) throw new Refusal(`${active.map(task => task.id).join(', ')} still has work running; stop or finish it first`)
  }
  async remove(place: string) {
    if (this.source.quiescing) throw new Refusal('Shepherdr is stopping')
    const space = this.source.space(place)
    if (!space || space.home) throw new Refusal('A home space cannot be removed; choose a repository space')
    if (this.removing(place)) throw new Refusal('This space is already being removed')
    this.idle(place); this.removals.add(place)
    try {
      await this.source.pilots.lifecycle.forgetRegular(place, () => {
        this.idle(place)
        const current = this.source.space(place)
        if (!current) throw new Refusal('This space changed during removal')
        current.removed = Date.now(); this.source.store.set('space', place, current); this.source.emit('snapshot')
      })
      return { ok: true }
    } finally { this.removals.delete(place) }
  }
  async cli(agent: CoreAgent, args: string[]) {
    const parsed = parseArgs(args.slice(1)), [op = 'list', ...words] = parsed.words
    const spaces = this.source.spaces().filter(space => space.machine === agent.machine)
    const find = (name: string | undefined) => {
      const found = name && findCoreSpace(this.source, agent.machine, name)
      if (!found) throw new Refusal('Choose a space on your machine')
      return found
    }
    if (op === 'list') return JSON.stringify(spaces.map(space => ({ ...space, name: coreSpaceName(this.source, space) })), null, 2)
    if (agent.role !== 'coordinator' || agent.pilot) throw new Refusal('Only a regular coordinator manages spaces, when the human asks')
    if (op === 'add') {
      if (words.length !== 1 || parsed.flags.size || Object.keys(parsed.opts).some(key => key !== 'name')) throw new Refusal('Use space add PATH [--name NAME]')
      return (await this.source.addSpace({ machine: agent.machine, path: words[0]!, name: one(parsed, 'name') })).place
    }
    if (op === 'rename') {
      if (words.length !== 2 || parsed.flags.size || Object.keys(parsed.opts).length) throw new Refusal('Use space rename NAME NEW_NAME')
      const space = find(words[0])
      if (this.removing(space.id)) throw new Refusal('This space is being removed')
      const result = this.act({ type: 'rename', id: space.id, name: words[1]! })
      if (!result.ok) throw new Refusal('error' in result ? result.error : 'Rename failed')
      return `Renamed ${space.name} to ${words[1]}`
    }
    if (op === 'remove') {
      if (words.length !== 1 || parsed.flags.size || Object.keys(parsed.opts).length) throw new Refusal('Use space remove NAME')
      const space = find(words[0]); await this.remove(space.id); return `Removed ${space.name}; files and history kept`
    }
    if (op === 'set' && words[0] === 'base') {
      if (words.length !== 2 || !one(parsed, 'space') || parsed.flags.size || Object.keys(parsed.opts).some(key => key !== 'space')) throw new Refusal('Use space set base BRANCH --space NAME')
      const space = await this.setBase(find(one(parsed, 'space')).id, words[1]!, agent), base = space.base
      return `New tasks in ${space.name} use ${base}; existing tasks keep their base`
    }
    throw new Refusal('Use space list|add|rename|remove, or space set base BRANCH --space NAME')
  }
  async setBase(id: string, base: string, actor?: CoreAgent) {
    const space = this.source.space(id)
    if (!space || space.home || this.removing(id)) throw new Refusal('Choose a repository space and branch.')
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(base) || base.includes('..')) throw new Refusal('Choose a valid base branch for a repository space')
    await this.source.tasks.git.head({ machine: space.machine, folder: space.folder }, base)
    const current = this.source.space(id), caller = actor && this.source.agents.get(actor.chat)
    if (!current || this.removing(id) || current.folder !== space.folder || current.machine !== space.machine || current.base !== space.base && current.base !== base || actor && (caller?.launch !== actor.launch || caller.grant !== actor.grant)) throw new Refusal('Space or coordinator changed; retry the command')
    current.base = base; this.source.store.set('space', id, current); this.source.emit('snapshot')
    return current
  }
  present(places: Place[], machines: Machine[]) {
    const named = <T extends { id: string; name: string }>(item: T) => ({ ...item, name: this.source.store.get<string>('name', item.id) || item.name })
    return sortPlaces(places.map(named), machines.map(machine => ({ ...named(machine), ownName: machine.name, emoji: this.source.store.get<string>('emoji', machine.id) || undefined })),
      this.source.store.get<PlaceOrder>('meta', 'place-order') ?? {}, this.source.store.get<SectionDefs>('meta', 'place-sections') ?? {})
  }
  act(action: Extract<Action, { type: 'rename' | 'order' | 'move' | 'section' }>) {
    const store = this.source.store, order = Object.assign(Object.create(null), store.get<PlaceOrder>('meta', 'place-order')), defs: SectionDefs = Object.assign(Object.create(null), store.get<SectionDefs>('meta', 'place-sections'))
    const { places, machines = [] } = this.source.snapshot()
    const fail = (error: string) => ({ ok: false as const, error })
    let id: string | undefined
    switch (action.type) {
      case 'rename': {
        if (typeof action.name !== 'string') return fail('Nothing to rename.')
        const name = action.name.replace(/\s+/g, ' ').trim(), emoji = action.emoji === undefined ? undefined : asEmoji(action.emoji)
        if (emoji === null) return fail('One emoji at a time.')
        if (defs[action.id] || action.id === PINNED) {
          const bad = renameSection(defs, action.id, name, emoji)
          if (bad) return fail(bad)
          break
        }
        const machine = machines.find(item => item.id === action.id), place = places.find(item => item.id === action.id)
        if (!machine && !place) return fail('Nothing to rename.')
        if (emoji !== undefined && !machine) return fail('Only a machine takes an emoji, one at a time.')
        if (name.length > NAME_MAX) return fail(`A name fits ${NAME_MAX} characters.`)
        if (machine && name && machines.some(item => item.id !== machine.id && item.name.toLowerCase() === name.toLowerCase())) return fail(`A machine is called ${name} already.`)
        const bad = place && name ? nameProblem(name, this.names(place.machine, place.id)) : undefined
        if (bad) return fail(bad)
        store.db.transaction(() => {
          if (name) store.set('name', action.id, name); else store.delete('name', action.id)
          if (emoji !== undefined) { if (emoji) store.set('emoji', action.id, emoji); else store.delete('emoji', action.id) }
        })()
        this.source.emit('snapshot'); return { ok: true }
      }
      case 'order':
        if (typeof action.under !== 'string' || !Array.isArray(action.ids) || !action.ids.every(item => typeof item === 'string')) return fail('No order to keep.')
        setOrder(order, action.under, action.ids); break
      case 'move': {
        if (typeof action.id !== 'string' || typeof action.to !== 'string') return fail('Nothing to move.')
        const bad = moveSpace(order, defs, places, machines, action.id, action.to, typeof action.before === 'string' ? action.before : undefined)
        if (bad) return fail(bad)
        break
      }
      case 'section':
        if (action.op === 'delete') {
          if (!defs[action.id] || action.id === PINNED) return fail(action.id === PINNED ? 'Pinned stays.' : 'No such section.')
          deleteSection(defs, order, action.id)
        } else {
          const name = typeof action.name === 'string' ? action.name.replace(/\s+/g, ' ').trim() : '', emoji = action.emoji === undefined ? '' : asEmoji(action.emoji)
          const machine = typeof action.machine === 'string' && action.machine ? action.machine : undefined
          if (emoji === null) return fail('One emoji at a time.')
          if (machine && !machines.some(item => item.machine === machine)) return fail('No such machine.')
          const bad = sectionProblem(defs, name, machine)
          if (bad) return fail(bad)
          id = newSection(defs, order, { name, ...(emoji ? { emoji } : {}), ...(machine ? { machine } : {}) }, machines)
        }
    }
    store.db.transaction(() => { store.set('meta', 'place-order', order); store.set('meta', 'place-sections', defs) })()
    this.source.emit('snapshot'); return { ok: true, ...(id ? { id } : {}) }
  }
}
