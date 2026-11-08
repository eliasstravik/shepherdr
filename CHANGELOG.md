# Changelog

## 3.1.26

The order you drag your spaces into now stays put.

- In the web app, a space you drag to a new spot in the sidebar stays there, even one that used to snap back to the bottom. The Herdr window shows the same order.

## 3.1.25

Calls are easier on a phone held sideways, and you can see how much voice you have left.

- In the web app, a full-screen call on a phone held sideways puts the orb on the left and the buttons on the right.
- End hangs up at once, with no "Are you sure" step.
- Settings → Plan usage shows your ElevenLabs credits. If your key can't read them, it says which permission to add.

## 3.1.24

You can ask the voice call to go full screen or step aside.

- On a call, say "go full screen" or "minimize" and the voice does it itself. When it opens the full screen for you, it
  no longer shrinks it again right after.

## 3.1.23

A minimized call on a phone keeps out of the way.

- In the web app on a phone, a minimized voice call no longer shows a green Listening pill above the bottom bar.
  Mute and End stay in the bar.

## 3.1.22

The voice call's orb is a clean circle on iPhone.

- In the web app on an iPhone or iPad, the full-screen call's orb shows only its circle, with no grey square around
  it.

## 3.1.21

A voice call opens full screen, and research tasks leave your code alone.

- In the web app a call opens full screen: a calm orb that moves with who's talking, plus Minimize, Mute and End.
  Minimized, the call's card and bar show Full screen where Mute was.
- A task that only looks things up (reading, research, comparing) works in the folder itself, with no branch or pull
  request, and hands you its answer as an artifact.

## 3.1.20

A voice call can see everything you can, and lets you know when it's busy.

- A call can read every panel the app shows: tasks, changes, pull requests, files, artifacts, usage insights and each
  machine's health and plan limits. Secrets stay hidden from it.
- While it looks something up, a call says a word or two ("On it.") and plays a soft typing sound.
- The call shows Listening, Thinking, Working (and on what, like "Checking tasks…") or Speaking: on the sidebar card,
  the top strip and a slim pill above a phone's bottom bar.
- A call answers what you asked first, before any news from your tasks.

## 3.1.19

On a phone, the voice call lives in the bottom bar, and a chat's round button only sends.

- A phone's voice button sits at the end of its bottom bar; search is in the ☰ menu's magnifier.
- A chat's round button is always Send: grey until there is something to send. Calls start from Talk to Shepherdr.
- During a call, a phone's bottom bar has Mute and a red hang-up that asks before it ends the call.
- The call card is one tidy row: who, what it is doing and how long, with Mute and hang-up.

## 3.1.18

One voice call now talks to all of Shepherdr, and model choice works on every machine.

- A voice call is with Shepherdr itself, not one chat: start it from Talk to Shepherdr at the top of the sidebar or a
  phone's voice button. It hears every chat it sent to, the one on screen and anything new that needs you, and says it
  when you're both quiet.
- What a call opens for you shows an Opened by voice tag for a few seconds.
- Changing an Assistant's model, reasoning or permissions works for a space on another machine too, and says so if
  that machine is offline.

## 3.1.17

Voice calls go on with the phone locked, and agents can show you an artifact wherever you are.

- A voice call keeps going with the phone locked, shows on the lock screen, and picks up again after a dropped
  connection.
- Voice calls switch to the language you speak, by themselves.
- An agent can open an artifact for you on the screen you used last, and gives you its link.
- The Tasks list shows what needs you first, then each space's tasks.
- A task that changed no code (research, a report) waits for your Accept instead of finishing on its own, and its
  Accept card links its artifacts.
- Usage insights, a new add-on you can switch off: a private log on your own machine of how you use Shepherdr, that
  your agents can read.

## 3.1.16

Every agent question can be answered from the chat, and web messages never get lost.

- Every question or permission an agent asks shows as a card in the chat, on the web and phone too, for Claude Code
  and Codex.
- Messages sent from the web go again by themselves after a dropped connection, show how they are going, and are
  never sent twice.
- Background processes and subagents each show as one row over the chat box, which opens to the list.
- A task's chat follows its agent when it restarts in a new terminal, instead of "Can't find this conversation".

## 3.1.15

Agents keep their chat history, a stuck web chat recovers on its own, and the session note works on Macs.

