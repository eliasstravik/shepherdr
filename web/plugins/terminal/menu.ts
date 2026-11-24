// The Terminal row of a space's name menu and of an open task's ⋯ menu (the header has no Terminal button): it opens
// your own shell (the drawer under the chat; the whole screen on a phone), checked while that is open, and a second
// tap closes it again. Ctrl+` does the same for a space. Below a line, View as terminal / View as chat swaps this chat
// for its agent's own terminal.
import { getState, setUI, type MenuRow, type UI } from '@client/kernel.ts'

/** a space's own shell: open now? */
export const spaceTermOn = (ui: Pick<UI, 'phone' | 'pane' | 'termTask' | 'term'>) => (ui.phone ? ui.pane === 'terminal' && !ui.termTask : ui.term)
/** an open task's own shell: open now? (a phone shows it in place of the task, so the task's menu never sees it open) */
export const taskTermOn = (ui: Pick<UI, 'phone' | 'pane' | 'termTask' | 'tterm'>) => (ui.phone ? ui.pane === 'terminal' && ui.termTask : ui.tterm)

export function toggleSpaceTerm() {
  const { ui } = getState()
  if (ui.phone) setUI({ pane: spaceTermOn(ui) ? null : 'terminal', termTask: false })
  else setUI({ term: !ui.term })
}

export function toggleTaskTerm(task: string) {
  const { ui } = getState()
  if (ui.phone) setUI(taskTermOn(ui) ? { pane: 'tasks' } : { pane: 'terminal', termTask: true, task })
  else setUI({ tterm: !ui.tterm })
}

/** the keys that open your own terminal by default (its command, terminal.mine, may be given others) */
export const TERM_KEYS = 'Ctrl+`'
export const spaceTermRow = (ui: UI): MenuRow => ({ icon: 'prompt', label: 'Terminal', on: spaceTermOn(ui), cmd: 'terminal.mine', run: toggleSpaceTerm })
export const taskTermRow = (ui: UI, task: string): MenuRow => ({ icon: 'prompt', label: 'Terminal', on: taskTermOn(ui), cmd: 'terminal.mine', run: () => toggleTaskTerm(task) })

/** View as terminal / View as chat: this same chat shown as its agent's raw terminal, in the chat's place, and back. Not
 *  the Terminal row (your own shell beside the chat): a line sets it apart from what opens beside the chat, and while the
 *  terminal view is on the row says so. */
export function switchView(chat: string, on: boolean) {
  setUI((ui) => ({ aterm: { ...ui.aterm, [chat]: on } }))
}

export function viewRow(ui: Pick<UI, 'aterm'>, chat: string, line = false): MenuRow {
  const term = !!ui.aterm[chat]
  return { icon: 'viewswap', label: term ? 'View as chat' : 'View as terminal', ...(term ? { value: 'Terminal now' } : {}), cmd: 'terminal.view', line, run: () => switchView(chat, !term) }
}
