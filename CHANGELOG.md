# Changelog

## 3.1.31

A patch release of fixes from the GitHub triage: the agent suggests your next message, the phone's Enter key stops
lagging, Codex tasks stop saying Working after they finish, and the Tasks rows show where each task is.

### Tasks

- Each Tasks row's second line is its reference, machine and space. What the agent is doing sits on a third line when
  there is one.
- A row shows the task's real status: a task accepted as Done no longer keeps an old Needs-you icon (GitHub #871).
- A task's folder stays while its agent is still working or asking after it said ready, so an auto-merge no longer
  pulls it out from under the agent (GitHub #919).
- A resumed agent gets a carry-on message instead of sitting idle, and an agent that stops is logged (GitHub #872).
- A Codex task whose commands finish no longer stays Working (Codex 0.163 and later).
- `herdr-task ready` titles the pull request with the task's title, in the repo's convention, and its body is the
  summary and proof, not the whole brief (GitHub #924).
- Resume and revive type the agent's command into a plain shell as it is, so zsh and bash run it (GitHub #925).
- `herdr-task list`, `show`, `where` and `autopilot list` work in a read-only sandbox such as a Codex reviewer's
  (GitHub #900).
- On a Mac, the memory check that holds new tasks reads macOS's own free memory, so a Mac with plenty free is no longer
  held at 80% (GitHub #922).

### Chat

- The agent suggests your next message, one line, and it shows as grey ghost text in the box. Enter or Send sends it,
  Tab fills it in to edit, and typing or a new reply replaces it. Settings → Agents → Suggested next message turns it
  off (built from the idea in GitHub #907).
- On a phone, Enter and the key row go down the same stream as your typing, so they land right after the text, not
  3 seconds later (GitHub #892).
- Ctrl+C copies highlighted chat text: a drag over messages keeps its selection (GitHub #916).
- Chat pictures show their thumbnails again, without ImageMagick, on ffprobe 8 (GitHub #914).
- A task's chat no longer cuts off its last row and message box at some zoom levels (GitHub #915).
- A task's chat header and the Assistant's line up: Back is a chevron on the title's line, in the same place in both.
- A published proof opens in the desktop app (GitHub #870).
- A link from another site, such as Slack, opens the web app instead of an error (GitHub #913).

### Spaces

- The # list shows the spaces each reachable machine has, named as Herdr names them, not as locked or as raw ids.
- New Space no longer crashes when its icon reply is missing (GitHub #917).

### Install and the task browser

- An update removes mods and helper files Shepherdr no longer ships, backs up what it changed and says so. An install
  that leaves a problem says NOT DONE (GitHub #895, #905).
- A Linux machine missing a system library for Chrome gets the library names and the install command, before the task
  browser starts Chrome (GitHub #918).
- On Ubuntu, when Chrome refuses to start because of AppArmor, the task browser says the exact fix (GitHub #920).
- The task browser's script runs under macOS's bash, so an update no longer skips agent-browser (GitHub #908).

## 3.1.30

A small release: a task whose checks GitHub won't show stops waiting forever, the model and effort switch without a
restart, and the Tasks panel is simpler.

### Tasks

- A pull request whose checks GitHub won't show no longer leaves its task stuck: a Ready task waits at most 20 minutes
  while GitHub blocks the merge, then shows Ready, and its Accept card says the checks can't be read. Accept still
  merges, and GitHub still refuses what its checks block.
- `shepherdr doctor` warns per repo that has tasks when its token can't read checks, and names the permission to add.
- The Tasks panel has one toggle under its search box: group by status (the default: Needs you and Ready first, Done
  at the end) or by place (each machine with its spaces). The status chips and the folder headers are gone.

### Chat

- Switch the model, reasoning level and Fast of a running Claude Code or Codex agent without restarting it, for an
  Assistant and for a worker task. The chat shows the switch at once. Only a change of agent or permission mode still
  restarts.
- The Assistant's and a task's chat headers line up: the title sits in the same place in both, with Back and the
  task's status in the margin on the left.
- On a web-only install, the Assistant's restart no longer fails with a window layout error.

## 3.1.29

A big batch of fixes: tasks say where they really are, calls stay calm and end only when you say so, Codex works
unattended, and many small window, web and Mac bugs are gone.

### Tasks

- A task stays Working while its pull request's checks run or it waits for GitHub ("Checks running", "Waiting for
  GitHub"), and shows Ready only once it can merge. A failing check, a conflict or a stale base goes straight back to
  its agent, and the same red checks are told once, not after every ready (GitHub #796).
- Merging works with GitHub's merge queue: the task stays Merging until GitHub says it merged. A base that needs an
  approval waits for it instead of asking you.
- A Done task's worktree goes once its agent has ended, leftovers from before included.
- Claude Code's "trust this folder?" prompt shows as Needs you, and an agent under a fish login shell counts as running
  (GitHub #755, #780).
- Running out of review rounds shows Needs you at once, not a stall 20 minutes later (GitHub #784).
- A running task keeps the Review its brief gave; a clean merge from the base after review costs no new round; a folder
  task that changed nothing needs no review; automations can turn Review off (GitHub #741, #744, #750).
- `herdr-task ready` keeps the pull request a task continues, skips a push the remote already has, and closes a branch
  rebased onto the base as nothing to merge (GitHub #737, #795, #828).
- `herdr-task reviewed --commit` names the commit a round reviewed, `--reviewer-model` and `--reviewer-effort` work,
  and `switch --space` moves the task to the space you give (GitHub #797, #803, #837).
- Settings → Machines start limits are no longer overridden by an old saved hold (GitHub #768).

### Codex

- A Codex worker publishes its proof, commits, reviews and says ready without anyone at the keyboard, and asks show one
  card, not two (GitHub #866).
- A Codex reviewer never stops on its trust or hooks screens, runs on its own sign-in, and a signed-out one hands the
  review to the task's own agent (GitHub #745, #753, #798).
- `herdr-task show`, `list` and `herdr-artifact show` work inside a read-only reviewer, and its brief says which checks
  it can't run there (GitHub #840, #841).

### Voice calls

- The agent can't hang up on its own: a call ends only when you say so, and an update waits for calls to finish
  before restarting. A chime plays when a call ends; one that ended by itself says why, with Call again.
- One calm, even voice for the whole call. Calls last up to 2 hours and 30 minutes of silence.
- Long replies are said whole, and the call says so when one is cut (GitHub #785).
- On a Mac, you can talk over the agent in a window call to interrupt it, as on the web (GitHub #790).

### Chat and window

- The sidebar draws again on herdr-app 0.1.13 and 0.1.14 (it went blank with the voice row hidden), and never scrolls
  sideways (GitHub #869).
- A second Herdr window no longer ends another machine's Assistants (GitHub #761).
- Drag a machine's heading, or use Move up / Move down in its menu, to reorder machines everywhere.
- Every copy button really copies, on every device; when it can't, it shows the words to copy.
- At Herdr's zoom, the chat keeps its spacing and its buttons and emoji pickers take the right press; long replies no
  longer overlap the next message (GitHub #751, #759, #775).
- The New space dialog keeps the keyboard and its folder list scrolls past the 8th folder (GitHub #752, #842).
- A task opens on its chat from the Tasks panel; an ended task's chat shows its messages; Permissions options no longer
  click the Fast switch under them (GitHub #740, #767, #779).
- The task header is one tidy row: Back, status and title on the left, Chat, Terminal, Artifacts and Browser on the
  right.
- Switching the worker's agent keeps its permission mode: auto stays auto (GitHub #758).

### Web app

- No bottom status bar: its machine, branch and Needs you already show in the sidebar and Tasks.
- No blank page after closing the last space; a tab on another machine opens instead of Reconnecting for ever; a Claude
  Code or Codex tab in Chat shows its chat and keeps your typing (GitHub #747, #786, #787, #818).
- Fork or Rewind from a held message no longer freezes the chat; a landscape iPad can type into a terminal; the web
  chat finds local agents' conversations (GitHub #748, #788, #862).
- The web app is shared again on tailnets whose user ids are very large (GitHub #845).

### Mac

- Dictation and window calls work with Swift 6.4 (GitHub #789).
- The agent menu's restart, switch agent and close work, and so do the chat's attach button and image paste
  (GitHub #736, #774).
- When the web app refuses every request on a Mac, it now says why; the fix itself needs a Mac to find (GitHub #777,
  still open).

### Setup, machines and sharing

- `shepherdr web https-port 8443` (or `./install.sh --https-port 8443`) shares the web app on another port; every link
  follows. Installs that never set one stay on 443. When tailscale won't share it, doctor, the installer and Settings →
  Web say tailscale's own reason, naming a port held by another app (GitHub #754, #778).
- The task browser works out of the box: Shepherdr installs agent-browser itself (no npm, no sudo), and when it can't,
  the Browser tab, `herdr-browser` and doctor show the whole message with its one fix, `herdr-browser --install`
  (GitHub #739, #799). Long task folders get short browser session names.
- An update replaces a mod file Shepherdr changed too, keeping your copy in the backup, so the new mod always loads
  (GitHub #766).
- An Assistant on another machine finds claude, and one that fails to start says why and keeps your message
  (GitHub #839).
- Secrets no longer deadlock when every machine is marked remote (GitHub #800).
- `herdr-artifact publish` works from a read-only install, never hangs silently, and survives Herdr's checker not
  connecting; `herdr-artifact guide` works on a web-only install (GitHub #735, #749, #843, #847).

Fixes GitHub #735, #736, #737, #739, #740, #741, #744, #745, #747, #748, #749, #750, #751, #752, #753, #754, #755,
#758, #759, #761, #766, #767, #768, #774, #775, #778, #779, #780, #784, #785, #786, #787, #788, #789, #790, #795, #796,
#797, #798, #799, #800, #803, #818, #828, #837, #839, #840, #841, #842, #843, #845, #847, #862, #866 and #869.

## 3.1.28

Tasks say Ready only when they are truly done, and every machine can open its own artifacts.

- A task stays Working while its agent still runs anything: a background command, a helper or a subagent. It shows
  Ready, with its news and alert, only once the agent is at rest.
- A question in an agent's last words while its own work still runs waits: the task shows Needs you once nothing
  runs. A question card or a permission still needs you at once.
- `herdr-artifact preview <id>` opens a machine's own artifact on that machine, even one that can't reach the
  machine serving the web app. It starts when asked and stops after 30 minutes unused.
- Shepherdr's own tests can no longer touch the real home's settings or hooks.

## 3.1.27

Shepherdr keeps your tasks, settings and secrets in folders of its own now, and moves them there for you. Chats show
pictures and artifact previews, and you can answer task agents' questions right in the chat.

- Updating moves Shepherdr's data out of `~/.herdr` into its own folders, once per machine: `~/.config/shepherdr`
  (settings), `~/.local/share/shepherdr` (tasks, artifacts, secrets, new tasks' worktrees) and
  `~/.local/state/shepherdr` (task browsers, the web service's files). Nothing to do: it says so in one line, and
  `shepherdr where` shows every path. `SHEPHERDR_HOME` or the `XDG_*` folders move them elsewhere.
- Nothing stops working: the old paths link to the new ones, so a machine not updated yet, an older helper or a path
  in an old brief still finds everything. Running tasks keep their worktrees where they are; new ones go to the new
  folder (or the one `tasks.worktree_root` names).
- Safe to stop halfway and run again; it doesn't move by itself on a network disk. To roll back:
  `shepherdr migrate --rollback` puts everything back in `~/.herdr`. Once every machine is updated,
  `shepherdr migrate --cleanup-legacy --yes` removes the old links.
- A repo's tasks now follow it when you rename or move its folder.
- Agents' pictures and videos show in the chat, and an artifact's card shows a preview that opens in place.
- A task agent's question shows as a card in the chat on every machine, with each option's preview and room for a
  note.
- The Accept card shows the task's proof inside it.
- Voice call is a small button beside Search; on a call it turns into Mute and End. The call screen shows the crook
  instead of the orb.
- A task's tabs are Chat, Terminal, Artifacts and Browser. Files and Changes stay in the space's side panels.
- Enter sends on a computer and makes a new line on a phone, in every chat box.
- Fewer false "Needs you": a quiet agent needs you only after 20 seconds, and a long command still counts as work.
- The task view's Back link lines up with the tabs.

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
