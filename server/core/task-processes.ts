import type { CoreSource } from './source.ts'
import type { CoreTask } from './tasks.ts'
import type { CoreAgent } from './model.ts'
import type { CoreTerminal } from './protocol.ts'
import { Refusal } from './client.ts'

/** Product-owned roots and their actual core descendants, never names or caller-supplied labels. */
export class CoreTaskProcesses {
  constructor(private source: CoreSource) {}
  private records(task: CoreTask) {
    return [...new Map([...this.source.agents.all(), ...this.source.store.all<CoreAgent>('agent-launch'), ...this.source.store.all<CoreAgent>('pilot-capture')]
      .filter(agent => agent.chat.startsWith(`${task.id}/`)).map(agent => [agent.launch, agent])).values()]
  }
  runningChildren(task: CoreTask) {
    const records = this.records(task), roots = new Set<string>()
    const current = new Set(this.source.agents.all().filter(agent => agent.chat.startsWith(`${task.id}/`)).map(agent => agent.launch))
    for (const agent of records) {
      const terminal = this.source.agents.terminal(agent)
      if (!this.source.machineConnected(agent.machine) || !terminal || agent.pid !== undefined && agent.pid !== terminal.pid) return true
      if (!current.has(agent.launch) && terminal.state !== 'finished') return true
      roots.add(terminal.address)
    }
    const descendants = new Set(roots)
    let changed = true
    while (changed) {
      changed = false
      for (const terminal of this.source.core.current.terminals.values()) {
        const prefix = terminal.address.includes('/') ? terminal.address.slice(0, terminal.address.indexOf('/') + 1) : ''
        const parent = terminal.parent && (terminal.parent.includes('/') ? terminal.parent : prefix + terminal.parent)
        if (parent && descendants.has(parent) && !descendants.has(terminal.address)) {
          if (terminal.state !== 'finished' || descendants.size >= 1024) return true
          descendants.add(terminal.address); changed = true
        }
      }
    }
    return false
  }
  async stop(task: CoreTask, cancel = true, forgetBrowser = false) {
    const records = this.records(task)
    const owned = new Map<string, { pid: number | null | undefined; created: number }>()
    const queued = this.source.store.all<{ chat: string }>('pending-send').filter(item => item.chat.startsWith(`${task.id}/`)).map(item => item.chat)
    if (cancel) for (const chat of new Set([task.chat, ...(task.reviewChat ? [task.reviewChat] : []), ...queued])) this.source.cancelQueued?.(chat)
    for (const agent of records) {
      if (cancel) this.source.cancelQueued?.(agent.chat)
      this.source.mailbox.revoke(agent.chat)
      this.source.denyPermissions(agent, 'Task stopped; ask again after an explicit restart')
    }
    for (const agent of records) {
      const terminal = this.source.agents.terminal(agent)
      if (!this.source.machineConnected(agent.machine) || !terminal) throw new Refusal('Task cleanup is unconfirmed; reconnect its machine before closing or deleting its work')
      if (agent.pid !== undefined && agent.pid !== terminal.pid) throw new Refusal('Task process identity changed; its work was left untouched')
      owned.set(terminal.address, { pid: terminal.pid, created: terminal.created_ms })
    }
    const collect = () => {
      let changed = true
      while (changed) {
        changed = false
        for (const terminal of this.source.core.current.terminals.values()) {
          const prefix = terminal.address.includes('/') ? terminal.address.slice(0, terminal.address.indexOf('/') + 1) : ''
          const parent = terminal.parent && (terminal.parent.includes('/') ? terminal.parent : prefix + terminal.parent)
          if (!owned.has(terminal.address) && parent && owned.has(parent)) {
            if (owned.size >= 1024) throw new Refusal('Too many task descendants to confirm cleanup; its work was left untouched')
            owned.set(terminal.address, { pid: terminal.pid, created: terminal.created_ms }); changed = true
          }
        }
      }
    }
    const connected = (terminal: CoreTerminal) => {
      if (!terminal.address.includes('/')) return this.source.connected()
      const name = terminal.address.slice(0, terminal.address.indexOf('/')), machine = this.source.machineIds().find(id => this.source.machineName(id) === name)
      return !!machine && this.source.machineConnected(machine)
    }
    const deadline = Date.now() + 30000
    let browserClosed = false
    while (Date.now() < deadline) {
      collect()
      let pending = false
      for (const [address, identity] of owned) {
        const terminal = this.source.core.current.terminals.get(address)
        if (!terminal || !connected(terminal) || terminal.pid !== identity.pid || terminal.created_ms !== identity.created) throw new Refusal('Task descendant identity or exit is unconfirmed; its work was left untouched')
        if (terminal.state !== 'finished') { pending = true; await this.source.core.call('terminal.kill', { terminal: address }) }
      }
      if (!pending) {
        if (browserClosed) return
        await this.source.browsers?.close(task.id, forgetBrowser, terminal => { owned.set(terminal.address, { pid: terminal.pid, created: terminal.created_ms }) })
        browserClosed = true
        continue // Include any cleanup relay that has not yet published its exit.
      }
      await Bun.sleep(100)
    }
    throw new Refusal('Task cleanup is still pending; its work was left untouched. Retry after its agents finish')
  }
}
