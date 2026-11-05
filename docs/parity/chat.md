# Chat

Window: `mods/chat/main.js` (W), `mods/chat/cards.js`, `mods/chat-models/main.js` (M), `mods/chat-react/main.js` (E),
`mods/chat-call/main.js` (B), `mods/chat-image`. Web: `web/plugins/chat/client.tsx` (C), `web/plugins/chat/rows.tsx`
(R), `web/plugins/chat/activity.tsx` (A), `web/plugins/chat/find.tsx` (F), `fold.tsx`, `markdown.tsx`,
`web/src/restart.tsx` (S), `web/plugins/voice/client.tsx` (V), `web/plugins/reactions/client.tsx` (X), and the data in
`service/compat.ts` `chat()` (D).

Shared: `core/chat-view.js` holds the chat's fixed words (`WORDS`), a message's time (`clock`), the band's actions
(`bandActs`), who sent a message (`senderName`), a brief's label (`briefLabel`), a task's news line (`newsWords`,
`newsTimeline`), which artifact a publish made (`resolveArtifacts`), image sizes (`fitThumbs`) and day lines
(`dayLabel`). The window's chat reads them (W imports `./core/chat-view.js`, `mods/chat/days.js` re-exports), the web
reads them (R, A, F, fold.tsx, days.ts) and the service builds the chat's rows with them (D). `core/chat-view.test.js`
checks the rules and that no word of `WORDS` is typed out again in W or `web/plugins/chat/*`. A tools row's summary is
`core/chat-log.js` `summary()` on both sides; its outputs are read with `core/chat-reader.js` `results()` (the
window's `loadResults()` reading). A CLI's start screens are read and watched with `core/screens.js` (`ScreenWatch`) by
the window's chat (`mods/chat/screens.js`) and the service (`service/watch.ts`), tested in `core/screens.test.js`; a
lost session's words and handover (`LOST`, `lostMessage`, the notes) are `core/chat-view.js`'s on both sides.

State: ✓ matches, ◇ web-only form (why), ✗ still differs (why).

## Timeline rows

| Element | Window (file:line, exact words/control) | Web (file:line) | State |
|---|---|---|---|
| First row, log read from its start | W:2673 "Start of conversation" | R:211 HeadRow (D `top`) | ✓ |
| First row, earlier pages left | W:2675 "Loading earlier…", loads on scrolling up (W loadEarlier) | R:211 HeadRow, loads when scrolled up to it (D `earlier`, action `earlier` → service/chats.ts `earlier()`) | ✓ |
| Day line | W:2737 Today, Yesterday, weekday, "Tue 20 Oct" (+ year) | C:888 DateLine, `dayLabel` from core | ✓ (was the browser's locale format) |
| Your message | W:2679 bubble on the right, accent tint | C:50 Bubble, right, `bg-reply` | ✓ (2.1's bubble look) |
| Agent's message, markdown | W:2715 bubble on the left | C:50 Bubble, left, Markdown | ✓ |
| Agent's code block | W:2717 bar: language or "code", Copy / Copied | markdown.tsx toHtml: `.code-head` with language or "code" and Copy / Copied | ✓ |
| Long reply folds | W FOLD 20 lines past 28, "Show more" / "Show less" with chevron | fold.tsx: past 28×21px to 20×21px, WORDS.showMore / showLess | ✓ |
| Reply line over a reply | W:2690 reply icon + its start, dim, one line; a press scrolls to it and lights it | R:84 ReplyLine; D finds the message it names (core `names`), a press jumps to it | ✓ (was a tucked quote bubble) |
| Task chips under your message | W:2696 ref + title chips, a press opens the task | R:97 Chips (D `mentions`, core/send.js `mentionedIn`) | ✓ (were missing) |
| Images under a message | W:2712 each whole, shape kept, 320×220 (one) / 200×140 (many), right, 6px apart; press opens the viewer | R:236 Thumbs, `fitThumbs` from core; under the words (C:50 `pics`) or alone (C:557 Album); press opens Photo (C:593) | ✓ (were cropped 2.1 tiles beside/after the bubble) |
| Images the chat can't show | W:2679 paperclip line "1 image" / "N images" | R:174 ImagesLine (D `images`) under the bubble | ✓ (was a text bubble) |
| From another agent | W:2702 quiet row "› Message from Reviewer" + first line, opens to its words | R:132 BriefRow (D `brief`, core `senderName`/`unsigned`) | ✓ (was your own bubble) |
| Launch brief | W:2702 "New session" / "Task brief" / "Handoff from the previous agent" | R:132 BriefRow (core `briefLabel`) | ✓ |
| Started from a slot with your words | W:2428 the template part a "New session" row, your words a bubble | D `firstTask()` reads the same data/chat-first/<slot>.txt: "New session" row, then your words | ✓ |
| Tools row | W:2793 "› Read a file, ran a command" (core summary), opens to each step's line and the first lines it printed | A:316 TurnLine + A:332 ToolSteps (D `activity.summary`, `api/activity` → `results()`) | ✓ (showed raw "Description: command" rows) |
| Quiet lines sit tight | W spaced(): tools, briefs, news, artifact lines one block, 16px between blocks | C:1084 quiet runs grouped, `gap-4` between blocks | ✓ |
| Task news line | W:2764 mark (green tick ready, grey tick done, amber started, red needs while live), REF, what, "·", words; Review (opens the Accept card) at the right while Ready | R:138 NewsRow (D `news`, core `newsWords`/`newsTimeline` incl. start/ready/done from the task's record) | ✓ (was a bordered 2.1 card with raw text) |
| Accept on a Ready line | W:2838 opens the Accept card | R:138 → `openAccept` | ✓ |
| Artifact card / line | W:2748 latest: card "Artifact · v3" + Open; earlier: "Published X v2" | plugins/artifacts ArtifactCard (D emits `artifact` via core `resolveArtifacts`) | ✓ (publishes were missing) |
| Artifact publishing | W:2807 "Publishing an artifact…" | R:164 PublishingRow (D `publishing`) | ✓ |
| Agent's own question in the log | W:2785 box "Asked you" (red) / "Asked you · Answered" / "Asked you · Closed without an answer" | R:189 AskedRow (D `asked`); while its card is up the card stands in its place | ✓ |
| Error | W:2791 red words | R:184 ErrorRow (D `error`) | ✓ (was an agent bubble) |
| Closed ask line | W:2743 "✓ <title> · Allowed in the chat" (not a question's: its "Asked you" box says it) | R EndedRow (D `ended`; service/asks.ts keeps closed asks with how they went, from the hook's end/<id>) | ✓ |
| CLI start-screen card | mods/chat/screens.js: "Claude asks", "Claude Code is waiting on its screen", its words, each choice a row that presses it, Answer in terminal | C OneQuestionCard with `press` (D `screenQuestion`); service/watch.ts watches with the same core/screens.js `ScreenWatch` (the window's now too); the window's own cards (shared "chat.screens") show too, a screen both saw once; a tap → action `answer` → press only on the same screen | ✓ |
| Start screen closed | W "Claude Code's start screen · Answered: Yes" | R EndedRow (`SCREEN.ended`) | ✓ |
| Workers' asks in the Assistant's chat | W:764 their cards headed "SHEP-7 asks", "Open chat", "Or write to it in its own chat.", their secrets and start screens, how each closed "SHEP-7 · … · …" | D for the space's workers (`by`): C askHead "SHEP-7 asks" + Open chat, ChatAbout hint, SecretCard with its task, EndedRow lines | ✓ |
| Lost session | W:860 checkLost/lostSession: the screen says the session is gone → a new one with core `lostMessage` (typed into its shell, or restart.sh), note "Earlier session was gone, starting a new one…" then "… started a new one." for 8 s | service/watch.ts the same, once per agent; waits 20 s and acts only when the window hasn't (its shared "chat.lost", or a CLI runs there again); R NoteRow (D `note`) | ✓ |
| Empty Assistant chat (no agent yet) | W:1511 "What should the Assistant do?" / "It plans the work, starts a task for each part and keeps you posted." | C:1135 WORDS.emptyTitle / emptyBody | ✓ |
| Empty chat, other agent | W:3711 "No messages" / "Write to the agent below." | C:1145 | ✓ |
| Notices | W:3569-3582 terminal icon, "Opening the conversation…", "No chat for this agent" + body + Open terminal, "Can't find this conversation" + body + Open terminal, "This agent has ended", "This task's agent has ended" + Resume | R Notice (D `notice`), the same words from WORDS; a task's: Resume | ✓ |
| Notice buttons Close / Close chat / Back to tasks | W close the chat pane | none | ◇ the web has no chat pane to close: the sidebar or Back leaves it |
| "No agent to show" | W a chat pane tied to no agent | none | ◇ every web chat is an agent's or a space's Assistant chat |
| Scrolled up | W:3688 pill "Latest", or "1 question below" with a red dot that goes to the card | C:2510 the same pill and words (`questionsBelow`), unread count kept | ✓ |
| Find matches lit | W tinted rows | F CSS highlights on the words | ◇ the browser's text highlight |

## Message actions (the band under a message)

| Element | Window | Web | State |
|---|---|---|---|
| Where | W:79 ONE row under the message, on its side, room always kept | R:42 Band, under the bubble, on its side, always laid out | ✓ (was beside the bubble) |
| Time | W:1783 dim "14:05" / "3 Nov 14:05", on hover | R:42 `clock` from core, on hover | ✓ |
| Reply | W reply icon → quote in the box | R:42 → `startReply` (ReplyStrip) | ✓ |
| Copy / Copied | W copy icon, check for 1.5 s | R:42 copy icon, check for 1.5 s | ✓ |
| Rewind (yours, not a /command, not another agent's) | W:1914 the CLI's /rewind, then the terminal | R:42 `bandActs` from core; action `rewind`, then the terminal | ✓ |
| Fork (agent's) | W:1934 new tab with the CLI's fork | R:42 action `fork` | ✓ |
| Reactions (pills) | W:2707 always shown, 20 px tall in the 22 px row: emoji + count, flush under the bubble's outer edge; each side the other's mirror: yours time, reply, copy, rewind, smiley, pills; the agent's pills, smiley, fork, copy, reply, time | R:42 + X:66 Pills with count 1/2, the same order and edge | ✓ |
| Smiley | W:1852 opens the emoji picker | R:42 → `openPicker` (the full picker) | ✓ |
| Newest reply while working | W:2477 no band yet | C:1084 `writing` | ✓ |
| What you just sent | W pending rows have no band | C:102 no band while in the outbox | ✓ |
| Touch | (no touch) | hold a message: X's bar; slide right to reply | ◇ touch instead of hover |

## Emoji picker (mods/chat-react)

| Element | Window | Web | State |
|---|---|---|---|
| Search | E "Search all emoji" | X:559 "Search all emoji" | ✓ |
| Nothing found | E "No emoji found" | X "No emoji found" | ✓ |
| Frequently used first | E "Frequently used" | X EmojiChooser | ✓ |
| Category icons, skin tone | E category bar on top, tone bottom right | X tabs under the search, tone beside it | ◇ 2.1's picker layout, same controls |
| Your emoji marked | E selected bg | X pressed look | ✓ |

## Composer

| Element | Window | Web | State |
|---|---|---|---|
| Placeholder | W:2547 "Message the Assistant", "Message SHEP-7", "Message Claude Code"; "Reply instead…" while a card or the terminal asks | C:2528 placeholderOf (incl. `blocked`) | ✓ |
| Attach | W:3286 paperclip "Attach files" → the file picker | C:1838 paperclip "Attach files" → the file picker; a phone gets a menu with its camera | ◇ phone camera |
| Pasted / dropped files | W tiles over the box, × each | C:2024 Attachments | ✓ |
| Model button | W:3199 "Opus 5.5 · High ⌄" in the box's bottom row, a narrow chat drops "· 1M" | S:384 AgentLine: the same words (D `agent.words`) with a chevron, under the box | ◇ 2.1's one-row box: the button sits under it |
| /model | W:2225 opens the picker, the named model chosen | C /model → `openModelMenu(chat, name)` | ✓ |
| Mic | W round mic (Voice add-on) | C:2255 Mic | ✓ |
| Send / Call | W one round button: Send with words, Call when empty | C Send, else V:65 CallButton | ✓ |
| Enter / Ctrl+Enter / Shift+Enter | W send, hold until free, new line | C same | ✓ |
| Up / Down recall | W:1337 earlier messages in an empty box | C:1780 | ✓ (was missing) |
| Esc | W stops a working agent (empty box), drops a quote | C same | ✓ |
| Slash list | W:3020 "/name" + about | C:1664 SlashList | ✓ |
| "#" task list | W:1351 "#4": the folder's tasks, ref + title + state | C:1691 TaskList (the space's tasks from the snapshot) | ✓ |
| Reply strip | W quote line with × in the box | C:1993 "Replying to …" × | ◇ 2.1's wording kept for whom it quotes |
| Queued (held) message | W:2999 a row over the box: clock, its words, "Queued · Sends when the agent is free", Send now, Edit, × | C Held: the same row over the box (held ones are kept out of the conversation) | ✓ |
| Draft kept | W data/chat-drafts | C drafts (useDraft) | ✓ |

## Model menu (mods/chat-models)

| Element | Window | Web | State |
|---|---|---|---|
| Opens | W popover over the model button | S:254 ModelMenu over the button (action `model-menu` → service/agents.ts `menu()`, core/agents.js `menuFor`) | ✓ (was the 2.1 "Restart Assistant?" dialog) |
| Model rows | M "Model" header, installed agents' models, check on the chosen, agent icon | S same rows and check, the window's own claude.svg / codex.svg (copied to web/public/agents with their MIT notice) | ✓ |
| Reasoning | M segmented levels (Low … Extra high, Max) | S segmented, same names | ✓ |
| Fast | M zap, "Fast", switch (where the model has it) | S same | ✓ |
| Permissions | M shield, "Permissions", current mode, chevron → sub-menu with checks | S same (restart passes `perm`) | ✓ |
| Restart | M "Restart with Opus · High" only when something differs | S same words | ✓ |
| Another machine's Assistant | M row as here: it runs on that machine (SHEP-8) | S same | ✓ |

## Over the box: working, needs you, helpers

| Element | Window | Web | State |
|---|---|---|---|
| Working line | W statusLine: spinner, what it does (its log's open call, else its CLI's live status report, as Claude Code says it: "Computing build times"; else "Working"), m:ss, [■ Stop Esc]; "Stopping…" | A WorkingLine (D `doing`, from the same core/chat-view.js `reportMsg` and `doingWords`: the service reads the report from herdr-core's `status`, where the window's terminals() has it as `report`, and tells the page each time it changes), `elapsed` from core, Stop · Esc | ✓ (was a line in the chat with dots; the web said only "Working" between calls until SHEP-25) |
| Only waiting | W clock icon, no spinner | A:360 clock (D `waits`) | ✓ |
| Needs you | W:2979 red dot, "Needs you", what it waits for or "The agent is asking something in the terminal.", Open terminal | A:389 NeedsYou (D `blocked`) | ✓ (was missing) |
| Starting the Assistant | W:1419 startAgent: the first message in an empty Assistant chat starts it (assistant template, the message its task, the slot's labels), "Starting the Assistant…" | service/actions.ts `send` to a space with no Assistant: the same `hc run` and labels in the window's slot (shared "coordinator.slots"), else the service's own labels; writes data/chat-first; A WorkingLine "Starting the Assistant…" | ✓ |
| Helpers | W:2972 rows: spinner, name, age; past five, four and "+N more" | A JobsTag: the same rows over the box | ✓ |
| Background shells and watchers | W background(): after the subagents, a row each for the shells and watchers the agent left running (terminal or eye icon, name, age, chevron), live from its log and its processes (core/bg-jobs.js), gone when they end; a tap opens its command, the last lines it printed (Claude Code's) and Stop; Codex's own long-running shells too. Settings' subagents switch leaves them shown. A background call answered without a task id (cancelled, denied, failed) is no row, and one with no task id stays a minute at most (SHEP-20, core/bg-jobs.js: a window still on an older install keeps such a row for hours, like "Keep watching SHEP-10 · 4h", until it updates) | A JobsTag JobLine: the same rows and the same open row (service compat `jobs`, api/activity `what=job`, action `stop-job`) | ✓ |

## Cards

| Element | Window | Web | State |
|---|---|---|---|
| Header | cards.js red dot, "Claude asks", quiet links at the right | C:1200 CardShell `head` (C:1231 askHead) | ✓ |
| Answer in terminal | cards.js link: no decision, the terminal shows | C:1231 action `answer` with `terminal` (service/asks.ts `release()`), then the terminal | ✓ (was missing) |
| Permission | cards.js title, detail, Allow / Deny | C OneQuestionCard (D question: Allow, Deny) | ✓ |
| Plan | cards.js Approve / Keep planning | C OneQuestionCard (Approve, Keep planning) | ✓ |
| Cut short | cards.js "Some of it is too long for the chat; the terminal shows it all." | D question(): the same words | ✓ |
| Question options, Other… | cards.js options, "Other…", "Your answer" | C options, "Other…" box | ✓ |
| Chat about this | cards.js "Chat about this", "Or type your answer below." | C:1238 ChatAbout (service/asks.ts `chatAbout()`) | ✓ (was missing) |
| Several questions | cards.js "Question N", Next, "Not answered", Submit | C:1295 StepsCard | ✓ |
| Secret card | secret-card.js "Secret: NAME", masked box | C:1563 SecretCard | ✓ |
| "Choose an answer to send it now." / "Send: X" | (none) | removed (2.1's) | ✓ |

## Find (Ctrl+F)

| Element | Window | Web | State |
|---|---|---|---|
| Box | W:1578 magnifier, "Find in chat" | F:42 WORDS.find | ✓ |
| Count | W "2 of 7", "No matches" | F "2 of 7", WORDS.noMatches | ✓ |
| Search earlier | W "Search earlier" ("Loading…") while pages are left | F:108 same (action `earlier`) | ✓ (was missing) |
| Up, down, close; Enter, Shift+Enter, Esc | W | F | ✓ |

## Dictation and calls

| Element | Window | Web | State |
|---|---|---|---|
| Recording row | W:1982 red round X, wave, red dot "Recording" m:ss, Done ✓ | C:2266 DictationBox: red round X, wave, dot "Recording", time, Done | ✓ |
| Writing it down | W "Writing", spinner in Done | C "Writing", Done disabled | ✓ |
| Call row | W:3259 Mute (mic / mic-off), wave, Connecting / Listening / Thinking / Speaking / Muted + m:ss, red round X | V:98 CallBox: the same, red round X | ✓ |
| No key | W:2936 "Voice calls need an ElevenLabs key", "Add your key in Settings › Secrets as ELEVENLABS_API_KEY, then press the call button again.", Open Secrets | V:34 CallHelp over the box, same words, Open Secrets | ✓ (was a top error bar) |
| Call bar elsewhere | B "Voice call with X · m:ss", Go back, red round X | V:146 CallLine: same words, Go back, red round X | ◇ 2.1's green pill look |
| Call error | B "Voice call: …" with × | V:168 | ✓ |

## Image viewer (mods/chat-image)

| Element | Window | Web | State |
|---|---|---|---|
| Opens over the chat, pages through its images | chat-image main.js | C:593 Photo | ◇ full screen with swipe and pinch on a phone |
