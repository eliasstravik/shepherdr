# Window and web parity

Shepherdr 3.1's web app works exactly as Shepherdr's 3.0 layout in the Herdr window: the same contents, labels,
controls, states, menus, empty and error texts, sub-pages and behavior. Only the look is 2.1's, fitted to desktop,
tablet and phone. The window decides; where the two differ, the web changes.

Each surface has its own page under [docs/parity/](parity/), made from the window's mod code (not from memory): every
element of the window's surface, its web twin, and a tick once they match. An element the web shows differently on
purpose (phone navigation, touch instead of right-click, a browser key the browser keeps) is listed as a web-only form,
with why.

Where both sides can read the same words or items from `core/`, they do, with a test, so they can't drift apart
(`core/menus.js`, `core/settings.js`, `core/spaces.js`, `core/tasks.js`, `core/chat-view.js` for the chat's words and its
working line, `core/bg-jobs.js` for the background jobs over the box, …).

| Surface | Window | Web | Page |
|---|---|---|---|
| Sidebar: brand, spaces, machines, sections, Pinned, foot, menus, machine popup | `mods/spaces-chat`, `mods/workspace-chrome-shepherdr` | `web/plugins/places`, `web/plugins/health`, `web/plugins/limits`, `web/src/App.tsx` (SideFoot) | [sidebar](parity/sidebar.md) |
| Tab bar, + menu, tab menu, pane header, Autopilot switch, Chat · Terminal | `mods/tabs-tasks`, `mods/new-menu-tasks`, `mods/menu-tasks`, `mods/pane-chat` | `web/plugins/coordinators`, `web/plugins/terminal`, `web/src/App.tsx` (headers) | [header](parity/header.md) |
| Chat: messages, tool rows, news, cards, images, reactions, message actions, find bar, composer, model picker, dictation, call | `mods/chat`, `mods/chat-models`, `mods/chat-react`, `mods/chat-call`, `mods/chat-image` | `web/plugins/chat`, `web/plugins/reactions`, `web/plugins/voice`, `web/src/restart.tsx` | [chat](parity/chat.md) |
| Tasks panel and task view | `mods/tasks`, `mods/tasks-menu`, `mods/chat/panel.js`, `mods/task-pr`, `mods/task-browser` | `web/plugins/tasks`, `web/src/Panel.tsx`, `web/plugins/browser`, `web/plugins/worktree` | [tasks](parity/tasks.md) |
| Accept card, toasts, status bar, confirm and prompt dialogs | `mods/accept-card`, `mods/toasts`, `mods/workspace-status-chat`, `mods/confirm-chat`, `mods/prompt-chat` | `web/src/screens/Accept.tsx`, `web/plugins/alerts`, `web/src/rowmenu.tsx` | [cards](parity/cards.md) |
| Artifacts, Jump, Keybinds | `mods/artifacts`, `mods/jump`, `mods/keybinds` | `web/plugins/artifacts`, `web/src/screens/Recipe.tsx`, `web/plugins/keyboard` | [artifacts and jump](parity/artifacts-jump.md) |
| Settings: Agents, Tasks, Notify, Secrets, Machines, Window, Web, and the Settings frame | `mods/shepherdr-settings` | `web/src/Settings.tsx`, `web/src/screens/Role.tsx`, `service/settings.ts`, `service/window.ts` | [settings](parity/settings.md) |
| Settings › Autopilot (Everywhere's and a space's own) | `mods/shepherdr-settings/autopilot-section.js`, `mods/tasks/bin/herdr_task/autopilot.py` | `service/settings.ts`, `service/autopilot.ts`, `web/src/Settings.tsx` | [autopilot](parity/autopilot.md) |
| New space, Add machine, worktrees, rename dialogs | `mods/newspace`, `mods/machine-add-chat`, `mods/spaces-chat/rename.js`, worktree dialog | `web/plugins/places/add.tsx`, `web/plugins/places/section.tsx`, `web/src/screens/AddMachine.tsx`, `web/src/screens/Worktree.tsx` | [dialogs](parity/dialogs.md) |

A surface is done when every row on its page is ticked (✓) or a web-only form (◇) with its reason. Nothing is ✗.
