// The Terminal row of a space's name menu and of an open task's ⋯ menu (the header has no Terminal button): it opens
// your own shell (the drawer under the chat; the whole screen on a phone), checked while that is open, and a second
// tap closes it again. Ctrl+` does the same for a space.
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

export const spaceTermRow = (ui: UI): MenuRow => ({ icon: 'term', label: 'Terminal', on: spaceTermOn(ui), run: toggleSpaceTerm })
export const taskTermRow = (ui: UI, task: string): MenuRow => ({ icon: 'term', label: 'Terminal', on: taskTermOn(ui), run: () => toggleTaskTerm(task) })
