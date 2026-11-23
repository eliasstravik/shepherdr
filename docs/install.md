# Install

Shepherdr 3.2.2 is one web app and the service behind it. One script puts everything in Shepherdr's own folder, starts
the service and shares the app on your tailnet. There is one kind of install.

## Requirements

- macOS or Linux, with herdr-core 0.1.17 or newer (`hc --version`).
- python3 3.8 or newer, git, and Claude Code or Codex, installed and signed in.
- Tailscale, signed in: the app is shared on your tailnet only.
- Bun runs the service and builds the app. The installer installs it from bun.sh when it is missing.
- Optional: `gh` (pull requests), `jq` (question cards), an ElevenLabs key for voice and dictation, the Herdr app.

## Install

```bash
git clone https://github.com/eliasstravik/shepherdr && cd shepherdr
./install.sh --dry-run      # what it would do; nothing is written
./install.sh                # do it
shepherdr doctor            # check it; it prints the link
```

Open the link in a browser on any device on your tailnet. `shepherdr web status` prints it again.

A fresh clone has no built app (`web/dist` isn't in git). The installer builds it with Bun when it is missing or older
than its sources. A build that fails stops the install before anything is written.

## What goes where

| What | Where |
|---|---|
| Everything Shepherdr runs: the service, the built app, `herdr-task`, `herdr-artifact`, the helpers, the hooks, the installer | `~/.local/share/shepherdr/` |
| What it installed, a sha256 per file | `~/.local/share/shepherdr/installed.json` |
| Helpers on the PATH | links in `~/.local/bin`: `herdr-task`, `herdr-artifact`, `herdr-secret`, `herdr-browser`, `shepherdr` |
| The agents' instructions | `~/.config/herdr-core/templates/{assistant,worker,reviewer}.md` |
| The service | Linux: `~/.config/systemd/user/shepherdr.service`. macOS: `~/Library/LaunchAgents/dev.shepherdr.service.plist` |
| Question and permission cards | hooks in `~/.claude/settings.json` and `~/.codex/hooks.json`; `--no-hooks` leaves them out. Codex asks once to trust a new hook |
| The "Open Shepherdr" button | `~/.config/herdr-app/mods/open-shepherdr`, and the key Ctrl+Shift+O in `keys.json` when that key is free. Only when the Herdr app is on this machine |
| agent-browser, for Screens | one on the PATH when it is 0.41.x from 0.41.1, else Shepherdr's own copy in `~/.local/share/shepherdr/agent-browser/<version>/`, and Chrome for Testing in `~/.agent-browser` |

Shepherdr's own folder is replaced whole on every update. Never overwritten: an instructions file you changed (the
new one goes beside it as `<file>.new`), a key you set, a Herdr mod named `open-shepherdr` that isn't Shepherdr's
(`--adopt` backs it up and takes it over). What it replaces of yours goes to
`~/.local/share/shepherdr/.shepherdr-backup/<time>/` first.

Last, the install checks that it is whole, as `shepherdr doctor` does. When it isn't, it says `NOT DONE` with each `✗`
reason.

## Options

```text
./install.sh [--root DIR] [--dry-run] [--adopt] [--no-hooks] [--no-build] [--force] [--port N] [--https-port N]
shepherdr update      the same again, from the checkout it was installed from (git pull it first)
shepherdr doctor      [--root DIR]: checks the install and says how to update
shepherdr uninstall   [--root DIR] [--dry-run]
shepherdr web status  which machine serves the app, and its link
shepherdr where       every folder Shepherdr keeps data in
```

- `--port N` moves the service off `127.0.0.1:7788`. `--https-port N` shares the app on another tailnet port than 443.
  Updates keep both. [The app](web.md) has more.
- `--root DIR` installs under another folder instead of your home: a scratch try you can look through. It starts
  nothing there.
- `--force` installs although a check failed, or switches from 3.1 while tasks are working.
- `--web`, `--guard` and `--keys` from 3.1 are still accepted and do nothing.

## Doctor

`shepherdr doctor` checks every file it installed, the links, that `herdr-task` runs, the hooks, the programs it
needs, where your data is, that the service answers, and where the app is served. It prints `✓ whole` or each `✗`
with the fix. It also says how this install updates.

## Coming from 3.1

`shepherdr update` does the switch. [Upgrading](upgrading.md) says what it does and what carries over.

## Other machines

Nothing to install by hand. `herdr-task` copies itself, `herdr-artifact`, `herdr-secret`, `herdr-browser` and the
agents' instructions to every linked machine. While an install or update replaces one of those, a sync hold
(`sync-hold` in `~/.local/state/shepherdr`) stops every copy until `shepherdr doctor` finds the install whole. So a
half-done copy never reaches every machine.

`shepherdr web install-on <machine>` installs the whole of Shepherdr on a linked machine, for serving the app from
there ([The app](web.md)).

## agent-browser

Screens use [agent-browser](https://github.com/vercel-labs/agent-browser). Shepherdr pins 0.41.1 and works with any
newer 0.41.x. When there is none, install, update and an agent's first `herdr-browser` command install Shepherdr's
own copy: the release binary for this machine, checked against the pinned checksum. No npm, no sudo, nothing global.
`shepherdr uninstall` removes it.

```bash
herdr-browser --install    # install or repair agent-browser and Chrome now
herdr-browser --status     # what is here, as JSON (doctor's line comes from it)
```

A failed try waits 10 minutes before the next automatic one. A scratch `--root` install downloads nothing.

## What Shepherdr contacts

Only what you set up yourself:

- **Machines you linked** in herdr-core, over that same link: their spaces, tasks, health and artifacts.
- **GitHub**, through `gh` and git, for your tasks' own repos.
- **ElevenLabs**, with your key only, for voice and dictation when you use them.
- **Your devices' push services**, when an alert goes to a device you turned alerts on for.
- **This machine's own Tailscale**, to share the app on your tailnet. Never Funnel.

It never tries ssh to hosts in your `~/.ssh/config` or to your Tailscale peers on its own. `herdr-task machines find`
lists the hosts it could try, and tries each once only with `--go`.

## Where your data lives

`shepherdr where` prints every path.

```text
~/.config/shepherdr/          settings.json, model-picks.json
~/.local/share/shepherdr/     tasks/, artifacts/, secrets/ (owner-only), worktrees/, and Shepherdr's own code
~/.local/state/shepherdr/     service/ (its token and log), browser/ (the agents' sign-ins), secret-drop/
~/.cache/shepherdr/           safe to delete (macOS: ~/Library/Caches/shepherdr)
```

`SHEPHERDR_HOME=<folder>` puts all four under `<folder>/{config,data,state,cache}`. Otherwise `XDG_CONFIG_HOME`,
`XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` are honoured. Set them before installing: the installer writes
them into the service's unit. The unit also sets `HC_SESSION=shepherdr`, so the service's agents run in Shepherdr's
own herdr-core session; `shepherdr doctor` says when a unit lacks it, and `shepherdr update` writes it. Task worktrees go to `~/.local/share/shepherdr/worktrees` unless `tasks.worktree_root`
in the settings file names another folder.

## Uninstall

`shepherdr uninstall` stops the service and removes what it installed: its files, links, hooks, the Herdr button and
its key. It puts back what the install replaced. A file you changed stays. Your data stays too: tasks, worktrees,
artifacts, secrets and settings.
