# Cursor CLI in the NeuralHerd fork

Install and sign in to Cursor CLI first. `cursor-agent` must be on the agent machine's PATH.
This integration was checked with Cursor CLI `2026.11.05-86047df` and Shepherdr 3.1.14.

After installing this fork, start a fresh session. Settings → Agents offers Cursor for the
Assistant, workers and reviewer when the CLI is installed. Choose **Auto** or a model from
your account's `cursor-agent --list-models` output. Existing role choices stay unchanged.
The same choices are available in the desktop and web chat model menus.

For a task, `herdr-task add "Describe the work" --agent cursor --model auto --folder /path/to/repo`
records the choice; adding alone starts nothing. Apply your usual checkout and review settings
when starting it. Role templates still supply the Assistant, worker and reviewer instructions,
including personal workflow guidance you have added to those templates.

## Models and permissions

Cursor model IDs can include reasoning and speed variants or bracket parameters. They are passed
unchanged to `--model`. Shepherdr does not invent separate effort or Fast options for Cursor;
using those fields directly is refused with an explanation.

- **Auto review** starts with `--auto-review`.
- **Read only** starts with `--mode ask`.
- **Full access** starts with `--force`, only when selected.

Workspace trust and sign-in remain Cursor's own prompts. The integration never adds `--trust`,
`--approve-mcps`, or disables the sandbox. Its own task commands use Cursor's selected permissions,
so they can still ask for approval. Switching CLI starts a new conversation with a handoff from the terminal screen;
restarting Cursor uses `--resume` for its saved conversation.

## Chat and startup context

The reader follows the exact Cursor chat database held open by the agent process or a child,
then finds that session ID's JSONL transcript under `~/.cursor/projects/*/agent-transcripts/`.
It never chooses the newest chat in the working folder. Messages and tool requests appear in
Shepherdr chat. Cursor's transcripts omit tool results, so those are not presented as verified
successes; use the terminal for full tool output. Logs without a known session ID are not guessed
after a crash. Cursor CLI does not expose a conversation-copy command, so Fork reports that it
is unavailable rather than resuming the same conversation in a second agent.

The installer adds a `sessionStart` entry to `~/.cursor/hooks.json`, preserving existing hooks.
It supplies Shepherdr's settings, reaction and artifact context only inside Herdr; outside Herdr
it emits nothing. Uninstall removes only Shepherdr's entries. Use `--no-hooks` to omit this context.

Cursor sign-in/permission cards and desktop interaction still need a live window check. Automatic
backup takeover remains the existing Claude/Codex feature. No HolyCow-specific model assignments
or personal settings are built into this fork.
