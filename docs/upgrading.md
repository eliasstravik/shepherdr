# Upgrading

For an existing `shepherdr` layout, first follow the [BossGoat layout migration](install.md#upgrading-an-existing-shepherdr-layout) to preserve saved layout preferences.

## From 3.0.x

```bash
git pull --ff-only
shepherdr update
shepherdr doctor
```

A web-only install (`./install.sh --web`) updates the same way: `shepherdr update` reads what was installed and
updates web only. `shepherdr doctor` says how this install updates. The web app is rebuilt when it's out of date.

Only files Shepherdr put there and you haven't changed are replaced; yours stay, with the new copy beside them as
`.new`. Each mod is swapped in one step, so Herdr reloads it once. Agents keep running in herdr-core. Until
`shepherdr doctor` passes, the sync to other machines waits (`~/.herdr/sync-hold`).

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
