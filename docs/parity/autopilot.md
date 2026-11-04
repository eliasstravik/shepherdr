# Settings › Autopilot (Everywhere and each space)

A redesign of both sides, asked for by the person: Autopilot is set Everywhere (every space on this computer), and a
space follows Everywhere until it sets its own, as the other Settings pages do. Made from the window's mod
(`mods/shepherdr-settings/autopilot-section.js`) and herdr-task's data (`mods/tasks/bin/herdr_task/autopilot.py`).
✓ matches, ◇ a web-only form on purpose (why), ✗ still differs.

Shared, so the two can't drift: `core/autopilot.js` holds the page's words (title, about lines, each row's label and
line for Everywhere and for a space, Run now, the facts, the spaces list, the Custom box's example), the schedule's
picks, the events, herdr-task's starter heartbeat, Everywhere's defaults and the inherit rule (`pilotFor`); the window's
section and header (`mods/pane-chat/autopilot.js`), the service (`service/compat.ts`, `service/model.ts`,
`service/autopilot.ts`) and the web (`web/src/Settings.tsx`, `web/plugins/coordinators/client.tsx`) read it.
`core/autopilot.cases.json` holds the inherit rule's cases: `core/autopilot.test.js` checks `pilotFor` on them and
`test/test_herdr_task.py` herdr-task's `resolve()`; the bun test also checks the starter, events and default schedule
are herdr-task's, and `test/test_repo.py` (test_autopilot_from_one_core) that the window and the service read the core
and keep no copy of its words.

## The data (herdr-task)

`~/.herdr/tasks/.autopilot.json` is version 2: `everywhere` ({on, every, events}) and `spaces`, where a key a space
holds (on, every, events) is its own and a missing one follows Everywhere's. The heartbeat is
`~/.config/herdr-core/autopilot/everywhere.md`, and a space's own `<space id>.md` once it has words (not blank, not the
starter). Version 1 files move on their own: a space that was on keeps all three as its own; one that was off keeps
only a schedule or events it changed, so it follows Everywhere. `sync()` acts on what changed in what applies to a
space (on: a fresh next wake and events from now; off: nothing waits; a new schedule: a new next wake), whether the
change was Everywhere's or its own. While Everywhere is on, the scheduler gives each space on this computer a record
(it looks at the window's list about once a minute), so every space that follows it is woken.

| Command | What it does |
|---|---|
| `herdr-task autopilot show --space <id>` / `--everywhere` | what applies, `own` (which of on, every, events, heartbeat the space sets itself), next and last wake, progress |
| `herdr-task autopilot list [--json]` | `{everywhere, spaces}`; the text says each space's name (never `~`) and `[its own: …; the rest from Everywhere]` |
| `on`, `off`, `set --every … --on …` with `--space` or `--everywhere` | a space's value equal to Everywhere's is unset (it follows again), as Settings' rows do |
| `reset --space <id> [--only on,every,events,heartbeat]` | back to Everywhere's; its own heartbeat is kept as `<id>.md.old` |
| `heartbeat --space <id> [--own]` / `--everywhere` | the file that applies; `--own` makes the space's own from Everywhere's words |
| `complete` | turns Autopilot off in that space as its own value (Everywhere's stays on; Reset follows it again) |

## Everywhere's page

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Title | `Autopilot` (`autopilot-section.js:130`, `AP.TITLE`) | the page's name `Autopilot` (`service/compat.ts:377`) | ✓ |
| About | `For every space on this computer, unless one sets its own. Its Assistant wakes on a schedule or when something happens to its tasks, and works from the heartbeat.` (`:131`, `AP.EVERYWHERE_ABOUT`) | `about: AP.EVERYWHERE_ABOUT` (`compat.ts:377`) | ✓ |
| Loading | `Loading…` until herdr-task answers (`:80`) | the snapshot always holds Everywhere's (defaults until read) | ◇ the service reads herdr-task before the page exists |
| Autopilot switch | `Autopilot` · `On in every space that doesn't set its own.` · switch (`:132`) | `autopilot.on` row, on/off → Switch (`compat.ts:51`, `Settings.tsx` Control) | ✓ |
| Heartbeat | `Heartbeat` · `What it works from: direction, priorities, limits and when to stop.` · `Edit` opens Everywhere's file in the instructions editor (`:133`, `:165`) | `autopilot.heartbeat` doc row: the same line, the file's words in an editor as wide as the page, its path on top, Save / Undo (`compat.ts:52`, `Settings.tsx` DocValue) | ◇ the web edits the file in place (it has no separate editor window) |
| Schedule | `Schedule` · `When it wakes by itself.` · segmented `Off`, `Every 30 min`, `Every hour`, `Weekdays 9:00`, `Custom…` (`:134`, `AP.PRESETS`, `AP.CUSTOM`) | trigger row: its words and next wake, the same picks as segments (a pick list on a phone, more than 4) (`compat.ts:54`, `Settings.tsx` TriggerValue) | ✓ |
| Custom box | placeholder `Every 2 hours on weekdays`, line `Like "every 2 hours on weekdays from 8:00 to 18:00". Saved when you leave the box.`, refusal in red in its place (`:120`) | `TextValue placeholder={AP.CUSTOM_PLACEHOLDER}`, `AP.CUSTOM_HINT`; a refusal under the row (`Settings.tsx` TriggerValue, `under()`) | ✓ |
| Events | `Events` · `These wake a space's Assistant at once when they happen to its tasks.` · chips `Added`, `Ready`, `Failed`, `Needs you`, `Merged`, `Stalled` (`:136`, `AP.EVENTS`) | `multi` chips, segments on a phone (`compat.ts:56`, `Settings.tsx` Control) | ✓ |
| Under each row | `1 space uses its own` / `N spaces use their own`, opening the list of them, each opening its settings (`main.js` scopeLine, `sc()` `:86`, `AP.ownIn`) | `others` (`compat.ts:47`, `Settings.tsx` under()) | ✓ |
| Spaces heading | `Spaces`, then `Each space on this computer. Open one to give it its own.` (`:154`) | `group: AP.SPACES`, `groupHint: AP.SPACES_HINT` (`compat.ts:380`, `Settings.tsx` groupHint) | ✓ |
| No spaces | `No spaces on this computer yet.` (`:155`) | one row with `AP.NO_SPACES` (`compat.ts:381`) | ✓ |
| A space's row | its name as the sidebar calls it (core/spaces.js `spaceName`: `Home`, `tt-repo`, never `~`), under it `On · Every hour · Next Today 10:00` or `Off` (`AP.summary`), at right `Same as everywhere` or `Its own: Schedule, Events` (`AP.ownWords`), chevron; the row opens that space's settings (`:156`) | `open` row: the place's name (spaceName), the summary under it, the own words at right (after the summary on a phone), chevron; it opens the space's level (`compat.ts:379`, `Settings.tsx` row.open) | ✓ |
| Refusal | herdr-task's words in red under the rows (`:138`) | under the row that was set (`Settings.tsx` refused) | ✓ |
| Kept fresh | read again every 4 s while shown (`:49`) | the service reads herdr-task when the task folder changes and after each change | ◇ the web is pushed changes instead of polling |
| Add-on off | no Autopilot page (Settings › Window) | no Autopilot sections (`compat.ts` pilotOn) | ✓ |

## A space's page

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | a space's row on Everywhere's page, `N spaces use their own`, its sidebar menu's Space settings, the header's `Write a heartbeat` (`main.js` pickScope) | the same rows (level = the space), `others` links, the header's link (`web/plugins/coordinators/client.tsx` openAutopilot) | ✓ |
| Banner | `Only for tt-repo on This computer` + `Everywhere` (`main.js` banner; scopeName now uses spaceName, never `~`) | `Only for {place.name} on {machine}` + `Everywhere` (`Settings.tsx` spacePlace) | ✓ |
| About | `Its Assistant wakes on a schedule or when something happens to its tasks, and works from the heartbeat.` (`:131`, `AP.ABOUT`) | `about: AP.ABOUT` (`compat.ts:383`) | ✓ |
| Autopilot switch | `Autopilot` · `On for this space's Assistant.` · switch (`:132`) | `autopilot.on` row (`compat.ts:51`) | ✓ |
| Heartbeat, following Everywhere | `Same as everywhere` · `Set its own` makes its own from Everywhere's words and opens it (`:127`, `:165`) | Everywhere's words in the editor, `Same as everywhere`; saving other words makes its own (`service/autopilot.ts` heartbeat `--own`) | ◇ the web edits in place: saving is Set its own |
| Heartbeat, its own | `Changed here · Reset` · `Edit` (`:126`) | `Changed here · Reset` (`inherits`), its file's path on top; saving Everywhere's words, or Reset, follows Everywhere again | ✓ |
| Schedule, Events, switch: scope line | `Same as everywhere` or `Changed here · Reset` (`sc()` `:86`, `reset --only <field>`) | `from: "everywhere"` / `inherits` (`compat.ts:47`), Reset → `reset --only` (`service/autopilot.ts:30`) | ✓ |
| Setting Everywhere's value here | unsets its own (herdr-task `set_own`) | the same (`follows()` and herdr-task) | ✓ |
| Run now | `Run now` · `Wakes it now, or as soon as it's idle.` / `Turn Autopilot on first.` · button, off: disabled (`:140`) | `autopilot.run` button row with the same line, `disabled` while off (`compat.ts:60`, `Settings.tsx` row.button) | ✓ |
| Next wake | `Off.` / `Waiting: <note>.` / `Today 10:00 · Schedule` / `On events only.` / `Only on Run now.` (`AP.facts`) | fixed row from `AP.facts` (`compat.ts:61`) | ✓ |
| Last wake | `Today 9:00 · Event: ready · Turn ended, progress saved` / `Never.` (`AP.facts`) | the same | ✓ |
| Progress | `<text> (Today 9:00)` / `None. The Assistant saves it after each wake.` (`AP.facts`) | the same | ✓ |
| Another machine's space | no Autopilot page there (`main.js` shows: `space: "local"`) | no section for it (`model.ts` pilot null) | ✓ |

## The header's switch (what applies)

| Element | Window | Web | State |
|---|---|---|---|
| On or off | what applies in the space: its own, else Everywhere's (`mods/pane-chat/autopilot.js` apPoll, `pilotFor`) | `place.pilot` from `model.ts` pilotOf (herdr-task's view, else `pilotFor`) | ✓ |
| Detail | `Waking`, `Queued`, `Next 10:00`, `Next Wed`, `On events`, `Run now only` (`headerDetail`) | `AP.headerDetail` (`web/plugins/coordinators/client.tsx`) | ✓ |
| Flipping it | sets the space's own (equal to Everywhere's: follows again) | the same herdr-task call (`service/actions.ts` mode) | ✓ |