- Agents started from inside Claude Code keep their chat history and folder-trust prompt again.
- The web chat follows an Assistant that was restarted, instead of showing "not a chat agent" until the service
  restarts.
- Macs: the note Shepherdr adds when a Claude Code session starts no longer breaks it (#731).

## 3.1.14

Shorter voice replies when you ask a call to open something.

- Voice calls: opening a space, task or screen gets a one-word reply, a failed or unclear open is said in a few words,
  and ending the call asks "Are you sure you want to end the call?".

## 3.1.13

Dictation that writes while you speak, Tasks grouped by space, calmer voice calls, and many phone and chat fixes.

- Dictation writes your words while you speak. Done stops the mic at once and shows a calm Writing… with Cancel.
- Tasks by status are split by machine and space when they sit in more than one, and a This space chip shows only the
  space you're in (web and window).
- Voice calls: short answers, quiet through silence, and the call ends itself after you say yes to End the call?. On a
  phone, a slim green band at the top takes you back to a call you can't see.
- The Herdr window on a Mac uses the Mac's own mic and speaker for dictation and calls.
- Dismiss (or Esc) closes a question or permission card without an answer; the agent hears it was declined.
- Send now on a message waiting in Claude Code's queue (web and window).
- A task's header has no Pin button any more: the task row's menu pins it.
- Phone chat: wide code and tables scroll on their own, typing is smoother, and folded replies never blank the list.
- Chat shows typed <words>, keeps your first message after a reopen, and ignores a template's example news.
- New tasks start from a freshly fetched base branch, and Settings › Tasks › Branch names picks how branches are named.
- The service's port can be set at install and is checked before anything is sent to it; the web app installs on a
  home screen behind login proxies.
- Alerts on this device show whether they really work, can be turned off, send a test, and let each device choose
  what it hears.
- Agents can offer feedback about Shepherdr itself; an issue is filed only after you say yes (switch in Settings ›
  Agents).
- A one-time "Enjoying Shepherdr?" card with a plain link to star it on GitHub (switch in Settings › Agents).
- The Autopilot switch stays put: its status and Run now open to its left.

## 3.1.12

Artifacts in a task's view, and tasks that finish cleanly after a squash merge.

- A task's view has an Artifacts tab, on the web and in the window: every report and proof the task's agents made, the
  proof first, then the newest.
- Artifacts name the task they were made for again.
- When a task's pull request was squash-merged, or its work is already in main, ready marks the task done instead of
  trying to open a second pull request.

## 3.1.11

Web app fixes: new spaces on other machines and menus that stay in sight.

- A new space made on another machine from the web app shows up and opens at once, with the icon you picked. If it
  takes a moment, the dialog says so and keeps waiting instead of closing.
- In the web app's sidebar, the machine load popover and every row menu open fully on screen, even in a narrow sidebar
  or the phone drawer.

## 3.1.10

Voice that can reach your whole screen, subagents you can see, and honest Working and Waking labels.

- Voice calls can look at and use everything on your screen: open files, changes, tasks by state, settings pages and
  more. Risky clicks wait for your yes. The bar on top is gone: a green mark with the clock on the call's space takes
  you back to it.
- An agent's own helpers, like its reviewer, show in its chat as Subagent rows you can open, and never count as the
  task's agents. Reviews run as one of these helpers, never hidden.
- An agent that's quiet because its own background job is still running (CI, a review, a shell) reads Working, not
  Needs you.
- Autopilot's header says Waking the moment you switch it on, and No schedule when nothing is set.

## 3.1.9

Voice calls that really open things where you are, reactions from every agent, and Assistants that know their settings.

- Voice calls open a space, task or artifact on the screen you called from, and only say it's open once it shows. An
  old page that never answers asks you to reload. Spaces are found by machine, artifacts by title.
- Settings › Agents › Reactions is one switch for every agent: Assistants, task agents, automations and agent tabs.
  Running agents are told when it changes, and pick the emoji that fits best, not just a thumbs up.
- An agent's reaction still works when it quotes your words, and never shows up as stray text.
- Each Assistant gets its space's settings when it starts (review, merge, proof, Autopilot and the rest), and a short
  note when one of them changes.

## 3.1.8

Tasks that start at a time you pick, an Assistant that never stops quietly, and a few things back where they belong.

- Scheduled tasks: tell a task to start later (at a time, or in an hour) and it starts by itself. They wait in their
  own Scheduled group with a countdown, and a task's menu has Start later, in the window and on the web.
- Autopilot never parks silently: when work waits on your Accept it says what waits, carries on with other work, and
  a quiet wake says why it stayed quiet. 3.1.7's starter heartbeat, if you never edited it, is upgraded (the old one
  kept as a `.bak`).
