# Plugins

Every feature of the app is a plugin. A plugin fills named places in the shell, so one can be added without touching
the rest. [`web/plugins.json`](../web/plugins.json) is the list, in order.

| Plugin | Switch | What it is | Off means |
|---|---|---|---|
| chat | always on | A chat's messages, cards and message box | |
| tasks | always on | The Tasks pane, a task's thread, the review card | |
| artifacts | always on | The Artifacts pane, a page's tile in a chat, Mark up | |
| search | always on | One search for spaces, tasks and artifacts (Ctrl+K) | |
| alerts | always on | Push alerts, one choice per device | |
| terminal | yes | Your own terminal in a space or a task, and "View as terminal" | No Terminal menu items |
| screens | yes | An agent's browser and desktop: watch, Take over, Hand back | No Screen menu item, live picture or card |
| voice | yes | Voice over the whole app, and dictation in the message box | No voice or mic button |
| schedules | yes | Tasks › Scheduled | No Scheduled tab |
| reactions | yes | Emoji reactions on messages | No emoji row in a message's menu |

Settings › Plugins has the switches. They are kept as `everywhere.plugins_off` in `~/.config/shepherdr/settings.json`
(`service/next.ts` `PLUGINS`). An open page starts again when a switch flips.

## Screens

- Each space has one browser with one profile, so its agents share the sign-ins. Each chat and each task has its own
  page in it: `herdr-browser <agent-browser command>`.
- Each agent has a desktop too: `herdr-desktop <agent-desktop command>`. On Linux it is the agent's own virtual
  display (Xvnc, or Xvfb with x11vnc). A Mac has one real screen, shared by its agents one at a time.
- You watch a screen live and Take over; the agent's commands are refused until you Hand back. An agent asks for a
  step only a person can do with `herdr-browser hands "<what>"`.
- For now, live views and actions work only for agents on the machine that serves Shepherdr.
- The streams listen on the machine itself only (127.0.0.1) and reach the page through the Shepherdr service.

## The places

`Registry` in [`web/src/kernel.ts`](../web/src/kernel.ts) names every place a plugin can fill. The shell
(`web/src/App.tsx`) only lays them out.

| Place | What goes there |
|---|---|
| `views` | The parts of a thread: `messages`, `box`, `taskHead`, `taskTop`, `scheduled`, `tile`, `search` |
| `header`, `taskHeader` | Buttons in a chat's or a task's header (Tasks, Artifacts, voice; Terminal and Screen are menu rows) |
| `panes` | What the right-hand pane can show |
| `bar` | The phone's bottom bar |
| `spaceMenu`, `taskMenu`, `messageMenu` | Rows of a space's, a task's and a message's menu |
| `messageParts`, `messageEdge` | Drawn under a message, and the reaction chips on its bubble's lower edge |
| `messageQuick` | First in the quick bar a tap or a mouse over a message shows (add a reaction) |
| `chatCards`, `chatTail`, `chatBody` | Cards put in a chat from a task's status, what follows the messages, what takes the chat's place |
| `aboveBox`, `boxButtons`, `drawer` | Above the message box, inside its bar, and under the column |
| `sideHead`, `middle`, `overlays`, `topBars` | The list's top row, the whole middle column, whole-screen layers, thin lines at the top |
| `settings` | Sections of the settings window, for everything, a space, or both |
| `keys` | Keyboard shortcuts |

## Add one

1. Make `web/plugins/<name>/client.tsx`. Its default export is `definePlugin({ name, setup(reg) { ... } })`. In
   `setup`, push into the places it fills. Give each entry an `order`.
2. Add `<name>` to `web/plugins.json`.
3. Run `bun web/build-plugins.ts`. It writes `web/generated/client-plugins.ts`, which the app imports.
4. For a switch, add it to `PLUGINS` in `service/next.ts` without `always`. In the plugin, `has('<name>')` from the
   kernel says whether another plugin is on.

A plugin reads the server's data with `useSnap()` and `useChat(key)`, what is on screen with `useUI()`, and acts
with `act()` or `tryAct()`. What the person sees for a status comes from `web/shared/view.ts`, by plain rules.
