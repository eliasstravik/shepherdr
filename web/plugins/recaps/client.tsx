// Recaps: a short recap of what happened in a chat (what was done, what it waits for, what you need to decide), for
// any agent. Claude Code writes its own (shown as it is); for the rest, a chat's menu (and the palette) has Recap,
// which asks the chat's agent once, only when it is idle and something happened since the last recap
// (service/recap.ts). Nothing asks for one by itself: no message goes to an agent the person didn't ask for (AGENTS.md
// "Nothing that risks a ban"). Switched off in Settings › Plugins, Recap is gone (recaps an agent wrote itself still
// show).
import { definePlugin, tryAct, type MenuRow } from '@client/kernel.ts'
import { focusChat } from '@client/commands.ts'
import { taskChat } from '@shared/view.ts'

/** ask now, from a menu or the palette: why not, if it can't (it works, nothing new) */
const recapNow = (chat: string) => void tryAct({ type: 'recap', chat }, 'Asked for a recap.')

const row = (chat: string | undefined): MenuRow[] => (chat ? [{ icon: 'clock', label: 'Recap', run: () => recapNow(chat) }] : [])

export default definePlugin({
  name: 'recaps',
  setup(reg) {
    reg.spaceMenu.push({ order: 20, rows: (p, head) => (head ? row(p.chat) : []) })
    reg.taskMenu.push({ order: 20, rows: (t, where) => (where === 'thread' ? row(taskChat(t)) : []) })
    reg.commands.push({ id: 'recaps.now', title: 'Recap this chat', area: 'Chat', icon: 'clock', words: 'summary catch up away what happened', when: () => Boolean(focusChat()), run: () => { const c = focusChat(); if (c) recapNow(c) } })
  },
})
