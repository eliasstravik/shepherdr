# Accept card, toasts, status bar, confirm and prompt dialogs

Made from the window's mods: `mods/accept-card`, `mods/toasts` (and the toasts its callers post: `mods/chat`,
`lib/inbox.js`), `mods/workspace-status-chat`, `mods/confirm-chat`, `mods/prompt-chat` (and their askers:
`lib/coordinator.js`, `mods/spaces-chat/popups.js`). ✓ matches, ◇ a web-only form on purpose (why), ✗ still differs.

Shared words, so the two can't drift: `core/accept.js` (the card's words, the summary's cut, the details as bullets;
the mod and the web read it, `core/accept.test.js`), `core/toasts.js` (how many, how long, which color, the title
format and a need's reason; `mods/toasts`, the web's toasts and the service's push alerts read it,
`core/toasts.test.js`), `core/confirm.js` (Close space and Rename tab; the web reads it and `core/confirm.test.js`
checks the window's askers say the same).

## Accept card

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Opens from | Review on a Ready row, the task header, Assistant's live row (`mods/tasks/main.js:805`, `mods/chat/panel.js:156`, `mods/chat/main.js:798`), a 640×640 modal | `openAccept` from the same rows and headers; a push alert's `#accept=<task>` (`web/src/screens/Accept.tsx` fromLink) | ✓ |
| Title | `Accept HERD-4?`, only `HERD-4` once settled (`mods/accept-card/main.js:305`, `ACCEPT.title`) | `Accept.tsx:132` `A.ACCEPT.title(ref)` / `ref` | ✓ |
| Task name under it | muted, one line, `x.title ?? p.title` (`main.js:306`) | `Dialog sub` from the evidence, else the snapshot's task name (`Accept.tsx:132`, `rowmenu.tsx:173`) | ✓ |
| × at top right | closes as Cancel (`main.js:270`) | `Dialog closer` (`rowmenu.tsx:175`, aria-label Close) | ✓ |
| Esc | closes (`main.js:296`) | Dialog's Escape; over the open proof it closes the proof first, back to the card (`Accept.tsx:129`) | ✓ |
| Reading | `Reading the task…` (dim) (`main.js:286`) | `A.ACCEPT.reading` (`Accept.tsx:145`) | ✓ |
| Couldn't read | the error in red in the body, footer still Cancel + Accept (disabled) | the error in red in the body (`Accept.tsx:145`) | ✓ |
| Summary | `words()`: an old long summary keeps its first sentence, the rest under Details; empty: `No summary.` muted (`main.js:289`) | `A.words(e)`, `A.ACCEPT.noSummary` (`Accept.tsx:147`) | ✓ |
| Changes | `N commits · N files changed +a −r`, `Not a git folder.`, `No commits.`, `· Couldn't read the files`, newest commits (sha, subject), biggest files, `And N more` (`main.js:204`) | `Changes` (`Accept.tsx:52`) from `A.commitsLine`, `A.filesLine`, `A.moreLine` | ✓ |
| Checks | dot (green passed, red failed/unknown, amber running) + its text; `No GitHub checks here` (`main.js:228`) | `Accept.tsx:149` | ✓ |
| Proof | a pressable row: title without its ref, `Open`, external-link icon; `No proof artifact.` (`main.js:237`) | SHEP-138: the proof drawn right in the card (`InlineProof`, the viewer's `ArtifactFrame`), the card large (up to 1100 wide, 90% tall): the proof beside the rest when wide, under the summary when narrow, a small `Open ↗` for the viewer; a proof the app doesn't know yet keeps the row; `No proof artifact.` (`Accept.tsx`) | ◇ the window's card is a fixed 640×640 overlay of its own mod: showing the proof in it means reopening it as a wider layout with the proof's mod beside it, not tried yet (no window to see it in on the dev VM) |
| Proof opens | a modal of a fitting size over the card, the card as it was under it (`artview.js` showModal) | the web's artifact viewer over the card (z-40 over the card's z-30); closing it shows the card again | ◇ the web has one artifact viewer, full screen on a phone |
| Proof `Opening…` | while its mod is pulled (`main.js:243`) | the viewer says `Opening…` until the artifact is there (`web/plugins/artifacts/client.tsx` Viewer) | ✓ |
| Details | folded, a chevron (right/down) + `Details`; the long text as bullets (`readable`), selectable (`main.js:250`) | chevron + `A.ACCEPT.details`, `A.readable(w.details)` in Markdown, `data-selectable` (`Accept.tsx:164`) | ✓ |
| Footer: Cancel + Accept | `Cancel`, `Accept` (disabled while reading or not Ready), `Accepting…` while it runs (`main.js:315`) | `Accept.tsx:133,143` | ✓ |
| Error after Accept | red line over the footer (`main.js:311`) | `foot` (`Accept.tsx:134`) | ✓ |
| Accepted elsewhere meanwhile | the refusal replaced by where it is now | `Accept.tsx` accept(): reads it again, shows where it is | ✓ |
| Settled | a dot (green done, muted otherwise) + `Already accepted.` / `Already done.` / `Not ready right now: it's in X.` over the footer; only `Close` (`main.js:260,314`) | `A.whereNow(t)` in `foot`, `cancel=Close`, no Accept (`Accept.tsx:138,143`) | ✓ |
| The row says Accepting… | shared `tasks.accepting` (`main.js:154`) | `useAccepting` / `Task.accepting` (`web/plugins/tasks/client.tsx:114`; see [tasks](tasks.md)) | ✓ |
| No task | `No task to accept.`, closes at once | the card only opens with a task | ◇ nothing on the web opens it empty |
| Phone | — | slides up as a sheet, buttons full width (Dialog) | ◇ phone |

## Toasts

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Where | a float over the work area, bottom right, 360 wide (`mods/toasts/main.js`, `WIDTH`) | bottom right, `T.WIDTH` (`web/plugins/alerts/toasts.tsx:105`) | ✓ |
| Where, phone | — | one compact toast across the top, under the notch: title on one line, at most one short line under it; a tap goes to it, a swipe up puts it away (`PhoneToast`) | ◇ phone: the bottom is the tab bar, and three cards would cover the screen |
| Several at once, phone | — | one toast: `2 tasks need you` (`2 need you` with an Assistant, else `3 updates`), who under it; a tap opens Needs you (`T.together`) | ◇ phone: one toast at a time |
| How many | the last 3 (`SHOWN`) | `useToasts().slice(-T.SHOWN)` (`toasts.tsx:73`) | ✓ |
| Dot | red alert/error, amber warning, green success, accent otherwise (`tone`) | `DOT[T.tone(level)]` (`toasts.tsx:118`) | ✓ |
| Title | bold, one line: `HERD-4 · Needs you`, `HERD-4 · Finished`, `tt-repo Assistant · …`; another machine's task `HERD-4 on vm · …` (`lib/ui.js` toastWho) | `T.toastTitle(who, …)`, `T.assistantWho`, `taskWho` (the machine's name, never `m3:HERD-4`; `web/shared/alerts.ts`) | ✓ |
| One event, one toast | one toast per agent that turns blocked | the service gives an agent asking with a card one need, not a second for its waiting (`service/compat.ts`); a later need of the same chat changes its toast (`T.withToast` key); one answered elsewhere goes | ✓ fixed (a question showed twice: `Question for you` and its words) |
| Body | muted, 3 lines at most, cut at 140 (`main.js` LINES, BODY_MAX) | `line-clamp-3`, `T.clip(body, T.BODY_MAX)` (`toasts.tsx:121`) | ✓ |
| × | shows on hover, its place always kept (`main.js` item) | shows on hover, always to a finger (`toasts.tsx:126`, aria-label Dismiss) | ◇ touch has no hover |
| Click | runs its action (goes to the agent) and closes it | goes to its chat (`goChat`/`openTask`) and closes it (`toasts.tsx:114`) | ✓ |
| Goes after | alert 20 s, error 12 s, warning 10 s, else 6 s; never while the pointer is on them (`TIMEOUT`, `unexpired`) | `T.unexpired`, paused while the mouse is on them (`toasts.tsx:92`) | ✓ |
| `<who> · Needs you` | an agent parked behind a chat turns blocked, its chat not looked at (`mods/chat/main.js:3465`); a hook's ask no chat shows (`lib/inbox.js:143`), body its reason; an Assistant only by its space's Notify | a new need whose chat isn't on screen, body `T.needReason` (question, `Plan to approve`, `Asks for X`, what it said), Notify as the window's (`toasts.tsx:36`) | ✓ |
| Its click (an ask) | `tabs-tasks.inbox`: the Tasks panel's Needs you, whose row opens the chat | straight to the chat, where the card is answered | ◇ one step: the web's Needs you row would open the same chat |
| `<who> · Finished` | the agent's turn ends while you weren't looking at its chat; an Assistant only on Notify All; body its terminal's title (`mods/chat/main.js:3465`) | a task leaving Working without needing you (body its name), an Assistant leaving Working (Notify All) (`toasts.tsx:50`) | ✓ |
| An agent's own alert | `herdr-task alert`: `<who> · <title>` (60) over its body (300), alert level; a task's always, an Assistant's by Notify (`lib/inbox.js:171`) | the service reads the same label (`service/push.ts` agentAlerts → `Snapshot.alerts`), each new one a toast (`toasts.tsx:45`) | ✓ |
| Provider cut-off | `<Assistant> · <why>`, `Write to it to carry on, or restart it.` (`lib/inbox.js:266`) | the service reads the same `.retries.json` (`service/push.ts` agentAlerts, once per cut), the same words, alert level | ✓ |
| Error toasts | `Artifact didn't open`, `Assistant didn't open`, `Couldn't reach X`, `Space wasn't made`, `Home space wasn't made` (with `plainError`) | each web action says its failure where it was asked (the dialog or row); `toast()` is exported for the actions that have no place to say it (`toasts.tsx` toast) | ◇ the web's actions answer in place |
| While the app is off screen | — (the window is the screen) | push alerts with the same words: `HERD-4 · Needs you`, `tt-repo Assistant · Needs you` (Notify Off: none), `HERD-4 · Finished` opening its Accept card, agents' own alerts (`service/push.ts` alertsOf) | ◇ a phone's lock screen |
| No toasts float in the layout | Herdr's `notify()` instead | — | ◇ the web always has its toasts |

