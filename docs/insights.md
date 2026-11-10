# Usage insights

An add-on that keeps a private log of how you use Shepherdr, so your own Assistant can look at it and suggest better
ways to work when you ask ("How do I use Shepherdr? Any tips?").

## The promise

- **Yours alone.** The log stays on your own machines, in `~/.local/state/shepherdr/service/`. It is never sent to Shepherdr's
  makers, to any server or to anyone else. No analytics library, no telemetry. The only hop is the web app handing
  its events to your own Shepherdr service, the same one it already talks to, which writes them on its machine.
- **Never your words.** It keeps kinds, ids, counts and times: which screen, for how long, which button, which
  feature, that an error showed. Never a message, a secret, a file's contents or what you typed.
- **Read only when you ask.** Your Assistant reads it only when you ask about how you work, and never sends it on.
- **Off is off.** Settings › Window › Add-ons › Usage insights: off, nothing more is recorded. Delete, right under the
  switch, removes the log on this computer and on your other machines.

On by default: it is your own data on your own disk, like your shell history, and tips need some history to be any
good. Switch it off any time.

## What is recorded

Only what Shepherdr keeps nowhere else, one JSON object per line in `usage.jsonl`:

| kind | When | Fields |
|---|---|---|
| `view` | A screen or tab you leave, with the time you spent on it | `view` (place, task, settings, artifact, search, tab), `space`, `task`, `tab`, `artifact`, `section`, `ms` |
| `act` | A main control pressed (the web app's actions, Accept in the window, a call's actions) | `type`, `task`, a setting's `key` (never its value) |
| `send` | A message you sent | `from`, `n` (files attached) |
| `feature` | Dictation, a voice call, Find in a chat, Jump | `type` |
| `error` | An error shown to you (a failed action, an error toast) | `type`, `status` |
| `ask` | An agent's question or permission closed | `type` (permission, question, plan), `ms` waited, `from: terminal` when answered there |

Every line has `at` (ms) and, when known, `from`: `web`, `phone`, `window`, `voice` or `terminal`. Anything else is
dropped before it is written (`core/usage.js`).

What Shepherdr already keeps is read where it lives, not copied: tasks and their timings (`herdr-task list --all
--json`), Autopilot's wakes (`~/.local/share/shepherdr/tasks/.autopilot.json`) and when you wrote to agents (their own logs). The
Assistant's instructions (`templates/assistant.md`, Usage insights) say where each is.

## Size

At 2 MB the log becomes `usage.1.jsonl` and a new one starts; the one before that goes. At most about 4 MB per
machine. Delete leaves an empty `usage.deleted`, whose time keeps a late batch from bringing older events back.

## Each machine its own

The window, the web app's service and voice calls each write to the machine they run on. Your Assistant reads another
machine's log over your own machines' link (`hc exec --on <machine>`), only when you ask.

## How it works

- `core/usage.js`: what may be kept (`clean()`), the file names, the size cap and the shell lines that append and delete.
- `lib/usage.js`: the window's writer (`note()`), and the space and tab shown with the time on each (the tab bar).
- `service/usage.ts`: the service's writer: the web app's events (`POST /api/action { type: "usage" }`, from
  `web/src/usage.ts`, every 30 s), a voice call's sends and actions, closed asks; and Delete for every machine.
- `test/test_usage.py` checks that nothing in these files can call the network.
