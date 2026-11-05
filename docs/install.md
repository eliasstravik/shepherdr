# Install

Shepherdr 3.1.9 is a layout for the Herdr app plus its mods, helpers and role instructions, and a web app for your tailnet ([Web](web.md)). One script puts them in
place, never overwrites what you made yourself, and keeps a backup of anything it replaces.

## Requirements

- macOS or Linux, the Herdr app 0.1.12 or newer (`herdr-app --version`) with herdr-core 0.1.17 or newer
  (`hc --version`). Open Herdr once first, so it writes its home (`~/.config/herdr-app`).
- python3 3.8 or newer, git, and Claude Code or Codex, installed and signed in.
- bun (the service and the web app; the installer installs it from bun.sh when it's missing), and Tailscale for the
  web app.
- Optional, per add-on: `gh` (pull requests), agent-browser 0.41.1, node and Chrome (the task browser), bun,
  `pw-record` for dictation in the window, an ElevenLabs key for voice calls and dictation.

## Install

```bash
git clone https://github.com/eliasstravik/shepherdr && cd shepherdr
./install.sh --dry-run      # what it would do; nothing is written
./install.sh                # do it
shepherdr doctor            # check it
```

Then in Herdr, `Ctrl+Shift+L` picks the Shepherdr layout.

A fresh clone has no web app built (`web/dist` isn't in git): the installer builds it with Bun (`bun install`,
`bun run build`) whenever it's missing or older than its sources, so nothing to do by hand. A build that fails stops
the install before anything is written.

What goes where:

| What | Where |
|---|---|
| The layout | `~/.config/herdr-app/layouts/shepherdr.json` |
| 29 mods (the add-ons, [Add-ons](addons.md)) | `~/.config/herdr-app/mods/<name>/`, one swap per mod so Herdr reloads each once |
| Shared modules, helpers | `~/.config/herdr-app/lib/`, `~/.config/herdr-app/bin/` |
| Keys | merged into `~/.config/herdr-app/keys.json`: free keys added; a key you already use is asked about (kept without a terminal; `--keys ours` takes Shepherdr's) |
| Role instructions | `~/.config/herdr-core/templates/{assistant,worker,reviewer}.md`; one you edited is kept, the new one goes beside it as `.new` |
| Helpers on the PATH | links in `~/.local/bin`: `herdr-task`, `herdr-artifact`, `herdr-secret`, `herdr-browser`, `shepherdr` |
| Question cards | hooks in `~/.claude/settings.json` (SessionStart, PermissionRequest) and `~/.codex/hooks.json` (SessionStart); `--no-hooks` leaves them out. Codex asks once to trust a new hook, and needs `hooks = true` in `~/.codex/config.toml` |
| The guard (`--guard`, opt-in) | `~/.local/bin/herdr-app`: refuses to open a window with another HOME, `HERDR_APP_HOME` or core session (it can overwrite every machine's spaces); subcommands pass through |

What it records: `~/.config/herdr-app/data/shepherdr/installed.json`, a sha256 per file it put there. Running it
again changes only what changed; a file you edited since is kept (the new copy goes beside it as `.new`).

What it backs up: anything it replaces or removes, in `~/.config/herdr-app/.shepherdr-backup/<time>/`, at the same
path under your home.

What it refuses: a mod, layout, lib or bin file by the same name that it didn't install and that differs (your own
mod called `chat`, say). Nothing is written then; it names each one. `--adopt` backs them up and takes them over.

## Without the Herdr window

herdr-core and the web app alone: no Herdr app, its spaces are the service's own ([Web](web.md)). Install herdr-core
(https://herdr.dev) and Tailscale, signed in, then:

```bash
git clone https://github.com/eliasstravik/shepherdr && cd shepherdr
./install.sh --web          # the service, the web app, herdr-task and the helpers
shepherdr doctor            # check it
shepherdr web status        # where it's served: https://<this machine's tailnet name>/shepherdr/
```

It shares itself on your tailnet only (`tailscale serve`, never Funnel). `shepherdr update` keeps it web only.

## Options

```text
./install.sh [--root DIR] [--dry-run] [--adopt] [--guard] [--keys ask|keep|ours] [--no-hooks] [--no-build] [--yes] [--force]
./install.sh --web    the web app alone, without the Herdr window
shepherdr update      the same kind again (layout, or web only), from the checkout it was installed from (git pull it first)
shepherdr uninstall   [--root DIR] [--dry-run]: takes out what it installed and puts back what it replaced
shepherdr doctor      [--root DIR]: checks files, links, shared copies, herdr-task and the programs it needs, and says how to update
```

`--root DIR` installs under another folder instead of your home (it mirrors `.config/herdr-app`, `.local/bin`,
`.config/herdr-core/templates`, `.claude`, `.codex`): a scratch try you can look through and diff. It never starts
Herdr there.

## Other machines

Nothing to install by hand. herdr-task copies itself, `herdr-artifact`, `herdr-secret`, `herdr-browser` and the role
instructions to every connected machine (`herdr-task machines sync --check` shows what it would do). While an install
or update replaces one of those, `~/.herdr/sync-hold` stops every copy to another machine until `shepherdr doctor`
finds the install whole: the scheduler's sync, `herdr-task machines sync` (it says "held"), herdr-task's and
herdr-artifact's own copy when they run a command there (the copy already there runs instead), and
`herdr-secret install --on`. So a half-done copy never reaches every machine. Turning the Other machines add-on off stops the
sync too.

## Uninstall

`shepherdr uninstall` removes the files it installed that you haven't changed (a mod you changed stays whole), its
keys (putting back any it replaced), links, guard and hooks, and puts back what the install replaced. Your Herdr
`data/`, `~/.herdr` (tasks, worktrees, artifacts, secrets, settings) and your own mods stay. Switch Herdr to another
layout first if Shepherdr's is showing.
