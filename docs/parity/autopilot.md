# Settings › Autopilot

Autopilot works like Tasks (docs/settings.md): Everywhere's heartbeat, schedule and events, and a space's own of any of
them; what a space doesn't set is inherited from Everywhere. Settings › Autopilot has the level switch at its top and,
in a space, "Inherited from Everywhere" or "Set for this space · Reset" under each row. There is no on/off switch and no
Run now there: a space is switched on or off only by the switch in its Assistant's header. Made from the window's mod
(`mods/shepherdr-settings/autopilot-section.js`) and herdr-task's data (`mods/tasks/bin/herdr_task/autopilot.py`).
✓ matches, ◇ a web-only form on purpose (why), ✗ still differs.

Shared, so the two can't drift: `core/autopilot.js` holds the page's words (title, about line, each row's label and
line, the Custom box's example, Saved), the schedule's picks, the events, herdr-task's starter heartbeat, the default
schedule, the fields a space can set (`FIELDS`), a level's own (`levelOf`), the rule for what applies in a space
(`pilotFor`) and the header's detail words (`headerDetail`). The window's section and header
(`mods/pane-chat/autopilot.js`), the service (`service/settings.ts`, `service/compat.ts`, `service/model.ts`,
`service/autopilot.ts`) and the web (`web/src/Settings.tsx`, `web/plugins/coordinators/client.tsx`) read it.
`core/autopilot.cases.json` holds the rule's cases: `core/autopilot.test.js` checks `pilotFor` on them,
`test/test_herdr_task.py` checks herdr-task's `resolve()` and commands, and `test/test_repo.py`
(test_autopilot_from_one_core) that the window and the service read the core and keep no copy of its words.

## The data

Shepherdr settings (`~/.herdr/shepherdr.json`, which goes to every machine): `"autopilot": { every, events, heartbeat }`
in `everywhere` and in `spaces[<id>]`, each field only where it's set (`every` is the schedule's words, `""` for none).
herdr-task (`~/.herdr/tasks/.autopilot.json`) keeps each space's own `on` and how its wakes go (next_run, pending,
inflight, last_wake, progress). Its `everywhere` ({every, events}) and the file `~/.config/herdr-core/autopilot/everywhere.md`
are Everywhere's from before Settings kept them: still read where Settings sets none. A schedule or events a space held
in `.autopilot.json` (version 1) are dropped on the next read.

