// Recaps: when you come back to a chat after a while, a short recap of what happened since you last looked (what was
// done, what it waits for, what you need to decide), for any agent. Claude Code writes its own (shown as it is); for
// the rest, the page asks the chat's agent once, only when it is idle and something happened since the last recap
// (service/recap.ts). A chat's menu has Recap for one now. Settings › Recaps turns the automatic ones off; switched off
// in Settings › Plugins, neither happens (recaps an agent wrote itself still show).
import { useEffect, useRef, useState } from 'react'
import { act, definePlugin, tryAct, useSnap, type MenuRow, type Thread } from '@client/kernel.ts'
import { focusChat } from '@client/commands.ts'
import { SRow } from '@client/settings.tsx'
import { Tgl } from '@client/ui.tsx'
import { taskChat } from '@shared/view.ts'
import type { Chat } from '@shared/types.ts'
import { dueRecap, loadSeen, saveSeen, WAIT_FOR_IDLE } from './due.ts'

const seen = loadSeen()

/** ask now, from a menu or the palette: why not, if it can't (it works, nothing new) */
const recapNow = (chat: string) => void tryAct({ type: 'recap', chat }, 'Asked for a recap.')

/** the page's own ask when you come back to a chat: notes when you last looked, then asks once its agent is idle */
function AutoRecap({ chat, thread }: { chat: Chat | undefined; thread: Thread }) {
  const auto = useSnap()?.config?.recaps?.auto !== false
  const key = thread.chat
  // the look before this visit, and when this visit started (null: nothing to decide any more)
  const since = useRef<number | undefined>(undefined)
  const arrived = useRef<number | null>(null)
  useEffect(() => {
    const look = () => {
      if (document.visibilityState !== 'visible') return
      seen[key] = Date.now()
      saveSeen(seen)
    }
    const arrive = () => {
      if (document.visibilityState !== 'visible') return
      since.current = seen[key]
      arrived.current = Date.now()
      look()
    }
    const vis = () => (document.visibilityState === 'visible' ? arrive() : look())
    arrive()
    const every = setInterval(look, 30_000)
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(every)
      document.removeEventListener('visibilitychange', vis)
      look()
    }
  }, [key])
  const [, tick] = useState(0)
  useEffect(() => {
    if (arrived.current === null || !chat || !auto) return
    // it works: wait a little for it to stop, then let it be (you see it working)
    if (chat.working || chat.background) {
      if (Date.now() - arrived.current > WAIT_FOR_IDLE) arrived.current = null
      else {
        const t = setTimeout(() => tick((n) => n + 1), 15_000)
        return () => clearTimeout(t)
      }
      return
    }
    if (chat.finished || chat.notice) { arrived.current = null; return }
    arrived.current = null
    if (dueRecap(chat.messages, since.current, Date.now())) void act({ type: 'recap', chat: key, auto: true }).catch(() => undefined)
  })
  return null
}

function RecapSettings() {
  const on = useSnap()?.config?.recaps?.auto !== false
  return (
    <SRow label="Recap by itself when I come back to a chat">
      <Tgl label="Automatic recaps" on={on} onChange={(v) => void tryAct({ type: 'config', place: 'all', key: 'recaps.auto', value: v })} />
    </SRow>
  )
}

const row = (chat: string | undefined): MenuRow[] => (chat ? [{ icon: 'clock', label: 'Recap', run: () => recapNow(chat) }] : [])

export default definePlugin({
  name: 'recaps',
  setup(reg) {
    reg.chatTail.push({ order: 90, View: AutoRecap })
    reg.spaceMenu.push({ order: 20, rows: (p, head) => (head ? row(p.chat) : []) })
    reg.taskMenu.push({ order: 20, rows: (t, where) => (where === 'thread' ? row(taskChat(t)) : []) })
    reg.commands.push({ id: 'recaps.now', title: 'Recap this chat', area: 'Chat', icon: 'clock', words: 'summary catch up away what happened', when: () => Boolean(focusChat()), run: () => { const c = focusChat(); if (c) recapNow(c) } })
    reg.settings.push({ name: 'Recaps', icon: 'clock', order: 70, scope: 'all', View: RecapSettings })
  },
})
