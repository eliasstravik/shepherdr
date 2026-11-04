# Artifacts, Jump and Keybinds

Window: `mods/artifacts` (main.js list and sidebar head, markup.js, recipe-view.js), `mods/chat-image/artifact-bar.js`
(the viewer's bar), `mods/chat/main.js` (artifact lines in a chat), `mods/jump`, `mods/keybinds`. Web:
`web/plugins/artifacts/client.tsx` (A), `web/src/screens/Recipe.tsx` (R), `web/plugins/keyboard/search.tsx` (S),
`web/plugins/keyboard/client.tsx` (K). Shared: `core/keys.js` (Keybinds words, both sides), `core/markup.js` (Mark up
words and the spot in words; `core/markup.test.js` checks the window's markup.js keeps the same), `core/recipe.js`, `core/spaces.js` (`spaceName`: Jump names spaces as the
sidebar does on both sides).

State: ✓ matches, ◇ web-only form (why), ✗ still differs (why).

## Artifacts list (the sidebar panel)

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Header title | main.js:169 "Artifacts", semibold | A:652 | ✓ |
| Folder name | main.js:170 the store's name from `herdr-artifact where` (repo main folder, "~" at home) | A:653 `place.store.name` (service/compat.ts `artifactStore`, same rule as `locate()`) | ✓ (from the space's folder; the window starts from its focused pane's cwd, which is the same folder unless a terminal `cd`'d elsewhere) |
| With All: "All folders" | main.js:170 | A:653 | ✓ |
| All toggle | main.js:171 a toggle "All" | A:654 pressed button "All" | ✓ (on by default on both sides, like Tasks; kept on this device; the window's resets to on with the panel) |
| Which artifacts | main.js:104-107 the store's list, or `list --all` | A:644 `a.folder === store.folder`, or all | ✓ |
| Other machines' artifacts | main.js:104 reads the store on the space's machine (`herdr-artifact --on`, `readTextFile(…, { on })`) | service/artifacts.ts `readThere()` reads every registry there through herdr-core's `machine.exec` (as mods/jump and mods/chat do), each marked with its machine; the list matches by `store` ("machine\|folder"); recipe and pictures come from there (`&on=`), a note goes through `herdr-artifact --on` | ✓ |
| Filter box | main.js:44,198-218 "Filter artifacts", magnifier, F while empty and unfocused, X "Clear" | A:660 FilterBox: same placeholder, F hint hidden on focus, Clear | ✓ |
| F focuses the filter | main.js:177 | K:184 | ✓ |
| Esc in the filter | main.js:204-208 clears, then gives the list the keyboard | FilterBox: clears, then blurs | ✓ |
| Enter in the filter opened the first | (none) | removed (2.1's) | ✓ |
| Filter fields | main.js:190-194 title, task, maker, with All the folder name and path | A:646 | ✓ |
| Row: icon, title | main.js:255-258, accent when shown or open | A:679-682 | ✓ |
| Row second line | main.js:238-242 "v3 · Claude Code · 2h ago" | A:70 `detailOf` | ✓ |
| "Open · " | main.js:248,260 open in a pane of this space | A:647,680 open in a split pane | ✓ |
| "Opening…" | main.js:260 while pulling it from its machine | (no pull: the web reads it from the service) | ◇ nothing to wait for |
| Folder at the right with All | main.js:262 | A:683 `folderName` | ✓ |
| Row click | main.js:254 opens it in the sidebar, in place of the list | A:678 drill-in (was: the full-screen viewer) | ✓ |
| Shown row stays marked | main.js:249-252 | A:252 `lastShown` | ✓ |
| Empty | main.js:220-227 icon, "No artifacts.", "Reports, boards and forms agents make for ~ show here. Ask an agent to make one." / with All "Reports, boards and forms agents make show here." | A:666-671 | ✓ |
| No match | main.js:184 `No artifacts match “q”.` | A:689 | ✓ |
| "Finding this space's folder…" | main.js:181 | (the snapshot already has it) | ◇ nothing to wait for |
| "Couldn't find this space's artifacts." / "Couldn't read the artifacts." | main.js:67,110 | the service reads the store; a failed read keeps the last list | ◇ |
| "2h ago" ticks by the minute | main.js:55 | A:641 | ✓ |
| Newest first | herdr-artifact keeps newest first | A:644 sort by `at` | ✓ |

## An artifact in the sidebar (its head)

| Element | Window | Web | State |
|---|---|---|---|
| ‹ Artifacts back | main.js:318-322 | A:296-301 | ✓ |
| Title | main.js:323 semibold | A:302 | ✓ |
| One version: "v3", when on hover | main.js:326-328 | A:86-87 `bar="sidebar"` | ✓ |
| Stepper ‹ v2 of 5 › | main.js:325-329, arrows dim at the ends, tooltips "v2" | A:88-95 | ✓ (a dim arrow's label is for screen readers only) |
| "· Latest ›" (tooltip v5) | main.js:331-335 | A:96-97 | ✓ |
| Mark up / Done | main.js:336-341, marks up in place | A:304-306 in place (was: opened the viewer) | ✓ |
| Placeholder "Pick an artifact to see it here." | main.js:344-348 (the view before one is picked) | the list shows instead (no empty view state) | ◇ the web's panel never shows an empty view |
| Old window title bar | main.js:351-361 (windows from before 3.0) | none | ◇ no window chrome on the web |

## The viewer (chat-image/artifact-bar.js)

| Element | Window | Web | State |
|---|---|---|---|
| Icon, title ("Artifact" when none) | artifact-bar.js:96-99 | A:561-562 | ✓ (icon hidden on a phone: ◇ room) |
| One version: "v3 · 2h ago" | artifact-bar.js:100-102 | A:86-87 `bar="viewer"` | ✓ |
| Stepper, "· Latest ›" | artifact-bar.js:103-111 | A:563 | ✓ |
| Mark up / Done | artifact-bar.js:112-113 text button with icon | A:564-571 | ✓ (label hidden on a phone: ◇ room) |
| Open in sidebar | artifact-bar.js:115-121 tooltip "Open in sidebar" | A:574 | ✓ (not on a phone: ◇ its panel is a tab) |
| Close, "Close  Esc" | artifact-bar.js:122 | A:578 | ✓ |
| Over the chat pane / modal from a dialog | artview.js:52-69 | full screen | ◇ the browser's whole page is the pane |
| Stale link | (a toast "Artifact didn't open") | "This artifact was deleted." | ◇ a link can outlive it on the web |

## Mark up (markup.js)

| Element | Window | Web | State |
|---|---|---|---|
| Dashed edge over the artifact | markup.js:52-53 | A:152 | ✓ |
| Click a spot / drag over an area | markup.js:54-96 (4 px moves make it an area) | A:153-170 (was: a tap on a block) | ✓ |
| Badge "1", the area outlined and tinted | markup.js:98-106 | A:173-176 | ✓ |
| Note box hides while drawing | markup.js:74 | A:177 | ✓ |
| Hint "Click a spot or drag over an area, or write to Claude Code about all of it." | markup.js:116-117 | A:147 (core/markup.js) | ✓ ("Tap" on a touch screen: ◇) |
| "A note on the marked spot." / "…area." | markup.js:116 | A:148 | ✓ |
| Clear spot | markup.js:130-133 | A:187 | ✓ |
| "What should change?" | markup.js:26 | A:214 | ✓ |
| Send (tooltip "Send  Enter"), Enter sends | markup.js:137-143 | A:216-225 | ✓ (Enter makes a new line on a phone: ◇ its keyboard's return) |
| Esc drops the spot, then ends | markup.js:122-126 | A:207-212 | ✓ |
| "Sending…", "Sent to Claude Code. A new version shows here when it's in.", error words | markup.js:177-190 | A:133-144 | ✓ (keeper: the publisher's program, service/compat.ts) |
| The spot in words for the agent | markup.js:152-162 `describe()` | core/markup.js `describe()` → `--spot` | ✓ |
| A picture of the panel with the spot | markup.js:89-93,170-173 (`herdr-app shot`) | none | ◇ a browser can't take a picture of the page |

## Recipe blocks (recipe-view.js vs Recipe.tsx)

| Block | Window | Web | State |
|---|---|---|---|
| heading, text, list | recipe-view.js:78-82 | R:124-126 | ✓ |
| table (right-aligned columns) | :83-87 | R:127-134 | ✓ |
| chart: bar | :64-73 bars, labels, legend when >1 series | R:43-57 | ✓ |
| chart: pie / line | :48-63 a bar of shares + legend / dots | R:24-48 an SVG pie / lines, same numbers (core/recipe.js `chartShapes`) | ◇ GPUI draws no arcs or lines; the web draws the shape the recipe names |
| stats, image, pair (Before/After), code, callout | :89-102 | R:136-140 | ✓ |
| columns, tabs, details | :103-120 | R:141-143 | ✓ |
| divider | :121 | R:144 | ✓ |
| choice: question, options, "<label> · Sent", once | :122-131 | R:61-75 | ✓ |
| form: fields with their label (and as placeholder), checkbox, "Sent" | :132-147 | R:77-95 | ✓ |
| form select field | :140-141 a text box | R:88 a picker of the recipe's options | ◇ GPUI has no select; the recipe names the options |
| button: "<label> · Sent", once | :148-152 | R:97-105 (was: no sent state) | ✓ |
| Unreadable: "This artifact's recipe can't be read." | :25 | R:16, A:370 (was "This version can't be read.") | ✓ |
| "Loading…" | (in the mod, nothing to load) | A:374 | ◇ the web fetches it |
| Older GPUI artifact | (drawn by its own mod) | A:384 "Made for the Herdr window: open it there." | ◇ only the window can draw it |

## Artifacts in a chat (chat/main.js)

| Element | Window | Web | State |
|---|---|---|---|
| Card: icon, title, "Artifact · v3" (its latest), Open | main.js:2810-2818 | A:518-529 (was the post's version) | ✓ |
| Earlier publish: "Published X v2", opens v2 | main.js:2808-2809 | A:509-516 | ✓ |
| "Publishing an artifact…" | main.js:2422,2809 | web/plugins/chat/rows.tsx (chat surface) | ✓ |
| Gone from its list | nothing | nothing (was "This artifact was deleted.") | ✓ |
| On another machine | read from the agent's machine | the service's other machines' artifacts, matched per chat by machine (service/compat.ts) | ✓ |

## Jump (mods/jump)

| Element | Window | Web | State |
|---|---|---|---|
| Box: magnifier, "Search spaces, tasks, artifacts" | main.js:110,322-324 | S:150-151 | ✓ |
| Groups Spaces, Tasks, Artifacts, Machines with counts | main.js:33-34,218,269-271 | S:170-174 | ✓ |
| Eight rows, then "Show N more" | main.js:35,221,273-278 | S:176-181 | ✓ |
| Space row: icon or #, name, bold when shown | main.js:179,286 | S:46,195 (bold was missing) | ✓ |
| Space name | main.js `nameOf()`: core/spaces.js `spaceName` with its folder's git repo, the sidebar's rule, never "~" (was Herdr's raw name, "~") | compat.ts `spaceName`, the same rule | ✓ |
| Space second line | main.js:176 "<machine> · <folder>" only with other machines | S:45 (was always the machine) | ✓ |
| Spaces' order | main.js:178 newest tab `changed_at` first (when something in a tab last changed state), ties in the sidebar's order | S:46 `changedAt`: service/model.ts takes the latest `status_ms` of the tabs' terminals | ✓ (Herdr's counts from the window's start, herdr-core's from the terminal's: after a window restart the window keeps the sidebar's order until something changes) |
| Task row: id in a monospace column, dot with its pie | main.js:262,285,294 | S:187,194 (`Dot`; one id width) | ✓ |
| Task second line: status, its line, place | main.js:188-192 | S:52-56 | ✓ |
| Archived only once something is typed | main.js:182 | S:49 | ✓ |
| Tasks newest first | main.js:190 | S:57 `t.at` (service/compat.ts) | ✓ |
| Task opens its chat or the Tasks list | main.js:246-252 | `openTask` | ✓ |
| Artifact row: title, "task · place · v3 · 2h ago" | main.js:194-199 | S:63-70 (task was guessed from the maker) | ✓ |
| Artifact opens over the chat, else in the sidebar | main.js:255-259 | S:73 (was always the viewer) | ✓ |
| Machine row: "N spaces · Offline", opens its first space else Settings › Machines | main.js:201-206,237-239 | S:76-90 (was Settings' first page) | ✓ |
| ↑/↓, Ctrl+N/P, Enter, Esc, click | main.js:112,315-321 | S:155-158 | ✓ |
| "Reading tasks and artifacts…" / "Nothing found. Try fewer words." / "Nothing here." | main.js:310 | S:165 | ✓ |
| Ctrl+K again closes | keys.json | K:151 | ✓ |
| Popup at the top of the window | mod.json | a sheet (a phone's full screen) | ◇ phone navigation |

## Keybinds (mods/keybinds, keys.json)

The words, groups, key text, row folding and the filter come from `core/keys.js` on both sides (`core/keys.test.js`).
The web lists the window's keys that work in a browser (`WEB_KEYS`, each checked against keys.json or Herdr's default).

| Element | Window | Web | State |
|---|---|---|---|
| A dialog "Keybinds" | main.js:142, mod.json (560×620) | K:30-67 a sheet over the app (was a Settings page) | ✓ |
| Opened with Ctrl+Shift+/ or ? | keys.json | K:104-108 | ✓ |
| From the tab bar's menu "Keybinds" | menu-tasks/main.js:80 | `openKeybinds()` exported for the header's menu | ✓ (the menu is the header surface's) |
| "Filter keys", "No keys match." | main.js:126,148 | K:48,53 (was no filter) | ✓ |
| Groups in order: Tabs, Spaces, Panes, Agents, Terminal, Chat, App | core/keys.js | the same | ✓ |
| Tabs: "Show tab 1–9" Alt+1–9; "Previous tab" Alt+Left, Alt+[; "Next tab" Alt+Right, Alt+] | keys() | K:18 | ✓ (was "Tab 1–9", arrows, one row per key) |
| Spaces: Next/Previous space Alt+Down/Up; Rename space Shift+F2 | keys() | K:18 | ✓ |
| Chat: Dictate, Start a call, Find in the chat | keys.json mod:chat | K:18 (was under App) | ✓ |
| App: Jump (Ctrl+K, Ctrl+Shift+K in one row), Keybinds, Show or hide the sidebar, Settings | keys() | K:18 | ✓ |
| Tabs: New tab, Close tab, Rename tab; Ctrl+1–9, Ctrl+Tab, Ctrl+PageUp/Down | keys() | not listed | ◇ the browser keeps Ctrl+T, W, Tab, 1–9, PageUp/Down; the web's tabs are the space's chat and terminals |
| Spaces: New space Ctrl+Shift+N; Ctrl+Shift+PageUp/Down | keys() | not listed | ◇ the browser keeps them |
| Panes: split, focus, swap, close, zoom; Next layout | keys() | not listed | ◇ the web has no panes or layouts |
| Terminal: Copy, Paste, word keys | keys() | not listed | ◇ the browser's own copy, paste and text keys |
| App: Command palette, Zoom in/out, Actual size | keys() | not listed | ◇ no palette on the web; the browser zooms |
| Settings › Keybinds page | (none: the window's Settings has no Keybinds) | removed | ✓ |