| Command | What it does |
|---|---|
| `herdr-task autopilot on` / `off` `--space <id>` | a space's switch (the header's); `--everywhere` refuses: "Autopilot is switched on per space, with the switch in its Assistant's header: pass --space." |
| `herdr-task autopilot set [--space <id> \| --everywhere] --every … --on … --heartbeat …` | writes that level in Shepherdr settings; `default` drops a field there, so it follows Everywhere's again; refused on a copy the window pushed |
| `herdr-task autopilot check --every …` | a schedule's words checked without saving (the window's and the web's Custom box) |
| `herdr-task autopilot heartbeat [--space <id>]` | the heartbeat that applies (`heartbeat_text`, `heartbeat_from`: space, everywhere or file), and the old file (made with the starter when missing; an earlier version's starter, never edited, becomes today's on any `autopilot` command) |
| `herdr-task autopilot show --space <id>` / `--everywhere`, `list [--here] [--json]` | what applies there, `own` (the fields the space sets itself), next and last wake, progress; `list` is `{everywhere, spaces}`, its text first `Everywhere: Every hour`, then every space the window lists by name (never `~`), this machine's then each other machine's (`exedev on vm-stravik`, asked there at once; `can't tell, … didn't answer` when it's away), with "its own schedule" where it has one; `--here`: this machine's only |
| Another machine's space (`--space vm/sp1`) | `on`, `off`, `run-now`, `show`, `heartbeat` are done by herdr-task on that machine (installed there first when it isn't this one's), told the space's name and folder from the window here; its own record and scheduler wake it there, so a wake is never sent twice and goes on while this machine sleeps. `set` writes this machine's settings under `vm/sp1`, which reach it with the rest. `on` and `run-now` start that machine's scheduler when it isn't running |
| `run-now --space <id>`, `progress`, `complete` | as before, per space |

## The page

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Where | Settings › Autopilot, Everywhere's and every space's (`core/settings.js` SECTIONS: space) | the same list (`Settings.tsx` SPACE_PAGES from `ST.SECTIONS`) | ✓ |
| Level switch | `main.js` levelBar: Applies to, a picker of Everywhere and every space | `Settings.tsx` LevelBar | ✓ |
| Under each row | in a space "Inherited from Everywhere" / "Set for this space · Reset"; on Everywhere "N spaces set their own" (`main.js` scoped) | `service/settings.ts` pilot() from/inherits/others | ✓ |
| Title | `Autopilot` (`autopilot-section.js`, `AP.TITLE`) | the page's name (`service/settings.ts` pilot()) | ✓ |
| About | `How Autopilot works. Turn it on in a space with the switch in its Assistant's header: its Assistant then wakes on a schedule or when something happens to its tasks, and works from the heartbeat.` (`AP.ABOUT`) | `about: AP.ABOUT` | ✓ |
| Loading | `Loading…` until what Everywhere had before is read | the snapshot always holds it (defaults until read) | ◇ the service reads herdr-task before the page exists |
| Heartbeat row | `Heartbeat` · `What it works from: direction, priorities, limits and when to stop.` (`AP.ROWS.heartbeat`) | the same (`pilot()`, hint) | ✓ |
| Heartbeat box | `Saved` a moment after a save; a monospace plain-text box, 4 lines, growing to 12; saved 600 ms after typing stops, on leaving it, on another level and on closing Settings (`beatBox`, `saveBeat`, `autopilotFlush`); the same words as it inherits: it follows again | `NoteBox mono`: a monospace box 4 lines tall growing to 10, saved 500 ms after typing stops and on leaving it, `Saved` beside the title a moment (`Settings.tsx` NoteBox) | ✓ |
| Nothing written yet | Everywhere's from before (the old file, else herdr-task's starter: a real heartbeat, ready as it is; an earlier version's starter shows as it, `currentBeat`) shown in the box | the same, from herdr-task's view (`model.ts` pilotEverywhere) | ✓ |
| Schedule | `Schedule` · `When it wakes by itself.` · segmented `Off`, `Every 30 min`, `Every hour`, `Weekdays 9:00`, `Custom…` (`AP.PRESETS`, `AP.CUSTOM`) | trigger row: its words, the same picks as segments (a pick list on a phone) (`Settings.tsx` TriggerValue) | ✓ |
| Custom box | placeholder `Every 2 hours on weekdays`, `Like "every 2 hours on weekdays from 8:00 to 18:00". Saved when you leave the box.`, herdr-task's check first (`autopilot check`), a refusal in red in its place | `TextValue placeholder={AP.CUSTOM_PLACEHOLDER}`, `AP.CUSTOM_HINT`, the same check (`service/autopilot.ts` checkEvery); a refusal under the row | ✓ |
| Events | `Events` · `These wake a space's Assistant at once when they happen to its tasks.` · chips `Added`, `Ready`, `Failed`, `Needs you`, `Merged`, `Stalled` (`AP.EVENTS`) | `multi` chips, segments on a phone | ✓ |
| Refusal | herdr-task's words in red under the rows | under the row that was set | ✓ |
| No switch, no Run now | none on the page | none (`service/settings.ts` pilot()) | ✓ |
| Add-on off | no Autopilot page (Settings › Window) | no Autopilot section (`service/main.ts` passes no pilot) | ✓ |

## The header's switch

| Element | Window | Web | State |
|---|---|---|---|
| On or off | the space's own switch (`mods/pane-chat/autopilot.js` apPoll, `pilotFor`); another machine's from its file there (read over herdr-core about every 12 s), flipped through herdr-task | `place.pilot` from `model.ts` pilotOf (another machine's file comes with its lists) | ✓ |
| Detail | `Waking`, `Queued`, `Next 10:00`, `Next Wed`, `On events`, `Run now only` (`headerDetail`, from the space's own schedule and events, else Everywhere's) | `AP.headerDetail` (`web/plugins/coordinators/client.tsx`) | ✓ |
| `Write a heartbeat` | while on and the heartbeat that applies is empty (herdr-task's `blank`; the starter is a real one); opens Settings › Autopilot on that space | the same; opens that space's Autopilot page | ✓ |