## Status bar

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| The bar | full width under the work area, chrome color, a hairline above (`mods/workspace-status-chat/main.js:31`) | — | ◇ removed from the web (SHEP-174): the panes and sidebar run to the bottom edge |
| Machine | monitor (this computer) or server icon + the machine as the sidebar names it (`main.js:32`) | the machine heads its spaces in the sidebar | ◇ |
| Branch | branch icon + the shown space's branch, when it has one (`main.js:33`) | on the space's row (`gitTail`), unless it is main, master or the space's own name | ◇ |
| Needs you | the red count badge (everywhere's) + `Needs you`, when something needs you (`main.js:34`) | the red count on each space's row and on the Tasks tab, the cards in Tasks' Needs you | ◇ |
| No agent count | — | — | ✓ |
| `Ctrl+Shift+P  Commands` | opens Herdr's command palette (`main.js:36`) | — | ◇ Herdr's palette drives the window; the web has none (Jump is the sidebar's `Search or jump to`) |

## Confirm and prompt dialogs

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| Confirm: frame | title (semibold), detail (muted), the verb, Cancel (`mods/confirm-chat/main.js:43`) | `Dialog` (`web/src/rowmenu.tsx:137`) | ✓ |
| Confirm: the verb | says what it does, never "Confirm"; plain primary (`main.js:47`) | the verb, plain `Primary` | ✓ |
| Confirm: Enter / Esc | Esc cancels; Enter runs a safe ask, does nothing on a destructive one | Esc cancels; `safe`: Cancel has the focus, so Enter cancels | ◇ a browser's Enter presses the focused button; nothing destructive runs |
| Close space | `Close “gtm”?` (`Close this space?` for ~), `Its tabs close and every program in them ends.`, `Close space` (`lib/coordinator.js:404`, `mods/spaces-chat/popups.js:28`) | `CF.CLOSE_SPACE` (`web/plugins/places/client.tsx:663`), then the window's own close (`service/actions.ts` space-remove) | ✓ |
| Close space: busy / failed | closes at once, Herdr closes it | the button waits while it closes; a failure says why under the detail | ◇ the web waits for the service |
| Close space: still working | none: it closes | (2.1's "can't be removed yet" question is gone) | ✓ |
| Prompt: frame | title, `Name` over the field, the field, a hint line, the verb, Cancel (`mods/prompt-chat/main.js:91`) | `Dialog` + label + field | ✓ |
| Rename tab | `Rename tab`, the field holding the name given (empty when unnamed, its name the placeholder), selected; `Save`; Enter saves, Esc cancels; empty unnames it (`lib/coordinator.js:393`) | `CF.RENAME_TAB` (`web/plugins/coordinators/client.tsx:306`), `assistantTab.named`, select on focus | ✓ |
| Other dialogs | Close the Assistant (`mods/coordinator` view close), Rename space, worktrees, Add machine | see [header](header.md) and [dialogs](dialogs.md) | — |
