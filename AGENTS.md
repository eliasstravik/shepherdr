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
  `test/test_repo.py`, herdr-task's in `test/test_herdr_task.py`.

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
