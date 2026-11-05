# Develop

```text
layouts/shepherdr.json   the layout (two live blocks shipped blank: tasks-thread-term, artifacts-view-body)
mods/<name>/             the 29 mods, installed as they are (names fixed: data/<mod> state follows them)
lib/                     shared modules, one source each; bin/sync-shared copies them into the mods in lib/COPIES
lib/addons.json          the add-ons: mods, blocks, keys, helpers, needs, web plugins (docs/addons.md)
lib/features.json        every feature: its Herdr side, its web side and its shared logic (CI checks all three)
core/                    the logic the mods and the service share (plain JS; copied into mods by bin/sync-shared)
service/                 the always-on service (Bun): the web app's API, background work, tailnet sharing (docs/web.md)
web/                     the web app (React, Vite, Tailwind; 2.1's design): src/, plugins/, shared/
bin/shepherdr            the installer (install, update, uninstall, doctor); ./install.sh runs it
bin/                     herdr-secret, herdr-browser, herdr-browser-view, sync-shared (installed to the app's bin/)
mods/tasks/bin/          herdr-task (entry) and its herdr_task package
mods/artifacts/bin/      herdr-artifact
templates/               assistant.md, worker.md, reviewer.md (herdr-core templates)
guard/herdr-app          the window guard (--guard)
keys.json                Shepherdr's keys, merged into the person's
test/                    python tests: repo rules, the installer in throwaway roots, herdr-task
scripts/parity.py        a scratch install against this machine's live Herdr home, file by file
RECIPE.md, preview.png   the herdr.dev listing (repo topic herdr-layout)
```

## Rules

- Edit `lib/<file>` or `core/<file>`, never a mod's copy, then run `bin/sync-shared`; `bin/sync-shared --check` must pass.
- A new mod: add it to an add-on in `lib/addons.json` (the tests fail otherwise), write its `mod.json` before or
  with `main.js`, and list it in `lib/COPIES` for each shared module it imports.
- Nothing personal: no absolute home paths (use `home()`, `appHome()`, `$HOME`), no machine or account names, no
  live terminal or artifact ids in the layout. `test/test_repo.py` checks.
- Version: `VERSION` in `bin/shepherdr`, the top of `CHANGELOG.md`, `RECIPE.md` and the README say the same.

## Checks

Quick, fine on any machine (seconds):

```bash
bin/sync-shared --check
python3 -m unittest discover -s test            # herdr-task's command test runs only on CI
for f in $(find mods lib core -name '*.js'); do node --input-type=module --check < "$f"; done
bun test service core web && bunx tsc --noEmit -p . && (cd web && bunx vite build)   # the service and the web app
```

The web app against your live data: `bun service/main.ts` (stop the installed service first: it holds port 7788),
then open the tailnet link. Never on a changed `HOME` or `HERDR_APP_HOME`.

GitHub runs these and more on every pull request (`.github/workflows/check.yml`). `herdr-app check <mod folder>`
needs the window's runtime and runs a mod's `init()` for real (it can reach the live app): only on a person's
machine, and never for `shepherdr-settings` (its init pushes settings to other machines).

## Parity check (a machine that runs these mods by hand)

```bash
./install.sh --root /tmp/shep-try --yes          # into a scratch root holding a fresh Herdr home
python3 scripts/parity.py /tmp/shep-try          # every difference with the live ~/.config/herdr-app
```

Never point `--root` at the real home for a try, and never start Herdr or herdr-task with a changed `HOME` or
`HERDR_APP_HOME`: a window or scheduler on another home can overwrite every machine's spaces.

## The herdr.dev listing (at release, with the person's yes)

- The repo root is the listed layout folder: `layouts/shepherdr.json`, `mods/`, `RECIPE.md`, `preview.png`,
  `keys.json`. herdr.dev reads the recipe's title and first paragraph.
- Repo topics: add `herdr-layout` (the listing), keep `herdr` and `shepherdr`, and drop `herdr-plugin` (the
  terminal-plugin card; `herdr-plugin.toml` is gone from main, 2.1 stays installable from `v2.1`).
- Tag `v3.0.0` and the GitHub release only after the person says yes; patch bumps after that.
