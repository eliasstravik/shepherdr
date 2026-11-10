# Tasks panel and task view

Window: `mods/tasks/main.js` (T), `mods/tasks-menu/main.js` (TM), `mods/chat/panel.js` (P), `mods/task-pr/main.js`
(PR), `mods/task-browser/main.js` (B). Web:
`web/plugins/tasks/client.tsx` (W), `web/src/groups.ts` (G), `web/src/App.tsx` TaskPage (A), `web/src/Panel.tsx`
(TaskTabs, TabBody) (N), `web/plugins/worktree/client.tsx` (K), `web/plugins/browser/client.tsx` (BR), and the data
from `service/compat.ts`, `service/worktree.ts`.

Shared, so the two can't drift: `core/tasks.js` (status words, `capital`, `day`, the second line and minutes left,
already the service's), `core/needs.js` (`fit` to 40 characters, `REASONS`), `core/menus.js` (`taskMenu`),
`core/worktree.js` (new: `VIEW_WORDS`, `CHANGE_WORDS`, `CHECK_WORDS`, `PR_STATES`, `LIST_DIR`, `dirEntries`,
`markOf`). `core/worktree.test.js` checks the Pull request words are still in mods/task-pr, word for word; `test/test_repo.py` `test_task_views_from_one_core` checks the
web and the service read them from core.

State: ✓ matches, ◇ web-only form (why), ✗ still differs (why).

