# Changelog

## 3.2.25

### What you will notice first

- MCP tool views now show even when a folder brings its own MCP setup (like Flowbound's `.mcp.json` or
  `.codex/config.toml`). Nothing to set up per folder: while MCP Apps is on, every agent Shepherdr starts, Claude Code
  and Codex, here and on your other machines, gets its MCP servers behind `herdr-mcp` by itself, and nothing in the
  folder changes. [MCP Apps](https://github.com/eliasstravik/shepherdr/blob/v3.2.25/docs/mcp-apps.md) says more.

### Also

- Claude Code only gets the folder's servers you already approved; a new one still asks first. Codex only gets a
  trusted folder's servers, as Codex decides itself.
- Turning MCP Apps off makes agents start as they did before, on every machine.

### Updating

Run `shepherdr update`.

## 3.2.24

### What you will notice first

- MCP tool views now also show for agents on your other machines (your VMs). Add the server with `herdr-mcp` in
  front there the same way, and its views show in the chat like any other.
- `herdr-mcp` is now installed on every machine with the other tools, so the same `claude mcp add ...` or
  `codex mcp add ...` command works everywhere. [MCP Apps](https://github.com/eliasstravik/shepherdr/blob/v3.2.24/docs/mcp-apps.md)
  says more, including `--scope user` to add a server to every folder in Claude Code.

### Also

- Saying **Always** to a view's tool calls now counts per server and machine: the same server on another machine
  asks again.

### Updating

Run `shepherdr update`.

## 3.2.23

### What you will notice first

- MCP tool views now show inside the chat. When an agent calls an MCP tool that has its own view (like
  Flowbound's), you see that view under the call, on a computer and on a phone. Open it full screen, and say yes
  or no when a view wants to run a tool.
- To turn it on, put `herdr-mcp` in front of the MCP server when you add it to your agent, for example
  `claude mcp add flowbound -- herdr-mcp flowbound -- npx -y flowbound mcp` (or `codex mcp add ...`), then
  restart the agent. [MCP Apps](https://github.com/eliasstravik/shepherdr/blob/v3.2.23/docs/mcp-apps.md) says
  more. You can switch it off in Settings › Plugins › MCP Apps.

### Fixes

- `shepherdr doctor` signs in to the service when it checks it, so it no longer calls a running service broken.

### Updating

Run `shepherdr update`.

## 3.2.22

### What you will notice first

- Needs you alerts are for questions only you can answer. Routine task waits go to the space's Assistant, and
  old alerts clear when the task can move on.
- New Codex tasks use a permission hook that stays the same across updates and permission modes. That keeps
  changes to the hook from stopping new tasks.
- Codex and Claude Code start screens show up as cards under Needs you. The card shows your choices and opens
  the terminal so you can answer there. Startup menus stay visible on narrow screens, too.
- Effort levels use capitals, and Fast and Ultra-fast have lightning bolts. The labels fit on narrow screens.

### Fixes from GitHub triage

- Find Everything by name and tag it in chat. Kept artifacts stay in their space, and Back from an artifact
  takes you to the chat, task or list you came from. The task pane opens at the newest reply.
- Task names in messages open the right task on the right machine. You can send a reply to a task's own chat.
- Codex keeps its reviewer when signed in with an API key. If Shepherdr needs to change the reviewer, the
  review card says why. The Codex permission choices explain what each one lets the agent do.
- Secret requests show which vault will keep the secret. The terminal warns you if it and the app use different
  vaults.
- A scheduled task keeps its start time when started again unless you ask to run it now. Deleting a task
  also clears its branch and checkout when the checkout is clean and the branch belongs to that task.
- Tasks and artifacts follow a moved or renamed repo. Marking work ready keeps the pull request on the task's
  branch unless you pick another one. Accept uses a merge method the repo allows.
- On macOS 27, a background service account can block the web app from letting you in. If you hit that problem,
  see [macOS service accounts](https://github.com/eliasstravik/shepherdr/blob/v3.2.22/docs/settings.md#macos-service-accounts)
  for how to let a trusted service account through and what access that gives it.

### Updating

Run `shepherdr update`. Codex may ask you to review Shepherdr's permission hook once after this update. If it does,
review it in the Codex terminal before starting work.

## 3.2.21

### What you will notice first

- Pick Standard, Fast or Ultra-fast under Speed wherever the agent and model offer them. Set defaults for chats,
  tasks and reviews, or pick a speed for one chat, task or schedule. A chat keeps its own speed, including when
  you reopen it. Faster tiers can use more of your plan.
- When you change a running chat's settings, the button says Update in place of Done. With the agent idle,
  Update reopens the same conversation with your choices and shows what changed in the chat.
- Chats and terminals open at the bottom so you see the newest line first. Chat reactions and reply quotes are
  easier to tap.
- Codex questions show up in the chat. The card opens the agent's terminal so you can answer there.
- When Claude Code or Codex needs you to sign in again or connect a tool, the app shows which command to run and
  opens the agent's terminal for you to sign in.

### Changes that protect your agent account

- Shepherdr no longer reads Claude Code or Codex login files, asks private services for usage or model lists, or
  shows their plan meters and limit alerts. For plan usage, run `/usage` in Claude Code or `/status` in Codex.
  Model menus use the providers' published lists. ElevenLabs usage still uses its official API with your own key.
- Shepherdr leaves the agent's settings files and menus alone. Update applies your choices when the agent
  reopens, through its own supported options. For sign-in, enter any codes or keys in the agent's own sign-in
  flow. Shepherdr does not run the sign-in or keep the key.
- The app no longer presses keys to answer Codex questions or accept an agent's start or folder-trust prompt.
  Answer those in the terminal, including for reviewers. Claude Code's question and permission cards still take
  answers in chat. For Rewind, use the agent's own command in its terminal where available.
- Send now for queued messages and automatic key presses after sending are gone. Claude Code can queue a message
  during a turn. If a send gets stuck, you can tap Retry yourself. Answer any open terminal question before sending
  a new message. Automatic recaps are gone, and Recap is still in the chat menu.
- A recurring task pauses when its agent reports a limit, needs to sign in, or gets a provider refusal. Check
  the agent on its own machine before resuming the schedule.

### Updating

Run `shepherdr update`. There is no one-time setup.

## 3.2.20

Recaps in the chat, an Update button for any agent, alerts that show their words, two new plug-ins you can switch on
(Files and Changes), and many things from 3.1 brought back.

### What you will notice first

- Coming back to a chat after 15 minutes away shows a short recap of what happened, in an outlined block with a
  clock. Claude Code's own recaps and heads-ups show the same way, and Recap in a chat's menu asks any agent for one.
  Switch recaps off in Settings › Plugins.
- A chat on an older Claude Code or Codex offers Update: it runs the agent's own update and reopens the same
  conversation.
- An agent's alert now shows its words: on the task's row under Needs you, as a card inside the task with Copy, and as
  a toast that stays until you close it.
- Nothing is pinned above the message box any more for a waiting question or secret: the card stays where it was
  asked, and Needs you, the badge and notifications still carry it. A secret ask that is no longer needed closes by
  itself.

### Off until you switch it on

Two new plug-ins, both off by default. Switch them on in Settings › Plugins.

- Files: the shown space's folder as a tree, on its own machine. Drop files from your computer onto a folder, or drag
  files between folders.
- Diff viewer: a Changes pane beside Tasks and Artifacts. What a task changed against its base, or what isn't
  committed in a space's folder, file by file and read only. A Ready card's files open there too.

### Chat

- # and @ open the space and task picker again, following the cursor as you type.
- / lists the agent's own commands again, and /model opens the agent picker.
- A message held for the agent's turn is a row over the box with Send now, Edit and Remove.
- Question cards get Other… (your own answer) and Chat about this. The scroll button says "1 question below" and
  goes to it; a reply quote jumps to its message.
- Background jobs and helpers show over the box again, with their output and a Stop button.
- Restart in a chat's menu reopens any running Claude Code or Codex on the same conversation, even mid-turn or stuck.
  End stops a space's Assistant (it asks first); its tasks keep running.
- Text in angle brackets shows as typed, Send finishes the keyboard's half-typed word first, and a desktop's message
  box takes the keyboard when you switch chats.

### Around the app

- Search finds archived tasks and task keys, with recent spaces first. New space lists recent folders to tap, and
  offers to make a folder a git repo.
- Unread spaces are bold again and count down once read; groups and machines have Mark as read. Remove group has
  Undo, and Mark as done asks first.
- The review card shows the details an agent wrote, under its summary.
- Settings › Secrets lists every kept secret, a machine's own too, with Replace and Remove.
- An older artifact card in a chat opens the version it was posted with.
- Settings › Machines counts each machine's live agents and shows its start limits, which you can change there.
- Settings has Keep the screen on, for this device.
- Driving a screen in the side pane brings up the keyboard, with a key row (Esc, Tab, arrows, Enter, Paste).
- Voice can read the artifact open on screen.

### Tasks and Assistants

- An Assistant that was running when its machine restarted (a reboot or power cut) starts again by itself on its own
  conversation. One that can't is listed in one alert with Restart all.
- The review rounds you set are the limit: once used, the agent fixes the last findings and says ready, saying the
  last fix wasn't reviewed again. Later rounds check the earlier fixes instead of starting over.
- Proofs start with a short For you part: what to check or decide, and what isn't proven.
- Assistants start small related tasks side by side instead of one after another.
- A merge waits only for GitHub workflows that are switched on; a task merged while it waited on you is done; a ready
  task is no longer held at Needs you by an older question; Codex's ready no longer counts as a job still running.

### Left out on purpose

Some things from 3.1 stay out of 3.2. [Upgrading](docs/upgrading.md) lists each with what to do instead, for example:
Find in chat (ask the Assistant, or use the browser's find), Rewind and Fork (ask the agent to undo, or use its own
/rewind in the terminal view), Start later (ask the Assistant: "start X at 9") and Pin a task.

### Nothing to do

Updating is enough: `shepherdr update`. Nothing needs doing once.

## 3.2.19

A Night theme in true black, a card to trust a folder and start, Codex's Approve for me, quieter tabs, and many small
fixes to the chat, the web terminal, tasks and the install.

### Look

- Settings has a fourth theme, Night: a true black page for OLED screens, with the browser's and phone's bars
  black too. System still picks Light or Dark.
- The Tasks button sits last in the header, where its pane's Close lands.

### Chat

- Multi-question card answers reach the agent as the options you picked, never as "[object Object]".
- An agent stopped at Claude Code's or Codex's "trust this folder" screen shows a Needs you card: Trust this folder
  and start, or No. It is never automatic, and it reaches the phone and the watch.
- A round button jumps to the newest message when you scroll up, with how many are new; End does it too.
- An open chat stops showing working as soon as its agent finishes.
- Wide tables keep readable columns and scroll sideways on a phone.
- The fade above the message box no longer leaves a band at high zoom or dims the scroll bar.
- An open task's header shows its live status line under its title, and a waiting Ready card moves below messages
  said after it.

### Web terminal

- The terminal you type in shows a solid blinking cursor.
- The key row no longer brings up the phone's keyboard, and stays above it on a foldable.
- Ctrl+D or `exit` closes your own terminal instead of starting a new shell.
- Folding or unfolding keeps the open terminal, and a terminal open on two screens keeps one size.

### Tasks

- Codex has a fourth permission, Approve for me: Codex's own review answers its requests, and a risky one is refused
  with the agent told to ask you.
- Ready, review state and status lines are no longer lost on a busy machine.
- A reviewer can read its own instructions, and one that never starts or freezes is caught and tried again.
- A task stacked on another task's branch moves onto that branch's base once it merges, and a started task's base
  can be changed.
- Ready and done work after a merge: after GitHub deleted the branch, after the worktree went, or after a rebase or
  squash by hand.
- reviewed and ready find the task's own branch wherever it is checked out.
- A taken-over Codex task reads its own log, never another folder's, and a schedule set to run "here" refuses a linked
  worktree instead of running in the main folder.

### Machines

- On a synced machine whose herdr-core pins one socket for every session, task agents' status and ready work again;
  sync and `shepherdr doctor` say what to fix.
- Open tabs and machine lists send only changes, and a tab in the background pauses: far less traffic.
- On macOS 27 the web app lets your tailnet in again (it no longer needs netstat).

### Install and update

- An update lets the sync to other machines go by itself, without a `shepherdr doctor` first.
- An odd byte from a helper no longer stops the install, and uninstall finishes when run from the installed copy.

## 3.2.18

A Cmd+K palette and shortcuts for everything, long pastes fold away, `!` commands show in the chat, and the chat
no longer flickers while you type.

### Shortcuts

- ⌘K (Ctrl+K) opens a palette that finds anything and runs any command; `?` shows every shortcut, and Settings ›
  Shortcuts lists them.

### Chat

- A long paste (25 lines or 2,500 characters and up) becomes a small chip in the message box: open it to read, put it
  back in the box to edit, or remove it. It is sent exactly as pasted. A long message in the chat shows folded with
  Show more.
- A line starting with `!` runs as a command in Claude Code's or Codex's own shell, and now shows in the chat as a
  command row with its state and what it printed. The box shows when it is in command mode.
- The chat holds still while you type: on Safari it no longer jumps up and down on every key.
- Suggested reply bubbles are never cut off: agents keep each one short, and the app shows every bubble whole.

### Notices

- Toasts stay long enough to read, wait while you hover them or the tab is in the background, stack up to three and
  each has a close button (Escape too). An error that asks you to do something stays until you close it.

### Voice

- Settings › Voice now holds the ElevenLabs key: add, test, replace or remove it there. It is the same key as the
  ELEVENLABS_API_KEY secret, so nothing to redo if you already have one. Talk or the mic without a key opens the page.

### Artifacts

- A proof page scrolls while its Mark up box is open, and a Reply box inside a page no longer breaks it with
  "Couldn't show this page".

## 3.2.17

Suggested replies no longer vanish when news or a message from another agent arrives.

### Chat

- The reply bubbles under an Assistant's message now stay when another Assistant's message, a news line or a quiet
  turn comes in after it. They go only when you write or the Assistant really replies again, in the chat and in the
  phone and watch feed.
- A message from another Assistant no longer shows as if you wrote it.

## 3.2.16

Agents with a command running in the background no longer look busy, and dictation no longer flashes "allow the
microphone" when it is already allowed.

### Agents and chat

- An agent that finished its turn but left a command running in the background now shows as at rest: no typing dots,
  no Stop button, not counted as Working and no "still working" alerts. The chat shows a quiet "1 background command
  running" line instead.
- A message an agent only wrote inside a background command, a loop or a function no longer shows as a "Message to …
  · Delivered" row: only a message it really sent does.

### Dictation

- The "allow the microphone" hint no longer flashes, or stays up, when the microphone is already allowed (seen in the
  installed Android app). It shows only while a prompt is really waiting and goes the moment the microphone is ready.
- When the microphone is blocked in the Android app, Shepherdr says to turn it on in the phone's settings for the app.

## 3.2.15

Shepherdr now keeps a private record of how you use it, for you and your agents, and messages you send quickly to an
agent arrive one by one.

### Personal analytics

- Shepherdr keeps a record of how you use it: messages sent and how (typed, dictated, a suggested reply or Talk),
  tasks and how long they waited, schedules, failures. Never what was said: no message text, titles or secrets.
- It stays on your machines and is never sent to anyone, not to Shepherdr's makers either.
- Settings › Personal analytics shows the main numbers for a day, week or month, lists every event as kept, and can
  export, switch it off or delete it all on every machine. It is on by default; a quiet note says so once.
- Ask your Assistant "how do I use Shepherdr, and what should I change?": it reads the record and answers. Agents use
  `herdr-task analytics`.

### Sending to agents

- Two messages sent to one agent at once no longer arrive glued together as one: they go one at a time, and the chat
  shows each one once.
- A message Claude Code takes mid-turn no longer shows twice in the chat.
- A chat that went quiet on screen notices a dead link and reconnects, so replies keep coming.

## 3.2.14

Buttons react the moment you tap them, dictation keeps your first words, and an Assistant's answer from a machine that
can't reach yours still arrives.

### Buttons

- A button looks pressed as soon as you tap it, then says what it's doing with a small spinner; the other buttons on
  the card wait until it's done, and a failure shows on the card itself.
- After an action on another machine's task, its task list is read again right away, so the row changes at once.

### Dictation

- The wave that says "start talking" now shows only once the microphone really hears you. Until then a quiet dot shows
  that it's getting ready, so a phone no longer loses your first words.

### Assistants on other machines

- When an Assistant answers a machine it can't reach, the answer waits on its own machine and yours fetches it, for up
  to 12 hours. It shows in the chat as an incoming message, and the sender's row says it's waiting and why.

## 3.2.13

The phone and watch app can see more: your spaces, unread chats, failed schedules, machines in trouble and how much
plan is left.

### The phone and watch app

- It gets your spaces, last used first, so a new task can be started by voice by sending it to a space's Assistant.
- Ready tasks say whether their review passed, whether their checks are green and how many proof pages they have, so
  "Mark as done" is offered only when nothing is red.
- Chats with a message you haven't read come with the Assistant's newest words, to read or answer from the wrist.
- A schedule that failed, a machine that can't be reached or is nearly out of memory now buzz the watch too.
- It shows how much of your plan is left, and can open a whole chat, write in it and mark it read with a much lighter
  call than the web page uses.

## 3.2.12

A chat no longer opens as a list of task rows before its messages appear.

### Chat

- While a chat's messages load, it no longer shows only the tasks' Done lines and review cards: those wait until the
  messages are in, so the chat opens as the conversation it is.

## 3.2.11

The phone and watch app can show what an agent asks in full, with its suggested replies to send in one tap.

### The phone and watch app

- Items that need you, and tasks that are Ready, now carry the agent's whole question or status, not only one short
  line.
- Where an item takes a written answer, it also carries the same suggested replies the web app shows as bubbles, so
  the phone or watch can send one with a tap.

## 3.2.10

Web addresses in a terminal open with a tap, links are easier to see, and you can put your machines in your own order.

### The web app

- Web addresses in every terminal open with a tap or click, a long one that wraps opens whole, and links a program
  marks as links work too. A long press or right click offers Open and Copy link. Only web pages open; other links
  can be copied.
- Links in the chat, on task lines and on artifact pages are now one clear link blue, easy to read on every bubble, in
  light and dark.
- The sidebar's machines can be dragged into your own order (hold, then move, on a phone), and a tap on a machine folds
  its spaces away or shows them again.

## 3.2.9

Suggested replies give you one bubble per option when an agent asks you to pick.

### The web app

- When an agent asks a question with options, the suggested replies show one bubble per option, in order, up to five,
  so you pick with one tap. A yes or no question gets both. A plain reply still shows at most three.

## 3.2.8

Every space can have its own icon, every machine, this one too, gets a home space (~) that works like any space, and a
task's chat can take the whole middle.

### The web app

- Give a space its own icon: an emoji or a picture. New space, Rename and a space's Settings have an icon button
  beside the name (Emoji, Photo, Paste picture, Reset). The icon shows everywhere the space's # was.
- With more than one machine, this machine also gets a home space (~) as the first row under it, beside Everything.
  It has its own chat and Assistant, which starts with its first message. Everything stays the top row, as before.
- A machine's home space (~) has the full space menu: rename, group, archive and remove, from its row, a long press or
  the chat header. Once renamed it shows its new name; clear the name and it reads ~ again.
- Removing a home space asks first, like any space, and stays removed; New space at ~ brings it back. Everything still
  can't be removed.
- The home space shows # like any space, or the icon you give it, in the sidebar, chat header, space pickers, Send to
  and search.
- Maximize a task's chat: it moves to the middle and stays there while you close the side pane, open Tasks or
  Artifacts, press Esc or reload. Minimize puts it back in the pane; going to another space does too. On a phone it
  opens as the task, as before.

### Tasks

- Tasks in your home folder stay Everything's unless the ~ space started them, and news of a task reaches Everything
  once, never twice.

## 3.2.7

The step line shows what an agent is doing now, every machine shows its home space, reply bubbles that are easier to
tap and never cover the chat, and schedules that no longer miss a merge.

### The web app

- The step line beside the working sign shows the step running now. An old step from an earlier turn no longer
  sticks there.
- Every other machine in the sidebar shows its home space first, as ~: it opens like any space and has its own
  Settings. A machine with no other space no longer shows an empty list.
- New space on a folder that already has a space opens that space and says so.
- Suggested replies get their own row: the chat ends just above them and fades softly instead of being cut, and a new
  set starts at its first bubble.
- All reply bubbles look the same, and a short one is round and at least a fingertip big.
- The bubbles stay while you type. A tap sends just that bubble's text; your draft, files and quoted reply stay in the
  box.
- Bubbles only react to hover with a mouse, not after a tap on a phone.

### Tasks

- A task merged and then reopened (like a release coming back to be tagged) stays merged when it's done again,
  instead of "Done, not merged".
- A schedule that listens for merges on another machine catches one that happened between its rounds, once, and one
  folder's error no longer stops it for the others.
- A schedule that listens to another machine says when it last heard from it, or that it can't hear it.

## 3.2.6

Replies you tap to send, replying to a task from the chat, question cards where they were asked, and fewer hangs and
stuck tasks.

### Once, after updating

- On Android, reinstall the app once to get the dark bottom bar: remove the installed app and add it to the home
  screen again.

### The web app

- Up to three suggested replies show as bubbles above the message box: a tap sends one, a long press puts it in the box
  to edit. The setting is now called "Suggested replies".
- Reply to a task in the space's chat: Reply in chat in a task's menu, or slide the task's row to the right. The sent
  message shows the task you replied to; tap it to open it.
- Question cards, secret asks and review cards sit in the chat where they were asked, not stuck at the end. While one
  waits out of view, a line above the message box takes you to it.
- The app opens even when its address has no slash at the end (…/shepherdr), instead of a blank page.
- While an agent works, its step line wraps up to three lines instead of being cut, and Stop stays put.
- Reactions sit on the bubble's top corner, facing the middle of the chat.
- Chat rows: a task's time no longer runs into its title, a closed question says what closed it and shows once, and
  there's no empty logo spot after +.

### Tasks

- A merge conflict goes straight back to the task's agent; the card says "rebasing" only once it was asked to.
- A pull request GitHub gives no clear can-merge answer for waits a few minutes at most, never Working for good.
- A task waiting on checks stays Working whatever language its status line is in.
- Ready no longer waits on a Monitor that has already run out.
- Reviews: a later round looks only at what changed since the last one, and only must-fix findings use up a round.
  The reviewer starts without your MCP servers, so it doesn't run out of room before reading the change.
- herdr-task never hangs on a git password prompt: it says git can't sign in to the remote instead.

### Machines

- Other machines' task lists, artifacts and health are read only while a page is open (task lists every 2 minutes
  otherwise, for alerts), so idle machines aren't kept busy.
- Your sidebar sections, icons, pins and order stay put when the host can't name the machine that saved them.
- The task browser works on Linux arm64: it uses the machine's Chromium, or says the one command to install one.

## 3.2.5

Full screen Browser and Desktop on a phone, a sidebar that's easier to use, and no more macOS keychain prompts.

### Once, after updating

- On Android, reinstall the app once to get the dark bottom bar: remove the installed app and add it to the home
  screen again. An app installed before 3.2.3 keeps its old white bar, as Chrome rarely refreshes its colours itself.

### The web app

- Browser and Desktop open full screen: pinch to zoom and two fingers to pan; a tap clicks, a drag drags, a long press
  right-clicks. A keyboard button brings up the phone's keyboard with a row of keys (Esc, Tab, Ctrl, Alt, Cmd, arrows,
  Enter, Paste). Back leaves full screen.
- Rename a machine from the sidebar: long-press or right click its heading. The menu also shows its real name, puts
  its own name back, and opens Machine settings.
- A long space name stays on one line in the sidebar, cut with "…", and the list never scrolls sideways.
- "Switch to terminal" is now "View as terminal" ("View as chat" while it's on), with its own icon below a line.
- Stop is a round stop button: a ring around a filled square.
- A reaction you just added is a small pill again, not a wide bar until you reload.

### On a Mac

- Every Chrome Shepherdr starts (the desktop, artifact pictures) skips the macOS keychain, so the "Chromium Safe
  Storage" question no longer pops up again and again.

## 3.2.4

Fixes for 3.2.3 so updating every machine works again, and a tidier message box and chat.

### Once, after updating

- The "Update Shepherdr everywhere" schedule (or any schedule of yours that runs `shepherdr update`) needs your yes
  once: `herdr-task auto edit <schedule> --may-update-shepherdr on`, from your own terminal or your Assistant (a task's
  agent can't set it). Its runs then update Shepherdr outside their own terminal and say how it went; the schedule's
  own words can stay as they are.
- On Android, reinstall the app once to get the dark bottom bar: remove the installed app and add it to the home
  screen again.

### Updating machines

- A schedule you allow can update Shepherdr again: 3.2.3's guard refused the update inside its run, so that machine
  stayed on the old version. The next run is told how the last update went.
- Machines sync works again: every machine read "can't reach" because one install step asked for more time than
  herdr-core allows. A call that is refused now shows as failed with the reason.

### The web app

- Dictation fixed: its row stays inside the message box, the wave moves, and Done and Cancel sit where the box's
  buttons are, in a soft green and red. A call's wave fills the row up to the mic.
- The + menu is Photos, then Files; no separate photo button and no Paste image (pasting a picture still works).
- Stop sits at the right end of the working row, and the tab chip lines up in the box.
- Chat rows share one even spacing and one left edge; on a touch screen each row stays big enough to tap.
- Reaction chips are small pills that hug their emoji, tucked over the bubble's corner.
- The header's count badge sits on its icon's corner, inside the header.
- Links in an artifact to other sites open in a new tab; a link to Shepherdr opens in the app. A page the artifact
  can't show says so, with Back to the artifact.

## 3.2.3

A big one: tasks named by their titles, task settings that follow the repo, a web app that updates itself, and a
calmer, roomier app on a phone and tablet.

### Once, after updating

- Shepherdr's own Instructions setting is gone: agents follow the repo's or folder's `AGENTS.md` / `CLAUDE.md` and
  their own global file. Anything you wrote there is saved in `~/.config/shepherdr/old-instructions.md`, and the
  update says so once: move what you still want into an `AGENTS.md`.
- Task settings (agent, reviewer, review, merge, proof) now follow the repo a task works in, whichever space started
  it. The update moves each space's task settings to its repo and lists anything it put elsewhere in
  `settings-moved.md` beside the settings file. Look at Settings › Tasks › Applies to, once.
- Pages already open update themselves after this release (see below). On Android, Shepherdr becomes a place to share
  into: if it doesn't show in the share sheet after a day, remove the installed app and add it to the home screen again.
- On Android, reinstall the app once to get the dark bottom bar: remove the installed app and add it to the home
  screen again.
- On a Mac, an agent's desktop needs Screen Sharing on, with its password given to Shepherdr as the secret
  `SCREEN_SHARING_PASSWORD`; `shepherdr doctor` says what is still missing.

### Tasks

- No more task numbers: tasks are named by their titles everywhere you read (chat, news, cards, notifications,
  pull requests). Commands take a title, or a unique part of one, as well as the hidden key.
- Each task's status icon is a ring filled by how far along it is, with its time left under it; agents estimate
  that time honestly from their own pace. Working is yellow, Needs you red with a softly tinted inside, and only a
  task waiting for Start has a dotted ring.
- The Tasks panel shows every task by default, with a filter by state, machine and space. Every task has a repo tag,
  and a task's row shows its worktree, branch and pull request with its checks.
- A task's page opens with the brief its agent got, and says why while it waits (queued, scheduled, starting).
- The Assistant runs tasks in parallel by default. A task that collides with a merge is sent back to rebase at once,
  with the files and the task that merged named, and a merge you already asked for goes through after the fix.
- A task set to merge on its own merges as soon as GitHub allows, not after optional checks too.
- Your message reaches a working agent within seconds, and the chat shows it sent, then read.
- A message is never typed into a terminal whose agent has gone: an Assistant starts again with it, and a task keeps it
  for its next start.
- A task's agent can't stop the session it runs in.

### The web app

- It updates itself after a release: a page on an older version reloads when nothing would be lost, else shows a
  New version · Update chip. Settings › About shows both versions.
- Share pictures, words and links into Shepherdr on Android; paste a picture from the + menu, or pick photos with the
  new photo button.
- A link to this app (a task, artifact or space) opens inside it, and Back returns.
- The message box's round button starts a voice call while it's empty and sends once it has words. A call shows no
  words on screen, only a live wave, with Mute and End call. Dictation shows that it's listening and gives clean text
  on Done, without losing your first words.
- Reactions sit as chips on a bubble's edge: tap for quick actions, hold for the menu, swipe right to reply.
- Messages between agents and task news are quiet rows you can open, never full bubbles.
- The working sign's dots sit in a small bubble, with the step in plain words beside it.
- Swap sides: the chat on the right of a pane, from the header's menu or a double tap on the divider.
- Each machine in the sidebar has its own filter and New space button. A space's folder shows quietly beside its
  name, as its path (`~`, `/`, `~/notes`).
- Terminal and Screen moved into the space's and the task's menus. The terminal fits the screen, opens at its last
  line and has its keys on every touch screen.
- The Desktop tab starts the desktop by itself, says why when it can't show one, and shows another machine's too.
  `shepherdr install`, `update` and `doctor` now look after the desktop tool on every machine.
- Comfortable tap sizes on phones and tablets; names and titles wrap to two lines before they're cut.
- Dark by default even before the page loads; artifacts fill their panel and never show a broken picture; sent
  pictures don't jump; bubbles never run past the chat.
- No phone notification for an alert while the app is on screen on that phone.

### The Herdr window

- After 3.2, the old Shepherdr views in an open Herdr window show a notice with an Open Shepherdr button instead of
  red error banners. `shepherdr window --remove` takes the notices out.

## 3.2.2

Fixes for 3.2.1: a machine link that broke for good after an update, a smoother app on a phone, and clearer signs of
an agent at work and of dictation.

### Machines

- A link to another machine that herdr-core refused for good ("a different core answers there") is linked again by
  carry-over, in the update or by hand, when it's safe: same address, name and session.
  The records naming the old id follow it. When it can't, `shepherdr doctor`, the home page's health, the sync report
  and the Machines page say why, in full, and what to run.

### The web app

- On a phone, the app's own colour reaches the edges: no white flash as the keyboard opens and no white strip under
  the bottom bar, in the dark theme too, also in the installed app.
- A sent message never leaves a stuck grey copy behind, also after a reload, in an older tab or with another
  machine's clock a little behind. A send cut off by a reload goes on, never twice, and Retry doesn't send one that
  arrived after all.
- While an agent works, the chat's end shows three dots that rise in turn, with the step it's on beside them when
  known, instead of three still dots and a separate working line. With reduced motion the dots brighten in turn.
- Dictation turns the message box into the recording: a live wave, the time, Cancel, Done and the words as they're
  heard. The time holds while the words are written down, and Escape cancels the dictation before it closes a dialog.

## 3.2.1

Fixes for 3.2.0, found on a Mac mini that serves the web app with machines linked to it, and a smoother app on a
phone.

### Agents and spaces

- Everything Shepherdr starts (Assistants, tasks, helpers) lands in Shepherdr's own session, not herdr-core's
  default one. The service's launchd plist or systemd unit says which session, an update writes it, and `shepherdr
  doctor` fails a unit without it.
- A new space whose Assistant didn't start still opens, with a notice saying why.
- A message to a space whose Assistant ended starts it again on its own conversation and delivers the message once.
- A message typed while an agent works goes in at once, as in 3.1. Ctrl/Cmd+Enter still holds it for the end of the
  turn.
- Everything can't be removed or archived. New space in this computer's home folder opens Everything, and a second
  space in another machine's home folder is refused.
- The message box names the model the Assistant really runs, also before its chat has loaded, and keeps the model
  picked in New space when its Assistant didn't start.

### The update and carry-over

- `shepherdr update` stops the running service before any file changes and starts it again after, also when the
  install fails halfway.
- Carry-over moves Shepherdr's agents left in the default session (an Assistant, a task's agent) into Shepherdr's,
  each on its own conversation once it's idle; a busy one waits and is named. The update runs it until none is left,
  and `shepherdr doctor` names any still there.
- Carry-over changes the records of who keeps the secrets and who serves the web app to each machine's id in the new
  session, here and on linked machines, and repairs the ones 3.2.0 left naming old ids. `shepherdr doctor` says when
  one names a machine none knows, and how to fix it.

### The web app

- No square focus outline inside the message box; it shows focus with its own quiet border.
- No blue flash when pressing things on a phone; buttons fade a little while pressed instead.
- The warnings line above the chat can always be closed, stays closed over a reload, and comes back only for a new
  warning.
- Each space's folder shows under its name in the list and search, in the open space's header, and whole at the top
  of its menu with Copy folder path.
- The Working ring turns everywhere it shows; with reduced motion it pulses slowly.
- Dictation writes the words on a phone: when the live result is empty it uploads the recording instead, and says why
  when it can't ("Nothing was heard", a blocked microphone). While it records, the mic is a red pill with the time.
- On a phone, the keyboard stays open in New space and every other dialog with fields.
- Attachments are square thumbnails in one row, with remove, upload and failed states. A tap opens a full-screen
  preview, in the message box and in sent messages.

## 3.2.0

Shepherdr is now one web app, on phone, tablet and desktop, private on your tailnet. The Herdr-window layout and its
mods are gone; the Herdr app gets one "Open Shepherdr" button.

### The new app

- The list: Everything on top, then your machines as headings, with groups and spaces under them. A space shows how
  many things need you. Drag spaces into order. New space, Feedback and Settings sit at the foot.
- Chats: Everything's chat reaches every space on every machine; each space has its own. The message box shows the
  agent, model, effort and speed, and opens the picker.
- The Tasks pane has two tabs. Now groups tasks under Needs you, Working, Up next and Done. Scheduled lists your
  schedules, with when each runs, its next run and its last.
- A task opens as a thread in the pane, with its own reply box, and can take the middle.
- "Ready for review" is one review card, in the task, its space's chat and Everything's chat. Its button reads "Mark
  as done and merge" on a branch and "Mark as done" otherwise. One answer clears it everywhere.
- Screens: every chat and task has a Screen button for the agent's browser and desktop. Watch, Take over, Hand back.
- Your own terminal in every space and task, in a drawer under the message box (Ctrl+`). An agent's own terminal is
  behind "Switch to terminal".
- Artifacts are real web pages. One opens in the pane with its versions, Pin and Mark up: point at a spot, then write.
- Settings is one window: General, Agents, Tasks, Instructions, Secrets, Machines, Usage and Plugins. A space has its
  own Agents, Tasks, Instructions and Secrets, and says "Same as Everything" or "Set here".
- The pickers: Agent, Model and Permissions as searchable lists, read from each agent's own catalog on that machine.
- Voice runs over the app: it opens things, sends messages and answers for you, and asks before it deletes, merges or
  stops anything. In a call the button becomes Mute and End call.
- Search (Ctrl+K) finds spaces, tasks and artifacts by name.
- Every feature is a plugin. Screens, Voice, Schedules, Reactions and Terminal can be switched off in Settings ›
  Plugins.

### What is gone

- The Herdr-window layout and all its mods.
- Autopilot. A repeating schedule does that now, and a schedule can also start on an event, such as a merge.
- Tasks at once. A task starts the moment it is asked to.
- Automatic retry and restart. An agent that stopped stays stopped, says why, and has a Restart button.
- The recipe format for artifacts. Old artifacts are converted to pages once, at the update.
- The Files and Changes panels, tabs, pinned spaces, per-space Notify, usage insights and the keyboard-shortcuts page.

### What carries over

- Your spaces; sections become groups.
- Tasks, schedules (the old automations), settings and secrets.
- Each chat's history, above a "New session" line.

### The update

- `git pull --ff-only`, then `shepherdr update`. It waits while tasks are working and names them; `--force` switches
  anyway.
- It takes out what 3.1 put in the Herdr app. A file you changed there is backed up first.
- If Shepherdr's layout was selected in Herdr, pick another one there.
- Shepherdr's agents now run in their own herdr-core session. They no longer show in the Herdr app, and terminals
  opened in the Herdr app don't show in Shepherdr.
- Settings from 3.1 with no row in the new window still apply. [Settings](docs/settings.md) lists them.

### For people who changed the window

- Mods removed (28): accept-card, artifacts, chat, chat-call, chat-image, chat-models, chat-react, confirm-chat,
  coordinator, jump, keybinds, machine-add-chat, menu-tasks, new-menu-tasks, newspace, pane-chat, prompt-chat,
  shepherdr-settings, spaces-chat, tabs-tasks, task-artifacts, task-browser, task-pr, tasks, tasks-menu, toasts,
  workspace-chrome-shepherdr, workspace-status-chat.
- Layout `shepherdr` removed, with its node ids (33): root, sidebar, brand, sidebar-lists, spaces, sidebar-footer,
  work, tabs, work-body, main, panel, panel-body, files, changes, tasks, tasks-list, tasks-thread, tasks-thread-head,
  tasks-thread-body, tasks-thread-chat, tasks-thread-term, tasks-thread-pr, tasks-thread-browser,
  tasks-thread-browser-host, tasks-thread-artifacts, artifacts, artifacts-list, artifacts-view, artifacts-view-head,
  artifacts-view-body, chat-call, toasts, status.
- `keys.json` contexts removed: global (24 keys), terminal (ctrl-v), mod:chat (3), layout:shepherdr (4).
- New: one Herdr mod, `open-shepherdr`, and the key `global ctrl-shift-o` (only if that key is free).

## 3.1.46

The rest of the 21 November triage: steadier task status, a smoother ready and pull request flow, fewer Codex hangs,
and many fixes.

### Tasks

- A task's status stops flapping: a Ready task stays Ready through a turn nobody asked for, or a brief wait on GitHub,
  and a cancelled approval no longer keeps it at Needs you.
- Mark done is in the web app's task menu, and a working task's pull request shows as a link.
- A task whose pull request merged into another branch, or after ready, is done and frees its slot.
- Task lists never hang on a busy list; a done task's worktree removal also stops its dev servers.
- A task started in another worktree's folder says so instead of running in the wrong place.
- Take back a fix that no longer applies.

### Ready and pull requests

- Ready can set the pull request's title and description, or open it as a draft; Accept takes it out of draft first.
- Ready keeps what people added to the pull request description, and refuses when the task is on another branch.
- A task built on an open pull request's branch goes on that pull request, never a second one.
- Accept on a closed pull request just closes the task, without merging.
- A review that's needed names what changed since the last reviewed commit.

### Codex and Claude

- A Codex question no card shows goes back to Codex's own prompt in seconds, instead of hanging for half an hour.
- A Codex worker's own tools stop asking for permission; finished helpers end.
- Telling the Assistant something ends within a minute and always says whether it got through.
- A Claude worker never starts in don't-ask mode by default; it asks on its card.
- The Claude reviewer runs with the worker's own profile and can no longer get stuck on a start screen.
- Claude sessions are found under a custom config folder, and a task a restart left in a plain shell says it needs a
  resume.

### Assistants and other machines

- A task's news goes only to its own space's Assistant; the home overview keeps only what needs you.
- Autopilot takes a space by name, and Shepherdr says when Other machines or Autopilot is switched off.
- Helpers find their tools on a bare PATH, Windows machines say they're unsupported, and the web app works with
  macOS 15.

### Browser, artifacts and chat

- The task browser stays while a Done task's agent still uses it, says when Herdr closed it, and gives up on a page that
  never loads.
- Line charts put their labels where they belong.
- A Mark up note sent while the agent asks a question waits and goes once it's answered.
- On Linux, attaching a file works without extra Python packages; on macOS, a dragged screenshot no longer vanishes.

## 3.1.45

A big catch-up: more control over how tasks start and finish, a smarter merge queue, steadier Codex, and many fixes.

### Tasks

- Give a task, or a whole space, extra Claude Code or Codex flags (like `--advisor opus`). Only real flags are taken;
  they show on the chat's model button and survive restarts.
- A space can run a setup command in each new worktree before its agent starts (Settings → Tasks). If it fails, the
  task waits and says why.
- A space can run a command when a task is accepted, for cleanup. If it fails, the task stays Done and says Cleanup
  failed.
- A task can take over a pull request that's already open instead of opening a second one.
- When the disk is full, the hold names the biggest folders.
- Worktrees get a plain package.json at their root, so tools there stop tripping.

### Review and Accept

- The Accept card shows the task's Markdown documents, in the window and the web app.
- Accept no longer gives up after 30 seconds on a slow merge.
- A reviewed task that only took in a newer main keeps its review and spends no extra round.
- Merge after checks waits only on the checks main requires.

### Merge queue

- When main or one check breaks many pull requests, you get one alert, not one per task, and the innocent ones go back
  in once.
- A pull request in the queue is taken out to push new work and goes back once its checks pass. One that conflicts, or
  just failed its group, is never queued again as it is.

### Assistants and Autopilot

- On the web, a new Assistant shows its model before your first message, and you can change it there.
- Autopilot's wakes are shorter, don't repeat task news, and wait while you're typing in the chat.
- Autopilot no longer lists tasks that merge themselves as waiting on you.
- A machine's news no longer goes to a home Assistant that can't reach it.
- The Assistant chains tasks that touch the same files, so they don't trip over each other.

### Codex

- Codex chats no longer get mixed up with Codex's own helper agents, or lost behind its start screens.
- Switching to Codex keeps the permission mode; the reviewer finds Codex installed with nvm; a busy Codex is waited for.

### Artifacts

- Table cells take links, bold and code.
- Form fields can start on a chosen value.
- Artifact preview works on every machine and is locked with a token.

### Machines

- After the network changes (like Tailscale coming back), machines reconnect right away instead of waiting.
- Serve stops on time and says plainly when it's off.

### Web and phone

- Voice on a locked phone can do everything it can unlocked, with the same spoken yes.
- Decline on the web app's secret card.
- Big task lists load faster in the panels.

### Fixes

- 24 smaller fixes from an audit: link actions, artifact checks, Find machines' cooldown, Autopilot marks, Restart
  Assistant and more.

## 3.1.44

A small release: Codex's newest models, and a crash fix for updates.

### Models

- Codex's GPT-6.2 Sol and Astra are in the model menus, in the window, the web app and Settings. Update Codex to get
  them.
- Where Codex offers it, an Ultrafast switch sits next to Fast, and you can flip it while the agent runs.

### Updates

- The task helper (`herdr-task`) no longer breaks with a zip error when an update lands while it runs.

## 3.1.43

A tiny fix: Needs you shows only tasks.

### Needs you

- What belongs to no task, like an Assistant's question card, a sign-in helper's "Finish sign-in", a memory warning or
  a failed automation, no longer shows in the Tasks panel, its counts or the phone and watch app's Needs you. You still
  get their pop-ups and pushes, and a failed automation still says so in Automations. A task's helper alert now shows
  on that task's row.

## 3.1.42

A tiny fix: the Tasks panel lists only tasks again.

### Needs you

- Assistants' new messages no longer show in the Tasks panel, its badge or the phone and watch app's Needs you. They
  stay in Chat, with its own unread dots. Tasks that wait on you and an Assistant's question cards still show.

## 3.1.41

A small release: what needs you is the same everywhere, and a call keeps going when your phone locks.

### Needs you

- The Tasks panel, the counts in the sidebar and header, the app icon's number and the phone and watch app now all use
  one rule for what needs you, so a "2 need you" on your phone always matches what the Tasks panel lists.

### Voice

- A call can carry on in your pocket: hand it from the web page to the Shepherdr Wake app and keep talking with the
  phone locked. The page shows Carrying on in your pocket, with Take it back.
- On a locked phone the call is for talking only: the agent can still pass on messages for you, but it takes no actions
  and shows no secrets or settings. Unlock the phone for those.

## 3.1.40

A tiny fix for the phone and watch app: the number by each section now always matches what it lists.

### Phone and watch

- The Needs you number in the phone and watch app now counts everything listed under it, including an Assistant's
  unread message and an agent's alert, so the number and the list never disagree.
- The app shows its sections in the same order and with the same names as the web app's Tasks panel.

## 3.1.39

A small release for the phone and watch app: it stays up to date with little data, and an alert never buzzes twice.

### Phone and watch

- The phone and watch app gets a small live feed of what needs you, what's ready and what's working, sent only when
  that changes. It uses a tiny part of the data the full web page needs.
- A device that shows Shepherdr's alerts itself no longer also gets the web page's notification, so one alert buzzes
  once. If that app loses its link for more than 2 minutes, the web notifications take over again.
- Tapping an alert in the app can open it right in the Shepherdr page you already have open on that device.

### Alerts

- In the phone and watch app, an agent's alert shows for 15 minutes at most, and goes once its task is done.
- A low-memory alert clears itself once the machine has enough memory again, instead of staying for days.
- Tapping a notification about a task that's ready opens its Accept card in the page you have open.

## 3.1.38

A small release: answer your agents straight from a notification on your phone or watch, and fewer false alarms from
automations that watch another machine.

### Notifications

- A notification can carry one button: Accept on a task that's ready, the first choice on an agent's question (like
  "Yes"), or Reply to type an answer to an Assistant or an agent. Tap the notification itself for everything else.
- After a button, the notification says what happened: Accepted, Answered, Sent, or Already handled if you did it
  elsewhere first.
- An Assistant's new message shows its own words in the notification instead of "Tap to read it".
- Notifications are short enough to read on a watch.
- A phone that turns notifications on now also hears when a task is ready for you, not only what needs you.

### Automations

- An automation that watches another machine no longer flags a short hiccup. Only when that machine hasn't answered
  for 15 minutes does it need you, and it says so plainly: "Can't reach vm-b since 23:03".

## 3.1.37

A small release: your phone's wake word now starts the call in the Shepherdr page you already have open on it.

### Voice

- Saying your phone's wake word starts a voice call with your Assistant in the Shepherdr page already open on that
  phone, instead of opening a new one. If no page is open yet, the call starts in the one you open within 15 seconds.
- Only the phone you spoke to starts the call: Shepherdr open on your other devices stays as it was.

## 3.1.36

A small release: your phone's wake word can open Shepherdr straight into a voice call.

### Voice

- Saying your phone's wake word (or opening the web app's link with `?voice=1`) opens Shepherdr straight into a voice
  call with your Assistant. If a call is already on, it shows that one.
- If Shepherdr is already open, it reuses that window instead of opening a second one.
- When the browser wants a tap before it can use the microphone, a big Start voice call button asks for it.

## 3.1.35

The 15 November fixes from GitHub: Shepherdr no longer tries SSH to machines you never linked, tasks stop getting stuck
on Working, Accept and merge behave, and updates finish again.

### Privacy and other machines

- Shepherdr no longer tries SSH to hosts you never linked, in the background or otherwise. Finding new machines is now a
  Find machines button in Settings → Machines that runs only when you press it and says first what it will try. If you
  reached an Assistant on a plain-SSH machine, link it with Add machine.
- Accept, start, merge and other actions on another machine finish even if the link drops for a moment, and say plainly
  whether anything ran when it stays down.
- With a window on two linked machines, only the hub's Home gets task news; each machine still sends its own health
  alerts, once.
- The sidebar shows the Autopilot rocket for spaces on your other machines too.
- Moving secrets to this computer (Secrets → Kept on) works instead of saying the machine isn't linked.

### Updates and install

- Updates and `shepherdr doctor` finish again when you have published artifacts; they used to end Not done and hold
  settings sync.
- An update leaves a Nix home-manager service file alone, and the web service finds `hc` and `herdr-app` wherever they
  live.
- Shepherdr checks on its agents with far less work: one read of the process list instead of a command per process.

### Tasks

- Tasks no longer stay on Working from finished background jobs, Codex tool servers, an agent's leftover shell or idle
  tidying, and finished Claude tasks stop flipping back to Working every hour.
- A task whose agent asks a question shows Needs you, also when it asks between two checks.
- Ready no longer freezes the other tasks while it pushes, updates the pull request's text and its one comment each
  time instead of adding new ones, and shows a failed push's own message.
- Starting, resuming or messaging a task right after it starts no longer launches a second agent.
- A task restarted after a crash reuses its folder, and a repo set up as bare says so when you add a task.
- When Codex's sandbox can't start on a machine, the task says why and how to fix that machine.

### Accept and merge

- The Accept card says Accept and merge when it will merge, and plain Accept when it only marks the task done.
- Accept and merge through a merge queue keep the pull request open until it merges, and a queue timeout is tried again
  once by itself.
- Merge when checks pass waits for the checks to really start (up to 20 minutes, then it asks you) instead of merging
  before they run.
- Accept always merges through the branch's open pull request, and refuses rather than merging on this machine when
  GitHub can't be reached. A reopened task stays open for its fix.
- When Accept can't start, it says so in one plain line.

### Agents and models

- Fable 5.2 is in the model menu.
- A switched Claude agent keeps your permission mode, and an Assistant started from the web or a phone uses the agent,
  model and permissions from Settings → Agents.
- Restarting a Codex worker no longer shows a broken message, and Codex workers skip the hook-trust prompt.
- A Codex reviewer that isn't signed in or can't use its model is caught before the review, with why.
- Forking a running task's chat asks first.
- An Assistant whose agent ended keeps its tab and offers Restart Assistant, on this machine and linked ones.
- A task out of review rounds reaches its Assistant at once, and the Assistant adds a round for a last-round fix.

### Artifacts and proof pages

- Code in artifacts in the window has a Copy button, also inside text, lists and callouts.
- Forms publish, previews update by themselves and never hang on Loading, and pictures keep their shape.
- The task browser saves screenshots where you asked and opens pages reliably; new `herdr-artifact check` and
  `herdr-artifact crop` commands re-check a page's drawing and crop pictures without extra tools.

### Window and web

- The Enjoying Shepherdr star prompt is gone.
- Coming back to a space puts the keyboard in its chat box again.
- The voice call button sits beside Search in the top bar.
- Settings menus (level picker, Secrets) are no longer painted over by the rows under them.
- The memory warning shows at most once every 30 minutes.

## 3.1.34

A small release: creating a new space works again, and finished Codex tasks show Ready.

### Spaces

- Creating a new space works again: pressing Create while the folder suggestions were open did nothing, and now it
  makes the space.

### Tasks

- A task run by Codex shows Ready once it's finished, instead of staying on Working when it had waited on several
  background jobs at once.

## 3.1.33

A small release: task agents say how it's going more often, and their time left is more honest.

### Tasks

- A task's agent updates its status line at least every 5 minutes while it works, not only at the start and at each
  step, so the Tasks panel never sits on an old line for long.
- Its time left is revised honestly each time from how the work is really going: when it's slower than thought, the
  time left goes up instead of just counting down.

## 3.1.32

A small release: artifacts hold clips, sounds and PDFs, Back sits beside a task's title, and switching a task's agent
no longer leaves it stuck.

### Artifacts

- An artifact can hold a video clip, a sound or a PDF, not only pictures. A clip plays in place in the web app, with
  its controls or muted and looping, a sound gets a small player and a PDF shows inline. Two clips side by side play
  together.
- At publish, a clip with no still picture gets its first frame, and a clip no browser plays gets an mp4 copy (with
  ffmpeg; without it, the notice says so). The window shows the clip's still and says it plays in the web app.
- Sizes: a video up to 40 MB, a sound 20 MB, a PDF 25 MB, a picture 4 MB, the whole artifact 64 MB. A file that's too
  big is refused with what to do about it.
- The artifact guide and the agents' instructions say a short clip beats a GIF.
- The web app's artifact viewer keeps a pair or a stats row in two columns.

### Tasks

- Switching a task to another agent no longer leaves the new one sitting on Interrupted with a false Needs you: the
  old agent ends first, then the new one picks up its session and carries on.
- In a task's chat, Back sits level with the middle of the task's title and status line, a little bigger and closer
  to the title.

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
