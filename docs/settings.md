# Settings

Settings is one window. Open it from the foot of the list. On a phone it is a list of sections that each push in.

## The sections

| Section | What is in it |
|---|---|
| General | Theme, Chat width, Motion, and "Alerts on this device": Needs me, Everything or Off. Kept in that browser |
| Agents | What Chats, Tasks and Reviews run on. Each row opens the picker: Agent, Model, Permissions, Effort, Speed |
| Tasks | Review by a second agent, Merge ("When I mark it as done", "When all checks pass", "Right away"), Proof |
| Secrets | Add or replace a secret. Agents use it by name and never see it |
| Machines | Each machine's agents, processor, memory and disk. Add a machine. Open desktop, where a machine has one |
| Usage | How much of each plan your agents have used, with reset times |
| Plugins | A switch for Terminal, Screens, Voice, Schedules and Reactions ([Plugins](plugins.md)) |
| Personal analytics | How you use Shepherdr, kept only on your machines: on or off, your numbers, see, export or delete it ([analytics.md](analytics.md)) |

## Permissions

Permissions in the picker lists the agent's own modes. Claude Code: Default, Auto, Accept edits, Plan, Bypass. Codex:
Read only, Auto, Approve for me, Full access.

Codex's Approve for me starts it with `--approve-for-me`. It works in the folder as Auto does, but when it needs more
(the network, a file outside the folder), Codex's own automatic review answers instead of you: a safe step runs, a
risky one is refused and the agent tells you why and asks. No permission card waits on you first. It is the nearest to
Claude Code's Auto, and a switch between the two CLIs carries it that way. It needs a Codex that has `--approve-for-me`
(0.163 has it). For one task: `herdr-task add|edit|start <task> --permission approve`.

## Task settings follow the repo

The settings that shape a task (Tasks and Reviews run on, Review, Merge, Proof, base branch, branch names, worktrees,
notes, extra flags) are the repo's (or plain folder's) the task works in, on its machine, whichever space started it.
A task gets Everywhere's, then its repo's, then its own (`herdr-task add --set`). `herdr-task show` and
`herdr-task config` say where each value comes from.

Settings › Tasks has "Applies to" at the top: Everything, or a repo picked from a searchable list (the repos and
folders that have tasks or a space, by machine). On a repo, each row says "Same as Everything", or "Set here" with
Reset.

## A space's own settings

A space's menu › Settings opens the window for that space: Agents (its own Assistant, "Chats"), Tasks and Secrets.
Its Tasks page lists the repos its tasks work in, each opening that repo's settings. A space on a repo has
Repo settings in its menu too.

A secret added there is for that space only.

How agents should work is not a setting: they read the repo's or folder's `AGENTS.md` (or `CLAUDE.md`) and their own
global file, as they do anywhere. The Instructions setting older versions had is gone; the update kept what you wrote
there in `~/.config/shepherdr/old-instructions.md`, to move into an `AGENTS.md` yourself.

The picker in a message box changes that one chat or task. What new chats and tasks start with is set in Agents.

## Where they are kept

`~/.config/shepherdr/settings.json` on the serving machine: `everywhere`, `repos[<folder>]` for a repo's task settings
(another machine's as `repos["<machine>:<folder>"]`), and `spaces[<space id>]` for what is a space's own. The update to
this version moved each space's task settings to its repo, or, for a space whose tasks all work elsewhere (root, on
`/`), to each repo they work in; what went elsewhere is said once and listed in `settings-moved.md` beside the file.
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
| `agents.suggestions` | Suggested replies: an agent ends its message with one to three replies you can send with a tap, or one per option (up to five) when it asks a question with options; each at most 30 characters, what a phone's bubble holds (one far longer isn't shown) |
| `agents.feedback`, `agents.feedback_repo` | Agents offer once to file a problem with Shepherdr, and where |
| `tasks.review_rounds`, `tasks.must_fix` | How many review rounds, and what a review must get fixed |
| `tasks.archive_after` | Days before a Done task is archived |
| `tasks.worktrees` | Off: tasks work in the folder itself |
| `tasks.worktree_root` | The folder new task worktrees go in |
| `tasks.base` | A repo's base branch |
| `tasks.branch` | The pattern for new task branches (`{slug}`, the title; empty: `task/{slug}`, `-2` when taken; `{n}` and `{key}` still work) |
| `tasks.claude_flags`, `tasks.codex_flags` | Extra flags for a task's agent |
| `tasks.setup` | A shell command run in each new worktree before its agent starts |
| `tasks.start_notes`, `tasks.finish_notes` | Steps a task's agent does first and last |
| `tasks.accept_command` | A shell command run in the repo once a task is Done |
| `automations.enabled` | Off: schedules don't run |
| `machine.start_memory`, `machine.start_load`, `machine.start_disk` | A machine's limits before new tasks start there |
| `machine.low_priority`, `machine.worker_memory` | How task agents run on a machine |
| `machine.home` | A machine's own Assistant, in its home folder: on for the serving machine, off for others unless set |

Ignored from 3.2 on, wherever a file still has them: `autopilot`, `tasks.max_running` (Tasks at once), the add-ons'
`off` list and Notify.
