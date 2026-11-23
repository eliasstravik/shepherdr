# Settings

Settings is one window. Open it from the foot of the list. On a phone it is a list of sections that each push in.

## The sections

| Section | What is in it |
|---|---|
| General | Theme, Chat width, Motion, and "Alerts on this device": Needs me, Everything or Off. Kept in that browser |
| Agents | What Chats, Tasks and Reviews run on. Each row opens the picker: Agent, Model, Permissions, Effort, Speed |
| Tasks | Review by a second agent, Merge ("When I mark it as done", "When checks pass", "Right away"), Proof |
| Secrets | Add or replace a secret. Agents use it by name and never see it |
| Machines | Each machine's agents, processor, memory and disk. Add a machine. Open desktop, where a machine has one |
| Usage | How much of each plan your agents have used, with reset times |
| Plugins | A switch for Terminal, Screens, Voice, Schedules and Reactions ([Plugins](plugins.md)) |

## A space's own settings

A space's menu › Settings opens the window for that space. It shows Agents, Tasks and Secrets only.

A space starts with Everything's settings. Under each row it says "Same as Everything", or "Set here" with Reset,
which puts the row back. A secret added there is for that space only.

How agents should work is not a setting: they read the repo's or folder's `AGENTS.md` (or `CLAUDE.md`) and their own
global file, as they do anywhere. The Instructions setting older versions had is gone; the update kept what you wrote
there in `~/.config/shepherdr/old-instructions.md`, to move into an `AGENTS.md` yourself.

The picker in a message box changes that one chat or task. What new chats and tasks start with is set in Agents.

## Where they are kept

`~/.config/shepherdr/settings.json` on the serving machine: `everywhere`, and `spaces[<space id>]` for a space's own.
`herdr-task` reads it each time, and turns Review, Merge and Proof into lines of each task's brief. When the app is
served from another machine, its service keeps the file in step with that machine (`service/sync.ts`).

Secrets live in one vault, `~/.local/share/shepherdr/secrets/vault.json`, on the machine that keeps them.

## Settings from 3.1 with no row

These have no row in the window. They still apply from the settings file. To change one, ask in a chat and its agent
edits the file, or edit it yourself.

| In the file | What it does |
|---|---|
| `backup.agent` | The other agent takes over a task once when its own can't go on; `"off"` turns that off |
| `agents.reactions` | Agents react to some of your messages with an emoji |
| `agents.suggestions` | An agent may end its message with one suggested reply |
| `agents.feedback`, `agents.feedback_repo` | Agents offer once to file a problem with Shepherdr, and where |
| `tasks.review_rounds`, `tasks.must_fix` | How many review rounds, and what a review must get fixed |
| `tasks.archive_after` | Days before a Done task is archived |
| `tasks.worktrees` | Off: tasks work in the folder itself |
| `tasks.worktree_root` | The folder new task worktrees go in |
| `tasks.base` | A space's base branch |
| `tasks.branch` | The pattern for new task branches (`{n}`, `{key}`, `{slug}`; empty: `task/{n}-{slug}`) |
| `tasks.claude_flags`, `tasks.codex_flags` | Extra flags for a task's agent |
| `tasks.setup` | A shell command run in each new worktree before its agent starts |
| `tasks.start_notes`, `tasks.finish_notes` | Steps a task's agent does first and last |
| `tasks.accept_command` | A shell command run in the repo once a task is Done |
| `automations.enabled` | Off: schedules don't run |
| `machine.start_memory`, `machine.start_load`, `machine.start_disk` | A machine's limits before new tasks start there |
| `machine.low_priority`, `machine.worker_memory` | How task agents run on a machine |

Ignored from 3.2 on, wherever a file still has them: `autopilot`, `tasks.max_running` (Tasks at once), the add-ons'
`off` list and Notify.