- A task's time left is back under its status icon, short ("2h", "<1m").
- The Fast switch is back in the model menu for Codex, and turning it off really runs at standard speed.
- Settings › Agents › Reactions: the Assistant reacts with an emoji where it fits (on by default), or never.
- Automations say which machine and space they belong to.
- Voice calls can look around Shepherdr: read a chat, open a space, task or artifact, and send or act for you.

## 3.1.7

A space's chat says which space it is, and the README shows how to install with an agent.

- A space's chat header, in the window and on the web, shows the space's name and its folder (and its machine when
  it's another one), not "Assistant · Claude Code". The composer's model menu still says which agent runs.
- README and the install guide: what to tell your coding agent so it installs Shepherdr for you, in the Herdr app or
  without it (the web app in a browser on your tailnet is then your window).

## 3.1.6

Autopilot that decides on its own, agents talking as a group chat, and a calmer, tidier app.

- Autopilot: on a wake the Assistant makes every call itself, saying in one line what it chose and why, and answers
  its agents' questions instead of asking you. Only something critical (money, publishing, deleting data, credentials,
  security, stuck after retries) reaches you, as an alert. 3.1.5's starter heartbeat, if you never edited it, is
  upgraded with the old one kept beside it as a `.bak`.
- Messages between agents show as a group chat: one quiet row ("Assistant → SHEP-4") that opens into the message,
  and another Assistant's message names it and its machine.
- A finished task shows its chat, not "hasn't started"; one whose chat is gone shows its summary instead.
- Assistant header: no hidden button that ended the agent, its state in words ("Working…", "Needs you"), Autopilot
  on the right.
- No hover tooltips anywhere; buttons say what they do.
- Tasks list: the id under the title, time left and Review at the row's end, the same in the window and on the web.
- Model picker: every model a CLI offers, with search, pinned and recent ones; reasoning levels read whole.
- Dictation writes your words down with ElevenLabs (the voice call's key), not whisper.cpp.
- Secrets follow the machine that serves the web app with no setup, and can be added or removed from any machine.
- Sidebar: no more git ahead/behind arrows. Attach in the composer is a plus.

## 3.1.5

Autopilot now pushes the project forward on its own.

- Autopilot: each wake, after unblocking and checking what's open, the Assistant looks at the project and adds and
  starts the next most valuable tasks (at most 2 a wake). It stays quiet only when nothing is worth doing.
- Each space can set a one-line Direction for Autopilot to follow, in Shepherdr settings → Autopilot (window and web)
  or with `herdr-task autopilot set --direction`. With none, it works out what matters from the project itself.
- The old starter heartbeat, if you never edited it, is upgraded to the new one on its own, with the old one kept
  beside it as a `.bak`. Your own words are never touched.

## 3.1.4

Mentions in chat, Autopilot you can see, and more done from the web without the window.

- Chat: type # to mention a space and @ to mention a task, in the window and on the web. A mention shows as a chip
  that opens the space or task, locked when the agent can't reach it.
- Autopilot: switching it on wakes the Assistant at once; every wake shows as one quiet line in the chat; the header
  counts down to the next run and has Run now; the sidebar marks spaces on Autopilot with a small rocket.
- Automations can fire on another machine's task events.
- Messages from other agents stand out as their own bubble and name who sent them. The person's words sent from
  the window always count as the person's, never as "Another agent".
- The web can close, rename and reorder a space with no Herdr window open.
- New space: pick the machine to make it on, and the folder list follows the path you type, as a shell completes one.
- Secrets can be kept on one chosen main machine, and voice calls use its ElevenLabs key everywhere
  (`shepherdr secrets move-to`).
- Tasks: a task whose agent is fixing its failing checks shows Working, not Needs you. Buttons that open the Accept
  card say Review.
- Web: tidier Assistant header with Autopilot as one group; a phone task view with a calm one-line header and tab
  strips that only scroll sideways; dictation says why when it can't write your words down; a nicer Mark up
  button; the chat's Latest pill stays under the drawer; spaces you've read stop being bold after each new reply.

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
