# Develop

```text
web/src/                 the app's shell: kernel.ts (the places, the store, the link), App.tsx, list, picker, settings
web/plugins/<name>/      the features, each a plugin (docs/plugins.md); web/plugins.json lists them
web/shared/              what the page and the service share: types.ts, view.ts (the status rules), alerts
web/demo/                the demo (serve.ts, data.ts) and live.ts, a go-between for a throwaway service
service/                 the always-on service (Bun): the app's API, background work, tailnet sharing (docs/web.md)
core/                    plain JavaScript the service and the page share
mods/tasks/bin/          herdr-task (entry) and its herdr_task package
mods/tasks/bin/herdr_task/layout.py   where Shepherdr's data lives (the one source); core/paths.js says the same
mods/artifacts/          herdr-artifact (bin/) and ARTIFACTS.md, the guide agents read
bin/shepherdr            the installer (install, update, uninstall, doctor); ./install.sh runs it
bin/                     herdr-secret, herdr-browser, herdr-desktop, sync-shared
herdr/open-shepherdr/    the one Herdr mod: an "Open Shepherdr" button
hooks/                   the agents' question and permission hooks
templates/               assistant.md, worker.md, reviewer.md: the agents' instructions (herdr-core templates)
lib/addons.json          a marker 3.1's `shepherdr update` looks for; nothing reads it
test/                    python tests: repo rules, the installer in throwaway roots, herdr-task
```

`herdr-task` and `herdr-artifact` keep their 3.1 paths under `mods/`, so machines on 3.1 and 3.2 find each other's
copies.

## Rules

- A new feature is a plugin: [Plugins](plugins.md).
- Behaviour is words, not code. A setting reaches an agent as a line in its brief or its instructions. Shepherdr's
  code never judges work.
- No model in the status path: a status comes from the agent's report and plain facts (`web/shared/view.ts`).
- The app never says Assistant, worker or coordinator. It says Shepherdr, Everything, space, task, schedule.
- Nothing personal: no absolute home paths, no machine or account names. `test/test_repo.py` checks.
- Version: `VERSION` in `bin/shepherdr`, `package.json`, the top of `CHANGELOG.md` and the README say the same.

## Where data lives

- Shepherdr's data is in its own folders ([Install](install.md)). Never write a `~/.herdr/...` path in new code.
  Python reads `layout.Where().path(kind)` (herdr-task: `base.WHERE`), the service `where()` from `service/paths.ts`,
  a one-file helper (herdr-secret, herdr-artifact) its SHEP block, which `bin/sync-shared` writes from `layout.py`.
- A new kind of data: add it to `KINDS` in `layout.py` and `core/paths.js` (`test/test_layout.py` checks they agree),
  then run `bin/sync-shared`.
- Tests never touch the real folders: herdr-task moves nothing when `HERDR_TASK_STORE`, `HERDR_TASK_SETTINGS` or
  `SHEPHERDR_NO_MIGRATE` is set. `shepherdr --root <scratch>` ignores `SHEPHERDR_HOME` and `XDG_*`.

## Checks

Quick, fine on any machine:

```bash
python3 bin/sync-shared --check
for f in core/*.js herdr/open-shepherdr/main.js; do node --input-type=module --check < "$f"; done
bun install --frozen-lockfile && bun web/build-plugins.ts
bunx tsc --noEmit -p . && bun test service core web && bun run build
for f in install.sh bin/herdr-browser bin/herdr-desktop hooks/*.sh service/restart.sh; do bash -n "$f"; done
python3 -m unittest discover -s test
```

GitHub runs these on every pull request to main and after each merge (`.github/workflows/check.yml`), and then
installs into a new throwaway home: dry run, install, doctor, uninstall.

## Looking at the app

The demo, with a fictional day and no service:

```bash
bun run build
bun web/demo/serve.ts [port]      # then open it; ?case=empty and ?case=down show those states
```

A real service that touches nothing of yours. It keeps your real HOME but its own herdr-core session and its own
folders:

```bash
SHEPHERDR_SESSION=try HC_SESSION=try SHEPHERDR_PORT=7801 SHEPHERDR_WEB=off SHEPHERDR_DATA=<scratch> \
  HERDR_TASK_STORE=<scratch> HERDR_TASK_SETTINGS=<scratch file> SHEPHERDR_NO_MIGRATE=1 bun service/main.ts
bun web/demo/live.ts 7801 <scratch>/token 7802      # a page in front of it, on 127.0.0.1:7802
```

Put wrapper scripts for `herdr-task` and `herdr-artifact` first on the PATH, so they run this checkout's copies with
the same variables. A page can't use the service on 127.0.0.1 by itself, so `live.ts` stands between them and adds
the token.

Never run the service or herdr-task on a changed `HOME`: a scheduler on another home can overwrite every machine's
spaces.
