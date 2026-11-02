# Working on Shepherdr

How to run, build and lay out the code: [docs/develop.md](docs/develop.md).

## Tests

- No tests on this machine: it keeps the CPU for herdr, the server and the agents. While you work and before you
  merge, run only `bun run typecheck` (seconds). Don't run `bun run test`, `bun test`, `bun run test changed`,
  `bun run check` or any browser test here.
- Check what you changed on the screen by hand in your shared browser, for the proof.
- GitHub runs the whole check (types, every test with the browser tests, the build) on every pull request to main,
  docs-only ones too, and again after each merge: the Check workflow (`.github/workflows/check.yml`), which skips a
  push to main that changes only docs. Each push to a pull request runs it again and costs Actions minutes.
- Merging waits for the pull request's check in this repo: `shepherdr checks <id>` shows it, and `shepherdr merge <id>`
  goes once it is green. A red main reaches the coordinator, who has it fixed forward. A failure's log is
  `gh run view <run> --log-failed`.
- A branch with no pull request can still be checked by hand, `gh workflow run check.yml --ref <branch>` then
  `gh run watch`: it costs Actions minutes, so only for rare cases.
- Still write tests with your change: GitHub runs them. A new browser test goes in the `layout-*.test.ts` file of its
  topic (setup in `test/layout.ts`); split a file that grows past about 20 s.
- If someone runs tests here by hand anyway, they run at the lowest priority and never touch `~/.shepherdr`.

## Plugins

- `definePlugin` (`src/kernel.ts`, `server/plugin-api.ts`) and the slots of `Registry` (`src/kernel.ts`) are a public
  contract: the human's own plugins in `~/.shepherdr/plugins` rely on them ([docs/plugins.md](docs/plugins.md), Your
  own plugins). Change them with care, keep old names working where you can, update that page's list, and say so in
  your done summary.
- A plugin the human asks you to make for them goes in `~/.shepherdr/plugins/<name>/`, never in the repo.

## README

- `README.md` is the project's landing page, and its design is the human's. Never change its design, layout, structure,
  hero or length, in a release or any other task, without the human's explicit yes.
- Only fix facts that became false, in place, in the same voice. Detailed docs go in `docs/`, not the README.
- "The previous README" means the one on main just before (`git log main -- README.md`), never a tag's.

## Releases

- Never cut a new release (version bump, tag, GitHub release, publish) without asking the human first and getting a
  yes.
- Version bumps are patch only (2.0.0 → 2.0.1) unless the human explicitly asks for a minor or major one.
