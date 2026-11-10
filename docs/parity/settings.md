# Settings (Agents, Tasks, Notify, Secrets, Machines, Window, Web, and the frame)

Made from the window's mod (`mods/shepherdr-settings`, with `lib/settings.js`, `mods/chat-models` and
`mods/coordinator`'s instructions view). Autopilot has its own page: [autopilot](autopilot.md).
✓ matches, ◇ a web-only form on purpose (why), ✗ still differs.

Shared, so the two can't drift: `core/settings.js` holds every page's title, every row's title and line, the button
words, the scope lines ("Set for this space · Reset", "Inherited from Everywhere", "N spaces set their own"), the level
switch (`LEVEL`), the
rows' choices, the model button's words (`modelLabel`, `choicesFrom`, `roleSel`, `chooseModel`), Backup's warning
(`backupProblem`), Home Assistant's line (`homeAbout`), an add-on's line (`addonAbout`), Web's state (`webState`) and
the instructions editor's notes. The window's mod (`main.js`, `layout.js`, `machines-section.js`, `secrets-section.js`,
`web-section.js`, `base-branch.js`, `lib/settings.js`, `mods/coordinator/main.js`; copies by `bin/sync-shared`), the
service (`service/settings.ts`, `service/window.ts`, `service/compat.ts`) and the web (`web/src/Settings.tsx`,
`web/src/screens/Role.tsx`) read it. `core/settings.test.js` fails when any of them writes one of those words out
itself, checks the model menu's headings against `mods/chat-models`, and checks the button words, Backup's warning,
an add-on's line and Web's state; `service/settings.test.ts` checks the rows the service builds.

