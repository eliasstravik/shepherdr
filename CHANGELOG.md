# Changelog

## 3.1.3

Autopilot everywhere, settings per space, and agents that survive a crash.

- Settings per space: each Settings page has a level switch at the top (Everywhere or a space), in the window and on
  the web. A space's own value overrides Everywhere's, shown as "Set for this space" or "Inherited from Everywhere"
  with a reset; Autopilot's schedule, events and heartbeat can differ per space. docs/settings.md lists which
  settings are per space.
- Autopilot works in every space on every machine: another machine's space is woken by that machine's own
  scheduler (never twice, on while this one sleeps), and the window and web show and flip its switch. The default
  heartbeat is a real one that works in any project instead of a form of blanks.
- The scheduler's round waits for the tick instead of skipping it, so wakes are closed and the Assistant's header
  no longer sticks on "Waking".
- After a crash, power loss or reboot, every space's Assistant and every working task's agent come back as
  themselves, resuming their exact session with its history.
- Web: on a phone the chat's rows over the box sit evenly with Stop on its edge, and no key hints show on touch. A
  task's Ready news line loses its Accept once the task moves on. The sidebar's foot is a gear and Settings.
- `shepherdr update` records the new version in one run.

## 3.1.2

Fixes and small wishes on top of 3.1.1, mostly the web app.

- Web chat: what you send reaches the agent at once, pictures show at once and sent bubbles no longer stick at the
  bottom. The composer matches the window's (model picker in the box), the working line says what the agent does,
  and long messages Claude Code shortens into updates show in the chat, in the window too.
- Web on a phone: one compact toast per event, named as the window names them; Tasks rows fit. The sidebar has no
  hover ⋯: right-click or long-press opens the menu.
- Reactions sit flush under the bubble's outer edge, each side's row mirroring the other's.
- Artifacts: every artifact is a recipe by default, so it opens on the phone (a custom one shows its picture there);
  the Artifacts panel opens on All.
- A task counts as merged only when its own work landed: catching up with main is never "done: merged".
- Workers keep working while they wait on CI or another machine, and only stop for a decision the person must make
  (worker.md).

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
