// Which terminal shows, and which takes the keys, from what the screen shows (no page needed: shown.test.ts)
import type { UI } from '@client/kernel.ts'

type Shown = Pick<UI, 'term' | 'tabView'>

/** one of a space's other agent tabs (t:<terminal>) switched to Chat (3.0's Chat | Terminal): its chat shows */
export const tabInChat = (ui: Shown, key: string) => key.startsWith('t:') && ui.tabView?.[key] === 'chat'

/** a chat's body is the terminal behind it: the Assistant's Chat | Terminal on Terminal (ui.term is its chat key), but
 *  never a tab switched to Chat, whose chat key is its terminal too (#786) */
export const termInPlace = (ui: Shown, key: string) => ui.term === key && !tabInChat(ui, key)

/** the terminal a desktop's keys go to, wherever the focus is: the one shown in place of a chat; none while a tab
 *  shows its chat, whose message box takes them (#787) */
export const keysTerm = (ui: Shown) => (ui.term && !tabInChat(ui, ui.term) ? ui.term : null)

/** a touch screen, at any width: a landscape iPad is a desktop by its width, with no key to type with (#862). Any
 *  pointer, not the first: an iPad with a trackpad says its first is fine. */
export const touchScreen = (media: ((q: string) => { matches: boolean }) | undefined = globalThis.matchMedia) =>
  !!media?.('(any-pointer: coarse)').matches

/** how a terminal takes what's typed: typed, a mouse and keyboard type into a task's while its screen has the focus;
 *  touch, a finger taps the hidden typing box (the on-screen keyboard comes up) and has a row of keys. Neither: the
 *  keys go to the one shown in place of a chat, wherever the focus is (keysTerm). */
export function termInput(device: UI['device'], panel: boolean, touch: boolean) {
  const typed = panel && !touch && device === 'desktop'
  return { typed, touch: device === 'phone' || touch || (panel && !typed) }
}

/** a key typed in a terminal's hidden typing box is the box's (it sends it): not the app's shortcuts (Esc, Ctrl+K)
 *  nor the desktop's keys again (#862); Ctrl+` still goes back to the chat */
export const typedInBox = (e: { target: unknown; ctrlKey: boolean; key: string }) =>
  (e.target as { getAttribute?: (n: string) => string | null } | null)?.getAttribute?.('name') === 'terminal-input' && !(e.ctrlKey && e.key === '`')
