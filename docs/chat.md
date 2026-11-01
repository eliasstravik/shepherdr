# Chats

Every agent, coordinator or task agent, gets the same chat.

- Pick a space; write to its coordinator. Ask it for a task; tasks are created only through a coordinator.
- What you send shows in the chat the moment you tap Send, faded until it is in. If it can't go through, it says so
  under the message, with Retry and Remove; it is still there after a reload.
- Write to a busy agent any time: it goes in at once and steers the agent mid-turn (Claude Code and Codex take it
  at their next step). It waits only while the agent shows a menu or permission prompt, where typed text could pick an
  option (the bubble says so, and it goes in once the prompt is answered), or while the agent is still starting or
  its machine is out of reach; only then does the bubble carry a note. Commands like /compact or a model change wait
  for the turn to end.
- An agent whose saved session is gone starts anew by itself, in the same chat, with "Earlier session was gone, started
  a new one." Any other start that fails shows its CLI's own words as a line in the chat, and your next message tries again.
- An agent stopped at its CLI's own screen before its session starts (trusting a folder, the theme, signing in, Codex's
  hooks, or anything a later CLI version adds) shows that screen in the chat as a card within about 10 seconds, and
  counts as Needs you. The card shows the choices it can read, and one tap presses that choice in the terminal. A
  screen with no choices to read may still be a slow start, so its card comes a few seconds later, and Open terminal
  is the way on. Each next screen is its own card. Nothing is pressed if the screen
  has changed since the card was drawn, and a card that goes unused closes when its answer comes from the terminal or
  the agent starts. Outside Isolated workspaces Shepherdr pre-trusts nothing, and Codex asks in any new Git repository,
  even on a machine set to bypass; its task worktrees share their repository's answer.
- Claude Code's own question tool and plan approval are cards, never permissions: a question is a choice card with an
  Other answer, a plan is Plan to approve (stop asking, keep asking, or change the plan). The answer goes back to Claude
  through its permission hook, so nothing is typed into its screen. Handled in the terminal instead, the card closes.
  Codex's own question tool (`request_user_input`, by default offered only in its Plan mode) has no card yet: answer it
  in Terminal.
- `/model` (with or without a name) never reaches the CLI, which would save it as the device's default for every later
  agent. It opens Restart agent instead, with the model you named picked, and that changes this agent only.
- Any other slash command you type (`/clear`, `/new`, `/compact`, a custom one) goes into the agent's CLI as
  you typed it, once its turn is over, and the CLI runs it. The chat shows it as you typed it, and what the CLI printed
  as its answer. After `/clear` or `/new` a quiet New session line starts the new session, whose log the chat reads
  from then on. A menu or view the command opens in the terminal (`/usage`) comes into the chat and is
  closed, so your next message goes in; one that asks a question (Codex's `/new`: where should the new conversation
  run?) is a card to answer, and what you write meanwhile waits for it. A command the CLI didn't run fails with Retry.
