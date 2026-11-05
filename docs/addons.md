# Add-ons

Everything in Shepherdr is an add-on made of Herdr mods. [`lib/addons.json`](../lib/addons.json) is the list: each
add-on's mods, the layout blocks it fills, its keys, helpers, role instructions and what it needs. The installer
installs all of them (one layout listing gives everything); Shepherdr settings → Window → Add-ons switches the ones
marked below off and on again, at once and on every machine (Everywhere's `off` in `~/.herdr/shepherdr.json`).

| Add-on | Switch | What it is | Off means |
|---|---|---|---|
| Core | always on | The layout: sidebar (spaces-chat), tab bar (tabs-tasks), pane header (pane-chat), sidebar foot, status bar, toasts, menus and dialogs, Shepherdr settings | — |
| Tasks | always on in 3.1.9 | The Tasks panel, a task's view (files, changes, pull request), the Accept card, `herdr-task`, worker.md and reviewer.md | — |
| Assistants | always on in 3.1.9 | An Assistant per space (coordinator, assistant.md), task news. Needs Tasks | — |
| Chat | always on in 3.1.9 | Agents as a chat, model choice, opened images | — |
| Questions and permissions | always on in 3.1.9 | Question and permission cards from Claude Code and Codex hooks. Needs Chat | — |
| Secrets | always on in 3.1.9 | `herdr-secret`, the masked card, Settings → Secrets | — |
| Keyboard | always on in 3.1.9 | Jump (Ctrl+K), the keys list (Ctrl+Shift+?) | — |
| Artifacts | yes | Agents' reports and draft screens beside the chat, `herdr-artifact` | No Artifacts button in the tab bar |
| Voice and dictation | yes | Calls with an Assistant (ElevenLabs), dictation (ElevenLabs speech to text, the same key). Needs Chat | No call or mic buttons; their keys do nothing |
| Reactions | yes | React to a message with an emoji. Needs Chat | No smiley on messages (agents' own reactions still show) |
| Task browser | yes | A browser per task you can watch and take over (`herdr-browser`). Needs Tasks | No Browser tab; workers aren't given a browser |
| Autopilot | yes | An Assistant works on its own from its heartbeat. Needs Assistants | No Autopilot switch in the header; no wake-ups |
| Other machines | yes | Keeps herdr-task, its helpers and the role instructions the same on every connected machine. Needs Tasks | Nothing is sent to other machines |
| Web | yes | The web app on your tailnet (docs/web.md) | The web app stops and isn't shared; the service keeps its background work |

An add-on can't be turned on while one it needs is off, nor off while an add-on that needs it is on: its line in
Settings says which.

## How a switch works

- The window's mods read shared `addons.off` through `lib/addons.js` (`on("voice")`), so a flip shows at once.
  `tabs-tasks` loads it from `~/.herdr/shepherdr.json` when Herdr starts.
- herdr-task reads Everywhere's `off` (`addon_off()` in `herdr_task/base.py`) for its background work: Autopilot's
  wake-ups, the task browsers, the sync to other machines.
- An off add-on's keys stay in `keys.json` and do nothing, so turning it back on needs no merge.
- The web app leaves an off add-on's plugins out (its `web` list in `lib/addons.json`); a page open at the flip
  starts again without them.

## Later

Splitting the always-on add-ons out of the panels they live in (Chat out of the pane, Tasks out of the side panel)
comes after 3.1.9, with standalone add-on mods listed on herdr.dev.
