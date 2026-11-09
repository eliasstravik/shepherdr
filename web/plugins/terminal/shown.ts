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