## Header, search, filter row

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Title | T:370 "Tasks", semibold | A SideList `Tasks` (beside Artifacts as tabs) | ◇ the window's Artifacts is its own panel; the web's narrow screens put the two side panels under one head (artifacts and header pages) |
| ⋯ Group by | T:372-375 icon button, tooltip "Group by" | W TasksMenu, label "Group by" | ✓ |
| Group by menu | TM heading "Group by"; For you, Space, Status (shared "tasks.group"; props().current from the panel); check on the current | W TasksMenu, G `groupChoices` | ✓ (SHEP-98) |
| Search field | T:86,489-503 "Filter tasks", magnifier, F key hint while empty and unfocused, X "Clear" | W TaskFilter (FilterBox) | ✓ |
| F to the field, Esc clears | T:384, T:505-510 | keyboard plugin, FilterBox | ✓ |
| What search finds | T:472-475 id, title, status line, summary, #PR, space, list, machine | W `found` | ✓ (summary isn't in the snapshot; the status line and report are) |
| Searching Needs you | T:479-485 who, why, where | W `asks` filter | ✓ |
| Filter row | T:397-419 "All statuses", then Needs you, Working, Ready as room allows, the rest under More with counts | W StatusFilterRow | ✓ |
| Filter row always there | T:378 shown whenever Status filters is on (not in Archived) | W TaskListBody (was hidden while empty) | ✓ fixed |
| Status filters off | T:298 Settings "Status filters" false: no row, all shown | W `filters` (snap.look.filters) | ✓ |
| This space (SHEP-72) | T hereChip: first in the filter row, a toggle kept by the panel; only the shown space's tasks, automations and Needs you (core/tasks.js inSpace; Needs you also by its tab); follows the space shown; off for a Ctrl+K jump's words; "Nothing in <space>." | W StatusFilterRow, kernel `thisSpace` (listChips: the place picked; kept on the device); asks and automations by the list's places | ✓ |
| Counts follow the search | T:296 counts of the rows shown | W `counts` from the searched lists | ✓ fixed |
| A chip kept while searching | T:300 | W `filter` | ✓ |
| More menu | TM:33-34 the statuses, count as hint, check on current | W StatusFilterRow Menu | ✓ |
| Automations chip | T:296,310 its rows | W filter `automations` → AutoRow | ✓ fixed (showed 2.1's automations box) |
| Flat list empty | T:319-320 `No ${what} match “q”.` ("tasks that need you", "automations", "Working tasks") | W, `STATUS` from core | ✓ |

## Groups

| Element | Window | Web | State |
|---|---|---|---|
| For you (default) | T `groupNow`, `spaceGroup`, `doneLine`: For you (everything that needs you, then Ready, each row saying its space), Pinned, each space's other work in status order under its name (emoji or #, count; machine quiet only when two machines have a space of that name; a click opens the space), Done as "N done today" until opened; old "tasks.groupby" Status with Split by space on becomes For you | G groupTasks `you`, W YouHeading/SpaceHeading/DoneLine (sticky headings), kernel `DONE_OPEN`, groups.ts loadGroups (same migration) | ✓ (SHEP-98) |
| Pinned | T: first by space or status; For you: after For you, without its Needs you and Ready ones | G groupTasks | ✓ (SHEP-98) |
| Needs you next | T:325-326 inbox items and tasks Herdr saw go wrong | W + G | ✓ |
| By status | T:328-334 Ready, Merging, Working, Queued, Scheduled, To do, Done; only groups holding something | G | ✓ |
| Scheduled group | core ORDER after Queued, the next to start first (core `order`) | G `GROUPS` | ✓ (SHEP-38) |
| By space | T:339-345 one group per task list, named by the space in its folder (else the list's name), sidebar order; machine quiet after it only when two machines have a space of that name | G projectGroups by `listName` and machine | ✓ fixed (grouped by the space that started the task) |
| Heading | T group(): chevron in the icon column, label small, its count right by it ("Ready 2"), room above each group; the whole heading folds | W GroupHeading/FoldHeading | ✓ (SHEP-34) |
| Folded headings remembered | T:551-554 | kernel `toggleShut`, groups.ts saveShut | ✓ |
| Alt-click folds siblings | (none) | W FoldHeading | ◇ a keyboard nicety for wide screens; does nothing unless Alt is held |
| Done cut | T:28,565 5 Done rows, "Show N more" / "Show less" | W DoneToggle, G DONE_SHOWN | ✓ |
| Searching: all open | T:313,363 every group whole and open, headings not folding | W | ✓ |
| Automations group last | T:359 "Automations", one group, every list's | W `autoGroup` | ✓ fixed (was one per space, at the foot) |
| Archived while searching | T:363 an "Archived" group after Automations | W `archivedGroup` | ✓ fixed (sat before Automations) |
| Archived link | T:514-524 hairline, archive icon, "Archived", count, chevron | W ArchivedLink | ✓ |
| Nothing at all | T:361,545-547 "Nothing to do." / "No tasks on any machine. Ask an Assistant to plan some." | W | ✓ (was skipped while only archived tasks existed) |
| No match | T:365 `No tasks match “q”.` | W | ✓ |
| Reading | T:390 "Reading tasks…" | W | ✓ |
| Lists unreadable | T:387-389 "Couldn't read the task lists: …" card | (the service reads them) | ◇ the service keeps the last lists; a read failure there shows as the service's own banner |

## Rows (every kind: Working, Needs you, Queued, Scheduled, Ready, Merging, To do, Done, archived, automation, agent need)

| Element | Window | Web | State |
|---|---|---|---|
| Grid | T line(): glyph level with the title; title owns line 1; line 2: id · words · where, read left to right; the end (Review, next run) centred on the row; time left under the glyph | W Line (a phone: the end at line 2's end, the title the whole first line) | ✓ (SHEP-34) |
| Id | T line() at line 2's start, monospace, dim (no id column since SHEP-34: it took the title's room) | W Line `ref_` | ✓ |
| Id without the machine | T:22 refOf "SHEP-7" | W `refOf` strips "vm:" | ✓ fixed |
| Title | T:829 foreground, Done dim | W Line `dim` | ✓ fixed |
| Title hover | T:822 the title when cut, an error | W Line `title` (the second line too when cut) | ✓ |
| Second line words | T:841-842 capital first, at most 40 characters cut at a word, whole on hover | W Line (`capital`, `fit`) | ✓ fixed ("after SHEP-7" → "After SHEP-7") |
| Working | core secondLine: why, else its agent's words; pie of % done | compat `sub`, TaskDot pie | ✓ |
| Time left | T line() short under the glyph, level with line 2, amber mono: "6m", "<1m", "2h" (as before SHEP-34) | W Line `left` from compat `left` (core leftOf) | ✓ (SHEP-39) |
| Needs you | why (core place) | compat `sub` | ✓ |
| Queued | "After HERD-3", "Waits: …", "Starts soon" | compat `sub` (core queueReason) | ✓ |
| Scheduled | a grey calendar (mods/tasks/scheduled.svg), its time until it starts under it ("6h", core `leftOf`), "Starts Today 18:00" (core `startsLine`) | ui.tsx `.dot.scheduled` (the same drawing), TaskDot `until` (core `untilShort`, live), compat `sub` | ✓ (SHEP-38) |
| Ready | "Ready 5m ago" + Review (opens the Accept card) | compat `sub` + W `accept` | ✓ |
| Merging | "Merges once its checks pass", "Merges once it's approved", "In GitHub's merge queue" (#743, #802) | compat `sub` | ✓ |
| To do, Done | one line, place at the end | W Line one-line | ✓ |
| Where it is | T whereOf: the space, only where the grouping doesn't say it; never the machine (SHEP-98); Settings "Where on task rows" off: none | W whereOf / autoWhere, `names` | ✓ |
| Place gives way | T line(): after the words, it takes only the room left and shrinks first | W Line: whole or not at all (wraps out of sight) | ✓ |
| Place, phone | — | whole or not at all (it wraps out of sight), never a cut `m3 · shep…` | ◇ phone: a few letters of a place say nothing |
| Accept | T:796-800 compact solid button at line 2's end, "Accepting…" while the Accept card's accept runs | W TaskRow `accept`, `useAccepting` + compat `accepting` (shared "tasks.accepting") | ✓ fixed |
| Review never covers the place | T line(): Review is the row's end, outside the text; soft (one per Ready row, never solid) | W Line `end` (shrink-0), desktop, tablet and phone | ✓ |
| Archived rows | T:538 done glyph, no pin menu | W TaskRow, `menu` off when archived | ✓ fixed (offered Pin) |
| Selected | T:833 the focused agent's row | W the open task's row | ◇ the web has no focused pane; the open task is what's shown |
| Right-click menu | T:786-790, TM:26-32 Pin / Unpin (core taskMenu) | W TaskMenu (right click, or a held finger) | ✓ / ◇ touch holds |
| Start later (SHEP-38) | TM rowSections: a task not started yet: "Start later" ("Reschedule · Starts …" when scheduled) over In 1 hour, In 3 hours, Tomorrow 9:00, Monday 9:00; scheduled: Start now, Unschedule; a refusal is a toast | W TaskActions, the same core `taskMenu`; a refusal shows under it | ◇ the web also has Other time… (a typed time, herdr-task's words); in the window the Assistant takes any other time |
| Agent need | T:617-628 its name, why (REASONS / request words), machine · space | W AgentNeedRow: "Assistant", REASONS.plan / the question / REASONS.permission | ✓ fixed (was "<space> Assistant", 2.1 words) |
| Secret ask | (the window's inbox has no secret item) | W "Wants the secret NAME" | ◇ the web's secret card has to be reachable from the list; the window answers it in the chat |
| Failed automation in Needs you | T:635-636 red repeat mark, its name, "Didn't run" / "Didn't start its task", tap opens Automations | W agentNeeds `autos`, AgentNeedRow | ✓ fixed (missing) |
| Automation row | T:601-613 repeat mark (red on error), name, no id, next run at line 1's end ("9:00", "Tue 9:00", "Nov 12 9:00"), "Didn't start" / "Paused" on line 2, error on hover, tap opens its last task | W AutoRow (core `day`), compat `nextAt`, `error`, `task`, `listName` | ✓ fixed (2.1's clock row with Run now / Pause / Remove: removed, as the window's has none) |
| Keyboard ↑ ↓ Enter in the search | (none) | W TaskFilter | ◇ walks the rows without a mouse on the web, where F has no list focus to go back to |

## Archived view

| Element | Window | Web | State |
|---|---|---|---|
| Search field stays, filter row goes | T:377-378 | W ArchivedList (TaskFilter, no StatusFilters) | ✓ fixed (the field was gone) |
| Back | T:532-535 chevron, tooltip "Back to tasks"; Esc too | W ArchivedList IconButton "Back to tasks", Esc | ✓ fixed (Esc) |
| Heading, count | T:536-537 "Archived", count | W | ✓ |
| Rows | T:538 latest archived first, machine and space named | W | ✓ |
| Empty | T:539 "No archived tasks match “q”." / "No archived tasks. Done tasks come here on their own." | W | ✓ fixed (no search words before) |
| Note | T:540 "Archived tasks keep their chat and summary. Search finds them too." | W | ✓ |

## Task view: header

| Element | Window | Web | State |
|---|---|---|---|
| ‹ Tasks | P:364-368 chevron + "Tasks" | A desktop button "Tasks"; phone round Back "Tasks" | ✓ / ◇ phone top bar |
| → base | P:371-372 "→ main", tooltip "Merges into main", only a base of its own | A `target` (compat sends base) | ✓ |
| Pin / Unpin | P:225-241,374 pin icon, pressed when pinned, tooltip "Pin"/"Unpin"; not an archived Done task's | A IconButton | ✓ fixed (showed on archived) |
| Review | P:385 primary "Review" (opens the Accept card), "Accepting…" | A Primary, `useAccepting` + `task.accepting` | ✓ fixed |
| Status dot | P:184-195 with halo, pie | A Dot halo | ✓ |
| Id and title | P:391-394 id in monospace, then the title, one line | A `named` | ✓ fixed (title over "id · CLI · space") |
| Report line | P:279-300 agent's words · "~6 min" / "<1 min" / "~2 h"; paused: dim, "· 40%" | A `said` (ReportLine head; minutesLeft as the window's) | ✓ fixed ("~1 h 20 min left") |
| Report while it waits on you | P:288-289 frozen, dim, "· 40%" (no % when it gave none) | service/model.ts `said` (core reportOf), compat `report` with `paused`; ui.tsx ReportLine | ✓ fixed (sent only while it worked, and only with a %) |
| Report without a % | P:285-295 its words alone | compat `report` (Report.progress optional now) | ✓ fixed |
| No CLI name | P:380-384 the chat's model button says which agent | A | ✓ fixed |

## Task view: tabs and bodies

| Element | Window | Web | State |
|---|---|---|---|
| Tabs | P:363-372 Chat, Terminal, Pull request (once it has one), Artifacts, Browser (add-ons on); no Files or Changes (SHEP-143: the space's side panels) | N TaskTabs (registry order 10-50, itemsFor): on a desktop the header's own row, a segmented control right of the title as the Assistant's Chat · Terminal, wrapping under the title without room (SHEP-176); a phone's row under its header | ◇ one header row on the web's wider task view; the window's thread head is a narrow side block (3 rows, layouts/shepherdr.json 127) with no room beside its title |
| Old Files/Changes links | voice nav: the service sends a task's files/changes as pr, else chat | `?item=files`/`diff` opens Pull request, else Chat (nav itemOfUrl); a saved panel item falls back to Terminal | ✓ |
| Tabs without an agent | P:340-348 always | A TaskTabs always | ✓ fixed (hidden until an agent started) |
| Switch in place | P:336 body stack | N TabBody | ✓ |
| Terminal dead | P:342 dim, disabled, tooltip "Not running" | N `termRunning`, aria-disabled, title "Not running" | ✓ fixed (opened onto nothing) |
| Ended while shown | P:327 back to its chat | N TabBody/TaskTabs | ✓ fixed |
| PR once found by gh | P:337 also when gh found one the record lacks | N itemsFor: the record's PR only | ◇ the service fills `pr` from herdr-task's record; a PR an agent opened itself shows once herdr-task records it |
| Never started | P:273, T:746 "This task hasn't started." / its queue reason | A `body` | ✓ fixed (2.1's "is starting…" words) |

### Files and Changes

No longer a task's tabs (SHEP-143). The web's FilesView and DiffView (K) show only in the space's Files and Changes
side panels (web/plugins/coordinators SpacePanel), the window's are Herdr's own `files` and `changes` panels.

### Pull request

| Element | Window | Web | State |
|---|---|---|---|
| States | PR:270-272 "Asking GitHub…", "This task has no pull request.", "This task works in its folder, with no branch of its own, so it has no pull request.", "GitHub didn't answer: …" (red), PR icon over | K PrView, service `pr` ({ pr } / { why } / { error }) | ✓ fixed (the service sent the PR bare, so the web always said "No pull request yet.") |
| Bar | PR:280-286 state pill (Open, Draft, Merged, Closed), #n, "N files" +a −d | K | ✓ fixed |
| Title, branch | PR:289-292 title, branch icon "head → base" | K | ✓ fixed |
| Buttons | PR:293-300 "Open on GitHub", "Copy link" → "Copied" | K | ✓ fixed (no Copy link) |
| Checks | PR:301-314 "Checks", checksLine, "No checks on it.", rows with icon, name, link icon, hover "Passed · workflow" | K | ✓ |
| Every 30 s | PR:197,225 | K useAsk 30 s | ✓ |

### Browser

| Element | Window | Web | State |
|---|---|---|---|
The window's Browser is `mods/task-browser` (B) running `bin/herdr-browser-view` (V) in a terminal; the web's is
`web/plugins/browser/client.tsx` (BR) over `service/browser.ts` (the relay).

| Element | Window | Web | State |
|---|---|---|---|
| Live view | B:15-163, V:1-15 the task's agent-browser, live; clicks, scrolls and keys go to it | BR LiveView | ✓ |
| First input takes it over | V:12-14 the first click, scroll or key: "You're driving", the agent told to hold off | BR (relay takes on input) | ✓ fixed (needed a Take over press) |
| Hand back | V:180-181 "Hand back"; also after a minute quiet | BR bar, IDLE_DRIVE_MS | ✓ fixed |
| Bar | V:176-197 "● You're driving" / "● Live" / "○ Off", the address (dim, no https://), "‹ Back", "↻ Reload", keys "Alt+← back · Ctrl+R reload" when there's room | BR bar (Back, Reload with their icons; keys on a wide desktop pane) | ✓ fixed |
| Back, Reload | V:327-329, 461-463 (Alt+←, Ctrl+R, F5 too) | BR + relay `back`, `reload` (herdr-browser --own) | ✓ fixed (the relay ignored them) |
| ⧉ Window / Open in a window | V:183,160 opens the browser's own window on the machine | (none) | ◇ it would open on the task's machine, not the device you're on |
| No live agent (never started, ended, Done) | B:76-81,158 "Pick a task to see its browser." and no viewer | BR BrowserView | ✓ fixed (dimmed "is done: its browser was closed."; never starts a browser for it) |
| Starting | B:156 "Starting the live view…" | BR | ✓ fixed |
| Stopped | B:92-100 "The live view stopped. Starting it again…", again by itself, at most every 10 s | BR useLink (RETRY_MS) | ✓ fixed (needed "Open it again") |
| Looking | V:152 "Looking for this task's browser…" | BR | ✓ fixed |
| Not open | V:154 "This task's browser isn't open." / "Its agent opens it when it checks a page; it closes after a while unused." + "Open browser" | BR + relay `closed`, `open` | ✓ fixed |
| Opening | V:153 "Opening the browser…" | BR | ✓ fixed |
| agent-browser error | V:155,213 its first line, or "agent-browser didn't answer." + Open browser | BR + relay `error` | ✓ fixed |
| Another machine's task | B:79 "This task runs on vm. Its browser can be watched only from that machine's Herdr for now." | compat `browser.hint` | ✓ fixed |
| Notes on the page, pins, Notes panel, sending notes, shots; address field; Forward; Fit; Take over; "Agent is driving" bar | (none) | removed | ✓ fixed |
| Keyboard button | (a physical keyboard) | BR "Keyboard" on a phone or tablet | ◇ a phone has no keyboard of its own: it brings up the on-screen one, whose keys the page gets |
