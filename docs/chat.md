# The chat

What you can type in a chat's box besides a message, and the keys that help.

## Sign in

When Claude Code, Codex or a connector needs you to sign in, its chat shows a card that says what to run, and a
waiting task also appears under **Needs you**. Tap **Open terminal** and sign in there yourself: Shepherdr never
types a sign-in command, pastes a code or keeps a key for you.

- Claude Code: run `/login` (a connector: `/mcp`).
- Codex: run `codex login`, or `codex login --device-auth` on a machine without a browser (a connector:
  `codex mcp login <name>`).

[Claude Code authentication](https://code.claude.com/docs/en/authentication) ·
[Claude Code connectors](https://code.claude.com/docs/en/mcp) ·
[Codex authentication](https://learn.chatgpt.com/docs/auth) ·
[Codex connector login](https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs)

## Commands with `!`

A line that starts with `!` runs as a shell command in the agent's own folder, the way Claude Code's and Codex's own
boxes do. The box shows it: **Run as a command** above it, the line in monospace. Sending it puts a command row in the
chat, on your side: the command, then how it went (Sending…, Running…, Done, Failed) and what it printed under it (its
last 8000 characters when long). A quoted reply or files in the box stay there for your next message: a command goes
alone, or it would arrive as a message.

What each agent does with it (checked with Claude Code 2.1.331 and Codex 0.163.0):

| | Claude Code | Codex |
| --- | --- | --- |
| Runs it | yes, in its bash mode | yes, as its `!` shell command |
| While it works | waits in its queue, runs when the turn ends | not checked yet |
| The agent sees it | yes: the command and its output are in its context | yes: the command, exit code and output |
| Done or Failed from | where it printed (success to stdout, failure to stderr; nothing at all on a silent failure) | its exit code |

Before this, the line went in the same way and ran, but the chat showed nothing: the logs keep `!` runs as their own
lines (`<bash-input>`/`<bash-stdout>` in Claude Code's, `<user_shell_command>` in Codex's), which the chat skipped.

An agent with no such shell (none that Shepherdr starts today) can't run it: the box says so, Send stays off, and
**Open your terminal** opens your own shell under the chat instead.

For more than a line or two, your own terminal is the better place: the space's name menu › Terminal, or Ctrl+`.

## Keys

| Keys | What they do |
| --- | --- |
| Enter | Send |
| Shift+Enter | A new line |
| Ctrl+Enter (⌘+Enter) | Send, held until the agent's turn ends |
| Ctrl+K (⌘+K) | Search spaces, tasks and artifacts |
| Ctrl+` | Open or close your own terminal under the chat |
| Esc | Close a menu or the message's quick actions |