- Every chat shows what its agent does, calmly and in plain words (Claude Code and Codex, read from their logs). Just
  before a turn's last reply its steps sit as at most three quiet rows, each an icon for its kind (read, edit, run,
  search, web, subagent) and what it did: `Checked the task list`, `Edited 2 files: app.ts, panel.tsx  +12 −3`,
  `Ran tests: 41 passed`, `Searched the code for “review”`. Files read or changed group into one row, and the rows that
  say most (changes, test runs, failures) show first; `4 more · 5m` shows the rest. A tap on a row opens what it ran
  (the command, the path, the pattern) and its output or diff; no command line shows until then. The words come from
  the agent's own short description of a command (Claude Code's `description`), else from what the command runs
  (`git status` is `Checked git status`, `bun test` is `Ran tests`, an unknown program `Ran <its name>`), else the
  tool. While a turn runs, one quiet line in place of the typing dots says what it does now and for how long
  (`Checking the task list  12s`), coordinators' turns too (their header still says nothing of it). While work it
  started in the background runs (subagents, background shells and monitors, a headless `codex exec` or `claude -p`,
  which counts as a subagent), a small tag sits just above the message box (`1 subagent · 1 shell`), only in its own
  chat (task rows stay clean); a tap shows each piece, what it does now (its latest step, or its output's last line)
  and for how long, and each opens to its own steps or its recent output. Nothing streams by default and nothing
  flashes; a turn it answered with nothing (news it had nothing to say about) shows no rows.
- On a phone or tablet it behaves like an app: every screen it opens (a space, a task, the sidebar drawer, settings,
  search, a task's Files or Diff, an artifact) is a step back, so iOS's swipe back and Android's back go one step at a
  time (task, then space, then the sidebar) and an alert's link opens with its space behind it. Swipe from the
  left edge for the sidebar (left again to put them away), right across a task's chat or settings to go back, and down
  on a sheet's grabber to close it; each follows your finger, and a quick flick is enough. A message slid right still
  replies, and held it still reacts. Screens push and pop, sheets slide, menus spring, tasks glide between groups; with
  reduced motion they just fade. No pull to refresh: everything is live.
- On a desktop, or a tablet with a keyboard, everything works from the keyboard: press `?`. Option+↑/↓ (Alt off a
  Mac) goes to the space above or below in the sidebar, as it shows (headings and folded ones skipped), from
  anywhere, the message box too, and leaves you typing in that space's box.
- On a wide screen, drag a sidebar's inner edge to resize it (double-click resets). Hide the sidebar for more chat room
  with the button at its top or `⌘B`. Each device remembers its own.
- Split view, as Slack's: on a desktop the middle holds up to three panes side by side (as many as the window has room
  for), each a space's chat, a task's chat, an artifact or a space's tasks, with its own header and message box. Open
  one with **Open in split view** in a space's or task's ⋯, an artifact card or full screen, or a task's header ⋯, or
  `⌘`-click (Ctrl-click off a Mac) a space, a task or an artifact's title. The focused pane has a thin line along its
  top: the sidebar's selection, the lists on the right and the keys follow it, and a space picked opens in it. Drag
  the line between two panes to resize them (double-click shares the room evenly); each pane's header has **Make it
  the only one** and **Close pane**. Each device remembers its own; a phone or tablet shows one at a time, as always.
- A task's chat has a side panel, like T3 Code's: on a desktop a column right of the chat, opened with the toggle at
  the end of the task's header, resized by its edge, its tabs **Terminal**, **Files**, **Diff** and **Pull request**
  (open or shut, width and tab remembered on the device); on a phone or tablet the same items in the task header's ⋯,
  each a full-screen sheet that Back closes (on a desktop its ⋯ lists them too). Every chat's ⋯, a task's or a
  coordinator's, starts with **Search in this chat**. All of it is read only. Terminal is the agent's live herdr terminal: click
  it and every key goes in, Esc too; `Ctrl+`` ` opens it and goes back to the chat. It is drawn at the terminal's own
  size, whoever watches: opening a view never resizes the agent, a phone and a desktop see the same screen, a narrow
  view pans sideways and a pinch (or `Ctrl` and the wheel) zooms. Files lists the worktree (tracked
  files and new ones git doesn't ignore), finds one by name and shows it highlighted. Diff shows what the task changed
  against where it left main, committed or not: its files as a tree with lines added and taken out, and each file's
  unified diff. Pull request shows the task's PR on GitHub (state, checks, a link), asked of `gh` on the remote's own
  host; greyed out until one is open. The server reads only that worktree: a file is read only when git lists it
  there and it really lies inside it (no `..`, no links out, nothing ignored, never `.git`). Coordinator chats have no
  panel; their terminal flips the chat, from the ⋯ menu or `Ctrl+`` `.

Every agent learns the chat lines, cards, artifacts and the `shepherdr` command from
[skill/shepherdr](../skill/shepherdr/SKILL.md); coordinators their tasks, news, merges and Autopilot from
[skill/shepherdr-coordinator](../skill/shepherdr-coordinator/SKILL.md); task agents the way from brief to merged from
[skill/shepherdr-agent](../skill/shepherdr-agent/SKILL.md). Their launch prompts (`server/core/agents.ts`) carry those skills and say who they are and
their space (and a home space's machine duties) or task. `shepherdr help` lists the command.

## Needs you

Needs you sits beside the chat: a tab with Tasks and Artifacts on a wide screen, and in the bottom bar on a phone. It
lists everything waiting on you, from every space on every machine, oldest first, each card once: questions,
permissions, plans, merges, secrets, CLI screens, and agents that just wait for a reply, a coordinator too once it ends
its turn on a question.

- One tap answers a question or a permission, and presses a CLI screen's choice. Merges and plans keep their pick and
  Send, and so does a card with a note typed.
- The list stays still under your thumb. A new card only ever joins the end. A card answered, here or anywhere else,
  keeps its place and its height until you leave Needs you, or tap Clear once none is open.
- Every red count comes from this one list, so they can't differ: a space's count in the sidebar is its cards here,
  those counts add up to the number on Needs you, and the app icon adds the Ready tasks. Tasks shows only Ready in its
  tab, and a task with two cards counts as two in its Needs you group. A task whose merge waits on you is on both
  lists: its card here, and its row under Ready in Tasks.
- A card still lives in its agent's chat, and can be answered there too. A task's card in the coordinator's chat is
  only a row saying what happened: while it waits, a tap on it opens Needs you.
