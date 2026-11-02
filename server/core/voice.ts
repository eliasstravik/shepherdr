import { machineName } from '../../shared/types.ts'
import { createHash, randomUUID } from 'node:crypto'
import { startVoice, type VoiceTools } from '../voice.ts'
import type { CoreSource } from './source.ts'

/** The voice agent uses exactly the same product actions and core-backed chats as the screen. */
export class CoreVoice {
  private calls = new Set<ReturnType<typeof startVoice>>()
  constructor(private source: CoreSource) {}
  tools(chat: string): VoiceTools {
    const targets = () => {
      const snap = this.source.snapshot()
      return [...this.source.spaces().map(space => ({ key: space.id, name: snap.places.find(place => place.id === space.id)?.name || space.name, machine: space.machine })),
        ...this.source.tasks.all().flatMap(task => [ { key: task.chat, name: task.id, machine: task.machine }, ...(task.reviewChat ? [{ key: task.reviewChat, name: `${task.id} reviewer`, machine: task.machine }] : []) ])]
    }
    const resolve = (name?: string) => {
      const word = (name || chat).trim().toLowerCase()
      const snapshot = this.source.snapshot()
      const matches = targets().filter(target => [target.key, target.name, `${machineName(snapshot.machines, target.machine)}:${target.name}`].some(value => value.toLowerCase() === word))
      if (matches.length !== 1) throw Error(matches.length ? 'Several chats match; use machine:name or the full chat key.' : 'No such chat. Use overview to find its full name.')
      if (!this.source.machineConnected(matches[0].machine)) throw Error('That machine is unavailable; its saved chat may be stale.')
      return matches[0]
    }
    const own = resolve()
    return {
      name: `${machineName(this.source.snapshot().machines, own.machine)}:${own.name}`,
      send: async (text, to, command) => {
        const target = resolve(to)
        const result = await this.source.act({ type: 'send', cid: command || randomUUID(), chat: target.key, text, human: true }) as { waiting?: boolean }
        return result.waiting ? 'Saved for delivery. It has not been confirmed by the agent yet.' : 'Sent.'
      },
      read: async to => {
        const target = resolve(to), view = this.source.chat(target.key)
        if (!view) throw Error('That chat is unavailable')
        const task = this.source.tasks.forChat(target.key), status = task ? this.source.tasks.view(task).state : this.source.chatStatus(target.key)
        return `${target.name} is ${status}.\n${view.messages.slice(-8).map(message => `${message.who === 'you' ? this.source.snapshot().user || 'You' : target.name}: ${(message.text || message.question?.title || (message.artifact ? this.source.artifacts.list().find(item => item.id === message.artifact!.id)?.title || 'Artifact' : '')).slice(0, 500)}`).join('\n')}`
      },
      overview: async () => {
        const snapshot = this.source.snapshot()
        return [...snapshot.places.map(place => `${place.id} (${place.name}): ${place.status}`), ...snapshot.tasks.filter(task => !task.archived).map(task => `${task.id} ${task.name}: ${task.state}`)].join('\n').slice(0, 32000) || 'No tasks.'
      },
      onReply: fn => {
        let seen = new Map(this.source.chat(chat)?.messages.filter(message => message.who === 'agent' && message.text).map(message => [message.id, message.text!]))
        let timer: ReturnType<typeof setTimeout> | undefined
        const off = this.source.on('chat', key => {
          if (key !== chat) return
          clearTimeout(timer)
          timer = setTimeout(() => {
            const view = this.source.chat(chat)
            if (!view || view.working) return
            for (const message of view.messages.filter(message => message.who === 'agent' && message.text && !message.card)) if (seen.get(message.id) !== message.text) fn(message.text!.slice(0, 1200))
            seen = new Map(view.messages.filter(message => message.who === 'agent' && message.text).map(message => [message.id, message.text!]))
          }, 500)
        })
        return () => { off(); clearTimeout(timer); seen.clear() }
      },
    }
  }
  open(chat: string, out: { send(data: ArrayBuffer | string): void; close(): void; buffered?(): number }) {
    if (this.source.quiescing) throw Error('Shepherdr is stopping; start the call after reconnecting')
    const space = this.source.space(chat) || this.source.space(this.source.tasks.forChat(chat)?.place || '')
    if (!space) throw Error('No such chat')
    let bridge: ReturnType<typeof startVoice>
    bridge = startVoice(this.tools(chat), { ...out, close: () => { this.calls.delete(bridge); out.close() } }, {
      key: async () => this.source.secrets.vault.pick(['ELEVENLABS_API_KEY'], [space.id, `m:${space.machine}`, 'all']).found.ELEVENLABS_API_KEY?.value || process.env.ELEVENLABS_API_KEY || null,
      agent: key => this.source.store.get<string>('voice-agent', createHash('sha256').update(key).digest('hex')),
      saveAgent: (key, id) => this.source.store.set('voice-agent', createHash('sha256').update(key).digest('hex'), id),
    })
    this.calls.add(bridge)
    return { audio: bridge.audio, end: () => { this.calls.delete(bridge); bridge.end() } }
  }
  stop() { for (const call of this.calls) call.end(); this.calls.clear() }
}
