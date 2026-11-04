# Changelog

## Unreleased

- More coding CLIs as task agents: pi and pii (with `--model provider/id`, e.g. ClawRouter's `clawrouter/claude-opus-5-5-200k`,
  and `--thinking`), grok, hermes, amp and cursor-agent, beside Claude Code and Codex. One table, `lib/kinds.json`,
  says how each is started, given a model and reasoning level, resumed and forked; herdr-task (`add --agent pi --model …
  --effort high`, start, resume, switch, the reviewer's default), the model pickers (chat, New space, Settings) and the
  web app's restart sheet read it. `bin/sync-shared` writes `core/kinds.js` from it. Pi's session is found in its
  per-folder log directory.

## 3.1.1

Fixes and small wishes on top of 3.1.0.

- Web: your messages to an agent on another machine arrive as yours, not as another agent's, and settle in order in
  the chat (sent files too). Another machine's question cards show on the web and are answered there.
- Workers always say about how long is left, from their first status on (worker.md); the Tasks panel shows it at
  once. `herdr-task ready` and Accept adopt a pull request the agent already opened for its branch.
- `./install.sh` from a fresh clone builds the web app first (Bun from bun.sh when it's missing; `--no-build` skips
  it). `shepherdr update` on a web-only install updates the web app alone, from where it came; doctor says how.
- The chat shows the shells and watchers an agent left running in the background, over the box, with their output
  and Stop, in the window and on the web. The status bar renders again: every view reads Herdr's live lists once.

## 3.1.0

Shepherdr is also a web app again: phone first, tablet and desktop too, on the same data as the window.

- The web app, at `https://<this machine>/shepherdr/` on your tailnet only (Tailscale identity, never funnel): 2.1's
  design with 3.0's features. Spaces and sections, each space's Assistant and other tabs, chats with cards (several
  questions on one card too), Needs you, Tasks and a task's view (chat, terminal, changes, browser), the Accept card,
  artifacts with markup, reactions, dictation and voice calls, search, push alerts, 3.0's keys, and every Settings
  page (Agents, Tasks, Autopilot, Notify, Secrets, Machines, Window, Web), per space where 3.0 has it.
- One always-on service (Bun, `127.0.0.1:7788`, systemd or launchd) serves it and takes over the background work from
  the window, so nothing runs twice. Web edits to settings reach other machines as the window's do.
- One shared core (`core/`): the mods and the service use the same logic; `lib/features.json` lists every feature's
  Herdr side, web side and shared logic, and CI checks them.
- Native on both sides: artifacts as recipes drawn by the window and as HTML (`herdr-artifact convert` for older
  ones); the task browser in Kitty and as a live view on the web.
- Add-ons switch both sides: an off add-on is left out of the web app too. Web is an add-on of its own.
- `./install.sh` installs the layout and the web app; `./install.sh --web` the web app alone, without the window.
- Serve from: the web app can be served from any linked machine that stays on (a Mac mini, a cloud VM), picked in
  Shepherdr settings → Web or with `shepherdr web serve-from <machine>`; the background work and alerts follow it,
  once. `shepherdr doctor` says where it's served.
- Every space gets its Assistant, on other machines too: a new space there opens on its Assistant's chat, started on
  that machine with its CLI. A space with none offers Start Assistant in its menu; an offline machine is said
  plainly, and its Assistant starts once it's back.
- A Ready task that goes back to work (a new message, `herdr-task fix` or `resume`) shows as Working again, with no
  Accept until its next ready, and its Assistant hears so. Accept retries a merge that failed once.
- Herdr's Apache license ships beside the mods that began as copies of Herdr's own (LICENSE-herdr, NOTICE).

## 3.0.0

Shepherdr becomes a layout for the Herdr desktop app.

- Everything built in Herdr comes as one install: the Shepherdr layout, 29 mods (spaces sidebar, tab bar, chat pane,
  Tasks panel and task view, Accept card, Assistants, artifacts, voice and dictation, reactions, task browser, Jump,
  keys, settings), herdr-task, herdr-artifact, herdr-secret, herdr-browser, the role instructions and the hooks.
- Everything is an add-on (`lib/addons.json`); Artifacts, Voice and dictation, Reactions, Task browser, Autopilot
  and Other machines switch off in Shepherdr settings → Window, here and on every machine.
- `./install.sh` and `shepherdr install|update|uninstall|doctor|whisper`: backs up what it replaces, refuses to
  overwrite someone's own mods, keeps files you changed (`.new` beside them), asks before replacing a key, records
  every file, `--root` for a scratch try, `--dry-run`. While it replaces a helper, the sync to other machines waits
  until `shepherdr doctor` passes.
- Listed on herdr.dev as a layout (RECIPE.md, preview.png, topic herdr-layout). The terminal-plugin listing
  (herdr-plugin.toml) is gone from main.
- 2.1's web app is off main: it stays on branch `v2.1` (2.0 on `v2.0`). A web app for phone and tablet returns in 3.1.
- Needs the Herdr app 0.1.12 and herdr-core 0.1.17 or newer.

## 2.1.1

See branch `v2.1`.
