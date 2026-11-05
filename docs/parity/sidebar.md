# Sidebar

Window: `mods/spaces-chat` (main.js the rows and headers, popups.js the menus, machine-popup.js, machines.js (from
`lib/machines.js`), sections.js, unread.js, notify.js; rename.js and icon.js are on the [dialogs](dialogs.md) page) and
`mods/workspace-chrome-shepherdr/main.js` (the brand row and the foot). Web: `web/plugins/places/client.tsx` (P),
`web/plugins/health/client.tsx` (H), `web/src/App.tsx` (A), `web/src/screens/AddMachine.tsx` (AM), and the data in
`service/compat.ts`, `service/machines.ts`, `service/model.ts`, `service/actions.ts`.

Shared, so the two can't drift: `core/menus.js` (every sidebar menu, Notify's note: `core/menus.test.js`),
`core/machines.js` (the meter's levels and tooltip, plan rows, every word of the machine popup, the red dot's:
`core/machines.test.js`), `core/spaces.js` (a row's git tail, `tilde` and `sharedNames` for two spaces with one name,
a deleted section's toast and its Undo: `core/spaces.test.js`). The window's mods read them as the web does.

State: ✓ matches, ◇ web-only form (why), ✗ still differs (why).

## Brand row and foot

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Mark and name | workspace-chrome-shepherdr main.js:51 Herdr's logo, "Herdr" | A:163 the crook, "Shepherdr" (`snap.name`) | ◇ the window's brand row is the Herdr app's own chrome; the web app is Shepherdr's own page, so it names itself |
| Search | main.js:52 magnifier icon button, opens Jump (Ctrl+K) | A:174 `SearchButton`: magnifier icon button, opens Jump (Search); title "Search · Ctrl+K" | ✓ (2.1's "Search" box under the brand row removed) |
| Sidebar toggle | main.js:54 sidebar icon: to the rail and back | A:168 `PlacesToggle` (Frame.tsx): hides or shows the sidebar | ◇ the web hides the column (no rail); on a phone or tablet the sidebar is a drawer |
| Foot: Settings | main.js:44 cog "Settings" (Herdr's app settings, update dot) | none | ◇ Herdr's own app settings belong to the window app, not to Shepherdr's web page |
| Foot: Shepherdr | main.js:46 crook "Shepherdr": Shepherdr settings | A:196 crook "Shepherdr": Settings | ✓ |
| Foot: Add machine | main.js:47 plus "Add machine" | AM:12 plus "Add machine" (was a server icon) | ✓ |
| Foot layout | rows stacked | one row | ◇ 2.1's look |

## Spaces heading

| Element | Window | Web | State |
|---|---|---|---|
| "Spaces" | main.js:708 "Spaces", 12 medium dim | P:778 `SpacesHeading` "Spaces" | ✓ (was missing; its + sat in the brand row) |
| + | main.js:711 tooltip "New space or section"; menu New space, New section on the shown space's machine | P:779 `AddButton` title "New space or section"; core/menus.js `addMenu` | ✓ |

## Machine header

| Element | Window | Web | State |
|---|---|---|---|
| Which machines | main.js:338 this computer and every machine `hc machine ls` knows (temporary ones aside), connected or not | service/model.ts `known` → main.ts → compat.ts: every non-temporary machine with its state | ✓ (the service listed connected ones only: an offline machine was missing) |
| Icon | main.js:378 its emoji, else monitor (this computer) or server | P:667 `MachineMark`: emoji, else `MonitorIcon` (`here`) or `ServerIcon` | ✓ (this computer showed a server) |
| Name | main.js:381 `machineLook` name, else its own, "This computer" | compat.ts `machineLabel` | ✓ |
| Connected: + | main.js:383-389 always there, tooltip "New space or section" | P:711, P:821 always there (was only on hover) | ✓ |
| Connected: meter | main.js:403-416 thin bars, grey / amber (new tasks wait) / red (past alert), tooltip `meterWords` | H:59 `MachineMeter` same bars and levels, title `core.meterWords` | ✓ (tooltip was "name: CPU …" without plans) |
| Red dot | main.js:391 when its health couldn't be read, tooltip "Couldn't read its health: …" | H:78 `HealthDot`, `core.healthErrorWords`; service/machines.ts now keeps `error` | ✓ (was missing) |
| Offline | main.js:382 "Offline" / "Connecting…", dimmed, no + or meter | P:710, P:695 `dim`, no +, meter or dot | ✓ |
| Offline starts folded, a tap opens it for now | main.js:356, 367 `openOffline` (not kept) | P:77 `toggleOff`, P:231 `placeTree` | ✓ |
| Fold | main.js:368-371 a click folds, kept (`machines.folded`) | P:45 `toggleFold`, kept on this device | ✓ |
| Chevron | main.js:393 at the right end | P:801 `Fold` before the icon | ◇ 2.1's look (Slack's chevron) |
| Warnings in words | none (the meter's colors say it) | removed ("herdr down", "CPU 95%") | ✓ |
| Folded: counts | none | removed (2.1's dot) | ✓ |
| Menu | main.js:378 right-click (offline too), at the pointer: core/menus.js `machineMenu` Rename… | P:709 right-click at the pointer (src/rowmenu.tsx), a held finger beside the row or under it on a phone (offline too) | ✓ (◇ a held finger: touch has no right-click) |
| ⋯ button | none | none | ✓ (the web's hover ⋯ removed) |
| Drag | header takes a dropped space back to its machine's top; machines don't move | P:707 drop target; machines no longer drag | ✓ (2.1's machine reordering removed) |
| Loading… row | main.js:344 "Loading…" while its layout loads and no rows show | none | ◇ the service reads each machine's spaces before its snapshot shows them; an empty machine is its header, as the window's |

## Machine popup (the meter's click)

| Element | Window | Web | State |
|---|---|---|---|
| Opens | machine-popup.js:19 under the meter, its right edge at the meter's, 320 wide | H:160 popover under the meter, right-aligned, 20rem | ✓ |
| Header | machine-popup.js:44-47 server/monitor, name, "Updating…" / "Updated just now" / "Updated 5m ago" | H header: same icon, name, `core.freshWords` | ✓ (was "at 08:41") |
| Reads again on opening | machine-popup.js:33 when plans are over a minute old | H `limits-check` when `limitsAt` over a minute old | ✓ |
| Health heading | machines.js `heading("Health")`, "Read 2m ago" / "Couldn't read it now" (amber) | H `Heading "Health"`, `core.healthReadWords` | ✓ |
| Meter rows | name, "N%", bar, detail + " · Over its alert limit" / " · New tasks wait" | H `MeterRow`, `core.meterSub` | ✓ (was "Alert limit crossed" / "New tasks wait for room") |
| No meters | "Couldn't read it: …" / "Reading…" | `core.noHealthWords` | ✓ |
| Nothing read yet | "Reading this machine…" | `core.READING_MACHINE` | ✓ |
| Tasks and herdr rows | none | removed | ✓ |
| Plan usage heading | "Plan usage" | H "Plan usage" | ✓ |
| A CLI | name · Plan, "Read 3m ago" (amber when old or failed), its account | H `Cli`: `core.cliTitle`, `core.readOld`, account | ✓ (account was dropped by the service) |
| A window | name, "19% left · 81% used", bar, "Refills Mon 3:05pm · in 2h" / "Refills …" / "No refill time reported" | `core.windowWords` | ✓ (was "19% left") |
| A refilled window | "5-hour: refilled Mon 3:05pm, not read since." | `core.windowWords().dead` | ✓ |
| Failed read | "Last read failed: …" | `core.failedWords` | ✓ |
| Signed out / no plan / unknown | "Not signed in on this machine." / "No plan limits: not signed in to a subscription." / "Unknown. …" | `core.whyWords` | ✓ (no periods before) |
| CLI with no usage source | "No usage info." | `core.NO_USAGE` (agents from the window's `machines.stats`) | ✓ (was missing) |
| No CLIs | "No agent CLIs here." / "Reading plan usage…" | `core.noPlanWords` | ✓ |
| Machine settings | cog "Machine settings" › → Settings › Machines | H: cog "Machine settings" › → Settings › Machines (everywhere) | ✓ (was "Limits and alerts") |
| Esc, click outside | closes | closes | ✓ |
| Plan limits sheet, foot bar | none | web/plugins/limits emptied | ✓ (2.1 only) |

## Pinned and sections

| Element | Window | Web | State |
|---|---|---|---|
| Pinned | main.js:425-443 at the top while it holds any; pin icon, "Pinned", no menu | P:729 `SectionHeading` (PINNED): pin, "Pinned", no menu | ✓ |
| Pinned rows say their machine | main.js:441 once there are several | P:570 `where` when `manyMachines` | ✓ |
| Section heading | main.js:471-488 folder or emoji, name, chevron | P:729 | ✓ (chevron place ◇ as above) |
| Folded: counts | main.js:433, 481 red and green counts added up | P:786 `Inside` → `AttentionBadge` | ✓ (was a grey/red dot) |
| Folded: still shows the space you're in and unread ones | main.js:440, 463 | P:235 `stays` | ✓ (was hiding them all) |
| Going to a space unfolds nothing | window never unfolds | P:893 (2.1's unfold-on-go removed) | ✓ |
| Empty open section | main.js:497 "Drag spaces here" | P:767 "Drag spaces here" | ✓ |
| Section menu | main.js:478 right-click at the pointer; popups.js core/menus.js `sectionMenu`: Rename…, Delete | P:747 right-click at the pointer, a held finger; the same items | ✓ |
| Section ⋯ button | none | none | ✓ (the web's hover ⋯ removed) |
| Delete at once, toast with Undo | sections.js: "Deleted the section “X”", "Its spaces moved up to the machine. Click to undo." | P:793 `deleteSection` → `toast` with `core/spaces.js` `sectionDeletedToast`; its tap → `section restore` (service/actions.ts, `withRestoredSection`) | ✓ (the web had no Undo) |
| Sections and machines don't drag | only spaces drag | P:707, P:741 menu-only press | ✓ (2.1's reordering removed) |

## Space rows

| Element | Window | Web | State |
|---|---|---|---|
| # or emoji | main.js:654 "#", or its emoji; # bright when unread, muted when open, else dim | P:334 | ✓ |
| Name | main.js:91 `nameText`: bold and bright while unread; dim when muted; bright when open; else muted | P:338 | ✓ (counts no longer make it bold) |
| Unread | unread.js: Assistant's turn unread; never when muted; Settings › Window › Bold unread spaces | src/unread.ts `placeUnread`, `look.unread` | ✓ |
| Notify Off look | main.js:654-659 dimmed, emoji at half, crossed-out bell, counts still show | P:334-352 | ✓ |
| After the name | main.js:598-616 `gitTail`: machine in Pinned, repo/branch (no ↑ahead ↓behind since SHEP-32) | P:322 core/spaces.js `gitTail` | ✓ |
| Two spaces with one name | main.js:619 its folder, from ~ | P:302 `sharedNames`, `tilde` (core/spaces.js) | ✓ (was missing) |
| Counts | main.js:662 red (needs you), green (Ready), 9+; Red counts / Green counts switches | P:352 `AttentionBadge` | ✓ (were hidden on unreachable spaces) |
| Worktree nesting | main.js:305-325 under its repo's space, branch icon; Worktrees in the sidebar off hides them but the open one | P:209 `nest`, `look.worktrees` | ✓ |
| Click | main.js:529 selects | P:538 goes there | ✓ (2.1's ⌘-click split view removed) |
| Right-click menu | main.js:649 at the pointer, core/menus.js `spaceMenu`; worktree rows too | P:585 at the pointer, a held finger; P:417 the same items; worktree rows too | ✓ (also on spaces of an unreachable machine now) |
| ⋯ button | none | none: the count stays put on hover | ✓ (the web's hover ⋯ removed) |
| Notify setting | popups.js: bell (crossed out when Off), "Notify", All / Needs me / Off, note "Tasks alert either way." | P:426 `MenuSetting named`, note from core/menus.js | ✓ (the word and the note were missing; per-choice hints removed) |
| Close… | confirm-chat: "Close “web”?", "Its tabs close and every program in them ends.", Close space | P:633 core/confirm.js `CLOSE_SPACE` | ✓ (the cards page keeps those words) |
| Rename…, Space settings…, worktrees | popups.js | P:436-441 (the dialogs: [dialogs](dialogs.md)) | ✓ |
| Drag | main.js:505-578 among its own, into a section or Pinned, back to the top; a folded section opens while dragged over | P:584 drag.ts; a folded heading lights up | ◇ 2.1's drag look (the heading lights instead of the section opening) |
| Alt+↑/↓ | keys.json space.next / space.prev | P:858 `stepPlace` | ✓ |
| Alt+Shift+↑/↓ on a focused row | none | P:156 `moveKey` | ◇ the keyboard's form of the window's drag |
| Rail (sidebar under 160 px) | main.js:666 numbers and a status glyph | none | ◇ the web hides the sidebar instead of narrowing it |

Counts: ✓ 61, ◇ 11, ✗ 0.
