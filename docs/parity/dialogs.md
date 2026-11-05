# New space, Add machine, worktrees, rename dialogs

Made from the window's mods: `mods/newspace` (and its opener and sizes, `lib/coordinator.js` newSpace / NEWSPACE),
`mods/machine-add-chat`, `mods/spaces-chat/rename.js` and `icon.js`, Herdr's own worktree dialog (`mods/worktree` in the
Herdr home: Herdr ships it, Shepherdr opens it from `mods/spaces-chat/popups.js:80`), the Assistant's close dialog
(`mods/coordinator/main.js` closeDialog) and `mods/prompt-chat` (Rename tab). ✓ matches, ◇ a web-only form on purpose
(why), ✗ still differs.

Shared words and rules, so the two can't drift:

- `core/newspace.js`: New space's words, the suggestions (at most `SHOWN`), the field's paths, where it starts, a new
  repo's git steps, when "Make it a git repo" shows, what Herdr names the space. `mods/newspace/main.js`,
  `web/plugins/places/add.tsx` and `service/spaces.ts` read it.
- `core/machine-add.js`: Add machine's words, the ssh config's hosts, a row's second line, when an add needs a
  terminal, the Mac check. `mods/machine-add-chat/main.js`, `web/src/screens/AddMachine.tsx` and `service/actions.ts`
  read it.
