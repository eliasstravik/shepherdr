# The chat

What you can type in a chat's box besides a message, and the keys that help.

## Sign in

When Claude Code, Codex or a connector asks you to sign in, open its chat and tap **Sign in**. A waiting task also
appears under **Needs you**. The sign-in link opens in the browser on the phone or computer you are using.

- Claude Code offers a Claude subscription or Anthropic Console billing. If Claude gives you a code, paste it into
  the card. Bedrock, Microsoft Foundry and Vertex AI use credentials set up on the agent’s machine.
- For Codex on another machine, choose the ChatGPT device code. Device sign-in has to be enabled for your account
  or allowed by your workspace. An OpenAI API key goes through the masked Secrets box for the agent’s machine.
  Tap **Reopen chat** when Codex needs to reload its sign-in. Choose the standard ChatGPT browser option only
  on the computer running Codex.
- For a connector, pick it in the card when prompted. The card may ask for the complete address from the
  browser’s address bar, even when that final page could not open. Use **Open terminal** when your provider
  needs machine setup or your Codex version does not offer a paste-back connector login.

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
