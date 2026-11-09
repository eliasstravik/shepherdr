# Upgrading

## From 3.0.x

```bash
git pull --ff-only
shepherdr update
shepherdr doctor
```

A web-only install (`./install.sh --web`) updates the same way: `shepherdr update` reads what was installed and
updates web only. `shepherdr doctor` says how this install updates. The web app is rebuilt when it's out of date.

Only files Shepherdr put there and you haven't changed are replaced; yours stay, with the new copy beside them as
`.new`. A mod file you changed that Shepherdr changed too is the exception: your copy could stop the new mod from
loading, so Shepherdr's goes in and yours goes to the backup folder (the update says where). Each mod is swapped in one step, so Herdr reloads it once. Agents keep running in herdr-core. Until
`shepherdr doctor` passes, the sync to other machines waits (`a sync hold (`sync-hold` in `~/.local/state/shepherdr`)`).

## Shepherdr's data moves to its own folders (3.1.27)

The first `shepherdr update` to 3.1.27 (or the first herdr-task run of it on another machine, once the sync brought
it there) moves Shepherdr's data out of `~/.herdr` into its own folders ([Install](install.md), Where your data
lives), once per machine. It says so in one line; there is nothing to do. `shepherdr doctor` and `shepherdr where`
say where everything is.

- **What moves:** tasks, artifacts, settings, the secrets vault and its mark, task browsers (their sign-ins with them),
  the web service's files, the tools stamp, cli-check and machine-hold. On the same disk each is one rename, so nothing
  is copied. On another disk (`XDG_*` or `SHEPHERDR_HOME` there), a file (settings, the vault) is copied, checked and
  swapped, the old copy kept as `<old>.pre-layout2`; a folder (tasks, artifacts, browsers) stays where it is and the
  new path links to it. A folder you linked elsewhere yourself (artifacts on a bigger disk) stays there.
- **What doesn't:** task worktrees. Git keeps their absolute paths, and agents, editors and logs know them by it, so a
  running task keeps its worktree in `~/.herdr/worktrees` until it's done; new tasks get theirs in the new folder.
  `~/.herdr` itself and Herdr's own worktree dialog's checkouts there stay too.
- **Old paths keep working:** each moved one is a link to its new place (`~/.herdr/tasks` →
  `~/.local/share/shepherdr/tasks`), so a window not reloaded yet, an older helper, a path in an old brief or artifact,
  and another machine still on an older Shepherdr (which reads `$HOME/.herdr/...` there over herdr-core) all find
  the same data. An older writer that replaces a link with a file is taken in by the next herdr-task run.
- **Several machines:** each one moves its own data when it updates; until then the others read and write it in its
  old place, and an updated machine's commands find each machine's data wherever it is. The sync hold
  (`shepherdr doctor`) still keeps new helpers from spreading before this machine's install is whole.
- **Safe to stop:** the move takes a lock, and `LAYOUT` (in `~/.local/share/shepherdr`) is written last. A crash or a
  power cut halfway leaves every old path working, and the next run finishes it. Running it again changes nothing.
  It doesn't move by itself on a network disk (NFS, SMB): `shepherdr migrate --force` does, when no other machine
  uses that home.
- **Rolling back:** `shepherdr migrate --rollback` moves everything back to `~/.herdr`, where an older Shepherdr finds
  it as it left it (with what was added since), and this version stays on `~/.herdr` until you run `shepherdr migrate`
  again. To go back to an older release: roll back first, then install that release.
- **When the links go:** never by themselves. Once every machine runs 3.1.27 or later (`herdr-task machines` lists
  them), `shepherdr migrate --cleanup-legacy --yes` removes the links and any `.pre-layout2` copies. Until then they
  stay.

## From 2.1 or 2.0

3.0 is a new build inside the Herdr app; 2.x was a web app (2.1) or a terminal-herdr plugin (2.0). Nothing carries
over: 2.x's data in `~/.shepherdr` stays where it is, and 3.0 never reads or changes it. 2.1 lives on on the `v2.1`
branch and 2.0 on `v2.0`, each with its own README; don't pull main into them or update them from main.

To move to 3.0: install the Herdr app, then [Install](install.md). Stop 2.1 (`shepherdr stop` from your 2.1
checkout) when you no longer want it; both can run side by side, but they're separate task lists.

## Moving a machine that already runs these mods by hand

A machine whose `~/.config/herdr-app` already holds these mods (they were built there before 3.0) is moved over
like this, with nothing lost:

1. Dry run: `./install.sh --root <scratch>` into a scratch folder that holds a fresh Herdr home, then compare it
   with your Herdr folder file by file ([Develop](develop.md), parity check). Every difference must be intended.
2. Make sure the helper and template hashes match the repo's, so the sync pushes nothing by surprise.
3. Back up `~/.config/herdr-app` (whole), `~/.config/herdr-core`, `~/.herdr`, the `herdr*` items in `~/.local/bin`,
   `~/.claude/settings.json`, `~/.codex/config.toml` and `~/.codex/hooks.json`.
4. Close the window (agents keep running in herdr-core), move `~/.config/herdr-app` aside as
   `~/.config/herdr-app.pre-3.0`, start Herdr once so it writes a fresh home, close it.
5. `./install.sh --guard`, then bring back your state from `.pre-3.0`: `data/`, `shared.json`, `view.json`,
   `seen.json`, `window.json`, `settings.json`, `keys.json`, `secrets/`. Set `"layout": "shepherdr"` in `shared.json`
   (the layout was `main-tasks` before 3.0) and rename `layout:main-tasks` to `layout:shepherdr` in `keys.json`.
6. Open the window, `shepherdr doctor`, and check: no errors in `herdr-app status`, the same tasks, chats and artifacts.

Going back: close the window, move `~/.config/herdr-app` aside and `~/.config/herdr-app.pre-3.0` back, and restore
the links, templates and CLI settings from the backup.