## Frame

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Title | `main.js:580` "Settings", a space's own "Space settings" | `Settings.tsx:1140` (Head), `:1075` (phone top) | ✓ |
| Pages, in order | `core/settings.js` SECTIONS: Agents, Tasks, Autopilot, Notify, Secrets, Machines, Window, Web | `Settings.tsx:537` groupsOf (ORDER from SECTIONS) | ✓ |
| A space's own pages | `main.js` shows(): Agents, Tasks, Autopilot, Notify, Secrets (docs/settings.md) | `Settings.tsx:537` (SPACE_PAGES from SECTIONS) | ✓ |
| Nav: one list, icon + title, the page picked raised | `main.js:572` navRow | `Settings.tsx` desktop nav, phone list | ✓ (2.1's icons drawn in its own set) |
| "This device: Appearance, Keybinds" group | none: the window follows Herdr's theme; Keybinds is its own overlay (`mods/keybinds`) | removed: one list, no group heading; the web follows the device's light or dark (`theme.ts` drops a pick kept from before) | ✓ |
| Nav title over the list | `main.js:580` (in the nav column) | Head's title (desktop), PhoneTop (phone) | ◇ the web has no window frame: its title sits in its header |
| Level switch | `main.js` levelBar: "Applies to" and a picker (Everywhere, then every space under its machine, "N own" beside one that sets some, a Find box past 8), then "Every space, unless it sets its own." or "Only this space, on <machine>. What it doesn't set is inherited from Everywhere." and its folder; Machines, Window and Web: "The same for every space." | `Settings.tsx` LevelBar: the same words (ST.LEVEL), Pick with its Find box past 10, the space's folder | ✓ |
| Escape closes | `main.js:600` | keyboard plugin back() | ✓ |
| A phone pushes a page over the list | none (a window) | `Settings.tsx` Stack | ◇ phone navigation |

## Under a row (every page)

| Element | Window | Web | State |
|---|---|---|---|
| A row: title, its line, control on the right | `main.js` row() | `Settings.tsx` PageBody | ✓ |
| In a space, own value | `main.js` scopeLine "Set for this space · Reset" (Reset's tip "Back to Everywhere's") | `Settings.tsx` PageBody (ST.CHANGED_HERE, ST.RESET, ST.RESET_TIP) | ✓ |
| In a space, following | "Inherited from Everywhere", or "Inherited from <machine>" for a value its machine set before | `service/settings.ts` pick()/follows() (machine layer too), `service/compat.ts` (Notify) | ✓ |
| On Everywhere | "1 space sets its own" / "N spaces set their own", opens the list, each opens its settings | `Settings.tsx` (ST.spacesOwn) | ✓ |
| Setting what it would get anyway unsets it | `main.js` set() | `Settings.tsx` follows() | ✓ |

## Agents

| Element | Window | Web | State |
|---|---|---|---|
| Rows | `main.js:467` Assistant, Workers, Reviewer (ROLES: titles and lines) | `service/settings.ts` agents() | ✓ |
| Model button | `lib/settings.js:143` quiet button, "Opus 5.5 · 1M · High ⌄" (modelLabel) | `Role.tsx:38` ModelButton: the words and ⌄, no box (was a "Opus 1M" pill) | ✓ |
| Unset role | the CLI's own defaults (choicesFrom defaults); unset Reviewer "Other CLI (Codex)" | `service/settings.ts` (roleSel, otherCliWords), choices read by `service/main.ts` readDefaults | ✓ |
| "Loading agents…" | `main.js` roleRow | value until the CLIs are read | ✓ |
| Model menu | `mods/chat-models/main.js:180` Model (every installed CLI's models, ✓ on the one picked), Reasoning (segments), Fast (switch, where the model has it), Permissions (row, its mode, a small list) | `Role.tsx:71` ModelMenu: the same sections and words (MODEL_MENU), segments, MenuSwitch, a list under Permissions (was a dialog with Agent/Model/Effort/Speed pickers and Save) | ✓ |
| A change saves at once | `lib/settings.js` settings mode: every change goes back | `Role.tsx` change() → setting at the page's level | ✓ |
| Picking another CLI's model | `chat-models choose()`: effort kept where it has it, full access stays full access | core `chooseModel` | ✓ |
| A model row's CLI icon | CLI icon at the left | the CLI's name as the row's hint | ◇ the web has no CLI icons |
| Use other CLI | `main.js` roleRow: Everywhere, Reviewer set | `Settings.tsx` Control (row.agent.other) | ✓ |
| Edit instructions | `main.js` roleRow: Everywhere only | `Settings.tsx` Control (row.file only on Everywhere) | ✓ |
| Instructions editor | `mods/coordinator/main.js:112` title, Done, saved as you type, the role's note, "Saved." | `Role.tsx:136` FileSheet: title, Done, saved 600 ms after typing, the note, "Saved." (was Save/Discard) | ✓ |
| Backup agent | `main.js:482` switch, "The other CLI takes over a task once when its agent can't go on." | `service/settings.ts` (BACKUP) | ✓ |
| Backup warning | `main.js` "Can't on vm-ssa: Codex is signed out." (cli-check.json; Everywhere: every machine, a space: its machine) | `service/settings.ts` (backupProblem), shown as the second line | ✓ (was missing) |

## Tasks

| Element | Window | Web | State |
|---|---|---|---|
| Merge | `main.js:503` segmented On Accept / After checks pass / Right away, its line | Segments (SEGMENTS), ABOUT | ✓ (was a picker, no line) |
| Review | segmented Off / 1 round / 2 rounds / 3 rounds | Segments | ✓ (was a picker) |
| Must fix | only while Review is on; segmented | `service/settings.ts` tasks() leaves it out at Off; Segments | ✓ |
| Proof, Worktrees, Run automations | switches | Switch (On/Off words) | ✓ (were pickers) |
| Tasks at once | stepper − N + (1–10), no unit | `Settings.tsx:575` Stepper over the row's steps | ✓ (was a typed box with "tasks") |
| Archive Done after | segmented Off / 1 day / 3 days / 1 week / 1 month | Segments | ✓ (was a picker) |
| Base branch (a space's) | `base-branch.js:47` box, "Its branch now: main" / "Its current branch", checked here or on origin, "There's no branch “x” here or on origin." | text box with that placeholder (`service/main.ts` fetchBranch), checked in `service/main.ts` before saving, the error under the row | ✓ (was missing) |
| Branch names (Everywhere's or a space's) | `branch-names.js` box, "task/{n}-{slug}" when empty, checked by `branchPattern`, its words under the box | text box with that placeholder, checked by `branchPattern` in `service/settings.ts` before saving, the error under the row | ✓ |
| When a task starts / finishes | `main.js:545` title, line, a box as wide as the page with its example dim, saved after typing stops and on leaving, "Saved" | `Settings.tsx:817` NoteBox (was a Save/Undo editor with "Every task here") | ✓ |
| Lines under each row | ABOUT | `service/settings.ts` hint: ABOUT | ✓ (were missing) |

## Notify

| Element | Window | Web | State |
|---|---|---|---|
| Notify row | `main.js:436` segmented All / Needs me / Off, "What reaches you from a space's Assistant. Tasks always alert." | `service/compat.ts` (NOTIFY_ABOUT), Segments | ✓ (was a long 2.1 page line) |
| Machines that set their own before | rows "<machine>" "Its spaces use X." Reset | `service/compat.ts` rows `notify.machine@m` with Reset, `service/main.ts` clears it | ✓ (was missing) |
| Alerts on this device | none (the window gets the system's notifications) | Turn on | ◇ a browser must ask the device before it can alert |

## Secrets

| Element | Window | Web | State |
|---|---|---|---|
| Line | `secrets-section.js:146` "Agents use these by name and never see them." | `Settings.tsx:861` SecretsPage | ✓ |
| Asked for | `:92` "<agent> asks for NAME", its why, Give it (fills Name and its narrowest scope) | asks from `service/main.ts` secretsPage | ✓ (was missing) |
| Add | `:104` Name (GITHUB_TOKEN), Value (Paste the value, masked), For (Everywhere / Machine… / Space…), "The same name again replaces it there.", Save / Saving… | same form, For as a menu with Machine and Space headings | ✓ (was "Add a secret" per level and a "For this space only" switch) |
| Notes and errors | "Kept X for Y." "Removed X from Y." "Paste the new value for X." the name rule, "Paste the value first." | the same (SECRETS) | ✓ |
| Kept | `:121` every secret, key icon, name, where, Replace, Remove → Remove / Keep | the same, all scopes (`service/secrets.ts` entries) | ✓ (was each level's names with "Saved … ago") |
| A space's own page starts For on that space | `main.js` secFor() | SecretsPage starts on the page's level | ✓ |

## Machines

| Element | Window | Web | State |
|---|---|---|---|
| Heading | `machines-section.js:157` "When new tasks wait, on every machine" | group heading (MACHINES.heading) | ✓ |
| Limits | `:96` steppers "80%" / "Off" (CPU as a share of all cores) | Stepper over the row's steps from "Off" its default (was a typed box) | ✓ |
| Workers run at low priority | switch | Switch | ✓ |
| Memory cap per worker | stepper Off, 1 GB … 32 GB | Stepper (was a picker) | ✓ |
| Under each: all machines | "1 machine uses its own" | ST.machinesOwn | ✓ |
| Under each: a machine | "Inherited from all machines" / "Set for this machine · Reset" | from/inherits "all machines" (ST.SET_FOR_MACHINE) | ✓ |
| Machine block | `:132` its name, then health and plans (machineDetails) | `MachineDetails.tsx` (core/machines.js words) under the machine's name | ✓ (health/plans were missing) |
| Home Assistant | `:60` switch, its line from the home round (homeAbout), Make home space beside it when there is none | Switch, homeAbout, row.extra button (`service/main.ts` home.makereq, also on turning it on) | ✓ (Make home space and the round's lines were missing) |
| Limits · Set its own | `:150` "Limits" "Same as all machines." Set its own | reveals row, ST.MACHINES.own | ✓ |
| Set before for its spaces | `:153` names, "These still apply to its spaces unless a space sets its own." Reset | button row | ✓ |

## Window

| Element | Window | Web | State |
|---|---|---|---|
| The nine switches | `layout.js:30` SWITCHES (titles, lines) | `service/window.ts` (core SWITCHES) | ✓ |
| Add-ons heading and switches | `layout.js:39` "Add-ons" | group "Add-ons" | ✓ |
| Blocker words | `:44` "<names> need(s) it: turn that/them off first." / "Needs <names>: turn it/them on first." | core addonAbout | ✓ |
| A blocked add-on | its switch greyed (disabled) | Switch disabled (was its words only) | ✓ |

## Web

| Element | Window | Web | State |
|---|---|---|---|
| Shepherdr on the web | `web-section.js:30` state line: "On, private to your tailnet." / why / "Off. Turn it on under Window › Add-ons." | `service/settings.ts` web() (webState, the service's own state) | ✓ (was only a Link row) |
| Link | `:32` the link, Copy, "Copied" for 1.5 s | link as its line, Copy (CopyButton), "Copied" for 1.5 s once it really copied (copy.ts) | ✓ |
| QR code | `:34` "Open it on your phone", the picture | the same SVG (`service/main.ts` webNow), its words | ✓ (was missing) |
| "Reading…", "Shepherdr's service isn't running here." | before the first read, no service | never: the page comes from the service | ◇ the web is the service's own page |
