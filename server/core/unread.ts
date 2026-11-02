import type { CoreStore } from './store.ts'

interface Mark { chat: string; last: number; read: number }
/** Product read marks, shared across devices. Native messages advance last; human sends do not. */
export class CoreUnread {
  private baseline: number
  constructor(private store: CoreStore) {
    this.baseline = store.get<number>('meta', 'unread-baseline') ?? Date.now()
    store.set('meta', 'unread-baseline', this.baseline)
  }
  last(): Record<string, number> { return Object.fromEntries(this.store.all<Mark>('unread').map(mark => [mark.chat, mark.last])) }
  read(): Record<string, number> { return { '*': this.baseline, ...Object.fromEntries(this.store.all<Mark>('unread').map(mark => [mark.chat, mark.read])) } }
  saw(chat: string, at?: number) {
    if (!at || !Number.isFinite(at) || at <= 0) return false
    const mark = this.store.get<Mark>('unread', chat) ?? { chat, last: 0, read: 0 }
    if (at <= mark.last) return false
    this.store.set('unread', chat, { ...mark, last: at })
    return true
  }
  mark(chats: Record<string, number>) {
    if (!chats || typeof chats !== 'object' || Array.isArray(chats) || Object.keys(chats).length > 4096) throw Error('Invalid read marks')
    let changed = false
    this.store.db.transaction(() => {
      for (const [chat, at] of Object.entries(chats)) {
        if (chat === '*' || !Number.isFinite(at)) continue
        const mark = this.store.get<Mark>('unread', chat)
        if (!mark) continue
        // A stale phone must not move another device's mark backwards or pre-read future messages.
        const read = Math.min(mark.last, at)
        if (read <= mark.read) continue
        this.store.set('unread', chat, { ...mark, read }); changed = true
      }
    })()
    return changed
  }
}
