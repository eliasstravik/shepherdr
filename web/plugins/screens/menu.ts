// The Screen row of a space's name menu and of an open task's ⋯ menu (the header has no Screen button): it opens the
// agent's browser and desktop in the pane (the whole screen on a phone), checked while that screen is open, and a
// second tap closes it again.
import { setUI, type MenuRow, type UI } from '@client/kernel.ts'

/** whose screen a thread opens: a task's, or a space's chat's */
export const screenKey = (place: string, task?: string) => (task ? `task:${task}` : `chat:${place}`)

/** this screen open in the pane now? */
export const screenOn = (ui: Pick<UI, 'pane' | 'scr'>, key: string) => ui.pane === 'screen' && ui.scr?.key === key

export function screenRow(ui: UI, key: string, open: (key: string) => void): MenuRow {
  const on = screenOn(ui, key)
  // back to the task it came from, or to the chat alone
  return { icon: 'screen', label: 'Screen', on, run: () => (on ? setUI(key.startsWith('task:') ? { pane: 'tasks' } : { pane: null }) : open(key)) }
}
