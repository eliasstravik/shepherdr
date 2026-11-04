# Settings › Autopilot

The person's decision (DECISIONS.md): Autopilot works like Tasks, one setting the same across every space. Settings ›
Autopilot sets only how it works, on Everywhere's page: the heartbeat, the schedule and the events. There is no on/off
switch, no Run now, no list of spaces, no space's own page and no "Same as everywhere" there. A space is switched on or
off only by the switch in its Assistant's header, and then works from the one heartbeat, schedule and events. Made
from the window's mod (`mods/shepherdr-settings/autopilot-section.js`) and herdr-task's data
(`mods/tasks/bin/herdr_task/autopilot.py`). ✓ matches, ◇ a web-only form on purpose (why), ✗ still differs.

Shared, so the two can't drift: `core/autopilot.js` holds the page's words (title, about line, each row's label and
line, the Custom box's example, Saved), the schedule's picks, the events, herdr-task's starter heartbeat, the default
schedule, the rule for what applies in a space (`pilotFor`) and the header's detail words (`headerDetail`). The window's
section and header (`mods/pane-chat/autopilot.js`), the service (`service/compat.ts`, `service/model.ts`,
`service/autopilot.ts`) and the web (`web/src/Settings.tsx`, `web/plugins/coordinators/client.tsx`) read it.
`core/settings.js` SECTIONS has Autopilot without the space flag, so neither side's Space settings lists it.
`core/autopilot.cases.json` holds the rule's cases: `core/autopilot.test.js` checks `pilotFor` on them (and that
SECTIONS keeps Autopilot out of Space settings, and that the starter, events and default schedule are herdr-task's),
`test/test_herdr_task.py` checks herdr-task's `resolve()` and commands, and `test/test_repo.py`
(test_autopilot_from_one_core) that the window and the service read the core and keep no copy of its words.

## The data (herdr-task)

`~/.herdr/tasks/.autopilot.json`: `everywhere` ({every, events}, the one schedule and events) and `spaces`, where a
space keeps only its own `on` and how its wakes go (next_run, pending, inflight, last_wake, progress). The heartbeat is
one file, `~/.config/herdr-core/autopilot/everywhere.md`. A schedule or events a space held of its own before (version
1), and a switch on Everywhere, are dropped on the next read; a space's old `<space id>.md` is no longer read.

| Command | What it does |
|---|---|
| `herdr-task autopilot on` / `off` `--space <id>` | a space's switch (the header's); `--everywhere` refuses: "Autopilot is switched on per space, with the switch in its Assistant's header: pass --space." |
| `herdr-task autopilot set --everywhere --every … --on …` | the one schedule and events; without `--everywhere` it refuses: "The schedule and events are the same in every space: set them with --everywhere." |
| `herdr-task autopilot heartbeat` | the one heartbeat file (made with the starter when missing) |
| `herdr-task autopilot show --space <id>` / `--everywhere`, `list [--json]` | a space's switch, the one schedule and events, next and last wake, progress; `list` is `{everywhere, spaces}`, its text first `Every space: Every hour, from ~/.config/herdr-core/autopilot/everywhere.md`, then each space by name (never `~`) |
| `run-now --space <id>`, `progress`, `complete` | as before, per space |

## The page

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Where | Settings › Autopilot, Everywhere's pages only; not in Space settings (`core/settings.js` SECTIONS) | the same list (`Settings.tsx` SPACE_PAGES from `ST.SECTIONS`) | ✓ |
| Title | `Autopilot` (`autopilot-section.js`, `AP.TITLE`) | the page's name (`service/compat.ts` pilot section) | ✓ |
| About | `How Autopilot works in every space. Turn it on in a space with the switch in its Assistant's header: its Assistant then wakes on a schedule or when something happens to its tasks, and works from the heartbeat.` (`AP.ABOUT`) | `about: AP.ABOUT` | ✓ |
| Loading | `Loading…` until herdr-task answers | the snapshot always holds it (defaults until read) | ◇ the service reads herdr-task before the page exists |
| Heartbeat row | `Heartbeat` · `What it works from: direction, priorities, limits and when to stop.` (`AP.ROWS.heartbeat`) | the same (`pilotRows`, hint) | ✓ |
| Heartbeat box | its file small in monospace on top (`~/.config/herdr-core/autopilot/everywhere.md`), `Saved` a moment after a save; a monospace plain-text box, 4 lines, growing to 12; saved 600 ms after typing stops, on leaving it, and on closing Settings (`beatBox`, `saveBeat`, `autopilotFlush`) | `NoteBox mono`: the file small in monospace on top, a monospace box 4 lines tall growing to 10, saved 500 ms after typing stops and on leaving it, `Saved` beside the title a moment (`Settings.tsx` NoteBox) | ✓ |
| Missing file | made with herdr-task's starter, shown in the box | the starter's words shown; the file is made on the first save (`service/autopilot.ts`) | ✓ |
| Schedule | `Schedule` · `When it wakes by itself.` · segmented `Off`, `Every 30 min`, `Every hour`, `Weekdays 9:00`, `Custom…` (`AP.PRESETS`, `AP.CUSTOM`) | trigger row: its words, the same picks as segments (a pick list on a phone) (`Settings.tsx` TriggerValue) | ✓ |
| Custom box | placeholder `Every 2 hours on weekdays`, `Like "every 2 hours on weekdays from 8:00 to 18:00". Saved when you leave the box.`, a refusal in red in its place | `TextValue placeholder={AP.CUSTOM_PLACEHOLDER}`, `AP.CUSTOM_HINT`; a refusal under the row | ✓ |
| Events | `Events` · `These wake a space's Assistant at once when they happen to its tasks.` · chips `Added`, `Ready`, `Failed`, `Needs you`, `Merged`, `Stalled` (`AP.EVENTS`) | `multi` chips, segments on a phone | ✓ |
| Refusal | herdr-task's words in red under the rows | under the row that was set | ✓ |
| No switch, no Run now, no spaces | none on the page | none (`compat.ts` one section, level `all`) | ✓ |
| Add-on off | no Autopilot page (Settings › Window) | no Autopilot section (`compat.ts` pilotOn) | ✓ |

## The header's switch

| Element | Window | Web | State |
|---|---|---|---|
| On or off | the space's own switch (`mods/pane-chat/autopilot.js` apPoll, `pilotFor`) | `place.pilot` from `model.ts` pilotOf | ✓ |
| Detail | `Waking`, `Queued`, `Next 10:00`, `Next Wed`, `On events`, `Run now only` (`headerDetail`, from the one schedule and events) | `AP.headerDetail` (`web/plugins/coordinators/client.tsx`) | ✓ |
| `Write a heartbeat` | while on and the one heartbeat is still the starter; opens Settings › Autopilot (Everywhere's) | the same; opens Everywhere's Autopilot page | ✓ |
