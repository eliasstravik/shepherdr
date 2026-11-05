# Working on Shepherdr

How to run, build and lay out the code: [docs/develop.md](docs/develop.md).

## Tests

- Quick checks are fine here (seconds): `bin/sync-shared --check`, `python3 -m unittest discover -s test` and the
  `node --check` loop in [docs/develop.md](docs/develop.md). The installer tests use throwaway roots only.
- Never run herdr-app or herdr-task with a changed `HOME` or `HERDR_APP_HOME`, never start a second herdr-app window,
  and never install into the real `~/.config/herdr-app` for a try: use `./install.sh --root <scratch>`. A window or
  scheduler on another home can overwrite every machine's spaces.
- `herdr-app check <mod folder>` runs a mod's `init()` for real: never for `shepherdr-settings` (its init pushes
  settings to other machines).
- GitHub runs the whole check on every pull request to main and after each merge: the Check workflow
  (`.github/workflows/check.yml`). Merging waits for it. A failure's log is `gh run view <run> --log-failed`.
- Still write tests with your change: the installer's in `test/test_install.py`, the repo's rules in
  `test/test_repo.py`, herdr-task's in `test/test_herdr_task.py`. herdr-task's can use a real throwaway git repo
  (tempfile) for git logic and mock only hc and gh.

## Trying a change

- A fresh worktree: `bun install && bun web/build-plugins.ts` before `bunx tsc` or a build (else missing types and
  `web/generated`).
- A branch's web app on the machine that serves it: build it (`bun run build`), then send `bin/shepherdr`'s
  `pack(<worktree>)` to `INSTALL_THERE` over `hc exec --on <machine> --stdin` (what `cmd_web_install_on` does from
  the installed copy). Browser pages can't use the local service on 127.0.0.1.
- `herdr-browser screenshot` takes an absolute path (a relative one lands in the repo). Headless agent-browser has no
  hover: restart its session with
  `--args "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"`.
- Claude Code may log an agent's message only as a thinking block: replay a real log through `core/chat-log.js`
  before blaming the reader.
- A branch's web app with live data, the installed one untouched: `vite preview` of its build behind
  `tailscale serve --set-path`, proxying `/api` (changeOrigin, origin header) to the serving machine's `/shepherdr`
  (`shepherdr web status` says which). Put the Mac mini back on the release the same way from
  `~/.local/share/shepherdr`.
- A test space's Assistant without the window: `hc run` it with the chat slot labels from the newest
  `data/backups/*/sidebar.json` (`coordinator.slots`), as `service/actions.ts` does; answer the folder-trust prompt
  with `hc keys <t> down enter`.
- No Shepherdr service runs on the dev VM: to screenshot a web dialog, serve `web/dist` with a tiny Bun stub answering
  only the APIs it needs, never the full service: upgrade `/api/ws` and send
  `{type:'snapshot',snapshot:{places,machines,tasks,...}}`; 404 other `/api`. A later pushed `chat` event (setTimeout) makes
  replies arrive while scrolled up (the Latest pill's count). Run the stub in the background, or it dies with the shell call. Each
  place in the snapshot needs a `chat` field (else a blank crash); open a viewer with `?artifact=<id>`, a task with
  `?task=<id>`. Answer the client's `watch` message with `{type:'chat',chat}` per key; `sections: []` lists places
  under their machine in the sidebar. A stub chat message can carry any Message field (brief, activity, news) to
  screenshot quiet rows without a real log.
- A cross-machine send without ssh: two throwaway cores (`HC_SESSION=a`/`b`, clean `env -i`) and
  `hc machine add --via 'sh -c' --name vmb --session b` on a; the wrap only shows with a real agent (e.g.
  `claude --model haiku`) as the target.
- Web dictation on the dev VM: agent-browser's fake-mic flags don't apply; override
  `navigator.mediaDevices.getUserMedia` with an oscillator `MediaStreamDestination` via eval.
- Another machine in herdr-task tests: run herdr-task as a subprocess with `HERDR_TASK_STORE=<tmp>` and a fake hc first on
  PATH (see AutomationFromAnotherMachine).
- Bun.spawn ignores a PATH changed inside a test: point the service at fakes with `SHEPHERDR_HERDR_APP` / `SHEPHERDR_HC`.
- No herdr-app window runs on the dev VM: window-mod UI can only be syntax-checked here, not screenshot. No ImageMagick
  either: crop proof screenshots with python3 PIL. Stop a background stub with `kill $(lsof -t -i:<port>)`, never
  `pkill -f` on its path (it matches the calling shell).
- Autopilot wake replay: print `herdr_task.autopilot.message()` (patch `heartbeat_of`/`direction_of`), then
  `claude -p --append-system-prompt templates/assistant.md` in a scratch repo with fake herdr-task/hc on PATH.
- Web stub: a place's `chat` is its chat key string (the chat object goes only in the watch reply). Headless screenshots
  never show native `title=` tooltips: check with `document.querySelectorAll('[title]')`.
- Crash recovery for real: a throwaway core, `HC_SESSION=<name> hc ...` with `HC_TERMINAL_SOCKET` and Claude's
  `CLAUDE_*` env unset (`CLAUDE_CODE_CHILD_SESSION` turns off transcripts).

## Other machines

- `herdr-task --on <machine>` copies its bundle there, and a hub (the Mac mini) copies it on: running a branch's
  herdr-task against other machines spreads that branch fleet-wide until the next update. Prefer local tests.
- herdr-task's scheduler re-execs itself within 15 s when its code changes. Its live code is either the zipapp
  `mods/tasks/bin/herdr-task` or the `herdr_task/` folder beside it (`zipfile.is_zipfile` says which).

## Add-ons

- `lib/addons.json` lists every mod by add-on; a new mod goes in one (the tests check). Shared modules have one
  source in `lib/`: edit it, run `bin/sync-shared`. The add-ons' switches and how they work: [docs/addons.md](docs/addons.md).
- Mod names, the layout's node ids and `keys.json` contexts are what people's state and keys hang on: change them
  with care and say so in your done summary.

## README

- `README.md` is the project's landing page, and its design is the human's. Never change its design, layout, structure,
  hero or length, in a release or any other task, without the human's explicit yes.
- Only fix facts that became false, in place, in the same voice. Detailed docs go in `docs/`, not the README.
- "The previous README" means the one on main just before (`git log main -- README.md`), never a tag's.

## Releases

- Never cut a new release (version bump, tag, GitHub release, publish) without asking the human first and getting a
  yes.
- Version bumps are patch only (2.0.0 → 2.0.1) unless the human explicitly asks for a minor or major one.
