# Install

BossGoat 3.1.30 is a layout for the Herdr app plus its mods, helpers and role instructions, and a web app for your tailnet ([Web](web.md)). One script puts them in
place, never overwrites what you made yourself, and keeps a backup of anything it replaces.

## Requirements

- macOS or Linux, the Herdr app 0.1.12 or newer (`herdr-app --version`) with herdr-core 0.1.17 or newer
  (`hc --version`). Open Herdr once first, so it writes its home (`~/.config/herdr-app`).
- python3 3.8 or newer, git, and Claude Code, Codex or Cursor, installed and signed in.
- bun (the service and the web app; the installer installs it from bun.sh when it's missing), and Tailscale for the
  web app.
- Optional, per add-on: `gh` (pull requests), node (the task browser in the window), bun,
  `pw-record` and `pw-play` for dictation and voice calls in the window on Linux (on macOS, Apple's command line
  tools: `xcode-select --install`), an ElevenLabs key for voice calls and dictation. A restricted key needs
  "User → Read" (elevenlabs.io › Developers › API Keys) for its credits to show under Plan usage in Settings › Machines.

## Install

```bash
git clone https://github.com/NeuralHerd/BossGoat && cd BossGoat
./install.sh --dry-run      # what it would do; nothing is written
./install.sh                # do it
shepherdr doctor            # check it
```

Then in Herdr, `Ctrl+Shift+L` picks the `BossGoat` layout.

### Upgrading an existing Shepherdr layout

Before installing this version, copy the layout through the running Herdr app so pane sizes,
theme choices and other saved preferences carry over:

```bash
herdr-app do layout.clone '{"name":"shepherdr","as":"BossGoat"}'
./install.sh --adopt --keys keep
shepherdr doctor
```

Skip the copy if `BossGoat` already exists. The installer backs up the clone before installing
its layout and preview; it never edits `layouts/.state/`. Existing BossGoat shortcuts take
priority, and missing shortcuts are copied from the old layout once. The old shortcut section
stays available for custom layouts. An unchanged old layout is backed up and removed; a layout
you customized is retained. Tasks, chats and agent settings keep their existing storage paths.

A fresh clone has no web app built (`web/dist` isn't in git): the installer builds it with Bun (`bun install`,
`bun run build`) whenever it's missing or older than its sources, so nothing to do by hand. A build that fails stops
the install before anything is written.

What goes where:

| What | Where |
|---|---|
| The layout | `~/.config/herdr-app/layouts/BossGoat.json` |
| 28 mods (the add-ons, [Add-ons](addons.md)) | `~/.config/herdr-app/mods/<name>/`, one swap per mod so Herdr reloads each once |
| Shared modules, helpers | `~/.config/herdr-app/lib/`, `~/.config/herdr-app/bin/` |
| Keys | merged into `~/.config/herdr-app/keys.json`: free keys added; a key you already use is asked about (kept without a terminal; `--keys ours` takes Shepherdr's) |
| Role instructions | `~/.config/herdr-core/templates/{assistant,worker,reviewer}.md`; one you edited is kept, the new one goes beside it as `.new` |
| Helpers on the PATH | links in `~/.local/bin`: `herdr-task`, `herdr-artifact`, `herdr-secret`, `herdr-browser`, `shepherdr` |
| Question cards | hooks in `~/.claude/settings.json` (SessionStart, PermissionRequest) and `~/.codex/hooks.json` (SessionStart, PermissionRequest); `--no-hooks` leaves them out. Codex asks once to trust a new hook, and needs `hooks = true` in `~/.codex/config.toml` |
| agent-browser (the task browser) | one already on the PATH when it's 0.41.1 up to 0.41.x, else Shepherdr's own copy in `~/.local/share/shepherdr/agent-browser/<version>/` and Chrome for Testing (`agent-browser install`, into `~/.agent-browser`). See [The task browser's agent-browser](#the-task-browsers-agent-browser) |
| The guard (`--guard`, opt-in) | `~/.local/bin/herdr-app`: refuses to open a window with another HOME, `HERDR_APP_HOME` or core session (it can overwrite every machine's spaces); subcommands pass through |

What it records: `~/.config/herdr-app/data/shepherdr/installed.json`, a sha256 per file it put there. Running it
again changes only what changed; a file you edited since is kept (the new copy goes beside it as `.new`), except a
mod file Shepherdr changed too: that one is replaced and yours goes to the backup folder.

What it retires: a file Shepherdr shipped before and no longer ships (or a mod `lib/addons.json` dropped) is removed on
the next update, whether you edited it or not; a changed one is backed up first and the update says where. A one-file
helper copy from an older release that doctor rejects (no current SHEP block) is replaced the same way.

What it backs up: anything it replaces or removes, in `~/.config/herdr-app/.shepherdr-backup/<time>/`, at the same
path under your home.

Last, it checks the install is whole (what `shepherdr doctor` checks). When it isn't, the update says `NOT DONE` with
each `✗` reason, and doctor keeps failing until they're fixed.

What it refuses: a mod, layout, lib or bin file by the same name that it didn't install and that differs (your own
mod called `chat`, say). Nothing is written then; it names each one. `--adopt` backs them up and takes them over.

## The task browser's agent-browser

Each task's browser runs [agent-browser](https://github.com/vercel-labs/agent-browser). Shepherdr pins a version
(0.41.1) and works with any newer 0.41.x too: one you already have on the PATH (npm, Homebrew…) is used as it is, unless Shepherdr has its own copy here.
When there's none, or it's another version, install, `shepherdr update` and an agent's first `herdr-browser` command
install Shepherdr's own copy: agent-browser's release binary for this machine (macOS or Linux, x64 or arm64), checked
against the pinned version's checksum, into `~/.local/share/shepherdr/agent-browser/<version>/`. No npm, no sudo,
nothing global. When Chrome isn't found it runs `agent-browser install` for Chrome for Testing. A new pin in an
update installs the new version and removes the old copy; `shepherdr uninstall` removes it.

When it can't (offline, no `curl`, a download that isn't the release), the Browser tab, `herdr-browser` and
`shepherdr doctor` say why, in full, with the one command that fixes it:

```bash
herdr-browser --install    # install or repair agent-browser and Chrome now, and say what it found
herdr-browser --status     # what's here, as JSON (doctor's line comes from it)
```

A failed try isn't repeated by every command: the next automatic one waits 10 minutes (`--install` tries at once).
A scratch `--root` install downloads nothing (`SHEPHERDR_AGENT_BROWSER=1` asks it to, into that root).

## Without the Herdr window

herdr-core and the web app alone: no Herdr app, its spaces are the service's own ([Web](web.md)). Install herdr-core
(https://herdr.dev) and Tailscale, signed in, then:

```bash
git clone https://github.com/NeuralHerd/BossGoat && cd BossGoat
./install.sh --web          # the service, the web app, herdr-task and the helpers
shepherdr doctor            # check it
shepherdr web status        # where it's served: https://<this machine's tailnet name>/shepherdr/
```

It shares itself on your tailnet only (`tailscale serve`, never Funnel). `shepherdr update` keeps it web only.

## Options

```text
./install.sh [--root DIR] [--dry-run] [--adopt] [--guard] [--keys ask|keep|ours] [--no-hooks] [--no-build] [--yes] [--force]
             [--port N] [--https-port N]
./install.sh --web    the web app alone, without the Herdr window
shepherdr update      the same kind again (layout, or web only), from the checkout it was installed from (git pull it first)
shepherdr uninstall   [--root DIR] [--dry-run]: takes out what it installed and puts back what it replaced
shepherdr doctor      [--root DIR]: checks files, links, shared copies, herdr-task and the programs it needs, agent-browser, and says how to update
```

`--port N` moves the service off `127.0.0.1:7788`; `--https-port N` shares the web app on the tailnet's port N instead
of 443, when something else here holds 443 (`shepherdr web https-port N` changes it later; [Web](web.md)). Updates keep both.

`--root DIR` installs under another folder instead of your home (it mirrors `.config/herdr-app`, `.local/bin`,
`.config/herdr-core/templates`, `.claude`, `.codex`): a scratch try you can look through and diff. It never starts
Herdr there.

## Other machines

Nothing to install by hand. herdr-task copies itself, `herdr-artifact`, `herdr-secret`, `herdr-browser` and the role
instructions to every connected machine (`herdr-task machines sync --check` shows what it would do). While an install
or update replaces one of those, `a sync hold (`sync-hold` in `~/.local/state/shepherdr`)` stops every copy to another machine until `shepherdr doctor`
finds the install whole: the scheduler's sync, `herdr-task machines sync` (it says "held"), herdr-task's and
herdr-artifact's own copy when they run a command there (the copy already there runs instead), and
`herdr-secret install --on`. So a half-done copy never reaches every machine. Turning the Other machines add-on off stops the
sync too.

## Where your data lives

Shepherdr keeps its own data in its own folders, never under Herdr's name (`shepherdr where` prints every path):

```text
~/.config/shepherdr/          settings.json (Shepherdr settings), model-picks.json
~/.local/share/shepherdr/     tasks/, artifacts/, secrets/ (the vault, owner-only), worktrees/ (new tasks'), tools.json
~/.local/state/shepherdr/     service/ (the web service's token, log, usage insights), browser/ (task browsers'
                              sign-ins), secret-drop/, cli-check.json, machine-hold.json, migrate.json (the move's journal)
~/.cache/shepherdr/           safe to delete; CACHEDIR.TAG keeps backups out (macOS: ~/Library/Caches/shepherdr)
```

The same on Linux and macOS. `SHEPHERDR_HOME=<folder>` puts all four under `<folder>/{config,data,state,cache}`;
otherwise `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` are honoured. Set them before
installing: the installer writes them into the service's unit so it sees the same folders. A process that doesn't see
them still lands right through `~/.herdr`'s links. Task worktrees go to `~/.local/share/shepherdr/worktrees` unless
`tasks.worktree_root` in the settings file names another folder (a bigger disk); a task keeps the worktree it has.

Herdr's own folders get only code: the mods, layout, `lib/`, `core/`, `bin/` and templates, each file listed in the
install record (`~/.config/herdr-app/data/shepherdr/installed.json`, a sha256 each), so an update rewrites exactly
those and an uninstall removes exactly those. A Shepherdr from before 3.1.27 kept its data in `~/.herdr`: the first
install or update moves it ([Upgrading](upgrading.md)).

## Uninstall

`shepherdr uninstall` removes the files it installed that you haven't changed (a mod you changed stays whole), its
keys (putting back any it replaced), links, guard and hooks, and puts back what the install replaced. Your Herdr
`data/`, Shepherdr's data folders (tasks, worktrees, artifacts, secrets, settings: `shepherdr where`) and your own mods stay. Switch Herdr to another
layout first if Shepherdr's is showing.