- `core/confirm.js` (the cards surface's): Rename tab's words.
- `core/newspace.test.js` checks the words, the rules, that the window's mod, the web and the service import the same
  core, and that the dialog's height (`lib/coordinator.js` NEWSPACE_SHOWN) counts as many suggestions as it shows.

All dialogs on the web are 2.1's sheet (a centered panel on desktop and tablet, a sheet from the bottom on a phone) with
a × in its header: ◇ the web has no window frame, and a touch screen has no Esc.

## New space

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | the + menu's New space, a machine's + › New space, Ctrl+Shift+N (`mods/tabs-tasks/main.js:61`, `mods/spaces-chat/popups.js:42`) | the Assistant's + menu (`web/plugins/coordinators/client.tsx`), a machine's + › New space (`web/plugins/places/client.tsx`), `openAddSpace` (`add.tsx:19`) | ✓ |
| Ctrl+Shift+N | opens it on the shown space's machine (`keys.json`) | none | ◇ the browser keeps Ctrl+Shift+N (a private window) |
| Its machine | the one it was opened for (a machine's +), else the shown space's (the Spaces heading's +, Ctrl+Shift+N), when reachable, else this computer (`lib/coordinator.js` newSpace, `core/newspace.js` startMachine) | the same (`add.tsx` NewSpaceDialog) | ✓ |
| Machine choice | with two or more machines on and reachable: `Machine` over the folder, a field-like button (icon, name, chevron) whose list shows them with a check on the chosen one; another one finds its home and recent folders and starts the field over; one machine: not shown, `on vm` in the title instead (`mods/newspace/main.js` machineChoice, switchTo) | a native select with the machine's icon (`add.tsx` MachineChoice); the field starts over from that machine's `api/newspace` | ◇ the phone's own picker on the web |
| Before it opens | the machine's recent folders and home are found first; unreachable: toast `Couldn't reach vm` / `Try New space again once it's connected.` (`lib/coordinator.js:183`) | `api/newspace` (`service/spaces.ts` newSpaceInfo) while the field waits; unreachable: the same words in red in the footer (`add.tsx:89`) | ◇ the web's dialog is already open when it asks, so it says it there |
| Title | `New space`, and `on vm` dim beside it on another machine while no Machine choice shows (`mods/newspace/main.js`) | `W.title`, `W.on(machine)` under it (`add.tsx`) | ✓ |
| Label | `Icon and folder` (`main.js:322`) | `W.label` (`add.tsx:219`) | ✓ |
| Icon button | `#` (dim) until an emoji is picked, left of the field; a click opens the icon picker (`main.js:196`, `:345`) | `IconChoice kind="space"` (`add.tsx:222`, `section.tsx`) | ✓ |
| Icon picker | the Rename dialog's picker, its pick shown on the button; saved for the new space as Rename saves it (`lib/coordinator.js` createSpace) | `IconPicker` under the field (`add.tsx:284`); sent as `icon`, kept in the sidebar's icons (`service/spaces.ts` newSpace) | ◇ under the field in the sheet, not a popup |
| Field | placeholder `~/path/to/folder`, starts at where the person works (the focused pane's or shown space's folder, as its recent repo's top; else home; never a scratch folder) (`main.js:64`, `:83`) | `W.placeholder`; starts at the shown space's folder through `NS.startFolder` (`add.tsx:89`, `service/spaces.ts`) | ✓ (the web has no focused pane: the shown space's folder) |
| Suggestions | recent folders of that machine (its terminals' folders as their repo's top, no task worktrees, at most 8), those matching what's typed, at most 5, the field's own left out; open on typing or Up/Down, close on a pick, Esc or a click elsewhere (`main.js:138`, `lib/coordinator.js` recentFolders) | `NS.suggestions` over `recent` from `NS.recentCandidates` / `REPO_TOPS` / `NS.recentFrom` (`add.tsx:131`, `service/spaces.ts`) | ✓ |
| A suggestion row | folder icon, its name, its path dim (`main.js:278`) | `add.tsx:260` | ✓ |
| Suggestions' place | a popup under the field in the window's top layer | a list under the field inside the sheet | ◇ a sheet clips what hangs out of it |
| Keys | Up/Down walk, Enter picks the one on else creates, Esc closes the list first then the dialog (`main.js:203`, `:249`) | `onKey` (`add.tsx:191`) | ✓ |
| Browse… | this computer: the desktop's folder picker; another machine: the field's folder's subfolders under the field, `..` first, a click goes on into one, `Loading…` / `No folders inside`, `Couldn't list ~/x on vm.` (`main.js:153`, `:168`, `:303`) | the field's folder's subfolders on every machine, `..` first, the same words (`add.tsx:147`, `:164`, `:252`) | ◇ the web has no system folder picker: it lists as the window does on another machine |
| Missing folder | `This folder doesn't exist. It will be created.` dim under the field, its room kept (`main.js:308`) | `W.missing` (`add.tsx:288`) | ✓ |
| Make it a git repo | a checkbox, on by default, `Make it a git repo` + dim `so each task gets its own worktree`, for a folder outside git that isn't home or / (`main.js:284`) | `role="checkbox"`, `W.makeRepo` / `W.makeRepoWhy`, `NS.offersRepo` (`add.tsx:295`) | ✓ |
| In a repo | branch icon + `A git repo: each task gets its own worktree` (`main.js:289`) | `W.isRepo` (`add.tsx:301`) | ✓ |
| Footer | an error in red at the left, `Cancel`, `Create space` (`Creating…`), disabled until the folder is known (`main.js:339`) | `add.tsx:305` | ✓ |
| Create | mkdir -p a missing folder (`Couldn't make ~/x.`), git init on main + `First commit` (`Couldn't make it a git repo: …`), named as Herdr names it (`Home` at home, its repo's, else its folder's), its icon kept, its Assistant (on the space's machine) when Settings says so, lands in it (`main.js:219`, `:225`, `:236`, `lib/coordinator.js` createSpace) | `service/spaces.ts` newSpace with `NS.NEW_REPO`, `NS.placeName`, `NS.WORDS.cantMake` / `cantRepo`; the window's tab bar gives a new space its Assistant, on any machine without a Shepherdr window of its own; the web opens it once it shows (`add.tsx:110`) | ✓ |
| 2.1's extras | — | the machine picker, the Name field and its rules, `Likely repos`, `Already a space.` and the status sentences: removed | ✓ |

## Rename (space, section, machine) and New section

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | a space's, machine's or section's Rename…, Shift+F2, a machine's + › New section (`mods/spaces-chat/popups.js:62`) | the same menus, Shift+F2 (`web/plugins/places/client.tsx`); a space's Rename opens it now (it opened nothing before) (`section.tsx:72`) | ✓ |
| Title | `Rename space` / `Rename section` / `Rename machine` / `New section` (`rename.js:124`) | `section.tsx:153` | ✓ |
| Subtitle | none | none (2.1's "In vm", "The machine vm" removed) | ✓ |
| Label | `Icon and name` (`rename.js:126`) | `section.tsx:190` | ✓ |
| Icon button | the emoji, else `#` (space), folder (section), server / monitor (machine / this computer) (`rename.js:115`) | `IconChoice` with `PlainIcon` (`section.tsx`) | ✓ |
| Pinned | — (Pinned's heading has no menu: `mods/spaces-chat/main.js:418`) | the dialog still handles Pinned (no icon: it keeps its pin) for whatever opens it | ✓ (whether Pinned has a Rename at all is the sidebar page's row) |
| Field | starts with its text selected; value the name given (empty when nobody named it), placeholder what it's called now: a space's shown name, `Section name`, a machine's own name or `This computer` (`rename.js:53`, `:54`) | `section.tsx:199`; a space's "nobody named it" from the snapshot's `unnamed` (`service/compat.ts`) | ✓ |
| Checks, on Save | `A section needs a name.`, `Another section here has this name.` in red in the footer, the field's border red (`rename.js:75`, `:76`) | `section.tsx:122`, `:160` | ✓ |
| Footer | `Cancel`, `Save` / `Create section`, never disabled (`rename.js:138`) | `section.tsx` (2.1's hint lines and the × in the field removed) | ✓ |
| Save | a space's name through space.rename (`""` gives Herdr's own back), its icon; a section's name and icon; a machine's name and emoji (`rename.js:71`) | `act rename` (`unname` for a space emptied: `service/actions.ts` rename) | ✓ |
| Keys | Enter saves, Esc cancels (`rename.js:123`) | form submit, Esc (`section.tsx:135`) | ✓ |
| Icon picker | categories, search `Search all emoji`, sections, `No emoji found`, at the bottom `Reset to #` / `Reset to folder` / `Reset to server icon` / `Reset to monitor icon`, dim while there's none (`icon.js:31`, `:109`, `:135`) | `IconPicker`: the chat's picker `plain` (no Frequently used, no skin tone), the reset row (`section.tsx:102`, `web/plugins/reactions/client.tsx` EmojiChooser) | ✓ (its empty search line is the chat picker's, the chat surface's) |
| Picker's place | a 360×420 popup under the icon button | inside the sheet under the field | ◇ a sheet clips what hangs out of it |

## Worktree dialog (New, Open, Remove worktree)

The window's is Herdr's own `mods/worktree/main.js` (in the Herdr home; cited as `worktree:line`).

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | a space's menu New worktree / Open worktree / Remove worktree (`core/menus.js` spaceMenu, `popups.js:80`) | the same menu (`web/plugins/places/client.tsx`), the + menu (`web/plugins/coordinators/client.tsx`) | ✓ |
| Looking | `…` until the repo is known (`worktree:314`) | `Worktree.tsx:126` | ✓ |
| Not in git | `~/x is not in a git repository.` (`worktree:282`) | `Worktree.tsx:126` from `info` (`service/worktrees.ts`) | ✓ |
| New: title | `New worktree of repo` (`worktree:311`) | `Worktree.tsx:125` | ✓ |
| New: detail | `A new space on a checkout in ~/.herdr/worktrees/repo/. A branch that exists is checked out; a new one starts from here.` (`worktree:321`) | `Worktree.tsx:135` | ✓ |
| New: field | placeholder `branch name`; Enter creates; empty: `Type a branch name.` (`worktree:115`, `:184`) | `Worktree.tsx`; `service/worktrees.ts` new | ✓ |
| New: makes | git worktree add (a new branch from HEAD), then a space there left unnamed so it follows the folder and nests under the repo (`worktree:185`) | `service/worktrees.ts` new → newSpace `unnamed` | ✓ |
| Open: title, count | `Open worktree of repo`, `N checkouts` or `n/N checkouts` right (`worktree:270`, `:280`) | `Worktree.tsx:125`, `:137` | ✓ |
| Open: filter | placeholder `filter worktrees` (`worktree:115`) | `Worktree.tsx:156` | ✓ |
| Open: rows | the main checkout first, then the latest committed; branch (`detached`), `main checkout`, `open` (accent) when a space shows it, else its age (`5m`, `3h`, `2d`, `1mo`); path dim (`worktree:248`) | `Worktree.tsx:163`; order, `place` and ages from `service/worktrees.ts` checkouts | ✓ |
| Open: none | `No matching worktrees.` (`worktree:297`) | `Worktree.tsx:169` | ✓ |
| Open: picks | the space showing it is selected, else a new space there (`worktree:201`) | `openOne` (`Worktree.tsx`) | ✓ |
| Remove: title | `Remove worktree name?` (`worktree:311`) | `Worktree.tsx:125` | ✓ |
| Remove: detail | `Closes the space and deletes ~/x. The branch stays.`; the main checkout: `This is the repository's main checkout, not a worktree.` (`worktree:319`, `:320`) | `Worktree.tsx:133`, `:134` | ✓ |
| Remove: warnings up front | `It has uncommitted changes: they will be lost.`, `Submodule a, b has commits that aren't pushed anywhere: they will be lost.` (`worktree:334`, `:335`) | `Worktree.tsx:176`, `:177`; read by `info` (`service/worktrees.ts` submodules) | ✓ |
| Remove: changed since | `It changed since this opened. Enter again removes it anyway.` (`worktree:220`) | `service/worktrees.ts` remove, shown as the error (`Worktree.tsx`) | ✓ |
| Remove: does | closes the space, then git worktree remove (forced with changes or submodules) (`worktree:222`) | `service/worktrees.ts` remove | ✓ |
| Errors | git's own words (`git worktree add failed.`, `git worktree remove failed.`) (`worktree:189`, `:225`) | the same | ✓ |
| Keys line | `↵ create · esc cancel`, `↵ remove · esc cancel`, `↑↓ choose · ↵ open · esc close`, `esc close`, `working…` (`worktree:302`, `:356`) | `Worktree.tsx:136`, with a keyboard | ✓ |
| Buttons | none | on a touch screen (coarse pointer) only: `Cancel` / `Close` and `Create` / `Remove` (`Worktree.tsx:187`) | ◇ a touch screen has no Enter or Esc to press |
| Keys | Esc closes; Enter acts; Up/Down walk Open's list (`worktree:229`) | `Worktree.tsx:99`, `onKey` | ✓ |

## Add machine

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | the sidebar foot's `Add machine` (a plus) (`mods/workspace-chrome-shepherdr/main.js:47`) | `AddMachineButton` (`AddMachine.tsx:24`) | ✓ |
| Title | `Add machine` (`mods/machine-add-chat/main.js:248`) | `AddMachine.tsx:160` | ✓ |
| About | `A VPS, a Mac mini, a box at home: Herdr reaches it over ssh, and agents there keep running while your laptop sleeps.` (`main.js:255`) | `W.about` (`AddMachine.tsx:164`) | ✓ |
| Hosts label | `From your ssh config` / `Your ssh config lists no hosts` (`main.js:257`) | `AddMachine.tsx:165` | ✓ |
| Reading | `Reading your ssh config…` (`main.js:267`) | `AddMachine.tsx:167` | ✓ |
| Host row | server icon, its alias, `user@hostname` (else `also a, b`) dim; a click adds while it's idle (`main.js:225`, `:268`) | `MA.hostSub`, `role="button"` while idle (`AddMachine.tsx:132`, `:140`) | ✓ |
| Row's right | `Added` (green, check) / `Connecting` (spinner) / `Waiting in its terminal` / `Add` button (`main.js:208`) | `AddMachine.tsx:142`, `:144`, `:146` | ✓ (no "Waiting in its terminal": see below) |
| Needs the person | a password, a new host key, herdr-core to install: the same add opens in a small terminal window (`Adding vm: answer it here`), the row waits, the list catches up every 3 s (`main.js:89`, `inTerminal`) | the window's own no-terminal fallback: `Herdr couldn't open a terminal for this. Copy the command, then run it in any terminal.` + `Copy command` / `Copied` (`AddMachine.tsx:95`, `service/actions.ts` machine-add) | ◇ the web has no terminal window to open one in |
| Failed | the reason in red under the row (else `It didn't work.`) (`main.js:162`) | `AddMachine.tsx` note | ✓ |
| A Mac | a neutral card: `vm is a Mac: allow its folders once`, the Full Disk Access text, the herdr-core path, `Open the setting on vm`, then `It's open on the Mac's screen.` (`main.js:111`, `:116`) | `macCard` (`AddMachine.tsx:111`, `:116`), `machine-mac-open` | ✓ |
| Typed | `Or type how ssh reaches it`, field `user@host`, `Add` (the dialog's one primary, disabled while empty); Enter adds; its error under it (`main.js:271`, `:290`) | `AddMachine.tsx:169`, `:177`, `:185` | ✓ |
| Adds with | `hc machine add <target> --json` (`main.js:72`) | the same (`service/actions.ts` machine-add; 2.1's `--install` and host pattern removed) | ✓ |
| Esc | closes (`main.js:170`) | `AddMachine.tsx:66` | ✓ |
| 2.1's extras | — | the one `Host` field dialog with `Adding…`: removed | ✓ |

## Close the Assistant, Rename tab

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Close: when | only while the Assistant has workers; else its tab closes (its space's last: Close space's confirm) (`lib/coordinator.js:380`) | counts first, then the same (`web/plugins/coordinators/client.tsx` closeTab flow) | ✓ |
| Close: title, text | `Close the Assistant?`, `It has N worker(s) running. Their branches and worktrees stay either way.` (`mods/coordinator/main.js:191`) | `coordinators/client.tsx` CloseAssistant | ✓ |
| Close: choices | `Stop its workers` / `Ends the agents it started and closes their tabs.`, `Let them finish` / `Workers keep running in their own tabs, on their own.`, Stop first; Up/Down switch (`main.js:197`) | radio rows, the same words | ✓ |
| Close: buttons | `Cancel`, `Close Assistant`; Enter confirms (`main.js:200`) | the same | ✓ |
| Rename tab | `Rename tab`, label `Name`, value the name given (empty: unnamed), placeholder its name, `Save` (`mods/prompt-chat/main.js:42`, `lib/coordinator.js` renameTab) | `CF.RENAME_TAB` (`coordinators/client.tsx` TabRename; `core/confirm.js`) | ✓ |
