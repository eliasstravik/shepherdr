# Shepherdr 2.1 delivery record

This is an implementation checklist, not a release or a claim of parity. Work is on
`work/301-build-shepherdr-2-1-on-core`; do not merge it into live-followed main until
the complete acceptance run and approved cutover.

## Finite readiness follow-up

See [the frozen launch checklist](launch-readiness.md) for the current go/no-go and bounded outcomes.
Fresh post-clean-review audit covers all code through 9c3e2d78, including the actual native provider-blocked
recovery correction. Full Check 41045612532 and rewrite 41045613515 passed that code. Later report-only commit
gets its own full Check; exact final binding is in PR #507 and hf2s. No older SHA is evidence for later code.
Elias explicitly declined broader GitHub access and the private preview route: the merge test is UNTESTED,
physical device/voice acceptance remains UNVERIFIED, and the launch recommendation remains NO-GO.

## Current result (2026-10-30)

The standalone rewrite is implemented on the dedicated branch, with real native
Claude Code/Codex runs, same-host core remote lifecycle/review/merge, authenticated
mailbox, restart/offline recovery and the retained UI. It is not a deployed release
or a verified full-parity result. The unchecked gates below are acceptance gates,
not an absence of implementation. Historical slice notes remain below for audit;
the later dated entries supersede their pending statements.

- Full GitHub Check **41031514810 passed** at 7bd30e01 (all three shards, types, build).
- Rewrite **41042086343 passed** at 15318781: core/types/build, task layout and real production plugin. Includes fresh repositories, default-HEAD space-control guards, first-use guidance and stable lost-response automation taps.
- Rewrite **41032408275 passed** at b8ad5df0, including the real production plugin compiler: compiled edit/replacement, persistent state and last-good fallback (11 assertions; 4.12 s on GitHub).
- Final full review: three rounds. Round 1's two Settings majors and round 2's
  failed-base observer major/context minor fixed; round 3 reported no remaining
  concrete critical/major findings at ed75b57e. Later manual Settings feedback and
  navigation/profile/repository fixes, native first-use guidance and added production-compiler coverage postdate that review.
- Proof artifact **hf2s v31** contains actual branch runs and explicit limits.
- **External vm-ssa acceptance skipped**, as Elias instructed: no saved address or
  working trusted connection was available. No access configuration changed.
- Real main-red observation now passed, including a failure behind a pending newer head, actual failed-job logs, one native notification, green re-arm and exact scratch workflow restoration.
- Still unverified: physical phone/lock-screen/offline return, actual ElevenLabs
  voice (no key in isolated state), native provider-failure takeover, product GitHub
  merge (configured GraphQL status-check refusal), installed service/macOS
  behavior, manual production plugin/device acceptance and every-feature side-by-side UX parity.
- Nothing merged into main; no live state, agents, services, sharing mapping,
  credentials, version, tag, release or publication changed. v2.0 stays preserved.

## Baseline and safety

- Verified origin/main: `ebb17d585c82906b788a8473237921802920b5c5` (SHE-295).
- Preserved the same commit as origin/v2.0 without overwriting any ref.
- The existing supervisor (`scripts/supervise.ts`) rebuilds on checkout changes.
  Main, installed helpers, live services, Tailscale mappings and live state stay untouched.
- Downloaded official core 0.1.14 into `/tmp/she-301-bin`, not the installed PATH.
  Probes use separate `HC_SESSION`, XDG config, state and runtime directories.
- Core source inspected: herdrdev/herdr-core, commit
  `298d9c9094ce36c2c80c8bd917032458d5f440f1`. Protocol generation 1.
- Temporary core sessions are not security boundaries. Core socket access grants
  account-wide command/file access. Never publish that socket or accept raw RPC from a browser.

## Build order and acceptance gates

- [x] Core connection: pinned schema, framed RPC/attach, bounds, reconnect/resnapshot,
  mailbox authentication, remote document/file exchange, both agents' real status sources.
- [x] Coordinator/chat: standalone launch, first run, spaces, Claude Code/Codex,
  native transcript readers, messages and persisted reconnect.
- [ ] Tasks/review/merge: core children, worktrees, workflow labels, queues,
  review, permission cards, merge safeguards and proof.
- [ ] Remote machines: core-only transport; disconnect/reconnect, remote tasks,
  files, credentials, mailbox response and recovery.
- [ ] Remaining parity: every feature below with real acceptance evidence.
- [ ] Full parity verification, fresh review, branch CI, complete proof artifact.
- [ ] Cutover approval (only after everything above is reviewable).
- [ ] Separate release approval; no version bump, tag or publication during build.

## Core observations (manual isolated probes, 2026-10-29)

These are API checks with harmless sleep processes, not product acceptance or
local test suites. The second machine is another isolated core on this host using
the documented `machine.add via` connection; actual remote SSH is not yet proven.

| Requirement | Evidence / remaining work |
| --- | --- |
| API compatibility | Binary reports 0.1.14; hello generation 1 and rpc.discover checked by new client |
| Documents | CAS set/get worked; event includes name/version; value must be fetched |
| Combined remote mailbox | Set/get through `on: probe`; local stream reported `machine: probe` |
| Remote files | `file.read on: probe` returned exact first two lines of scratch connection helper |
| Child outlives parent | Local t4 survived killing t3; remote probe/t1 survived killing local t6 |
| Cross-machine parent | Use `caller` with `on`, not explicit `parent`: explicit parent resolves on destination; returned child parent was local t6 |
| Core restart | Holder adopted live t4 after server.restart followed by explicit core start |
| Restart API | server.restart prepares/stops; CLI/server manager must start the replacement; do not wait for RPC to spawn it |
| Attach | First paint received via framed terminal.attach; cols/rows are required |
| Event framing | Event channel is a newline-delimited byte stream; multiple messages can share a frame |
| Event resync | New CoreSession observed disconnect, then epoch 2 with seq reset 29→1 and a second authoritative resync after isolated CLI restart |
| Agent status | Claude Code 2.1.312 and Codex 0.163.0 emitted SessionStart/UserPromptSubmit/Stop with transcript paths in real isolated runs. Both interactive CLIs also emitted native OSC 7501 (`reported: true`); hooks/logs and explicit core status are the sources |
| Agent permissions | Both real interactive CLIs emitted PermissionRequest to a per-launch hook for a harmless scratch-file request. Claude hook denial visibly stopped it. Codex was stopped after its hook event; final denial completion still needs proof |
| Mailbox authorization | AES-GCM request/reply with per-session grants and durable claims implemented. Actual roundtrip through second core succeeded; unauthorized action refused without dispatch. Product secret/card/merge dispatch not yet connected |

The Codex integration uses the documented per-invocation inline hook configuration
and explicit trust of Shepherdr-generated hooks, without changing the user's
hook files. Reference: [official hooks documentation](https://learn.chatgpt.com/docs/hooks).
Headless `codex exec` uses approval `never`, so it is not evidence of interactive
permission handling.

Early core-slice review: three read-only fresh-eyes rounds; four major findings
fixed in round one, one additional major fixed in round two; round three found
no critical/major. Minor cancellation, idempotent start and uncertain-dispatch
reporting findings also fixed. Regression tests were written, not run locally;
`bun run typecheck` passed. This is not the final review of the complete rewrite.

## Feature parity matrix

Baseline references are source locations on the verified legacy commit. Every row
is pending until it has current-branch runtime evidence, including matching
phone/tablet/desktop light/dark screenshots for visible features. Demo data is
not evidence of a working feature.

| Feature | Legacy baseline | 2.1 acceptance evidence |
| --- | --- | --- |
| First run, spaces, sidebar ordering/sections, renames | plugins/places; server/live/places.ts | Partial: real local/second-core homes and scratch spaces created; phone sections/order/moves/rename and restart persistence checked; fresh installation → new/existing-folder initialization → native Claude coordinator → Codex worktree/research Done verified; full device parity pending |
| Coordinators and task chats, Claude/Codex, logs/activity, attachments, reactions | plugins/chat; plugins/coordinators; server/live/readers | Partial: both native chats and repeated sends/restart shown; real phone upload reached second-core Claude, native file reaction and human add/remove confirmed; quoted replies shown both ways; native activity rows and recorded read output shown; native background child details/output and large-log bounded readers verified separately; full device parity pending |
| Task IDs, worktrees, briefs, queues, pause/restart/archive/close/delete | plugins/tasks; server/live/engine; server/live/task-ids.ts | Partial: real dependency validation/capacity delivery; phone Restart preserves To do and unfinished file; explicit contained resume/ordinary relocation; task options; confirmed Stop of replacement and retired-root child; pin/archive/unarchive/stopped-task pause. Clean Close/research Done, regular coordinator Restart, clean Stop/removal and message-driven checkout recreation verified; native ended-turn Needs you and restart notice/PID preservation verified. Held-work Stop/Close/Delete and failure exit codes verified. Active native foreground Pause verified with same live PID/unchanged work; long shell-tool interruption and full parity pending |
| Provider retries and configured backup agent | server/live/retry.ts; server/live/engine/engine.ts cantGoOn | Implemented: native completed-log failure classifier, durable 1/2/4/8m retries, explicit-message reset, one-shot ordinary backup with retained checkout/handover, capacity and interrupted-start recovery. Two scoped reviews passed after a minor queued-context fix; CI passed; real native provider-failure/handover acceptance pending. Contained tasks do not auto-switch, matching legacy |
| Review/PR/checks/ready/merge, conflicts and recovery | server/live/engine | Partial: real local CORE-1 scratch task committed 1222573, native reviewer round 2 reported no findings, exact-commit card approved, squash merge 6e3a817 confirmed. Real private GitHub PR creation, exact-head Ready/draft promotion, published-comment native follow-up, conflict/rebase leased push, external merge and dirty-base sync/cleanup verified. Product check-dependent merge remains unverified (configured GitHub check-read 403); real main-red/pending-head/log/native-alert/green recovery passed; full checks/device parity pending |
| Questions, permissions, plans, secrets cards and notification answers | server/live/chats.ts; server/push.ts | Partial: actual merge and synthetic secret cards answered in phone-width preview; stale permission cards disable correctly; native GITH-3 multi-choice and two-step plan approved, followed by clean research Done; physical lock-screen and complete native permission parity pending |
| Remote machines, status, files and reconnect | server/live/machines.ts; server/live/mfs.ts | Partial: same-host second-core Claude task + Codex review + approved merge completed through core only; loopback SSH transport checked; external vm-ssa acceptance skipped for missing configured address/host trust; external disconnect acceptance unverified; legacy transport/launcher removal and native tool-environment recovery passed scoped review and branch CI |
| Artifacts, versions, data, notes, actions, validation | plugins/artifacts; server/live/artifacts.ts | Partial: real second-core artifact 9788e43f published, HTML/data versions and live data-only refresh inspected; button reached native keeper; real targeted versioned note reached native keeper, same-artifact update appeared live, and disposable artifact deletion removed stored versions/list entry; device parity still pending |
| Scoped secrets and authenticated agent access | server/live/secrets.ts; server/live/secret-access.ts | Partial: second-core masked card saved synthetic key; fresh remote launch used current authenticated helper and returned REMOTE_SECRET_OK without value in chat; real scoped run/env/ignored-file refusal and removal revocation passed; main-home scope isolation passed; private human CLI scoped set/replace/rm passed; UI Replace consumed the replacement in native Claude, then UI removal revoked access; full device acceptance pending |
| Shared browser, takeover and markup | plugins/browser; server/live/browser.ts | Partial: real second-core browser frames, takeover, navigation, fit, markup crop and native BROWSER_NOTES_OK shown; app restart retained takeover. Agent-only open was detected without a viewer and one-minute expiry closed its Chrome. Real SSH and full device parity pending |
| Voice, tool/audio bridge | plugins/voice; server/live/voice.ts | Implemented with bounded private provider bridge and CI coverage; page/control visible. Actual ElevenLabs call unverified: isolated home has no API key; no live credentials borrowed |
| Autopilot, usage controls and sandbox | plugins/autopilot; server/live/autopilot*.ts | Partial: real contained Claude/Codex runs, child checkpoint/review, phone on/wake/off, contained restart/outlive children, durable keep-workers return/completion and post-report usage limit. Full events/browser/limit/device acceptance pending; contained Autopilot remains Linux-only as in legacy |
| Automations, recurrence and heartbeat | server/live/automations.ts; server/live/heartbeat.ts | Partial: native coordinator saved rules/checklist; actual Run now and scheduled-once tasks answered; app restart preserved state; real failed and 20-minute quiet rules each produced exactly one native handler; complete recurrence/events/device parity pending |
| Terminal typing/resize, panels, files/diff/PR | plugins/terminal; plugins/worktree | Partial: raw core attach and phone typing returned TERMINAL_INPUT_OK; phone Files and added-file Diff inspected through second core; real core-confirmed phone/tablet/desktop resizing and app reconnect preserved PID; PR creation/Ready/comment/rebase/external-merge recovery verified, product check-dependent merge and lost-input-ack acceptance pending |
| Settings, agent/model/effort policies, private rules | server/live/settings.ts; server/live/models.ts | Partial: scoped role/task/review defaults + private launch rules implemented; phone scoped change and native runtime model before/after inspected; observed runtime is separate from launch choices; real Repository/base and Task IDs/prefix/forward-only numbering exercised by native INCQ-40; global Time zone, Plugins and Machines restored after legacy UI comparison; full acceptance pending |
| Health, alerts, unread/search, keyboard and mobile layouts | plugins/health; plugins/keyboard; src/layout* | Partial: phone unread/search/attention and keyboard reaction bar checked; machine capacity held/delivered messages; complete health/alerts/device parity pending |
| User plugins and documented new API | src/kernel.ts; server/plugin-api.ts; docs/plugins.md | Partial: API-2 client/server action and retained state inspected; isolated hot rebuild/switch/fallback code and CI coverage added, real production compiler/assets/runtime replacement, persistent state and last-good fallback passed in GitHub; full manual/device/gating parity pending; 2.0 plugins require migration |
| Standalone start/stop/status, installation and optional service | New requirement | Partial: isolated idempotent start/status/stop + crash/core restart exercised; final install/service/cutover pending, no live service enabled |
| Browser WebSocket resync, bounded output, duplicate-safe commands | server/app.ts; src | Partial: real server/core restart recovery and simulated browser offline for 10m03s caught up native TEN_MIN_OFFLINE_OK once; bounds/duplicate handling have branch CI coverage; physical-device return and full slow-client acceptance pending |

## Final acceptance and deployment boundary

Coordinator evidence: Claude Code and Codex each answered two messages through the
unchanged app. In the isolated preview, Codex t18/PID 983333 remained live across
server and core restart during a 30-second tool call, then returned
`SURVIVED_RESTART`. Standalone repeated start retained the same server PID; stop
left core and agents alive. No live state or mappings changed.

Real scratch lifecycle includes both native agents and the task/review/approved-merge runs above. Not yet verified: an external remote worktree/task through
permission notification, artifact and merge (vm-ssa access skipped as instructed); physical-device
offline return/lock-screen answers; every parity row; identical UX across device sizes. The simulated
browser offline check above passed; it is not a physical-device check.

At approved cutover only: stop all legacy writers; make and verify a complete
backup (including SQLite WALs); relocate legacy home to `~/.shepherdr-legacy`;
pin legacy launch code to v2.0 and audit every path before restart; initialise
fresh 2.1 at `~/.shepherdr`; never allow shared writes. Rollback stops 2.1 writers,
preserves new state separately and restores verified legacy launch/home settings.
The final runbook must specify exact installed service/config paths after their
read-only inventory; this checklist does not authorize operational changes.

## Current integration work

Standalone lifecycle, native coordinator chat, durable command receipts, permission
mailbox dispatch and an initial task/worktree/review/merge implementation are in
the integration branch. These are not completed acceptance gates. Mailbox requests
run concurrently so a human permission wait does not block status; answer writes
remain serialized and retain responses for the current request queue. Helpers
reconnect with the same authenticated request identity. New regression coverage
runs only in branch CI. Local verification remains typecheck and manual inspection.

Manual task evidence: the unchanged app's coordinator created CORE-1 as a real
Codex core child in a separate scratch repository and worktree. A native
PermissionRequest became a card; answering Allow once let Git commit succeed.
This is desktop/shared-browser evidence, not lock-screen push evidence. The
existing Terminal panel now displays the real raw core attach over a per-viewer
WebSocket with bounded queues, acknowledgements and no input replay. Further
typing/reconnect acceptance is pending.

Second scoped review found five major lifecycle defects in the new integration:
answer delivery could be lost, stale-session cards could answer replacements,
fresh merge cards could retain old approval, terminal confirmation could overwrite
hooks, and hook EOF could block transcript polling. Fixes and regression tests
are being checked in branch CI; this is still not final rewrite review. Manual
restart also exposed replayed PermissionRequest hooks resurrecting answered cards;
permission ownership now belongs only to authenticated mailbox dispatch.

Proof artifact `hf2s` (SHE-301: Proof) records the actual coordinator chats,
restart response, ready card, scratch merge and Terminal panel. It explicitly
lists unverified capabilities. Three scoped integration review rounds found
five initial majors, two additional session/expiry majors and one visibility
major; all were fixed with regression coverage. The final complete-rewrite
review remains pending. Manual acceptance then exposed premature reviewer
commentary forwarding: relays now require a successful native turn-end marker
and retain the reviewed commit. An aborted turn is not a completed review.

Remote provisioning is implemented through core machine.exec only. Helpers are
immutable, content-versioned files in a private per-installation agent runtime
under the destination user's .local/share/shepherdr-agents; credentials are
created with exclusive mode-0600 writes, never file.write's default permissions.
Agent-side hc connect speaks the pinned framed API to its own core; no app
listener, SSH bridge or per-machine worker is installed. Both binary version
and the helper's actual connected core identity are checked before launch.
A real Claude coordinator on the isolated second core returned
REMOTE_CORE_CLAUDE_OK through its own native transcript. This is same-host
transport evidence, not real SSH-machine acceptance.

Remote task IDs retain their machine-local prefix/number, qualified by the core
machine name in the combined app (e.g. probe/CORE-1), avoiding cross-machine
collisions. Bare local IDs resolve only within the authenticated caller's space.
Workflow remains separate from an unreachable agent's machine status.

Historical implementation risk (follow-up below): the development Codex launcher used the CLI's
one-invocation hook-trust bypass to exercise generated hooks. That flag also
covers other enabled hooks; trusting generated hooks alone is insufficient to
justify it for a final installation. The follow-up below removes it; native
trust first-run acceptance remains pending.

Scoped task/agent Settings are now stored in the isolated core SQLite store,
with Everywhere → stable machine → space inheritance and explicit empty private
instruction overrides. Existing Settings and restart-sheet components are reused.
Role defaults, model/effort picks, review policy and private launch snapshots are
connected; backup, capacity, archive, browser, notification and other catalog
sections remain pending. Native Codex model discovery travels through core exec.
The pure legacy model catalog/parsers are shared without importing legacy state.
Manual phone-width inspection changed a scratch space's task Agent to Codex and
showed its scoped reset/inheritance controls; screenshot she301-settings-phone.png.
Settings slice review: three rounds, cross-CLI model and resumed/parent launch
choices fixed, checks-only merges fail closed without GitHub checks, and atomic
save notifications fixed; final round found no unresolved critical/major issue.
No local suites ran. Branch CI remains the check authority.

Codex hook trust follow-up: the launch-wide bypass has now been removed. Interactive
Codex keeps native /hooks review; untrusted hooks are skipped by Codex, and a
starting chat explains how to review them in Terminal. First-run native trust
still needs fresh manual acceptance. Read-only Codex reviewers now use the
supported `codex exec --json` event stream (stdin closed), privately captured by
a core-owned holder with a nine-minute limit. Successful report relay requires
both native turn completion and a zero-exit finished holder; failures are told
to the parent separately. No terminal text is used as chat or review results.
Sources: https://learn.chatgpt.com/docs/non-interactive-mode and
https://learn.chatgpt.com/docs/hooks (read 2026-10-29).
The second-core task probe/REMO-1 actually committed 19b9707, completed a fresh
headless Codex review, reached Ready, then merged its scratch change after the
shared-browser merge card was selected and sent. Screenshots:
she301-remote-ready.png and she301-remote-merged.png. This is same-host two-core
acceptance, not a real SSH machine, physical phone or lock-screen push proof.
Scoped trust/reviewer review: no critical/major findings; interrupted-review
notification minor fixed. Full rewrite review and parity acceptance remain open.

Secrets slice in progress: explicit-home vault + existing masked cards and scoped
Settings pages are wired. Agent list/ask/run/env use authenticated core mailbox;
secret responses are encrypted before core docs and journal persistence. Scope
comes only from the active launch's stored machine/space, not request labels.
The agent-side helper runs locally with values in child environment and masks all
nonempty values, including short/split stdout and stderr. Env output requires a
git-ignored plain file. Review found the inherited short-secret masking gap,
fixed with CI regressions; second round had no critical/major, and nonregular env
target refusal minor was fixed. Real two-core secret use and CLI set/rm parity
are still pending; do not mark this row complete.
GitHub core + restart-layout jobs both passed commit 1f2bb1ea (run 40971184563).
Native Codex trust was then accepted through its own hook browser in the shared
Terminal panel, with the generated command/source inspected. All generated
hooks showed active/trusted; a raw phone-input turn produced
CODEX_NATIVE_TRUST_OK in the native transcript and chat. No bypass flag was
present. This verifies the current local native setup path, not remote Codex
setup or a claim that the extra native trust step can be skipped.
The real resumed remote coordinator exposed stale absolute helper paths in its
old conversation. Launches now publish the current SHEPHERDR_COMMAND and replace
earlier routing instructions; a stale helper gets a repair message naming only
its owning launch's current helper, never secret values. This does not change
authority: the server still validates the private active-session grant. Third
Secrets review found no unresolved critical/major. After a fresh start with this routing fix, the actual second-core coordinator
used secret run successfully and returned REMOTE_SECRET_OK. Screenshot:
she301-remote-secret-ok.png. Synthetic value only; actual SSH and complete secret
CLI parity remain pending.

Artifacts slice in progress: native core-only file reads/exports, immutable input
checks (private roots, symlink/hardlink/nonregular refusal), sealed browser
validation, persistent thumbnails, 20 retained versions, data/title-only updates,
comments/notes/actions and keeper routing are implemented. The exact existing
frame and artifact UI are reused. Checker imports no legacy state/SSH transport;
its browser runs in an isolated installation namespace/profile via one core exec
batch, with inherited browser routing removed. Core exec sweeps that batch's
children afterward; no testing browser/service/Tailscale mapping is installed.
Update locks and permanent ID tombstones prevent lost updates and reused links.
Fresh review found hardlink input and revoked-session publication majors; both
fixed with CI regressions. Round two found no unresolved critical/major. Typecheck
passed; real checked-artifact UI acceptance and branch CI remain pending.

Manual offline acceptance: shared preview browser network set offline at
2026-10-29 23:21:33 UTC, then reloaded to chrome-error (old WebSocket/page gone).
Network restored after 23:31:36 UTC, over ten minutes later. The second-core
Claude coordinator's 610-second harmless shell wait completed while the browser
was offline. Reopening its chat showed native TEN_MIN_OFFLINE_OK once, with
correct earlier messages. Screenshot she301-ten-minute-offline.png. This proves
simulated browser network absence + authoritative native-log resync; physical
phone sleep/offline behavior remains unverified. No live agents/services stopped.

Artifact manual acceptance: the real second-core Claude coordinator published
9788e43f from its own file through the authenticated core mailbox. The initial
check refused publication on an agent-browser Unix socket path limit; shortened
installation/session IDs fixed that without changing the shared browser. v2/v3
changed HTML and JSON; v4 changed data only. The existing inline frame retained
its v3 URL while showing ARTIFACT_DATA_TWO, proving the data event updated it
without a page reload. Full screen also showed v4. Send proof reached the native
coordinator as ARTIFACT_ACTION_OK. Phone light/dark inspected; screenshots
she301-artifact-light.png, she301-artifact-data-full.png and
she301-remote-artifact.png. This is two cores on one host, not actual SSH.
Final scoped artifact review round found no critical/major or additional minor
findings. Local typecheck passed; branch CI pending. Full parity remains open.

Chat parity slice: app-owned uploads are checked against their original chat and
forwarded in bounded 2 MiB chunks through core, including binary files up to the
existing 32 MiB upload limit. Each deliberate remote send gets a fresh private
copy; prior links retain access to the original upload, with concurrent history
updates merged. Filenames are normalized before chat-line formatting. Native
attachment, reaction and reply tags use the same pure 2.0 language helpers.
Manual shared-browser phone upload she301-upload-proof.txt reached second-core
Claude, which read REMOTE_UPLOAD_CONTENT_OK and reacted to the file. A tap added
the human side, another removed only that side, and native replies confirmed
both events. Screenshot she301-chat-reactions.png. A manual ordinary HTTP send
with reply identity produced a native QUOTED_REPLY_OK reply; both quote links
appeared in the phone view (she301-chat-quoted-reply.png). This proves the backend
and rendered quotes, not the phone swipe-to-reply gesture.
Manual focus+Enter initially opened a task behind the message; the chat now
consumes its own Enter. Repeating it opened the reaction bar and stayed in the
coordinator. New GitHub layout regression covers that exact navigation conflict.
Scoped review fixed quoted-name, stale-copy and concurrent-copy history minors;
final scoped round found no unresolved critical/major or additional minor findings.
Local typecheck passed; branch CI pending.
Artifacts branch CI passed ca52a13a (run 40974536655): core regressions, legacy
artifact/model regressions and restart layout. Proof hf2s updated to v3.

Native activity slice: common pure turn grouping, step summaries and output
decoding moved to server/activity.ts; legacy adapters retain their public names.
Core activity uses persisted native events and reads only their recorded output
locations through core exec, including on remote machines. Hidden system turns
remain quiet; rows keep chronological order and finished processes have no live
turn. Headless Codex steps link to their own captured native output. Child logs
use native readers with original byte offsets; child output links are isolated
to their owning chat. Shell tails preserve the cut flag even for a very long
single line. Child logs currently have an explicit 4 MiB display limit: full
large-log parity and incremental reading remain pending before readiness.
Manual phone view opened the actual second-core file-read output containing
REMOTE_UPLOAD_CONTENT_OK (she301-native-activity.png). A real 25-second native
background shell appeared in In the background, then disappeared on its native
completion, with BACKGROUND_COMPLETE_OK in chat (she301-native-background.png,
she301-native-background-output.png). No screen parsing or alternate transport.
Scoped review: two rounds, no critical/major, truncation-notice minor fixed;
second round found none remaining. Typecheck passed; branch CI pending.
Chat CI passed 41b6bc45 (run 40975053582), including native chat regressions,
existing core/artifact/model tests, restart layout and the focused-Enter
regression in layout-keyboard.test.ts. All suites ran only on GitHub.

A second harmless background shell printed BACKGROUND_OUTPUT_OK before a
35-second wait. Opening its live job displayed that exact native output in the
existing phone sheet (she301-native-background-output-live.png).

Activity CI 40975708398 passed new core activity tests and all three layout
files, but exposed stale legacy activity fixture doubles missing runtime and
runtimeHook. The fixture now supplies both; branch CI is rerunning.

Worktree panel slice: files, literal relative paths, binary/large-file display,
rename-aware counts, uncommitted additions, unified patches and read-only gh PR
inspection are served by one stateless native script through core machine.exec.
No listener, SSH mirror, worker or legacy filesystem adapter is used. The task
record alone chooses machine/folder/base/branch. Git external diff/textconv and
interactive prompts are disabled; subprocess capture and time are bounded.
File reads reject traversal, outside/ignored symlink targets, nonregular files
and hardlinks. Review exposed a tracked-hardlink bypass in Git diff; the reader
now validates every listed regular content path before Git can read it, with
regressions for tracked hardlinks, redirected paths and literal-tab counts.
Two scoped review rounds: one major and one minor fixed; second round clear.
Manual acceptance: the real second-core coordinator created deferred task
probe/REMO-2; its actual Claude child stayed To do. The coordinator added only
panel-check.txt in that scratch worktree, uncommitted. Existing phone Files
showed PANEL_DIFF_OK and Diff showed its +1 line. Screenshots
she301-core-files-phone.png and she301-core-diff-phone.png. Actual GitHub PR
data/check fallback and complete tablet/desktop/light/dark comparison pending.
Typecheck passed; worktree branch CI pending. Activity follow-up e64e8679 passed
core + legacy activity regressions and all three layout files (run 40975907171).

Final scoped worktree round found no unresolved critical/major or additional
minor findings. Expected reader failures use plain error envelopes. An unreadable
GitHub checks fallback now has an explicit checksError in the existing PR Checks
slot, rather than claiming no checks exist. New helper and layout regressions
cover that access failure; actual GitHub failure UI remains unverified manually.

Task lifecycle safety slice: per-task changes now exclude merge, close, delete,
restart, review/report/ready and message preparation/delivery from racing each
other. A removed task cannot be resumed by a waiting send; reviewer messages
retry their actual reviewer chat after preparation. Shutdown blocks new task
changes, queued-go scheduling and pending-send retries, waits for active task
changes/merges, and leaves undelivered messages queued for restart. An unchanged
local squash-merged branch can be cleaned up without force using the recorded
ready head and merge commit; later work stays protected. GitHub merge commits
are recorded, but syncing the local base after GitHub merge remains pending.
Three scoped review rounds found deletion/delivery, reviewer retry, shutdown
retry and queued-go races; fixes have authored regressions. The final round's
queued-go finding was fixed after its report, without a fourth review round.
Typecheck passed. Manual second-core REMO-2 send after isolated app restart
returned native LIFECYCLE_SEND_OK and remained To do, with its uncommitted panel
marker preserved. Worktree CI 40976525268 passed; lifecycle branch CI pending.

Native main-log reader slice: core machine.exec reads at most 1 MiB of the owning
native file per request, retaining exact byte offsets and incomplete UTF-8 lines.
Whole histories no longer pass through core file.read's 64 MiB whole-file limit.
Inode/shrink, consumed-tail and no-growth modification checks reset replaced
files. Polling tracks each chat independently, with four slots per machine and
rotating fairness; a stalled remote does not block later local polls. Individual
records above 64 MiB have an explicit display limit: a persistent chat notice
names the skipped record and later complete records continue. That is a record
limit, not a whole-history limit. Child activity logs still use their earlier
4 MiB limit, pending the next slice.
Three scoped review rounds fixed unbounded unfinished records, unchanged-suffix
overwrite detection, remote polling blockage and a warning that initially only
entered an internal map; final round found none remaining. Authored CI regressions
cover those cases, UTF-8 boundaries, regular EOF, large sparse files and slot
fairness. Manual second-core native reply NATIVE_READER_OK appeared after an
isolated preview restart (she301-native-reader-phone.png); real >64 MiB native
agent history acceptance remains unverified. Lifecycle CI 40977676240 passed.

Sidebar organization slice: the same shared ordering/section rules now persist
in core-backed product SQLite metadata. Sections, pinned spaces, machine/space
order, moves, renames and emoji use the existing UI. Names never change native
core machine identity or repository paths; machine rename reset shows its native
display name rather than its immutable UUID. Section mutations use own-key maps.
Scoped fresh review found no critical/major/minor findings. Typecheck passed;
authored core regressions cover ordering restoration, scoping, duplicate names,
pinning, native-name reset and invalid inherited object keys. Manual phone UI
created Core proof, moved remote-demo into it and retained the section/move after
isolated server restart; rename to Core evidence succeeded. Screenshot
she301-sidebar-section-phone.png. Drag gesture and full legacy device comparison
remain unverified. Native main-log CI 40978065938 passed.
Sidebar CI 40978265737 passed layouts but exposed a new fixture expecting an
uppercase spaced space name to succeed, contrary to the existing slug rule.
The regression now sends the lowercase hyphenated name the UI actually sends;
production behavior already correctly refused the invalid name.

Child activity slice: native child histories now share incremental byte reads,
with a per-job serialized cursor, reset-on-replacement reader and bounded cache
of 200 step summaries. Other native text is not retained in this cache; output
links keep original byte offsets. Very long displayed fields say shortened.
The existing quiet sheet text names incomplete catch-up and oversized records.
Two scoped review rounds: unbounded raw-event cache major fixed; second found
none remaining. Authored CI coverage includes >4 MiB history, appended steps,
original output links, 10,000-step cache bounds and loading/warning layout.
Typecheck passed. Manual phone opened the real second-core Claude child's read,
failed initial wait and later background wait; read output showed
REMOTE_UPLOAD_CONTENT_OK after an isolated server restart
(she301-native-child-output.png). Its native completion notice explicitly says
it is still waiting on its own background work, so Shepherdr retains that job;
we do not infer completion from elapsed time or the agent's commentary.
Actual >4 MiB child history remains unverified manually. Sidebar follow-up CI
40978356162 passed. Branch CI now also includes existing order, places and
section regressions. Proof hf2s updated to v4; light/dark checker images inspected.
Child CI 40978845483 passed core regressions and the new loading/warning layout.
Broadening existing sidebar layouts exposed nine stale expectations: old combined
need badges, the older search menu and an ambiguous drawer navigation selector.
Verified baseline ebb17d58 already has split need/ready badges and the added
Search this chat and beyond row. Tests now assert that current baseline (including
both counts and keyboard order) and select the actual drawer during transitions.
Scoped read-only test review found no issues. No product appearance was changed
for these failures. Full sidebar CI rerun pending.


## Core browser slice (2026-10-30)

The existing Browser panel now uses an installation-owned core child on the task's
machine. Main talks only to its core socket. The child talks locally to the pinned
agent-browser daemon/CDP; no remote listener, tunnel, direct tailnet stream or
worker fallback is provisioned. Unknown OSC 777 envelopes carry authenticated,
direction-separated frames/controls through raw core attach, not screen reading.
The child is an outliving task child where its agent is live.

Browser configuration and handoff journals are private files; HMAC keys stay out
of labels, agent prompts and logs. A record binds task, launch, machine and child
identity. Snapshot/reconnect adopts that child and reattaches. Input is never
replayed; timeouts ask the human to inspect the page. Command receipts, bounded
input/output queues and slow-viewer frame dropping prevent reconnect duplication
and unbounded buffering. Takeover/handback news uses durable authenticated IDs
and the native agent delivery queue; it stays out of the human chat.

The server provisions agent-browser 0.39.4's platform binary and its guide/assets
inside the existing immutable helper bundle, using chunked core exec, private
files and hash verification. Supported packaged targets are Linux/macOS x64/arm64
(with Linux musl detection). Chrome must already be installed, or be installed
explicitly with the pinned wrapper's documented install command on that machine.
No service, global PATH or Tailscale mapping is changed by provisioning. Missing
Chrome reports a setup hint. Other platforms remain unverified/unsupported.

A viewer lease expires after disconnect and hands the browser back after the
normal leave delay. Agent-only usage marks are discovered through core and get
an idle owner even without a viewer. The helper enforces the scoped idle setting
independently of the app. Task stop/restart first interrupts/stops its own agent,
then awaits authenticated browser cleanup; merge cleanup failures remain queued
for retry instead of hiding the merge result. Explicit delete/merge forgets that
browser profile; ordinary pause/archive preserves sign-ins.

Browser note retries retain the same command ID and uploaded screenshot references.
Only screenshots uploaded by this chat can be included; attachment captions retain
the original filename after private remote copying. The panel's look is unchanged.

Manual isolated evidence: probe/REMO-2 used the real core browser child, took over,
navigated to its scratch artifact, fitted the page, selected Send proof, added a
note and sent its actual crop. Native Claude returned BROWSER_NOTES_OK once and
kept the task To do. Desktop screenshot and phone chat screenshot were inspected.
Stopping/restarting only the isolated app preserved both browser page and takeover.
The second core is on this host, not SSH. Actual SSH,
lock-screen/browser-on-phone input, full device comparison and crash cleanup are
still unverified. Fresh review: three scoped rounds; two major cleanup/idle gaps
fixed, later rounds clear. Regression tests are written for branch CI only; no
local suites were run. This does not complete the full rewrite acceptance gate.


## Automation scheduling slice (2026-10-30)

The existing recurrence/event model is shared through an injected persistence
adapter, with no implicit live-home reads in core. The standalone SQLite store
keeps definitions, last runs, time cursors and run claims. The old adapter retains
legacy JSON behavior. The original task-list controls and schedule wording stay.
Time zone is the same Everywhere-only control used by every schedule.

Authenticated coordinators can add/edit/list/pause/resume/run/remove automations
on their own machine. Each run creates a fresh task/worktree through CoreTasks,
with the normal policy/review defaults and core parent lifetime behavior. Run-now
keeps a browser command ID over a lost response; a second action waits for that
result. Time cursor advances and the claim commits before any remote work. A crash
reconciles an interrupted claim to its recorded task or an explicit interrupted
result; it never silently replays task creation.

Task-added/ready/merged/needs-you transitions enqueue durable run records in the
same transaction that marks the transition seen. Concurrent events wait instead
of being dropped while a run starts. Implicit space matches are machine-local per
matching rule; explicit space rules cannot grant an unrelated rule that authority.
Automation-created tasks suppress added-event recursion. Paused definitions retain
queued events without starting them. Stop drains active creations and preserves
queued claims. Failed/stalled/main-red/health event production is still pending
with the corresponding task/health/GitHub monitoring work; this slice does not
claim complete automation parity.

Manual evidence: native second-core coordinator added Core schedule check using
an RRULE and paused it. Phone Tasks showed the unchanged automation row/details.
Run now created probe/REMO-3 in its own real worktree; native Claude returned
AUTOMATION_TASK_OK and kept To do. Both phone screenshots were inspected. The once-only rule fired at 00:52 UTC, created probe/REMO-4 and native Claude returned SCHEDULED_TASK_OK before waiting. Both definitions/runs survived an isolated app restart. Dark/device comparison remains pending.
Three scoped fresh reviews found two major event-loss/machine-scope issues; both
were fixed with regressions and the third round was clear. Tests are written for
branch CI; only typecheck and manual acceptance run on this VM.


## Machine health and start limits (in progress)

Machine CPU, available memory, disks and optional NVIDIA GPU are sampled through
bounded, stateless core exec. Linux uses MemAvailable; macOS uses the OS free-memory
measure and remains unverified. No machine listener or worker is installed. Pure
legacy parsing/limits/hysteresis is shared; the UI retains its meters/settings and
says core where the underlying service genuinely changed. Machine limits remain
Everywhere/machine-only, with fractional core and percentage controls.

Fresh starts and idle-chat resumptions check machine availability, sample freshness,
load, memory and per-machine slots. A persisted reservation precedes transport;
it tracks the actual main/reviewer chats so long native turns stay counted. A
capacity-held task has no new native agent until room is available. Queued human
messages remain saved; health refresh retries them. Ready human changes revoke
stale merge approval, while internal merge answers retain Ready. Explicit Pause
cancels queued unsent messages with a visible notice. New regression coverage
checks these boundaries using real scratch Git and fake core on GitHub only.

Manual isolated evidence: both cores returned real CPU/memory/disk samples through
core exec; home chat displayed the existing health button. At max 1, probe/REMO-5
worked on a harmless sleep while REMO-6 showed Queued with its slot reason. It
started after the first task returned To do. Later, with both native chats already
open, a second message to REMO-6 remained queued while REMO-5 occupied the slot.
The saved message later reached native Claude, which returned LIVE_HELD_MESSAGE_OK and kept To do. Full device comparison, alert crossing/recovery, top process detail,
actual SSH/macOS and full queue parity are still pending.

Scoped fresh review (three rounds) found capacity bypasses for live/Ready agents
and long reviewer turns, plus a hidden health-input display bug. Fixes and regression
cases are in this slice; the final reviewer-chat fix awaits the complete rewrite's
fresh review rather than claiming a fourth scoped round. This slice is not a full
rewrite readiness result. No live state or service changed.


## Heartbeat checklist storage (2026-10-30)

The shared heartbeat model now takes explicit storage. Legacy retains its existing
files; core stores its checklists, held news and last-beat cursors in the isolated
product database. Authenticated coordinators may write checklists only on their
own machine; other roles can read but cannot change them. Empty input stays empty
across restarts. The core CLI forwards bounded 64 KiB stdin only for heartbeat set.
An old helper without stdin forwarding gets a refusal naming its current command.
No automatic wake-up or Autopilot containment is claimed by this storage slice.

Manual second-core coordinator saved HEARTBEAT_CHECKLIST_OK through its current
immutable helper, read it back and returned HEARTBEAT_SAVED_OK. The resumed native
chat first used an old helper path from its history and correctly failed; supplying
the current launch command succeeded without credential copying or repo edits.
The phone reply screenshot was inspected. Fresh scoped review was clear; tests are
written for GitHub and only typecheck ran locally.

A separate status fix removes a contradictory startup result: a live process whose
health response is delayed says alive/unconfirmed, rather than stopped. Successful
start reuses its authenticated health observation instead of probing a second time.
Fresh scoped review was clear; a regression covers the unconfirmed live process.

Real SSH evidence: Tailscale reports the Mac mini online at
eliass-mac-mini.tailda0205.ts.net. A documented core machine.add via strict,
noninteractive SSH to port 22 timed out (2026-10-30). No machine was added or binary
installed there; machine.ls still shows only probe. Actual remote acceptance remains
blocked on a reachable SSH endpoint, not replaced with another transport.

## Voice bridge (2026-10-30, provider acceptance pending)

Voice retains the existing composer/call UI and ElevenLabs agent. Its tools now
resolve core-backed spaces/tasks/reviewers, read familiar workflow states and send
through the same durable queue as typing. Exact names or machine-qualified names
are required when names collide; unavailable machines are reported rather than
silently reading stale history. Provider tool IDs get per-call receipts and stable
send IDs. Repeated requests cannot duplicate a native message.

The scoped vault selects ELEVENLABS_API_KEY without putting it in snapshots or
remote grants. Existing server environment configuration is supported, but the
launcher removes that server-only key from core daemon startup/recovery; only the
app subprocess explicitly receives it. Account-bound voice agent IDs are cached by
key hash. Fresh provider agents require signed URLs and request no audio recording
and retention zero. Calls keep no local recording or transcript. Provider protocol
and authentication were checked against the primary documentation:
[WebSocket API](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket),
[signed URL authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication)
and [privacy](https://elevenlabs.io/docs/eleven-agents/customization/privacy).

HTTP JSON, provider frames, PCM chunks, tool queues and both audio directions have
bounds. Slow/disconnected calls stop instead of buffering indefinitely or replaying
audio. Microphone tracks belong to cleanup immediately after permission, including
when AudioContext setup fails. No provider key is present in the isolated preview:
the real phone-width UI showed the expected Settings → Secrets hint. This proves
that failure path only, not a working audio call. Real provider audio, actual phone
microphone/lock screen and cross-agent voice delivery remain unverified. Talk-to-type
still uses the existing device speech-recognition path and needs acceptance.

Three scoped reviews found one major microphone lifetime leak and one malformed
provider-event issue; both were fixed, the third round was clear. Typecheck passed.
Provider/core regressions and phone audio-failure layout cases were written for
GitHub; no local suites were run.

## Versioned plugin contract (2026-10-30, controls pending)

User plugins require an explicit `shepherdr.json` API-2 manifest before either part is imported. Incompatible
replacements fall back to the built-in plugin, including cross-plugin Vite aliases. Client `definePlugin`, names
and Registry slots are retained; server `definePlugin` adds `api: 2` and scoped `setup(context)`. The context offers
snapshot copies, private namespaced JSON state, change subscriptions, methods and cleanup. Startup is bounded;
failed listeners/setup are quarantined. HTTP plugin actions require durable command IDs, with existing uncertain
outcome behavior rather than replay. The API is documented as trusted local code, not containment.

Manual isolated evidence: `/tmp/she-301-accept/plugins/core-proof` declared API 2 and registered an increment method.
Two actual HTTP actions with CID `she301-plugin-proof-01` both returned count 1. App stop/start left native agents
running; a new CID returned count 2 from the retained namespaced state. The phone Plugins page was inspected in the
shared browser (`/tmp/she301-plugin-contract-phone.png`). This is runtime evidence, not full plugin parity:
server-only fixture, client-extension visual proof, on/off switches, built-in server gating, automatic rebuild,
last-good fallback and full device comparison remain unverified/unimplemented. No live plugin directory was read
or changed. Fresh scoped review round 1 reported no findings. Typecheck passed; new tests await branch CI.
Voice commit d1bb3eff branch CI 40984454359 passed both jobs.

Plugin contract CI 40984980305 passed core/protocol/plugin tests. Layout builds failed before running: Vite bundled
`build-plugins.ts` into `.vite-temp`, so its default module-relative root pointed at `node_modules/plugins.json`.
The resolver now passes the config's actual project root explicitly. Existing branch layout builds cover that
integration; no local build or suite was run. The scrolled phone page also showed `core-proof` under Yours
(`/tmp/she301-plugin-contract-yours-phone.png`).

## Plugin rebuilds and controls (2026-10-30, production acceptance pending)

The standalone app now has its own plugin updater, with no main/ref watcher or legacy supervisor. It freezes the
started source tree, stages only its configured home's trusted plugins, compiles the client and server registry,
and publishes assets plus the extension runtime without restarting core agents. Two-second source polling and
Everywhere switches request rebuilds. Build process groups have bounded output, a shared two-minute deadline,
and shutdown cancellation. Last-good plugin folders survive same-code app restart; current/previous builds are
retained. Changed application code invalidates the cache. New runtime listeners stay paused until publication.
Server import/setup failure restores the old plugin folder (or skips a failing new extension), with a Settings
warning. Setup state is staged, bounded and checked against concurrent writes before transactional activation.
Failed setup cannot delete the working plugin's private state. Browser/terminal, voice, health, alerts, artifacts
and worktree entry points now honor their switches; voice off also closes active provider/audio bridges.

Review: three scoped rounds. Fixed major server-only compilation gap, runtime-startup fallback gap, active voice
shutdown gap, and setup-state mutation gap. The last fix needs confirmation in the final whole-rewrite review.
No local suites or builds ran. New branch tests cover actual API-2 client/server compilation and syntax fallback,
private same-code cache, on/off runtime swapping, asset HTTP/WS reload notification, runtime failure/state fallback,
concurrent-state refusal, active-call cleanup and build cancellation. CI is pending for this slice.

Manual proof is narrower: the isolated API-2 fixture's client button returned real server count 3; tapping again with
its retained CID returned 3 again (`/tmp/she301-plugin-client-phone.png`). The phone Plugins page showed the fixture
under Yours. This used Vite, not a full build. Automatic compilation, fallback, switches and full device parity are
not manually verified here. The Vite preview explicitly uses `--no-plugin-updates`, so inspection cannot silently
invoke the prohibited local build checks. Actual SSH, physical-phone/audio and remaining feature acceptance are
still delivery gates. Prior branch checks at d9fb40d3 passed both jobs (40985361547).

Plugin update CI 40986360653: layout job passed; real API-2 client/server compilation plus server syntax fallback
passed (4.4 seconds), as did live HTTP/WS asset publication and the staged-state/CAS regression. Seven updater
unit cases stopped at fixture creation because its nested home used default 0755, correctly refused by prepareHome.
The fixture now creates that directory with 0700; production privacy checks remain unchanged.

## Unread, attention and search (2026-10-30)

Reproduced the unread bug against the previous running preview: sending the human request changed last to
1793324088111; the native UNREAD_BEFORE_OK reply at 1793324089788 left it stuck there. The new core-owned read
ledger receives visible native agent messages and product cards, excludes human sends, and persists a baseline
plus monotonic per-chat marks. Read requests cannot regress another device or pre-read future messages. Original
current questions/permissions/secrets supply attention IDs; expired/replaced permissions and forwarded copies do
not inflate the count. Notify uses the same inherited All / Needs me / Off controls and existing push filter.

On the fixed preview, human send left last at 1793324089788; native UNREAD_AFTER_OK advanced it to 1793324135309.
While core-demo stayed open, remote-demo became bold in the sidebar (`/tmp/she301-unread-sidebar-phone.png`).
Opening it marked exactly that native timestamp read. These are real native replies through the second core,
not a mocked screenshot. No physical-device push delivery is claimed.

Search loaded all 11 chats but exact UNREAD_AFTER_OK initially returned nothing: the old plain-text normalizer
removed identifier underscores. It now strips paired emphasis in a linear scan while preserving literal identifiers
and code spans. The same exact query found the real native reply and human request afterward
(`/tmp/she301-search-fixed-phone.png`; before `/tmp/she301-search-phone.png`). Existing search UI was retained.
Fresh scoped review round 1 clear; round 2 with the search correction clear. Typecheck passed. New native observer,
read/attention and identifier regressions plus existing search/unread/attention layout coverage await branch CI.

Plugin updater commit 7821f2d0 passed both GitHub jobs (40986550153), including real client/server compilation and
syntax fallback plus runtime-startup/state fallback, active voice cleanup, cancellation, and asset HTTP/WS tests.
This remains CI evidence; automatic production builds were not invoked on this VM.

Manual inspection also found a historical forwarded native permission card with active buttons after expiry in
core-demo. The private permission answer already refuses stale authority, but that display needs correction before
card parity is complete. It is a remaining concrete issue, not a verified feature.

## Stale permission copies (2026-10-30)

The historical forwarded card `ask-e2c77361-2654-4c68-a0b5-8689e758738c` in core-demo still showed active Allow once /
Deny controls after CORE-1 was merged and its private permission was settled. Reproduced in the shared browser
(`/tmp/she301-stale-permission-before-phone.png`). CoreCards now resolves both original and forwarded displays
from private permission/question records. Settled/expired/replaced requests close without changing old message
timestamps. Expiry and replacement update both chats and deny an outstanding native permission request; ordinary
question replacement refreshes its coordinator copy too. This is display/lifecycle reconciliation, not authority
from chat text or labels. The answer endpoint still rejects stale session/expiry.

After only the isolated preview restart, the identical card rendered sent=-1 and “Interrupted; ask again after
reconnecting”, with its choices disabled (`/tmp/she301-stale-permission-after-phone.png`). Actual task merge/native
history remained in place. Fresh scoped review round 1 clear; typecheck passed. Canonical original/forwarded
history and expiry regression coverage is written for branch CI. No live app/core/agent was stopped.

The final card rendering uses optional `Question.closed`: muted Closed plus the reason, rather than “Sent to” for
an interruption that sent no human answer. This preserves the existing card layout. Review round 2 caught the new
field accidentally placed on Task; it was moved to Question and typecheck passed. Round 3 found no critical/major
issues. One unfixed minor is limited to pre-flag alpha user-question history: negative sent can also mean a genuine
Other answer, so those older rows are preserved rather than guessed closed. Fresh 2.1 state and every new replaced
question carry the explicit field. There is no approved historical import at cutover.
Unread/search CI 40987111965 passed core/logic tests; newly enabled search layout cases timed out opening search
before initial page readiness. Their keyboard actions now wait for the composer; shorter locator deadlines expose
any remaining selector issue before the outer timeout. Attention desktop timing is under investigation in CI;
no local browser suite was run or represented as passed.

Unread/search/card branch CI 40988084887 passed both jobs at 4ea5b662. Screen regressions now wait for initial
message layout before keyboard actions, target whole question cards rather than text-only bubbles, and move the
pointer/focus away before checking a desktop row badge (the unchanged hovered row gives its room to More).
Manual keyboard Enter opened the real core-demo reaction bar. Proof artifact hf2s v8 adds real unread/search and
stale-card before/after images; light/dark artifact checks were inspected. No physical-device claim is added.

## Queue validation (2026-10-30)

New queue edges resolve canonical combined-app task IDs (case-insensitive bare IDs on the owner's machine;
space-local bare numbers; explicit combined IDs across machines; bare main IDs accepted when no local match).
Missing, ambiguous, self and circular dependencies are refused before changing saved workflow. Iterative traversal
handles long chains without recursive stack growth. New tasks omit already-finished dependencies. Queue edits
reject merged/closed/merging tasks, keep native in-flight work counted until idle, tell another task agent to pause,
and send a durable go when clearing dependencies for a live agent with room. Archived queued tasks never auto-start.

Scoped review round 1 found a queue system-echo minor, fixed with the existing native hidden-input filter. Its
capacity major was retracted after checking the actual reservedChats path, which already counts live work without
reservedAt; the implementation additionally retains that reservation and ensures the primary chat is recorded.
Round 2 had no critical/major, and found bare main IDs unreachable from a remote queue, now fixed with exact-ID
fallback and regression coverage. Queue logic, native hidden-input and capacity regressions are written for GitHub.
No local suite/build/browser test was run. Actual native scratch validation is in progress.

Real native second-core coordinator ran the isolated queue check: REMO-6 after REMO-5 saved; inverse edge refused
a circle; missing MISSING-999 refused without losing the saved edge; native final reply QUEUE_VALIDATION_OK.
The run also exposed CLI task show returning stale initial state text despite correct workflow/UI. It now uses
the same current task projection as list and snapshot; regression coverage added. Snapshot confirmed REMO-5 To do
and REMO-6 Queued with after=[probe/REMO-5]. No scratch files were changed by this check.

Final queue slice review round 3 found no critical/major. Its remaining minor (main/local ID collision) is fixed by
explicit machine-name:task-ID or stable-machine-ID:task-ID resolution; canonical queue edges still store permanent
product IDs. Bare IDs retain own-machine precedence. Added collision coverage; whole-rewrite review remains pending.
The same native coordinator then read both tasks after the isolated app restart and returned QUEUE_STATUS_OK:
REMO-5 To do/todo; REMO-6 Queued/queued, still after probe/REMO-5. Shared-browser phone screenshot
`/tmp/she301-queue-validation-phone.png` inspected. This is a same-host second-core run, not actual SSH.

## Done task archiving (2026-10-30)

Restored the existing Tasks settings section, Archive Done after default 7 days, scoped overrides and off. The pure
interval parser is shared with the legacy engine without importing its live storage. Core queue ticks archive only
ended tasks whose deadline passed, whose space exists, and whose agents have no active/unconfirmed native work.
This is metadata only: no kill, branch/worktree deletion or history removal. Pin clears when archived; bringing a
task back records a new delay so it does not immediately disappear again. Archived queues remain paused.

Fresh scoped review round 1 found no findings. Typecheck passed; time-boundary/native-work/unarchive/file-preservation
and inherited-setting regressions are written for GitHub. The actual phone Settings control saved remote-demo's
1 day override while all other scopes stayed 7 days (`/tmp/she301-archive-settings-phone.png`, inspected), then Reset
restored its inherited 7 days. No simulated aged screenshot is offered as real timed-archive proof; a real-day timer
run is unverified. Queue commit fefdf726 passed both branch CI jobs (40988550257).
Done archive commit 7745118a passed both branch CI jobs (40988728424). Proof hf2s v9 includes actual queue status
and scoped archive-setting images; light/dark artifact check screenshots inspected.

## Autopilot containment work (in progress)

The existing Linux bubblewrap prerequisite is available on this VM: harmless `bwrap --unshare-all --ro-bind / /
-- /bin/true` exited zero. This only establishes namespace availability, not product containment or Autopilot proof.
The core socket must never be mounted into a contained agent. The intended local mediation runs as that agent's
core child wrapper: a private Unix gateway fixes its server-issued identity, forwards product commands only through
the authenticated core doc mailbox, and mediates allowed HTTPS. It is not an SSH/worker fallback or an additional
network door to Shepherdr. The app owns shared run policy/budgets; no authority comes from labels/request text.

Before enabling controls: prove filesystem/network/PID/core isolation, provider startup, native logs and status,
run-owned children/reviewers, checked git checkpoint/PR/merge, shared limits, restart recovery, wake/news behavior
and explicit stop/keep-workers outcomes. Existing legacy git entry points need a containment-specific audit: an
agent-writable repository script referenced by a Git filter/hook must not execute outside containment. No shortcut
of running an unrestricted agent under an Autopilot label is acceptable. UI controls remain unoffered until wired.
The first new Autopilot module is app-private run policy only (`server/core/pilot-policy.ts`), not connected to
launch or exposed as working controls yet. It persists config snapshots, exact chat/launch/role/task bindings,
owned task IDs, shared traffic, monotonic reported usage, runtime/parallel limits and stop/keep-workers states.
It deliberately has no remote socket or label authority. Its command gate is only one layer: integration must
also check target ownership, configured secret names and exact-head merge approval in the product handlers.
These missing connections are requirements, not claims already satisfied. Coverage is written for branch CI.
Private policy review round 1 caught a major stale stop retry reviving old worker authority. Stop transitions are now
monotonic/idempotent, terminal runs cannot revive, and cleanup confirmation requires stopping/failed state. Its
private-host-suffix minor is fixed too; actual destination DNS/IP checks remain required in the gateway. Round 2
reported no remaining findings. Typecheck passed. This model is not yet Autopilot runtime/containment acceptance.
Containment-preparation helper now builds cleared-environment namespace/mount arguments, sanitizes selected provider
config, rejects shared writable hardlinks, masks project sockets/FIFOs, and conservatively filters special-use IPs.
The builder derives its own Git paths and masks rather than relying on caller-supplied omissions. Review round 1
caught a critical hostile Git pointer mounting unrelated host directories. Fixed by bounded non-symlink pointer
files, verified .git/worktrees structure and backlink, matching repository/worker common root, and real objects/refs.
Round 2 reported no findings. Typecheck passed; CI regressions cover the hostile pointers and other preparation
rules. Standard main/linked worktrees are supported; arbitrary separate Git-directory layouts fail closed here.
Runtime gateway/launch/actual containment remains unimplemented and unverified. Policy commit b9f3f05c passed both
GitHub jobs (40989188435). No core or app API is exposed by these preparation modules.
Contained-side command/hook/bootstrap plumbing is being added next. The command client has bounded Unix HTTP
request/reply sizes, stable request IDs, explicit uncertain timeout errors and cancellation. It carries no core
credential. Secret run/env stay inside the isolated namespace and use the existing masking/ignored-file helper.
Native transcript capture opens no-follow/nonblocking regular files inside the namespace, sends bounded byte
chunks, rotates batches, retains offsets only after acknowledgement, and reports failures rather than claiming
complete history. Source paths never instruct the outside wrapper to open a host file.

Review round 1 found a major same-size/unchanged-tail rewrite being missed; the extracted capture reader now checks
mtime/ctime too and has filesystem regression coverage. A minor final-drain deadline excluded an in-flight batch;
periodic requests now abort and final batches share the one shutdown signal. Outer gateway/launch/policy wiring
is still absent; these scripts are not invoked by the preview and do not establish working Autopilot proof.
Containment-preparation commit 6197f4c5 passed both branch CI jobs (40989700430).
Contained helper review round 2 caught a second major: truncation/replacement by an empty native log omitted its
reset packet. Empty resets now require acknowledgement before committing the cursor; retry identity is preserved.
Round 3 reported no remaining findings. Added actual filesystem/Unix-client regressions cover multi-chunk bytes,
append offsets, same-size rewrites, empty resets/lost acknowledgements, batch fairness, removed unread files,
response/request bounds, refusals, uncertainty and cancellation. Typecheck passed. Actual outer/runtime integration
and namespace/provider acceptance are still pending, so this slice does not complete the Autopilot parity row.
Contained helper CI 40990334236 passed layout and all native capture cases, but failed one Unix-client assertion:
Bun emitted response-aborted synchronously during oversize socket cleanup before its intended too-large refusal
settled. The client now settles its specific refusal/cancellation/timeout before destroying transport; late chunks
are ignored. This is a corrected race, not a claimed full passing run.

The outside capture writer (`helper/core-pilot-records.ts`) now accepts only validated provider-relative JSONL names
and bytes, writes private no-follow regular files, and persists SQLite reset intents/byte offsets. File fsync comes
before cursor commit. Identical overlaps/lost replies are verified rather than appended twice; partial data written
before cursor commit is verified and completed on retry. New identities require a reset; empty resets truncate old
captured bytes. It never opens a host source path from an agent. Coverage includes reconstruction, partial-write
recovery, conflicting/gapped retries, empty resets and path/symlink escapes. Fresh scoped review round 1 found no
findings; typecheck passed. Outer HTTP gateway, native launch and product-policy integration remain pending.
Capture writer/client fix commit 72a51036 passed both GitHub jobs (40990598020).

The outside per-agent Unix gateway is now implemented as a library, still not launched by product agents. Its
backend receives fixed command fields/IDs, never caller chat/grant/cwd authority. Private socket ownership,
request/response/action/concurrency bounds, all-answer public DNS validation, resolved-IP TCP, shared pre-forward
traffic reservations and shutdown cancellation are covered by new branch tests. Initial CONNECT head bytes retain
order; incoming stream completion waits for asynchronous metering so final bytes are not dropped on normal EOF.

Proxy review round 1 found CONNECT-only routing could send another TLS name at a shared IP. A bounded first
ClientHello/SNI guard now rejects plaintext, missing/different SNI and ECH before forwarding tunnel bytes. Structures
were checked against [RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html), [RFC 6066](https://www.rfc-editor.org/info/rfc6066/)
and [RFC 9849](https://www.rfc-editor.org/rfc/rfc9849.html). The gate inspects only complete records, with bounded
fragments/bytes/time and cancellation; a native TLS-client ClientHello case is written for CI. Encrypted HTTP Host
and application payloads remain uninspected, matching the legacy profile's explicit destination-only limitation;
this is not TLS interception or a claim to stop encrypted application-level domain fronting. Round 2 found no
remaining findings against that declared TCP/TLS destination contract. Typecheck passed. Provider startup/actual
namespace/remote/core-runtime integration is still unverified and the controls stay unoffered.

Gateway/TLS commit 079e65f8 passed both GitHub jobs (40991579594), including an actual native TLS client's
ClientHello and ordered/charged tunnel EOF cases. The next boundary now has an outside-only core backend closure:
endpoint, credential and cwd are fixed at construction, while gateway words cannot select another identity.
Provider hook path mapping accepts only normalized absolute native-history paths for the chosen provider and
maps them into the private captured tree; it never opens the supplied host path or copies caller chat/grant fields.
Fresh scoped review round 1 found no findings. These functions are not yet wired to source dispatch/launches;
permission cancellation, actor authorization at dispatch, actual containment/provider runs and product controls
remain pending, so this does not establish a working Autopilot feature.

Backend/path-boundary commit 2d746415 passed both GitHub jobs (40991997576). Fresh runtime preparation now copies
only the chosen provider's bounded, owned login/configuration files to a new private home; sanitizes executable
configuration; and copies an explicit inside-helper list with no core backend/credential. Host login files are not
overwritten. Failed preparation removes its own new directories. Fresh scoped preparation review found no findings.

The outside runtime library now joins that private home with the real Unix gateway and capture writer, checks a
private lease before spawn and periodically, and launches only through bubblewrap. Revocation kills its owned
detached process group. An independent coreutils timeout enforces the shared deadline even if the wrapper's event
loop is busy. Normal cleanup removes the gateway and retains native history. Runtime review rounds 1 and 2 found
no findings; process-lifecycle regression cases use an explicitly fake bwrap and do not claim namespace proof.

A harmless manual run used the actual library, real `/usr/bin/bwrap`, a disposable read-only project, empty provider
home and `/bin/sh` as a stand-in executable. It returned `NAMESPACE_BOUNDARY_OK`: an outside private marker and the
isolated core socket were absent, the core credential env was empty, project modification failed read-only with
the original bytes unchanged, private HOME writes worked, and connecting to the real preview's host loopback port
17887 was refused. Temporary files were removed. Its lease/accounting callbacks were isolated fakes, so this only
proves this Linux mount/network boundary, not provider startup, product policy or working Autopilot.

Runtime/home commit 3a9d8776 passed both branch GitHub jobs (40992500506). Follow-on harmless native provider runs
used that actual runtime/gateway with the installed selected login copied to a private disposable home. Claude
returned `CONTAINED_CLAUDE_OK` (exit 0, 711,863 observed encrypted bytes); Codex returned `CONTAINED_CODEX_OK`
(exit 0, 1,490,719 observed bytes). Both left the read-only project unchanged; private runtime/login copies were
removed afterward and host files were not overwritten. No live tasks or services were touched. These probes used
fake private-lease/shared-accounting callbacks, so they establish provider feasibility inside the actual namespace,
not authenticated product controls or full Autopilot parity.

The first Codex attempt exposed a missing `codex-code-mode-host` companion and exhausted its intentionally small
1 MiB manual network allowance, failing closed with routing errors. The sandbox now mounts the installed sibling
companion beside Codex, and control preparation provides its mount target. A 2 MiB bounded repeat succeeded with
no missing-companion/routing error. Only public exact hosts were permitted; no host-network fallback was used.

Companion/native-proof commit 1785e0b8 passed both GitHub jobs (40992845258). Source dispatch now has an internal
`pilot` mailbox action backed by app-private run/agent records, exact launch/grant/machine/space/task membership,
confirmed terminal PID, and private policy actors. A lease waits briefly for terminal.run's response to bind its
actor before granting authority; replacement/stopping checks repeat after awaits. No product launch yet creates
that metadata or grants the new action. Contained ordinary commands explicitly fail closed until their owned-task,
secret and Git brokers are connected; Autopilot remains unavailable in the preview.

The dispatch handles leases, cumulative pre-forward traffic, normalized captured-history hooks and deny-only
permission cancellation. Cancel waits use a separate authenticated core doc; durable per-grant tombstones also
deny a hook arriving after cancellation. An unrelated grant cannot cancel another card. Ordinary tool results are
dropped before the bounded core mailbox. Permission input too large to display in full is refused before changing
agent state or publishing a partial approval. Regular permission reconciliation now also closes a confirmed
finished process, while absence during core reconnect stays distinct from confirmed exit. Regression coverage is
written for private identity, binding/renewal PID checks, quota failure, path mapping, both cancel orderings,
cross-grant cancellation, oversized input, finished processes and unknown connectivity. Fresh scoped review rounds
1 and 2 found no findings. This is dispatch assembly, not launch/task/Autopilot acceptance; no new UI proof is claimed.
Dispatch commit fc76120f passed layout but failed core CI (40993414386): new shutdown reconciliation reached an old
unread fixture's permission rows that omitted their required question. All dispatch regressions passed. The fixture
now includes actual permission-card data; no production permission validation was weakened. A passing rerun is pending.
The fixture correction cf894c93 passed both branch jobs (40993631583).

CoreAgents now has an internal contained launch path. Preparation and native execution run through documented core
machine.exec/terminal.run, including immutable remote helpers; the core credential stays in an outside private
launch file. Native settings/hooks/instructions point inside the read-only control tree. Codex never receives the
outside shell environment policy inside its namespace. Native browser provisioning and session resume are disabled
for these fresh contained starts. Readonly Claude uses `--print`/plan mode and keeps native JSONL/hooks as its source;
Codex reviewers keep the existing native-JSON stdout capture outside the contained wrapper.

Launch review round 1 found a major race: headless Codex becomes Working before its actor is bound. A separate
private `pilot.pending` flag now permits the initial lease to wait without using native status as launch readiness;
the confirmed lease clears it. A minor definite pre-submission cleanup gap is fixed too: revoke the new grant,
restore the earlier record and discard only the new preparation before terminal.run has been submitted. After an
ambiguous submitted start, retain its mounted state and private record for authoritative reconciliation. Coverage
checks exact wrapper/native argv, excluded credentials, readonly Claude routing, failed filesystem setup cleanup,
record restoration, headless binding and uncertain core starts. Rounds 2 and 3 found no must-fix findings.

Two actual, harmless, one-shot readonly coordinator transport probes created separate temporary app homes and
scratch projects against the existing isolated core. They used real CoreAgents preparation, core-owned wrappers,
bubblewrap, authenticated encrypted mailbox leases/traffic, and native captured logs (no fake accounting callbacks).
Codex terminal `t1g` returned `CORE_CONTAINED_CODEX_OK`, exit 0, 943,810 accounted encrypted bytes and pending=false.
Claude terminal `t1h` returned `CORE_CONTAINED_CLAUDE_OK`, exit 0, 583,033 bytes and pending=false, exercising the real
inside hooks and capture path mapping. Their private app/login copies and scratch projects were removed after
confirmed exit. No live installation, other agent, service or Tailscale mapping was changed. This proves the internal
contained launch/observation route, not user-facing Autopilot controls, managed tasks, hard-limit exhaustion, remote
SSH or full parity. UI/scheduler callers and owned product/Git commands remain deliberately disconnected.
Contained-launch commit 99fd1017 passed both GitHub jobs (40994624651).
The same actual source/launch probes then ran on the second isolated core through alias `probe`, using a new private
installation each time. Codex `probe/t1b` returned `REMOTE_CONTAINED_CODEX_OK`, exit 0, 1,488,752 accounted bytes;
Claude `probe/t1c` returned `REMOTE_CONTAINED_CLAUDE_OK`, exit 0, 554,707 bytes. Both cleared pending binding. This
exercised immutable remote provisioning, hc-connect endpoints, authenticated remote docs/events, core file reads
and Claude native capture hooks. Their private remote helper installations were removed through core after confirmed
exit; temporary app/login copies and scratch projects were removed too. This is still a same-host second-core
fixture, explicitly not real SSH-machine acceptance. No legacy/live helper or another agent was changed.

A checked Git/GH helper is now implemented but not exposed or connected to product commands. It disables hooks,
filters, merge/diff callbacks, fsmonitor, editors, signing and custom remote helpers, and inspects every configuration
include (including inactive conditions) before effect. Writable workspace/provider-home includes are refused even
when currently missing. Validated Git metadata and worktree are pinned for Git and GH children; callback names in
inactive includes are disabled before branch changes. SSH is deliberately refused until a checked account/config
adapter exists; this incomplete foundation is not claimed as SSH parity. Source-level command/target ownership,
all writable-root tracking and every task/panel Git call still need integration before Autopilot is exposed.
Review round 1 found a major core.worktree redirection and a minor descendant timeout leak; both were fixed, plus
inactive-include traversal coverage. Round 2 found no remaining findings. New actual-Git regression coverage runs
only on GitHub; local verification is typecheck only. No live state, service or Tailscale mapping was changed.

The first checked-Git CI run (40996184841) passed layouts but exposed a real unsafe assumption: Git's configured
remote upload/receive program is first-wins, so later command-scope values do not replace it. The guard now refuses
nonstandard remote programs before effect, including inactive declarations. The regression verifies refusal with
no callback side effect, then removes that setting and exercises an ordinary native file-remote push. This profile
restriction is explicit; no configured custom remote command is silently run outside containment.

CoreTasks now routes Git and GH (including commit-tree stdin, PR creation and exact-head PR merge) through this
helper for contained repositories. CoreAgents records durable repository/worktree/private-home boundaries before
launch; prospective worktrees are recorded before creation. These boundaries remain after exit and restart because
leftover files remain untrusted. The files/diff/PR panel's stateless reader receives the same checked context, with
per-call async isolation and literal path handling. Remote helper provisioning includes the checked broker. Ordinary
uncontained repositories keep their existing route. No contained product command or UI was enabled by this wiring.
Fresh wiring review round 1 found no findings; after the CI correction round 2 also found none. Local typecheck
passed; integration and real-Git regressions await GitHub. Full Autopilot/SSH/feature parity remains incomplete.
Checked-Git wiring 33dcb38a passed the GitHub core job, including all actual-Git and panel guard regressions
(40996417951). Its layout job hit a pre-existing browser fixture race: the follow-up ps sweep could still see a
just-killed fake Chrome. That fixture now waits for its owned subprocess exits before asserting the next sweep.
No production browser code or timing allowance was changed. A passing complete rerun remains pending.

Contained command/task integration is implemented internally, with no UI mode control yet. Authenticated launches
are checked against private run/actor/task records; names in a request cannot change ownership. Task actions stay
inside the run (workers may change only themselves), secret use/list/ask obey the saved approved-name list, progress
is private to the run, and checkpoint stages/commits only the recorded worker worktree through checked Git. Artifact
listing is space-scoped; contained artifact export explicitly remains disconnected instead of returning inaccessible
host paths. Completion/stop/wakes and all-log usage accounting remain pending, so this is not working full Autopilot.
Managed task/reviewer launches inherit run, destination allowlist, shared deadline, selected task/reviewer defaults
and required exact-head merge approval. Their worktree root is a private installation-named cache outside protected
app/helper state; app state retains only records/captures. Native unattended flags are used only inside the validated
OS namespace (as in 2.0's isolated profile); ordinary agents retain native permissions. Shared capacity covers queued
release, delivery, initial contained To-do turns and reviewer starts; expiry is checked before new activity.
Fresh review: round 1 no findings (an initial parallel-gate report was retracted after re-reading health.room);
round 2 major To-do→go workflow bug fixed. Explicit human delivery now promotes To-do to Working; internal answers
and review relay do not. Round 3 had no must-fix findings. Added real-Git Todo→go→checkpoint/reviewer routing coverage,
private task ownership/secret-list regressions, and To-do capacity/runtime-expiry checks for GitHub only. Native
contained managed-task acceptance remains pending. Local typecheck passed; no local suites were run.
The browser-fixture correction f27faaa0 passed both GitHub jobs (40996593644).
Command/task commit c74315e6 passed all new GitHub regression cases and layouts (40997216011), but the existing
health unit fixture lacked CoreTasks.get, now needed to identify a run's capacity profile. The fixture was updated
to reflect the real interface; no production gate was relaxed. Complete rerun pending.

A real contained interactive Claude launch reached its native welcome screen rather than chat; a prior attempt
correctly refused a provider bootstrap host absent from the run's allowlist (`platform.claude.com`). The private
provider home now copies only the existing human's three bounded display/onboarding preferences, never account
metadata, MCP or project trust. That removed the theme welcome; native workspace trust and bypass-mode consent
still require resolution before unattended readiness. These were diagnostic reads of this task's own isolated
terminal, never screen-derived chat or status. Failed probes stopped and removed only their own temporary state.
Preference-copy review round 1 had no findings. New whitelist regression is for GitHub only; typecheck passed.
Health-fixture correction 30edd436 passed both GitHub jobs (40997411145), including contained command/task checks.

Native bootstrap now grants trust only to the app-selected contained cwd after sandbox mount validation and
sets Claude 2.1.314's recognized native consent preference in private control/settings. Codex uses its documented
projects.<path>.trust_level entry. This does not import host project trust or change normal agents; the app's
explicit isolated access profile remains enforced outside the native CLI. No Codex hook-trust bypass was added.
A new actual contained interactive Claude coordinator (`t1p`) returned `INTERACTIVE_CONTAINED_CLAUDE_OK` through
native hooks/captured JSONL with no manual startup clicks, pending=false, 364,719 accounted encrypted bytes. Its
private state and native login copies were removed after stopping only this task's owned probe. This proves
unattended interactive Claude startup/chat, not full managed delivery, Codex interactive or UI Autopilot controls.
Bootstrap review round 1 had no findings; generated trust scope and exclusion of host trust have GitHub regression
coverage. Local typecheck passed. Preference-only commit 3f0424fe passed both jobs (40997706751).

A real core-owned contained Claude coordinator then created scratch task PILT-1 via its inside CLI and authenticated
core mailbox. The worker's private binding was confirmed before its coordinator (`t1s`) was stopped deliberately.
The child (`t1t`) continued, changed only kept.txt to CONTAINED_TASK_FILE_OK, and checkpointed through checked Git
at 7035642014bae37d9a41f71324225a4fb97121d6. It requested a fresh readonly Codex reviewer (`t1v`), received the
native forwarded report (“No findings”) for that exact commit and replied CONTAINED_TASK_REVIEW_OK. Total measured
traffic was 3,103,674 encrypted bytes across the run. This exercised real namespaces, provider logins, core-only
commands/files/docs, native log projection and child-outlive-parent; no fake policy or launch callbacks were used.
No tests ran. Every owned terminal was confirmed ended before temporary app/login copies and scratch worktrees
were removed; no live installation or another agent changed. This is internal local-core acceptance, not UI
Autopilot, stop/keep-workers, hard-limit exhaustion, SSH, physical phone, ready/merge, or complete parity proof.
Native bootstrap b0e2916d passed both GitHub jobs (40998085599).

Contained Codex now starts interactively without extra app command hooks and discovers its own primary captured
JSONL from native session metadata (cli source plus exact contained cwd). A real authenticated core launch (`t1w`)
returned INTERACTIVE_CONTAINED_CODEX_OK, with 1,423,202 encrypted bytes and no pending binding. A separate run (`t1y`)
with a one-token advisory allowance reported 13,957 tokens after its first call, failed closed with the shared
reported-token allowance reason, and ended itself (exit 1) before cleanup; traffic was 1,169,625 bytes. This is an
advisory post-report stop, not a hard spending cap. Only owned disposable state/login copies were removed after
confirmed process exit. No human services, live state or network mappings changed.

Usage accounting reads the outside capture journal, includes Claude sidechains, deduplicates mirrored provider
message IDs and durable replay, and distinguishes reset Codex capture generations. Retired sessions remain in
private accounting until fully drained; completed captures are skipped durably. Usage parsing is independent of
chat projection and never reads terminal screens. Regression coverage was added for GitHub only. Three scoped
review rounds fixed omitted sidechain usage, malformed JSON handling and reset identity aliasing; the last found
no remaining findings. Local typecheck passed; branch CI pending for this slice. UI lifecycle remains unfinished.

Internal Autopilot stop/keep-workers lifecycle now revokes authority before awaiting core cleanup. It persists
private terminal identity in the capture journal, includes retired launches, refuses changed PIDs, and retries
uncertain/offline cleanup after reconnect. Missing terminals are not claimed dead. Keep-workers retains only
workers/reviewers; a later default stop tightens it. Limit failure also triggers cleanup. No unrestricted
coordinator is launched by fallback, restart or cleanup while its contained profile remains recorded.

A real contained Claude coordinator (`t1z`) created an actual scratch child (`t20`). Keep-workers ended the
coordinator, retained the privately bound live child beyond cleanup, and restored regular mode metadata. Default
stop then ended the child and confirmed stopped, with 674,776 encrypted bytes. All owned processes were confirmed
ended before scratch state/login copies were removed. This checks the internal lifecycle, not its unfinished UI,
regular coordinator replacement, wake scheduling or SSH. Scoped fresh review: two rounds; one major pending-card
revocation race fixed by synchronous denial and a post-answer private-actor recheck; final round no findings.
New offline/retired-process/identity/keep-workers regressions are for GitHub only; local typecheck passed.
Usage commit 5d19cfb8 passed both GitHub jobs (40999359491).

Autopilot now connects the existing mode switch, checklist editor, scoped agent/access/limit settings and Run now
to core. Starting snapshots the validated profile, replaces only the explicit coordinator and retains chat/progress.
Turning off waits for owned containment cleanup before explicitly starting a regular coordinator. Retained workers
can restart in their old contained profile without creating an unrestricted parent. Wake requests persist per run
and exact coordinator launch, wait for idle, coalesce, retain news arriving in flight, and complete only after their
own native user receipt followed by turn-end. Interrupted deliveries are not repeated. Empty checklists skip provider
calls. A crash during startup is recorded as interrupted and cleaned up, never activated from labels.

Real phone-width manual proof on a new isolated repository space: the unchanged menu switch launched contained
Claude terminal t21, PID 968946, run d1bc517c-7ac8-4c95-b72a-a0f9a22bc846 and returned AUTOPILOT_UI_WAKE_OK.
Settings Run now produced a second reply and Last run Finished. An isolated server stop/start preserved the same
terminal/PID/private launch; another phone Run now produced a third reply and Finished, with 114,096 cumulative
reported tokens. Files remained unchanged. The checklist and normal Autopilot badge/card were inspected at 390×844;
screenshots are in the task proof source, not git. This is local-core browser emulation, not physical phone or SSH.
The final switch-off check and branch CI are pending. Completion CLI, contained coordinator restart, full event
producers, SSH Git and full parity remain unfinished.

Scoped review: three rounds, startup-crash major and empty-checklist/inherited-model minors fixed; last round no
must-fix findings. Regression coverage includes durable wakes, no duplicate uncertain delivery, own-turn completion,
empty checklist, follow-up news, inherited Codex models and interrupted startup. Only typecheck ran locally and passed.
Lifecycle stop commit 16f57a92 passed both GitHub jobs (40999607762).

The phone switch-off check completed: old contained t21 ended, a fresh normal coordinator t22/PID 1002208 started
with no pilot binding, and the existing off card/menu appeared. The scratch repository stayed clean. Autopilot
mode/settings/wake commit c2c7ab53 passed both GitHub jobs (41000321920). Proof artifact hf2s v12 includes phone
screenshots and the real lifecycle evidence; its light/dark checks were inspected.

Contained coordinator Restart now revokes only its old coordinator actor/cards, keeps worker bindings, elapsed
run time and cumulative allowances, and binds a fresh contained coordinator in the same run. A preparation/start
failure leaves workers contained and records a retryable coordinator error. Restart choices validate before effects;
saved Autopilot preferences commit atomically only after successful launch. Recent chat is history, not a new request.
A real native run created child t24/PID 1049667, replaced coordinator t23 with t25 and confirmed the unchanged live
child/private run, then received CONTAINED_RESTART_COORD_OK. Traffic was 1,540,197 bytes after replacement and
1,554,112 after subsequent keep-workers and full stop; all owned processes ended before private state/login copies
and scratch worktrees were removed. This is an actual internal local-core check, not SSH or physical-device proof.
Scoped review first round found no must-fix and one atomic-preference minor, now fixed. Regression coverage for
replacement ownership, unchanged limits, failed preparation and atomic preferences is for GitHub only.
Restart review round 2 found no remaining findings; local typecheck passed. Failed-preparation coverage is queued
for GitHub and does not claim a real provider failure was induced locally.

Authenticated coordinator `complete "goal evidence"` now saves a durable completion intent and progress before
revoking the run. Recovery performs owned cleanup and one explicit regular replacement; uncertain starts surface
instead of repeating. Both the queue and mode-change boundary check exact saved run lineage, including newer
retained-worker runs which are deliberately absent from current(). An old completion cannot stop those workers.

A real contained Claude coordinator t26 invoked complete through its native tool and authenticated core mailbox.
The app saved GOAL_EVIDENCE_OK: scratch project untouched, ended t26, recorded its run stopped and launched fresh
normal t27. Traffic was 578,162 bytes. Both owned processes were confirmed ended before disposable state, native
login copies and the scratch repository were removed. No live state/services/network mapping changed. This is
internal local-core acceptance, not physical-device or SSH proof. Scoped review: two rounds; one major older-intent/
newer-retained-worker recovery bug fixed, final round no findings. Added GitHub-only coverage for intent-first
revocation, actor identity, durable single replacement, unconfirmed starts and retained-worker lineage. Local
typecheck passed. Restart commit 2447b860 passed both GitHub jobs (41000687252).

Checked Git now has a lazy SSH account adapter, separate from the core-only agent/mailbox transport. A fixed private
wrapper accepts only standard Git services and validated destinations. It preserves ordinary aliases/static account
paths/literal jump hosts and native Include scoping, rejects host-command callbacks across all include branches,
keeps keys/sockets outside runtimes, strips unrelated environment, and disables forwarding/control sockets/prompts.
Local and HTTPS Git never parse SSH configuration. Static/dynamic/custom-program support limits are explicit in
start.md and generated access instructions; they are not silently treated as full configuration parity.

A harmless actual native OpenSSH check used a disposable server bound to 127.0.0.1:17955, temporary host/account keys,
a forced Git-only account command and isolated repository/home. Through pilotGitCommand, SSH alias authentication,
push and ls-remote matched head 8d85590b1f2df343392c499508351af24743d1ca (CHECKED_SSH_GIT_PUSH_OK). The server ended,
port was confirmed closed, and all disposable keys/files were removed. Two setup attempts first refused auth because
the remote URL selected git instead of the temporary exedev account; using the configured account resolved it.
No existing SSH config, live service, agents, live state or Tailscale mapping changed. This proves loopback repository
SSH transport, not real Mac/core remote acceptance. The separate Mac SSH connection remains unverified.

Scoped SSH review: three rounds, no concrete findings. Added GitHub-only checks cover native ssh -G alias/include
resolution, service/path injection, inactive callbacks, writable account/config paths, fixed-wrapper selection,
unrelated environment removal and cleanup. Only local typecheck ran and passed. Completion d629d4ee passed both
GitHub jobs (41000938111). Remaining lifecycle audit includes waiting for already accepted task mutations during
stop; complete parity, dynamic SSH account profiles, real external SSH, physical-device and voice acceptance remain.
SSH commit 34a6ccf6 passed layouts and 298 core checks but failed the native ProxyJump assertion (41002042608).
The generated profile quoted this raw-remainder option; OpenSSH retained those quotes as part of its value. Rendering
only the already validated literal comma-separated jump list without added quotes corrects the actual adapter, rather
than weakening the test. Direct authenticated loopback SSH remains proven; jump-network acceptance is not claimed.

Human mode-off and automatic limit/start failure now persist the same scoped return intent used for goal completion.
A crash between cleanup and regular launch no longer leaves an off chat with an unusable contained record. Recovery
preserves keep-workers, permits a later explicit default stop only to tighten it, waits while offline/cleanup remains
known pending, and never repeats an unconfirmed normal launch. Cleanup runs before the return processor so retained
workers cannot starve recovery. Human messages wait through the change and retry after confirmed return.
Default stop also waits accepted task mutation locks and rechecks newly recorded launches before claiming stopped.
A successful retry clears only its temporary warning, preserving a distinct original limit reason.

Real isolated reconstruction check: Claude coordinator t28 created child t29/PID 1406103. A keep-workers return was
saved, then only that disposable app instance was drained/closed and reconstructed with the same private state/core.
Recovery launched fresh regular t2b and confirmed the retained child live with unchanged PID, run and private actor.
A final default stop ended the child; regular t2b was explicitly killed and separately confirmed finished before state
cleanup. All disposable native login copies/worktrees were removed (DURABLE_KEEP_WORKERS_RETURN_OK). No human/live
installation, agent or service changed. This is local-core acceptance, not an external SSH/physical-device claim.
Scoped review: two rounds, no must-fix; stale recovery-warning minor fixed and covered. New regressions cover mutation
drain, saved keep-workers recovery, offline waits, tightening and warning cleanup. Only typecheck ran locally and
passed. SSH syntax correction e9a512ca passed both GitHub jobs (41002281238).

### Real SSH transport check (2026-10-30)

- HEAD `257826f2`: branch GitHub run `41002731923` passed both core and layout jobs. This includes durable human mode-off/limit returns and mutation-drain regression coverage; no local test suite was run.
- A disposable foreground native OpenSSH daemon bound only to `127.0.0.1:17956`, with temporary account/host keys and pinned known-hosts, carried the documented core `machine add --via 'ssh …' --session she301ssh --temp` connection. Both ends used pinned core 0.1.14, generation 1. No installation, live service, Tailscale mapping, legacy state or human task changed.
- Actual core API calls over that connection passed `machine.exec`, `file.read`, document CAS/get and the combined remote document event. Remote child `ssh-proof/t2` retained its live PID after parent `ssh-proof/t1` ended (`CORE_REAL_SSH_LOOPBACK_OK`). The first probe used an incorrectly qualified remote parent; the corrected probe used the destination-local parent ID, as the product launcher already does.
- Both probe terminals were confirmed finished; the temporary machine alias, isolated remote core, foreground SSH daemon, keys and state were removed. This proves the actual SSH byte transport and core routing on one physical host. It does **not** prove external-host provisioning/reconnection, native agent execution across an external SSH link, or physical-phone/lock-screen acceptance. The separately attempted Mac SSH connection still times out on port 22.

### Explicit task resume after a contained stop

- `task start ID [MESSAGE]` is now an explicit authenticated coordinator operation. A new contained run can discover/read its own space’s earlier tasks, but must explicitly adopt an earlier contained task before changing it. Adoption requires the old private run stopped and every current/retired recorded worker/reviewer confirmed finished on a connected machine. Retained workers, unknown exits and other-space mutations are refused.
- Reprofiling preserves the task’s worktree, uncommitted files and review requirement, snapshots the new run’s agent/reviewer and required merge approval, invalidates stale ready approvals and launches a fresh native session. Explicit regular-coordinator start can resume a fully stopped contained task with regular access; background recovery never does that. Dependency and machine/run capacity gates still apply.
- Real native Claude check: the first contained coordinator created PILT-1 and its child wrote an unfinished file. After the old private run stopped, a new contained coordinator used the actual authenticated CLI to list/show/start that task. Worker `t2d` became fresh worker `t2g`, returned `RESUMED_CONTAINED_WORK_OK`, retained the same worktree and unchanged uncommitted file (`NATIVE_CONTAINED_TASK_RESUME_OK`). Both runs’ owned processes were confirmed finished before temporary state/worktree cleanup.
- Fresh scoped review round 1 found no critical/major findings. Local typecheck passed; regression suites run only on GitHub. Existing ordinary tasks still need a checked worktree relocation before contained adoption, because their old helper-state worktrees cannot be mounted into the namespace. Human UI restart after a stopped run and complete CLI parity remain unfinished; this scoped CLI proof is not full task lifecycle acceptance.

### Artifacts in contained sessions

- Contained coordinators/workers can now create, check, update, list, show and remove artifacts in their own space. Reviewers can list/show only. Publication still rechecks the private run actor, current grant and live launch after browser validation.
- Artifact inputs travel through documented core exec into a fresh networkless read-only namespace with only the registered repository/worktree and immutable exported files available. No host-read fallback exists. Real-path scope checks, nonblocking/no-follow opens, regular-file/single-link validation and 2 MiB reads cover symlink/shared-file escapes and file growth. The reader starts from its fixed helper directory, so mutable project Bun preloads cannot execute.
- Phone screenshots, exported HTML and JSON are written into private immutable runtime control storage and returned as `/run/shepherdr/artifacts/...` paths that the contained native agent can actually read. Provider credentials/private app state are not mounted into the reader. The immutable remote helper bundle includes this broker.
- Real authenticated native Claude `t2h` published artifact `cd022aa0` with the actual browser checker, used list/show and acknowledged reading the exported files (`NATIVE_CONTAINED_ARTIFACT_OK`). The light/dark phone screenshots were also inspected by the task agent. Own native process/state were cleaned up. Full contained artifact update/delete/notes/large-file and remote-SSH acceptance remain unproven.
- Fresh scoped review round 1 found no critical/major findings. Regression coverage includes 2 MiB exports, invalid encoding and private-directory symlinks; real namespace read/escape/hardlink/project-preload checks run on GitHub where unprivileged namespaces are available and explicitly skip otherwise. No local test suite was run.

### Human task Restart and browser cleanup race

- Task Restart now revokes the old mailbox grant/permission cards, checks exact process identity and waits for confirmed exit before replacement. Disconnected/unknown/changed processes refuse a replacement. Explicit Restart can reopen a fully stopped contained task as a fresh regular native session; active/retained contained workers keep their private run. An unsupported regular-to-contained transition refuses before killing the healthy old worker. New profile transitions invalidate stale ready approval.
- Shared-browser phone inspection reproduced a real cleanup race: after the browser acknowledged close and ended its core attach, Restart dereferenced the cleared stream and showed `hub.stream.close` as an error. Cleanup now tolerates that already-ended attach; the CI regression acknowledges close and immediately closes the stream before the promise resumes.
- The same real phone-width task Restart then succeeded: old `probe/t9` PID 1517674 confirmed finished, replacement `probe/t1g` PID 1643871 replied `TASK_RESTART_UI_OK`. Existing uncommitted `panel-check.txt` still contained `PANEL_DIFF_OK` and remained untracked. A premature ready attempt was refused by the existing review gate; the agent returned To do. Screenshots captured/viewed before and after. This remains same-host remote-core, not external SSH or physical-phone proof.
- Inspection also found that To-do restart incorrectly included a `<go>` while telling the task to wait. Restarts now send go only for Working tasks; queued/To-do/Ready sessions retain an explicit wait instruction. A fresh phone-width Restart confirmed the correction: replacement `probe/t1k` PID 1661781 returned To do, explicitly waited for go and noted the untouched untracked file. Core exec again confirmed `panel-check.txt` contained `PANEL_DIFF_OK`; the screenshot was captured/viewed.
- Scoped review: three rounds, no critical/major findings; one minor preflight ordering finding fixed. Only typecheck ran locally. Full rewrite/task lifecycle parity remains unfinished, including checked relocation/adoption of existing ordinary worktrees.

### Adopting an existing ordinary task

- An authenticated contained coordinator can now explicitly `task start` an earlier ordinary task after its recorded worker/reviewer exits are confirmed. The product closes its browser and uses checked Git to move its registered worktree out of helper/app state into an installation-owned cache path. The branch, uncommitted files, review requirement and history stay with the task. Display names cannot choose the destination path.
- A private journal precedes the move. The machine-local helper takes a private `flock`, checks the actual Git registration and conditionally moves only the expected source. Repeating an identical request after a lost response checks the already-registered destination instead of moving again. No unlocked fallback or overwrite exists. The app changes its authoritative folder only after checked destination/head verification. An uncertain reply retains both paths and the journal; retry reconciles them after the bounded wait.
- Private run ownership is claimed before awaiting cleanup/move, so stop observes in-flight mutations. The run and coordinator actor are rechecked before launching. Stop can finish an already-accepted move while preventing any fresh contained worker. Human UI regular-to-contained Restart still refuses before killing its old worker; explicit coordinator start is the connected adoption entry.
- Real native check after the locking helper: an ordinary task and its native holders were created through the actual product, holders stopped, and an unfinished scratch file added. A fresh contained coordinator used list/show/start; worker `t2x` read the relocated file and replied `ORDINARY_ADOPTED_WORK_OK` (`NATIVE_ORDINARY_TASK_ADOPTION_OK`). The old helper worktree was gone, the uncommitted bytes were unchanged and the task used the new private run. All owned processes ended before temporary files/state/cache cleanup. This is local-core proof, not external SSH.
- Two scoped fresh review rounds found no critical/major findings. Local typecheck passed. GitHub regression cases cover real checked Git relocation, exact duplicate helper requests and lost-response reconciliation; stop/in-flight capacity coverage was added. Full lifecycle and full rewrite parity remain unfinished.

### Per-task command settings

- `task add` restores the existing `--desc` brief alias, reviewer/model/effort flags and repeated `--set` task settings, including legacy short/key aliases and precedence. Bare/unknown flags, unknown one-task keys and invalid values refuse instead of silently disappearing. Review rounds accept the existing numeric/unit forms and remain 1–10.
- Each task snapshots its selected native harness/reviewer and review/merge rules; the prompt names explicit coordinator overrides. Scoped defaults remain unchanged. Contained runs still require their approved harness/reviewer profile and cannot relax required human merge approval; explicit `default` model/effort is normalized before comparing with the run. Changing a task’s access profile clears obsolete harness-origin labels.
- Real authenticated contained Claude coordinator used `--desc`, `--reviewer codex`, `--reviewer-model default` and `--set` review/mustFix/rounds/merge/agent options. Native child `t2z` replied `PER_TASK_OPTIONS_OK` while To do. The saved task had review off, critical, one round, and still required human merge approval despite the requested task-level automatic merge (`NATIVE_TASK_OPTIONS_OK`). Space defaults remained review on/three rounds. Own processes/state/worktree were cleaned up.
- Fresh scoped review found no critical/major findings; local typecheck passed. Prior adoption branch CI `41004728222` passed core/layout, including stop/in-flight capacity, real Git move and duplicate/lost-response cases. Its earlier fixture failure was fixed by initializing the private app home before placing worktrees in it. Artifact namespace-escape CI remains explicitly skipped where unprivileged namespaces are unavailable; actual native artifact publication was separately checked. Full CLI/settings parity remains unfinished.

- Phone-width follow-through for per-task options: the real second-core coordinator created `probe/REMO-7` using `--desc`, reviewer/default flags and review/mustFix/rounds/merge overrides. Its native child `probe/t1n` PID 1873268 read the familiar brief/settings block, returned `TASK_OPTIONS_PHONE_OK` and stayed To do. The coordinator verified `OPTIONS_SAVED_PHONE_OK`. The phone screenshot was captured/viewed. This is real core transport on a second session of the same host, not external SSH or physical-device evidence.

### Confirmed task Stop and retired children

- Authenticated `task stop` cancels persisted deliveries, revokes task/reviewer grants and denies old permission cards before cleanup. It waits for connected, exact private process identities and their actual core descendants, including outlive-parent children from earlier task launches. Caller-supplied labels never establish ownership. Close/delete and ordinary-to-contained adoption share this checked cleanup; uncertain cleanup preserves files. Browser relay cleanup also requires its saved identity and confirmed exit.
- All native launches now retain a private launch history before submission and after confirmation, including ordinary task restarts. This lets cleanup find children left by retired roots. Reconciliation seeds current existing preview records; this is not a legacy-data import or label-only reconstruction.
- Real phone-width check: REMO-7 root `probe/t1n` PID 1873268 had an actual outlive-parent child `probe/t1p` PID 2024843. Human Restart ended the old root and launched `probe/t1s` PID 2029843, while the child remained live. The coordinator then used the authenticated Stop command. Its first attempt reproduced a reducer bug: the app cleared a finished root’s PID, unlike pinned core’s finished-event contract. Files remained untouched. The corrected reducer preserves finished identity and still clears a lost holder’s PID.
- The same Stop retry succeeded (`TASK_STOP_PHONE_OK`). Core confirmed both replacement root and old child finished with reason `killed`, before the child’s sleep deadline. Unrelated REMO-2 root `probe/t1k` stayed live with PID 1661781; its uncommitted file still contained `PANEL_DIFF_OK`. The phone screenshot was captured and inspected. This is a second same-host core session, not external-host or physical-phone evidence.
- Stop scoped review: three rounds, three major findings fixed (label-only ownership, queued deliveries without a native root, and retired ordinary roots). Final round had no remaining critical/major. A separate finished-event reducer review found no findings. Regression coverage includes real framed finished/lost events, retired roots/children, unrelated copied labels, queued cancellation, unknown identities and browser-close acknowledgement races. Local typecheck passed; suites run only on GitHub. Full lifecycle/CLI and complete rewrite parity remain unfinished.

### Task command controls

- Restored coordinator-only CLI pause, pin/unpin, archive/unarchive, close and delete through the existing task controls. Workers/reviewers cannot invoke these coordinator controls. Contained coordinators still need private ownership of the target; task listing remains readable for discovering earlier work, with separate archived results and explicit space/machine scope enforcement.
- Archive now waits for confirmed private root/descendant/browser cleanup before hiding the task. Pinning preserves workflow, archiving removes the pin, unarchiving restores list visibility, and pause interrupts rather than kills a live worker. Destructive deletion still refuses held work unless explicitly forced.
- Real second-core coordinator ran pin, archive, archived list, unarchive, pin, unpin, pause and show for the stopped REMO-7 fixture, returning TASK_CONTROLS_PHONE_OK. No files or other tasks changed. This proves these commands for a stopped task, not pause during active native work or destructive deletion acceptance.
- Fresh scoped review found no critical/major findings; local typecheck passed. Stop CI 41006485877 passed layout but found two fixture errors: an older deletion fixture had no connected/identified terminal, and a launch-history assertion expected an undefined property omitted by JSON serialization. Fixtures now model the required identity/connectivity and separately assert the actual ordinary-history fields. No product guard was relaxed. GitHub rerun remains required; no local suites ran.

### Clean task Close and retained work

- Closing a clean task now removes its registered worktree and base-contained branch after confirmed process cleanup, while retaining the Done record, chat, optional validated summary and facts. Branch removal uses its checked exact head. Held files/commits remain intact even when the human confirms Close; force-close is not force-delete. Work is rechecked after shutdown and a late write asks for confirmation again.
- Close/delete/archive pass their final browser-forget intent through the one tracked cleanup relay. They no longer launch a second cleanup relay after the confirmed Stop pass.
- Real phone-width coordinator closed disposable REMO-8 with summary/facts, returning CLEAN_CLOSE_PHONE_OK and kept=[]. Core exec independently confirmed the worktree and branch absent (CLEAN_CLOSE_FILES_CONFIRMED); native probe/t21 PID 2131851 was finished/killed. The Done card/chat remained. Screenshot captured/inspected. Unfinished REMO-2 was not changed.
- REMO-7 pause follow-through retained native probe/t1z PID 2105922. It received the later message, returned AFTER_PAUSE_SAME_AGENT_OK and marked To do. Its original wait had moved into a background job before Pause, so this does not prove interrupting an active foreground tool. It cancelled its own background wait afterward. A stale jobs row after native TaskStop was observed and remains to fix.
- Two fresh close review rounds: one minor late-write confirmation finding fixed; no remaining findings. Local typecheck passed. GitHub a30bc7d8 found one older merge-race fixture that expected a worker to close a task; that operation now correctly refuses coordinator-only. The regression now uses a separately authenticated coordinator for Close while still checking worker queue/status mutation gates. Remaining assertions passed (322); final branch CI is required. No local suite was run.

### Native background-job cancellation

- Actual REMO-7 Claude TaskStop input named its pending background shell, and its successful structured native result confirmed that same task ID stopped. The reader previously only ended jobs from completion notifications, leaving this cancelled job visible indefinitely.
- The reader now correlates each TaskStop call with its result and ends only that job on a matching successful structured response without a tool error. Failed and mismatched results leave the job alone. This uses native log records, never terminal-screen text.
- Re-reading the same real task log after the fix produced jobs=[] while retaining AFTER_PAUSE_SAME_AGENT_OK and the same live native process. Fresh scoped review found no findings; local typecheck passed. GitHub coverage includes successful cancellation, failed cancellation, mismatched target and final activity state. The earlier stale-row observation is resolved; foreground interruption remains unproven.

### Core notices in chat

- Phone inspection showed native core `<hc>` exit/read instructions as blue human messages after task Restart/Close. They are internal notifications rather than human input. The native-log adapter now filters that envelope alongside existing internal product tags. Historical native notices are filtered at read time; optimistic human messages with a distinct native-source ID and actual agent replies remain visible. This is presentation only and grants no authority.
- The same real coordinator chat after restarting only the isolated preview retained CLEAN_CLOSE_PHONE_OK and its Done card without the raw core-notice bubble. Before/after phone screenshots were captured and inspected. Fresh scoped review found no findings; local typecheck passed. Regression cases cover new ingestion and previously recorded native notices versus human/agent messages. No local suites ran.

### Failed and stalled task news

- Automation and Autopilot news scanning now distinguishes a confirmed failed native exit or recorded setup failure from an ordinary needs-you transition. Busy, archived and disconnected tasks are excluded. Private failure fingerprints survive app reconstruction; each accepted setup/native launch has its own attempt identity, so identical errors on a later explicit attempt are fresh news. Launch errors are retained for all managed launch paths.
- Native hooks/log events retain monotonic bounded activity timestamps; task reports retain their actual report time. Working tasks can emit stalled news once after 20 quiet minutes or when past the legacy estimate allowance. New activity or a fresh estimate re-arms the relevant condition. Quietness is advisory news, never process-exit proof or automatic task completion. Seen state and queued rules are saved in the same transaction.
- Real second-core coordinator saved a title-filtered failed rule and attempted disposable REMO-9 against an intentionally nonexistent base. The expected setup failure produced exactly one rule run and real handler REMO-10, which returned FAILED_EVENT_TASK_OK and To do. The coordinator verified FAILED_EVENT_ONCE_OK and paused that rule. No repository content changed. Phone screenshot captured/inspected. A separate actual 20-minute quiet check is in progress; quiet timing, new-event Autopilot wake, main-red and complete event parity remain unproven.
- Two fresh scoped review rounds: one minor identical-retry dedup finding fixed; no remaining findings. Regression coverage includes confirmed failure/reconstruction, intentional To-do stops, offline exclusion, quiet/estimate re-arming and repeated setup attempts. Only typecheck ran locally; one invocation was terminated by SIGTERM and its retry passed. GitHub b4c1b703 passed core/layout (41007341261), covering prior lifecycle/Close/native-cancellation/chat-notice fixes. New event coverage awaits branch CI.
- Baseline clarification: legacy `server/live/autopilot-sandbox.ts` explicitly refuses non-Linux contained startup. The rewrite preserves that limit; ordinary macOS core/agent/health/device acceptance is separate and remains pending. No macOS containment capability is claimed or silently removed.

### Explicit GitHub repository routing

- Restored legacy GitHub remote forms, including SSH URLs/ports, enterprise-style GitHub hostnames, trailing `.git/`, and written origins rewritten through Git `insteadOf`. This uses only core exec and a pure parser, with no legacy worker/SSH module dependency.
- A successful remote-list query must establish that origin is absent before choosing local repository behavior. If origin exists, URL/config read failures propagate and never silently select a local merge. PR view/create/merge name the explicit host/owner/repository so CLI defaults cannot choose a different host.
- Real read-only lookup through the isolated core found github.localhost/eliasstravik/shepherdr, then GitHub CLI returned that exact repository (CORE_GITHUB_HOST_ROUTING_OK). No PR was created or merged and no Git ref changed. Enterprise network access and actual PR creation/merge acceptance remain unproven.
- Fresh scoped review found no findings; local typecheck passed. New regression cases cover URL forms, rewritten/written precedence, explicit PR routing and core-read failure refusal. GitHub runs the suites; no local suite ran.

### Base-branch GitHub failure news

- Added a core-only read-only GitHub watcher for repositories with a GitHub task merge in the last three hours, or an unresolved red incident. It checks the explicit current base head, its push workflows, and the head again before publishing. No fetch, pull, merge or ref update occurs during observation. Polls are serialized and bounded to two repositories per pass, at least one minute apart per repository.
- Missing, pending, unknown, cancelled or full/truncated workflow sets never clear red. A confirmed failure saves one incident, the familiar red card and matching automation/Autopilot rule events atomically. Green re-arms later red news. API errors retain the last red state and a private error record. Failed publication transactions retain retryability.
- Regular coordinator news waits in a private outbox for a live idle regular session; transport acceptance is not claimed as completed work. Waiting notices bind repository/machine/base/head/incident and are discarded when those change or green supersedes them. Contained mode uses its existing configured news/checklist pipeline. Internal GitHub/news envelopes stay out of human chat bubbles.
- A real read-only snapshot through isolated core exec and authenticated GitHub CLI read legacy main ebb17d585c82906b788a8473237921802920b5c5 and its failed Check (CORE_GITHUB_MAIN_SNAPSHOT_OK). Existing baseline run 40916895905 has types/build passing and all three test shards failing; it predates this rewrite. Main/live legacy/ref state was not modified. This proves actual API reading, not a complete native alert/automation/Autopilot delivery run; those remain pending.
- Two fresh scoped review rounds: two minor findings fixed (cancelled workflows mixed with success, and stale waiting notices after base changes); no remaining findings. Local typecheck passed. CI regressions cover verdicts, restart dedup, green re-arm, API failure, stale head/space/base, idle delivery and transaction rollback. Prior failed/stalled event CI cf20779b passed (41007845454); GitHub-routing CI 4c775497 passed (41008123146). This new observer awaits branch CI. No local suites ran.

GitHub observer CI 41008525460 passed layout and found one fixture error: mutating the space’s base also mutated the fixture’s supposed historical merged-task base. The fixture now keeps that saved task base fixed. Event title filters also retain their task-title meaning: a known exact merged task supplies its name; unknown causes do not substitute workflow names. A regression covers both. Full commit-range attribution is still pending.


### Ready-task GitHub follow-up

- Ready tasks now observe published PR reviews, line comments, issue comments and failed checks through their own machine’s core exec and explicit GitHub host. Pending reviews and lines without confirmed published review metadata are withheld. Private per-ready-attempt observations and launch-bound outbox records prevent restart duplicates or delivery to a replacement actor. New work clears stale Ready/approval through the normal capacity-aware delivery path; a checks-ready reminder preserves Ready and never grants merge approval.
- Native notices contain bounded excerpts. Authenticated `checks ID --comments` returns one comment in UTF-8-safe 8192-byte pieces: repeat the same `--offset` with returned `--from nextFrom`, then use returned `next` for the following comment. Each response fits the actual 128 KiB sealed mailbox envelope even with Unicode and JSON escaping. The task’s actor/ownership is checked again after GitHub reads. No terminal-screen scraping is used.
- Read-only real core/GitHub checks fetched all three published-comment endpoints for existing PR 506 and decoded one existing published issue comment on PR 451 (CORE_GITHUB_COMMENTS_READ_OK). No comment, PR or merge was created. This proves API routing/decoding, not native follow-up delivery or published line/review end-to-end acceptance; those remain unproven.
- Three scoped fresh review rounds: two minor findings fixed (unconfirmed linked-review publication and full-comment mailbox size); final round found none. Local typecheck passed. Regression coverage includes native-work versus reminder delivery, publication timestamps, pending/missing reviews, restart dedup, changed actors, failed checks, policy gating and sealed-envelope Unicode reconstruction. Suites run on GitHub only. Prior main-observer CI a16c036c passed core/layout (41008726101). Full GitHub/lifecycle and rewrite parity remain unfinished.


- Actual quiet-rule follow-through: REMO-11 ran its own background sleep 1300 without polling/progress. At 05:40:41 UTC, after 20 quiet minutes, the title-filtered stalled rule created exactly one REMO-12, queued behind the one-task limit. The original job ended naturally and replied QUIET_WAIT_FINISHED at 05:41:23; the real native handler then replied STALLED_EVENT_TASK_OK and returned To do. The coordinator confirmed STALLED_EVENT_ONCE_OK, one linked run, and paused only that rule. Both phone-width screenshots were captured/inspected and added to proof hf2s v17 (light/dark checks inspected). No fake clock, forced completion or repository content change. New-event Autopilot and full event parity remain unproven.
- Ready-task PR-follow-up CI 41009821166 passed core/layout at 61eb83a1. No local suites ran.


### Confirmed regular coordinator Restart

- Regular Restart now validates the harness/model/effort before stopping anything and joins the same per-space lifecycle gate used for mode transitions. Pending sends wait behind that gate; shutdown drains it. Old mailbox authority and permission cards are revoked before termination. A replacement starts only after the connected old process reports finished with the same address, PID and creation time; unknown/lost/changed identity refuses. Saved defaults update only after successful replacement.
- Only the coordinator root is stopped. Real phone-width Restart ended probe/t19 PID 2452209 at 1793339032951; core created probe/t26 PID 2675146 at 1793339033366. Its later human message received COORDINATOR_RESTART_PHONE_OK. Existing child probe/t1k kept PID 1661781, live, parent probe/t19 and outlive-parent enabled. Screenshot captured/inspected. No human session or live installation was touched.
- Fresh scoped review found no findings. Local typecheck passed after correcting an optional-property fixture type. Regression cases cover delayed exact exit, concurrent restart, lifecycle drain, task-child survival, validation/offline preflight, changed finished identity, lost state, shutdown and failed-launch settings preservation. GitHub runs the suites; no local suite ran.


- Task Restart now applies the same exact-exit checks to its own root, including an already-finished holder. Harness/model/effort validation happens before revocation or kill. Defaults save only after successful native launch, not a failed/deferred start. Fresh scoped review found no findings; local typecheck passed. Added CI cases cover invalid-model preservation, substituted finished PID, failed native start and successful To-do restart. Earlier actual Restart/work-preservation evidence remains above; changed-identity cases use CI fakes, not live process manipulation.


### External-machine acceptance target

- Elias explicitly selected vm-ssa, with isolated test directory/private core state and harmless test agents only; existing agents/services/configuration must remain untouched. He explicitly instructed skipping access/setup blockers and continuing the build. No substitute machine or legacy transport is authorized.
- This environment’s `herdr machine list --json` returned [], SSH config is empty, Tailscale has no vm-ssa peer, saved legacy remote-machine records provide no target, and `ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=yes vm-ssa true` failed: Could not resolve hostname vm-ssa. The documented exe.dev machine-list lookup (`ssh exe.dev ls --json`) failed strict host verification because this environment has no trusted exe.dev RSA host key. `ssh-add -l` also reported no identities. No host keys, credentials, machine settings or access configuration were added or guessed.
- External-machine lifecycle/reconnect/mailbox acceptance is skipped and remains unverified. No resource was created on vm-ssa. Earlier same-host two-core and loopback-SSH evidence remains separate; it is not external-machine evidence. Continue independent implementation/verification without waiting for SSH access.


### Research completion and deferred finished-task cleanup

- A clean branch with no commits ahead of its saved base now reports Done directly from ready, retaining summary/facts without requiring a code review or merge card. Done tasks reject Todo, Pause, launch, Restart and new work delivery; follow-up work belongs with the coordinator.
- New research/merged completions persist cleanup intent. A worker command returns an unpredictable private completion receipt bound to that exact launch. The native reader must capture that receipt and a later turn-end in byte order before automatic cleanup may stop a live holder; hook idle alone is insufficient. Pending reader reconstruction/reset cannot count a historical turn end. Coordinator-reported completion without a worker receipt only auto-cleans an already-finished root. An uncertain capture retains the running holder/work instead of guessing.
- Cleanup then confirms all private roots/descendants/browser exits and rechecks actual Git work. It removes only clean base-contained branches or the exact recorded squash head whose merge is still in the base. Late changes/commits are retained and reported. Another live core terminal using the checkout prevents removal. Ref-query failure is no longer confused with branch absence. Errors retain pending state and retry at most once per minute; completion records/chat stay visible.
- Real second-core native Claude task REMO-13 used default review-on settings, called ready with no file changes, and replied RESEARCH_DONE_REPLY_OK after the command returned. Its Done card, summary/facts and final native reply were inspected at phone width. Core confirmed probe/t27 PID 2820018 finished/killed; independent core exec confirmed the worktree and branch absent (RESEARCH_CLEANUP_FILES_CONFIRMED). No files were edited or commits/merges made. This proves ordinary native no-code completion, not contained final-capture timing or external-machine acceptance.
- Three scoped fresh review rounds: two majors fixed (Stop-before-final-capture race and Done→Todo/Pause resurrection); final round had no critical/major findings. Local typecheck passed. CI cases cover actual reader receipt/turn ordering and reconstruction, real Git research/squash cleanup, late writes/commits, other holders, failed ref reads/retry and Done mutation guards. Suites run on GitHub only. Task-restart CI 41010229238 found one older fixture missing its required native kind; fixture fixed, rerun 41010462018 passed. Full rewrite and lifecycle parity remain unfinished.


### Reversible space controls

- Restored CLI add with --name, display rename, set base and remove, plus the existing sidebar space-remove action. Removal hides a private saved record rather than deleting its identity, files, task/chat/settings history or base. Re-add of the same repository restores that record. Canonical names and saved display aliases remain reserved across active/removed records; commands resolve aliases to stable IDs on the authenticated machine. New tasks use a newly selected base; existing task bases do not change.
- Removal shares the coordinator lifecycle gate, revokes its authority and confirms that root’s exact exit. Home spaces, current work/task mutations, live or uncertain private historical task roots/actual core descendants, and active or retained containment prevent removal. No child or unrelated process is killed by these refusal checks. Task creation/start/queue delivery and timed/queued rules wait/refuse while removal is underway or the space is hidden. Hidden spaces stop product commands and attention/list entries while retaining history. Re-add does not silently restart a coordinator without a pending human request.
- Real second-core coordinator added an owned scratch repository, renamed it to space-control-renamed and selected alternate, returning SPACE_CONTROLS_SAVED_OK. Its own native coordinator probe/t29 PID 3040110 replied SPACE_COORDINATOR_OK in the phone-width chat. Remove returned SPACE_REMOVED_OK and core confirmed t29 finished/killed. Re-add returned the same ID p:59316df40a99cc9f92f773a8ecd4f35d:space-control-proof with its display name/base preserved. Core independently read unchanged seed.txt and the alternate branch (SPACE_READD_FILES_CONFIRMED); the old chat remained visible. Screenshots captured/inspected. This is same-host two-core proof, not external SSH.
- Three scoped review rounds: two minor findings fixed (saved aliases and outlive-parent task descendants), final round had no critical/major findings. Local typecheck passed. GitHub regressions cover reversible records/files/history, settings/base retention, renamed task/rule/checklist targeting, name reservation, active/home/containment refusal, late actor changes, uncertain exits, creation/removal races, historical task children and dormant automations. No local suite ran. Research completion CI 41010976697 passed at 08966f0b. Space-controls CI remains required; full rewrite parity is unfinished.


Space-controls branch CI 41011982746 passed layout and all product regressions except one fixture expecting a checklist without its deliberately retained trailing newline (369 passed). The expectation now includes that newline; rerun 41012223780 passed core/layout at cf1d0f4d. No product behavior was relaxed and no local suite ran.

### Authenticated home task overview and bounded reads

- The regular main-machine home coordinator can read visible tasks across machines; another machine’s home can read that machine’s tasks. Project/task actors stay within their saved machine/space. Private launch/grant/machine records establish this scope; labels, caller text and contained-home roles cannot grant a global overview. Read access does not grant mutation access. Exact full IDs resolve before short aliases within the readable scope; ambiguous numeric/short aliases refuse.
- Task lists return bounded summaries with a next-page cursor, never whole briefs. Large task details return UTF-8-safe chunks bound to a content revision; changed revisions refuse continuation. Chat returns bounded snippets with explicit truncation and older-message cursors. These bounds fit the real 128 KiB sealed mailbox envelope with Unicode/JSON escaping. Contained commands reuse the same bounded readers after their existing ownership checks.
- Actual second-core home Claude listed 13 tasks in one page, included probe/REMO-13 and excluded local CORE-1, replying REMOTE_HOME_OVERVIEW_OK. Phone-width screenshot captured and inspected. The older main-home Codex launch selected a legacy helper on its first attempt; its explicit preview-command retry is not yet confirmed. This is not a main-home acceptance pass. New launch routing and guide checks follow separately. No credential was borrowed or read.
- Two fresh scoped review rounds: one major fixed (local/remote short-ID collision); final round found none. Local typecheck passed. Added CI coverage checks scope/hidden records/stale actors/strict mutations, exact IDs, bounded list/chat paging and full Unicode detail reconstruction through actual seal/unseal functions. No local suites ran. Branch CI remains required; full rewrite parity is unfinished.

Overview CI 41013072691 passed layout and 375 regressions, finding one older assertion expecting an ownership refusal where the earlier private actor check now returns “no longer current.” The assertion now checks that precise authentication refusal. No product permission was relaxed; rerun is required.

### Launch-provisioned house and coordinator guides

- Ordinary coordinator starts now include the full house conventions and coordinator guide for both Claude Code and Codex, plus the saved project/home/main-home role and current authoritative command. Task/reviewer launches also receive house conventions before their explicit role restrictions. Isolated launches retain the fixed gateway, no host credentials/socket and no sandbox escape; read-only reviewers never request an escape to report.
- Product skills now describe authenticated core mailbox routing, private credential references, current-start path precedence, bounded overview reads and slash-qualified remote IDs. Secret documentation now describes the actual 2.1 capability/scope/encrypted-doc transport, reviewer refusal and restart behavior rather than the legacy worker/HTTP transport. Plugin guidance uses the existing API-2 migration document. No private instructions or secret values were copied into these public guides.
- Two fresh scoped review rounds: one minor guide mismatch fixed (unwired mode/set commands); final round found none. Automatic failure-stop and the remaining regular settings CLI are still delivery gaps, not removed scope. Local typecheck passed. New GitHub regressions inspect both native launch formats, role/house content, command precedence and Codex shell-policy credential reference. No local suite ran. Actual new-start command acceptance is in progress, not yet claimed.

### Autopilot failure-stop through its own gateway

- Added `mode regular --why REASON` to contained coordinators only, for their private current run. It cannot turn Autopilot on, target another space/run, retain workers or grant a worker/reviewer mode control. The existing durable return intent revokes the run before cleanup, stops only owned workers, preserves unfinished work and recovers reconnect/restart without repeating a fresh regular start. The reason is saved separately from goal evidence; saved progress/next steps survive and the fresh regular coordinator receives both.
- Real disposable contained Claude called the command with FAILURE_STOP_OK: harmless acceptance escalation. Core confirmed the old t31 ended, a different regular t32 became live, the run was stopped and no goal-completion evidence was recorded (CONTAINED_FAILURE_STOP_OK). Its owned agents and temporary state/repository were then cleaned up after exit confirmation. No suite, human agent, live service or file was touched. This proves a deliberate failure-stop command, not a natural repeated-failure policy judgement.
- Two fresh scoped review rounds: one minor handoff-loss finding fixed, final round found none. Local typecheck passed. Added CI cases for worker/forged actor refusal, cross-space controls, invalid flags/reasons, offline durable recovery, saved next steps and no false completion. Launch-guide CI 41013353947 passed core/layout at c88c6cda, also covering the overview assertion fix. No local suites ran. Full parity remains unfinished.

### Ordinary Codex reaches its own core socket

- Reproduced the main-home command failure in a harmless installed-Codex sandbox probe: a connect-only request to the isolated core socket returned ECONNREFUSED with command networking disabled; the same request returned OWN_CORE_SOCKET_REACHABLE with networking enabled. Neither probe sent a core action or changed files/services. The installed 0.163.0 sandbox CLI uses `codex sandbox --permission-profile NAME COMMAND`, rather than the older documented linux subcommand; its help and pinned primary config schema were inspected.
- Ordinary interactive Codex now launches with explicit workspace-write, on-request approvals and sandbox_workspace_write.network_access=true. This enables ordinary command networking as well as its required Unix socket; docs state that authority clearly. It is per-launch config, never a change to the human’s config or managed requirements. Native approvals/hooks remain enabled. Headless read-only reviewers and externally isolated/gateway agents do not receive the override.
- The same real main-home Codex acceptance, after phone-width Restart, completed its authenticated command and replied MAIN_HOME_OVERVIEW_OK, listing local CORE-1 and remote probe/REMO-13. The previous failure remains in the same retained chat. Phone screenshot captured/inspected. Current native holder t33 uses the newly provisioned command. This closes the main-home read acceptance gap; separate same-host remote-home Claude previously replied REMOTE_HOME_OVERVIEW_OK. It does not prove external-machine vm-ssa access.
- Fresh scoped review found no findings; local typecheck passed. CI assertions cover ordinary policy flags/approval retention and absence of the override in read-only reviewer launches. Failure-stop CI 41013701827 passed core/layout at 4ad4b4f6. No local suites ran. Full rewrite parity remains unfinished.

### Ordinary settings, models and explicit task alerts

- Restored ordinary authenticated show/models/set/unset/alert commands. Settings retain Everywhere → machine → space inheritance, explicit same-machine target resolution, validation and reset. Reads include keys/provenance and optional section selection; model reads use the selected machine’s catalog. Only current regular coordinators can mutate settings when the human asks. Private instruction bodies are never echoed. `set space.base` delegates to the existing checked space control; isolated profiles retain their separate policy. Heartbeat rule changes return plain schedule/event words. Task queue clear accepts none/nothing/- aliases.
- Main-home explicit task alerts can point at readable remote tasks without gaining task mutation authority. Current unanswered questions keep their safe notification choices/destination; stale grants cannot supply a button. Unknown/hidden/archived targets refuse. Reviewers cannot issue these alerts. Product plugin/Notify/push handling remains the existing path, with no second transport.
- Actual native main-home Codex set only the owned pilot-ui-proof archive override to nine days, read it back, listed Codex models, issued CORE_COMMAND_ALERT_OK for probe/REMO-13, then unset the override and read the inherited seven days. It replied CORE_COMMANDS_PHONE_OK; independent private-state read confirmed the override absent again. Phone screenshot captured/inspected. This proves command dispatch/acceptance, not physical lock-screen push delivery.
- Fresh scoped review found no findings. Local typecheck passed after correcting the internal permission-reader visibility. CI cases cover current/forged/stale roles, settings inheritance/scope, private-body exclusion, plain heartbeat words, remote alert targeting/current cards, stale-card exclusion and queue aliases. Codex socket-access CI 41014014552 passed core/layout at 70c59f5e. No local suites ran; full rewrite parity remains unfinished.

Common-command CI 41014476428 passed layout and 388 regressions but exposed a real alert gap: a current unanswered question lost its task-alert tag while core was reconnecting because process status was Off. The explicit alert now retains task routing whenever that authenticated card is still open, independently of process connectivity. The regression explicitly keeps core disconnected; stale-card checks remain. This is a notification classification fix, not permission or workflow authority from liveness.

### Regular coordinator task news and main-home overview

- Task observations now persist separate product-news intents in the same transaction as the event cursor. A regular space coordinator and the regular main-home overview receive native news input; unrelated regular coordinators do not. No absent coordinator is started. Waiting delivery requires connected origin/target, idle current private coordinator and confirmed live holder; existing launch-bound delivery receipts handle uncertainty without replay. Transport acceptance is not claimed as completed agent work. Closed research says Done rather than Merged.
- Waiting notices validate saved workflow/attempt/launch/Ready/Done/native failure evidence. Fresh activity cancels quiet-only news; overdue estimates remain independently valid until that report changes. Coalescing carries valid causes separately for each target, preventing lost overdue news or duplicate causes across coordinators. At most one notice is queued per coordinator/pass; settled receipts prune after seven days without changing event cursors. Home Autopilot routes through its own configured wake path using the original space identity; real home-profile acceptance is still pending.
- Actual same-host second-core Claude deliberately added REMO-14 with missing base she301-intentionally-missing, then replied EXPECTED_START_FAILURE. Core file/record checks confirmed no checkout or task actor (REGULAR_FAILURE_NO_WORKTREE_OR_AGENT_OK). Its regular coordinator received the familiar failed card and native news, replying REGULAR_FAILURE_NEWS_OK without retry/fix. The main-home native Codex received the forwarded card and explained it without changing the remote task. Both phone screenshots captured/inspected.
- Restarted only the preview server afterward. Private news/reply IDs stayed unchanged and core confirmed both coordinator holders live with the same PIDs (REGULAR_NEWS_RESTART_NO_DUPLICATES_SAME_PIDS_OK). This proves actual failed-start native delivery and restart dedup; new native quiet/overdue/Ready/Done news and physical lock-screen push still need acceptance.
- Three fresh scoped review rounds: three minor cause/coalescing issues fixed, including the final round’s per-target observation copy; no critical/major findings. Local typecheck passed. GitHub regressions cover target scope, idle/offline/absent actors, stale evidence, reconstruction, home wake routing, bounded passes/retention, independent overdue causes and per-target coalescing. No local suites ran. Reconnect-alert CI 41014834537 passed core/layout at 0f146f03. Full parity remains unfinished.

### Newly identified lifecycle follow-through

- Failed task creation preserves its record but currently reports a raw start error without its saved task ID. Improve the refusal so agents do not accidentally create a duplicate while retrying.
- Verify/fix the familiar Needs you state for a native task turn ending without ready/Todo, while retaining Working for recorded background jobs. Current task view can still show Working for an idle root.
- Finish clean Stop checkout removal/recreation, held-work Close/Delete and active foreground Pause acceptance, GitHub merge/recovery flow, remaining Autopilot/home/profile and device/voice parity, obsolete legacy-source removal and complete cutover inventory. These remain required scope, not follow-ups removed from delivery.

Task-news CI 41015326546 passed layout and 396 regressions, finding one fake fixture that emitted failed news for a live working task with no failure evidence. The fixture now stores the explicit start failure it claims to report. Product stale-evidence validation remains unchanged; rerun is required.

### Native ended-turn waiting and surviving failed-start identity

- A task shows Needs you after its current native transcript is fully captured and records an ended turn with no open turn or recorded background job. Process idle alone is insufficient; native active status wins. Partial/oversized records remain conservative, and replacement launches cannot inherit an older launch's waiting evidence. Todo/Queued/Ready/Done keep their workflow meaning.
- Actual same-host remote Claude task probe/REMO-15 replied WAITING_FOR_HUMAN_OK without tools or product status commands. Independent snapshot/private actor/core checks confirmed workflow working, visible Needs you, live terminal probe/t2b with the same PID 3946820 (NATIVE_ENDED_TURN_NEEDS_YOU_LIVE_OK). Phone screenshot captured and inspected. Its regular coordinator also received/explained the native Needs you news. This is separate from external-machine acceptance, still skipped for vm-ssa access limitations.
- Failed creation now names the saved task ID and explicitly warns not to add it again. Actual native coordinator added exactly one deliberately missing-base probe/REMO-16 and replied SAVED_FAILURE_ID_OK after inspecting that refusal. No retry or task actor was requested. Existing failed records remain preserved.
- One fresh scoped review found no findings. Local typecheck passed; no local suites ran. New GitHub regressions cover current/old turns, recorded background jobs, partial/reset logs, reconstruction, workflow precedence and surviving failed creation records. Task-news fixture correction CI 41015592474 passed core/layout at 3fa00503. Stop/recreate and remaining full parity are still required delivery scope.

### Clean Stop and checkout recreation

- Stop confirms owned roots/descendants have exited, then rechecks work. Dirty or unmerged work stays; only a clean landed checkout and branch are removed. Chat/task records remain. Start and message delivery reopen the saved branch at its saved location, reusing held work; another branch at that location, the branch checked out elsewhere, an occupied path or an unconfirmed prior process refuses without overwriting. No forced removal or pruning is introduced.
- Actual owned REMO-15 Stop returned CLEAN_STOP_OK with no held work. Independent core checks confirmed old probe/t2b PID 3946820 finished and the checkout absent (CLEAN_STOP_CHECKOUT_REMOVED_OK). Sending a follow-up, without adding a task, recreated its exact saved branch/checkout and launched a different probe/t2f PID 4001230. Native Claude replied RECREATED_CHECKOUT_OK; chat retained its earlier reply. Independent Git/core checks returned CLEAN_STOP_MESSAGE_RECREATES_CHECKOUT_OK. Phone screenshot captured/inspected.
- Fresh scoped review found no findings; local typecheck passed. CI coverage adds real-Git clean/held Stop and reopen cases plus occupied/wrong-location branch refusals. No local suites ran. Native waiting CI 41016369372 passed layout but found a background-job fixture starting its spawn step outside any native turn; the fixture is being corrected to capture the spawning turn before background completion. Manual preview restart separately exposed repeat Needs you news during historical log reconstruction; that actual product gap remains open and is the next fix, not claimed as restart acceptance.

### Restart does not replay native waiting as new work/news

- Reproduced a real preview-restart gap: historical native hooks/turns could rewind the saved agent status while logs reloaded, making Needs you news repeat. Older hook observations now cannot replace newer state/session/transcript metadata, and older native turns still populate chat/activity without rewinding current status. A private current-launch fully captured waiting snapshot bridges initial capture/backlog; new activity, another launch/path, partial/oversized tails or actual truncation cannot inherit stale authority.
- After warming the new snapshot, restarted only the isolated preview again. Independent private notice/reply-ID comparison and actual core checks returned NATIVE_WAITING_RESTART_NO_DUPLICATES_SAME_PIDS_OK: both coordinators and REMO-15 retained their live PIDs, and its workflow working/Needs you remained correct. Earlier duplicate cards remain honestly retained in the same chat. No human agents/services/state changed.
- Two fresh scoped review rounds: one minor initial-backlog reset issue fixed; final found none. Typecheck passed. GitHub regressions cover old-hook metadata/state, initial long backlog, launch replacement, actual truncation and partial tails. The prior CI background fixture now records its spawning turn before background completion, matching native event order rather than leaving an implicit unfinished step turn. No local suites ran. Full feature/device parity remains unfinished.

### Held-work controls and truthful CLI refusal

- Actual owned REMO-15 created only held-proof.txt with HELD_WORK_BYTES_OK, then stopped. Stop retained the uncommitted file; unforced Close and Delete both refused and kept the task To do. Independent core process/file checks confirmed the stopped PID and exact retained bytes (HELD_STOP_CLOSE_DELETE_PRESERVE_BYTES_OK).
- The native coordinator caught that these structured refusals still returned exit zero. Close/Delete CLI now return exit one for ok:false while the screen keeps its structured confirmation result. The same native retest replied HELD_REFUSAL_EXIT_CODES_OK: both exit one, both held-work refusals, task/file unchanged. Phone screenshot captured/inspected; no force or cleanup used.
- Fresh scoped review found no findings. Local typecheck passed; no local suites ran. Added real-Git CI tests for both refusal codes and preserved records/bytes. CI 41016951992 passed layout and 400 regressions; three older fake launch fixtures reached real core routing through the newly added checkout check. Those fixtures now explicitly fake checkout I/O, keeping actual Git recreation coverage separate. Rerun required. Native waiting/background/restart regressions passed in that run.

### GitHub acceptance resources (in progress)

Created private disposable repository eliasstravik/she301-core-acceptance-20261030 solely for authorised GitHub acceptance; no deployment. Intended owned checkout /home/exedev/.cache/she301-github-accept-20261030, isolated preview space github-proof. Its only workflow checks that example.txt exists on GitHub. This is separate from SHE-301's rewrite branch and live main. Record/clean only these owned acceptance resources after proof; no partial rewrite pull request or live merge is authorised.

Active foreground Pause remains unverified: native Claude rejected standalone sleep 120 before execution with its tool's documented condition-wait/background guidance. No sleep-loop bypass was attempted; the stopped-task pause proof remains distinct.

### Real GitHub PR identity and Ready promotion

- Real native Claude GITH-1 committed only example.txt (40087b8cf7d61dfa507691df648bee3d07d7f2b7) and opened scratch PR #1. Reproduced two gaps: its authenticated pr command created the PR but failed its follow-up identity lookup because statusCheckRollup access was denied; Ready then had no saved PR association and left it draft.
- PR identity can now be read without restricted checks. A successful unambiguous open head/base lookup is required before creating a PR; a lookup error never triggers blind duplicate creation. Ready verifies the saved PR number/head/base/open state, updates its summary/facts through stdin and promotes a draft before recording Ready/card. Merge/checks observation retain their full check query and fail closed on access errors.
- Retested the same unchanged commit and existing PR through the same native agent. Both authenticated commands returned zero and it replied PR_READY_RETEST_OK; independent GitHub query confirmed PR #1 OPEN, isDraft false, main base and the exact same head. Screenshot captured/inspected; no duplicate PR or merge. One fresh scoped review found no findings. Local typecheck passed; no local suites ran. CI adds exact-head draft promotion and uncertain/ambiguous lookup coverage. Lifecycle/refusal CI 41017255943 passed core/layout at 7208983c.
- Precise remaining access gap: configured GitHub CLI token receives GraphQL Resource not accessible by personal access token for statusCheckRollup and REST HTTP 403 for commits/40087b8cf7d61dfa507691df648bee3d07d7f2b7/check-runs. The independent combined-status endpoint returns pending with zero statuses, which is not a pass. No credential, permission or account configuration was changed or borrowed. Full real GitHub checks/merge acceptance remains unverified; independent implementation work continues.

### Confirmed external GitHub merge and recoverable base sync

- Added a bounded, persisted GitHub merge observer independent of agent liveness/check-read permission. Only the saved PR number/URL, exact Ready head, expected base and confirmed merge commit can record Merged. It never initiates a merge. The same sync intent is saved after product-initiated GitHub merges. Two observations and two syncs per pass, with one-minute per-task retry spacing.
- Base sync fetches only the expected remote base into a private hashed ref (not shared FETCH_HEAD), verifies the confirmed merge is contained, and fast-forwards only the expected clean checked-out branch. Dirty/diverged work is preserved with an honest message and durable retry. Cleanup waits for sync plus fully captured native completion (external merges), or the existing self-completion receipt; held work is never forced away.
- Real private scratch PR #1 was merged externally through GitHub's documented API to e8fb9342dc595f1ed337dc811d2cdc5d20a54f47. This exercises external-merge recovery, not the check-dependent product merge path. The observer marked GITH-1 Merged but refused base sync while my sole owned base-preserve-proof.txt held BASE_PRESERVE_BYTES_OK. Independent core reads confirmed that file and the original before content unchanged; pending cleanup survived (BASE_DIRTY_PRESERVED_AFTER_CONFIRMED_GITHUB_MERGE_OK).
- After removing only that exact owned fixture, normal retry fast-forwarded the base to the confirmed GitHub commit, confirmed the task process finished, and removed its landed clean checkout (EXTERNAL_GITHUB_MERGE_SAFE_BASE_SYNC_CLEANUP_OK). No forced update, release, live-main merge or human-agent/service change. The private scratch repository and seed checkout remain owned acceptance resources for follow-up proof; no other repository was changed.
- Two fresh scoped review rounds: one minor cleanup-intent issue fixed; final found none. Typecheck passed; no local suites ran. GitHub cases cover exact identity rejection, no live-agent requirement, bounded/throttled reconstruction, dirty-base preservation/retry and pending cleanup. PR identity/promotion CI 41017758035 passed core/layout at 812ada16. Real check-dependent merge is still blocked by configured GitHub check-read 403. The run also exposed stale merge-card buttons after external merge; a display fix is in progress, not claimed complete.

### Completed/replaced merge cards are visibly closed

- Reproduced original GITH-1 merge cards still offering buttons after the externally confirmed merge, despite the backend correctly refusing those stale answers. Card projection now resolves saved merge requests against the private current task/question/head. Merged, replaced or removed requests show Closed and disabled choices in original and forwarded chats, without inventing a human answer or changing historical timestamps/approval authority.
- On the same retained phone chat, both historical Merge/Not yet pairs are now disabled; the current card says Closed — This task is already merged. Before/after screenshots captured/inspected. Fresh scoped review found no findings. Typecheck passed; no local suites ran. Added original/forwarded/current/replaced display and stale-answer/no-approval regressions for GitHub.

### Published GitHub feedback survives denied check-read access

- Split the ready-task observer's basic identity and checks reads. A check-read error is retained as an error, never a green nudge, while independently published reviews/line/issue comments still use the original private launch-bound delivery journal. Number/head/state changes between the two snapshots refuse that observation.
- Actual owned GITH-2 waited in the CPU capacity queue, then started without changing its safeguards. Native Claude created scratch PR #2 at 6f590e66d4420df7d3e0e647e8969ac5688fbe3e. Published owner comment 6517179153 requested its already-authorised one-file correction. The phone showed one GitHub-comment card and the real Claude applied it, pushed to the same PR and reported Ready again at a63d20ea50ed4f4f5adbcb06c15fff914bef3c75. Independent GitHub reads confirmed only example.txt changed and its exact contents review-corrected. Screenshot captured/inspected. No merge, extra helper, workflow or settings change.
- Fresh scoped review found no findings; local typecheck passed, no local suites ran. CI regression explicitly denies checks but delivers feedback once without a green nudge. Card/external-merge CI 41018483238 passed all checks on rerun: its first run passed layout and 411 regressions but timed out in the existing native-usage capture test; rerunning only the failed job passed without code changes. Real check-dependent merge remains unverified due the configured token's 403.

### Safe task pushes after a real conflict/rebase

- Task push captures the saved checked-out branch's exact ref/SHA, then pushes that SHA to its exact remote ref. First publication leases an absent ref; later pushes lease the app-private last published SHA, supporting its own rebase while refusing another writer's remote update. A lost response settles only if an independent remote-ref read confirms the exact captured SHA. The published SHA is saved before PR lookup so a later API error cannot erase push identity.
- Two fresh scoped review rounds: one major checkout-switch race fixed by resolving the saved branch ref instead of HEAD; final found none. Local typecheck passed, no local suites ran. Real-Git CI cases cover own rebase and a foreign remote update; unit cases cover lost reply, captured SHA and checkout switch.
- Actual native GITH-2 first confirmed its unchanged published commit. I advanced only the owned scratch main sample (bc526909bbf874995c15001ce8c12a8b4f454b88); Claude fetched it, resolved the expected example.txt conflict retaining review-corrected, pushed through its authenticated command and reported Ready again. It replied REBASED_PR_PUSH_OK. Independent GitHub query confirmed same PR #2 OPEN/non-draft at ff75ecaeb9039432b6dde0f903dcce79d648308d. Independent private/core Git checks confirmed pushedHead equals readyHead, the new base is its ancestor and exact file contents (NATIVE_REBASE_SAME_PR_SAFE_PUSH_READY_OK). Screenshot captured/inspected. No merge or other repo/settings/workflow changes; scratch resources retained for remaining acceptance.

### Pause during real native foreground work

- The standalone sleep probe was refused before execution; a subsequent read-only CI watch was rate-limited before it could wait. Neither is counted as a Pause pass or bypassed. A first analysis turn ended before the click, also not counted.
- Actual GITH-2 then began a normal read-only native analysis turn. The saved pre-action chat reported work/working true and zero background jobs. Clicked the existing phone Tasks → More → Pause while Working. Independent private/core checks confirmed To do, the same launch/PID 308220/t37 still live, native OSC status idle with reported true, and a clean unchanged worktree (ACTIVE_NATIVE_TURN_PAUSE_SAME_LIVE_PID_TODO_OK). Phone screenshot captured/inspected. This proves interrupting active native foreground work; a long foreground shell-tool interruption is not separately proven. No files, commits, settings or other agents changed.

### Baseline home Autopilot scope audit

Verified directly against legacy ebb17d585c82906b788a8473237921802920b5c5: source.ts:1011/1105 and docs/autopilot.md already refuse home-space Autopilot and non-Linux containment. The rewrite's refusal preserves that actual baseline; historical generic home-news routing is not evidence that home containment was supported. Main/remote ordinary home overview has its real native acceptance above. Remaining Autopilot event/profile/browser/device checks are still required.

Pause follow-up: a subsequent message received native PAUSE_RESUME_SAME_SESSION_OK without tools or file changes. Independent core/private checks confirmed the same live PID 308220/t37 and ordinary working workflow restored (PAUSE_MESSAGE_RESUME_SAME_NATIVE_PID_OK). The proof artifact hf2s v24 now includes held-work, GitHub feedback/rebase/recovery, closed merge cards and active native Pause; light/dark checker pictures inspected. No full parity/readiness claim.

### Scoped secret use and human CLI parity (2026-10-30)

Real phone-width Settings saved a generated disposable secret for github-proof only.
The native Claude task listed its name, used `secret run` without printing its value,
refused a nonignored env file, and wrote a mode-0600 git-ignored env file. It removed
that file and restored Git exclude bytes exactly; its checkout remained clean.
The main-home Codex coordinator could not list the project-scoped name. Removing the
secret in Settings immediately revoked a fresh list/run; no child command ran and no
test value remains. Native markers: SCOPED_SECRET_RUN_ENV_CLEAN_OK,
HOME_SECRET_SCOPE_ISOLATED_OK, SCOPED_SECRET_REMOVAL_REVOKED_OK. Screenshot inspected:
she301-scoped-secret-settings-phone.png. UI Replace is not yet separately verified.

Integration review found human CLI set/rm missing, rather than merely unverified.
Implemented a separate private local operator socket with bounded input, owner/mode
checks, no web route, no caller-selected agent identity, and one server vault writer.
The repository command routes only human secret set/rm there; credentialed agents
remain on core mailbox and cannot use those verbs. Real isolated CLI generated a fresh
value internally, set it for github-proof, replaced it, removed it, and independently
checked snapshots contained the name only while present. Marker:
HUMAN_PRIVATE_CLI_SCOPED_SET_REPLACE_REMOVE_OK. No value was printed or put in command
arguments, core documents or chat. Review found partial startup cleanup missing if
operator bind fails; startup now unwinds source, app and socket before returning error.
CI coverage added for scope/alias resolution, command-word refusal, mailbox refusal,
private socket permissions and server-owned vault writes; local suites were not run.

### Native multi-choice, plan and research completion (2026-10-30)

The github-proof coordinator created exactly one read-only Claude task GITH-3.
Its authenticated helper posted a multi-choice card with two described choices;
both were selected and sent in the shared phone-width browser. The same native
agent received the answer and returned MULTI_CHOICE_NATIVE_OK, then posted the
actual two-step plan. The browser selected Approve the plan and sent it; the agent
ran only branch/status reads and returned PLAN_APPROVAL_NATIVE_OK. It marked the
research task Done with no changes to merge; its clean checkout was removed.
Persisted cards independently confirm multi-choice answered and plan choice 0.
Screenshots inspected: she301-native-multi-choice-phone.png and
she301-native-plan-phone.png. Physical lock-screen answering remains unverified.

Regular coordinators now match verified legacy creation-news behavior: ordinary
added events do not produce a second news wake or main-home card; the original
creation card remains. Existing waiting added echoes retire without replay.
GITH-3 had no persisted added news, while its Done news was present and delivered.
Marker: NATIVE_MULTI_CHOICE_PLAN_APPROVAL_RESEARCH_DONE_NO_ADDED_ECHO_OK.
Automation/Autopilot added-event processing is unchanged. Scoped fresh review had
no findings, and meaningful no-echo/delivery CI cases were written, not run locally.


### Standalone transport removal and provider recovery (2026-10-30)

Removed executable terminal-herdr plugin/LiveSource/supervisor entrypoints, old
SSH worker/mirror/tunnel/remote API bridge and installed legacy helper templates
from this rewrite branch. Pure native readers/parsers/Vault and fictional demo
formatters moved to server/common; unchanged UI remains. The optional demo browser
is now local-only, with all remote SSH/sharing paths removed. Package start selects
the standalone core launcher; credentialed agents still select their own encrypted
mailbox, and credentialless commands never fall back to the old HTTP route.
Primary installation/development/machine/upgrade docs now describe core, and
core/cutover.md contains the explicit later backup/relocation/rollback sequence.
No live source/state/service/mapping/ref was changed. Isolated preview restart
succeeded; current native helper returned AFTER_LEGACY_REMOVAL_OK. Human scoped secret CLI also passed again.

Cleanup review found an actual missing baseline capability: provider retry and
configured backup. Implemented server/core/provider-retries.ts from native error
records only, using the retained primary classifier in common/provider-error.ts.
Retries wait 1/2/4/8 minutes and use durable duplicate-safe pending sends. Explicit
messages cancel/reset old observations. Lasting/exhausted failures ask the human
or switch an ordinary task once to its configured backup, retaining the same branch,
checkout bytes, brief, commits/status and recent chat. Contained runs never switch
provider automatically, matching verified legacy's t.pilot exclusion. Backup
model/effort controls are restored with the original visible labels.

Takeover records its intent before ending the owned process. A capacity hold retains
its handover until a replacement is confirmed; an interrupted ambiguous takeover
requires explicit restart. Reviews: provider scope two rounds, one minor capacity/
context issue fixed, final none; cleanup scope two rounds, one major missing retry
capability fixed, final none. Tests cover native error fixtures, durable timing/reset,
identity gates, one-shot/context/queued backup and interrupted/contained refusal.
Legacy transport-specific tests were removed with their deleted implementations;
pure reader/activity/vault/frame/health/UI regressions were retained/retargeted and
core integration suites replace the old runtime tests. Suites/build run on GitHub,
not this VM. Real provider failure/backoff/automatic native takeover is unverified.

Manual phone check restored Settings → Agents → Backup with Agent/Model/Effort.
Switched only github-proof's Backup to Off, independently observed that scoped
snapshot, then used Reset to Codex and verified the override was removed.
Marker: BACKUP_SCOPED_OFF_AND_RESET_OK; screenshot inspected:
she301-backup-settings-phone.png (Off state before the reset acknowledgement).
Main and v2.0 remote refs still equal the verified legacy baseline.

Next explicit baseline audit item: ignored-file `.worktreeinclude` seeding was
provided by terminal-herdr worktree creation, while the core rewrite currently
uses Git worktree creation directly. Its ordinary/contained semantics must be
verified and implemented safely before full worktree parity can be claimed.

### Ignored worktree configuration seeding (2026-10-30)

Baseline audit correction: legacy docs/tasks.md promised `.worktreeinclude` copying,
but the installed terminal-herdr is 0.9.3. Its primary versioned source
[src/app/api/worktrees/deferred.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/api/worktrees/deferred.rs)
and [src/worktree.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/worktree.rs)
create a Git worktree without a built-in include-copy step. This is a documented
product capability to preserve, not evidence that core implements it or a reason
to reintroduce a plugin/SSH bridge. No third-party plugin is installed.

Implemented an app-owned stateless include helper, provisioned through core with
other immutable helpers. On a fresh/recreated task checkout, Git applies native
include-rule syntax; only untracked files ignored in both source and destination
are copied. Tracked, excluded and nonignored files are left alone. Links, unsafe
parents, wrong checkout/branch/repository identity, oversized selections and missing
destination ignore rules refuse explicitly. Existing task files are never replaced.
No setup hooks or fsmonitor callbacks run. Bounds: 64 KiB rule file, 2 MiB selection,
2048 files, 16 MiB/file and 64 MiB total bytes.

Copies stage privately outside both Git checkouts, fsync complete bytes, then publish
without replacement. Interrupted staging links are reconciled by verified private
inode identity; only staging aliases are removed, restoring single-link task files.
An unconfirmed/foreign link is left untouched and refuses launch. `includesPending`
is durable until core confirms the copy; reopening an existing checkout does not
reseed it. A newly recreated checkout is seeded again. All worktree/transfer actions
still use core exec. Three scoped reviews: two minor crash/publication cases fixed,
last round none. Real-Git regressions are written for GitHub, not run locally.

A real new Codex research task probe/INCL-1 started in the same-host remote core,
using only harmless public fixture files. Native tool output confirmed the exact
selected bytes, exclusions, tracked fixture and clean Git status; it deleted only
its own copied public file. Independent reads confirmed source fixture and the
existing REMO-15 held-work bytes unchanged. Native completion through the helper
has not passed: its ordinary tool sandbox reports Core disconnected. The run is
not complete and is not external vm-ssa acceptance.

### Capacity follows current work, not workflow (2026-10-30)

Reproduced with probe/INCL-1 held at the unchanged one-task limit while REMO-15
was Needs you with a native ended turn. Legacy busy() counts effective Working
status; the rewrite incorrectly counted durable workflow=working. CoreHealth now
uses the existing task status calculation, which retains conservative Working
while native capture is uncertain or background work remains. Recent start grace
and active reviewer reservations still count. A fresh scoped review found no
findings. After restarting only the isolated preview, INCL-1 started without
changing the machine limit or REMO-15 launch/workflow/PID/held file. CI regression
covers waiting, active work, reviewer work and recent reservations. Local
bun run typecheck passed; no local suites or full build ran.

### Verified core environment survives native tool shells (2026-10-30)

The actual INCL-1 native Codex run exposed a connection regression: hc reported
that core listened under the isolated XDG runtime but the tool shell looked under
/run/user/1000. Approving execution outside the ordinary sandbox did not repair
that environment. No socket/config/authentication setting was changed.

Remote provisioning now captures only the three documented core home variables
(XDG_RUNTIME_DIR, XDG_STATE_HOME, XDG_CONFIG_HOME) from core exec. Protected
per-launch endpoints restore those values before hc connect; explicit null removes
a foreign inherited value. Native launch/tool environment also preserves present
values. Core identity/version checks remain required. A resumed native turn now
explicitly states its current public helper command, since the resumed Codex used
a historical immutable helper path despite refreshed developer instructions. No
credential value or credential pathname is added to that turn.

Reproduced failure then actual recovery: restarted only this isolated fixture's
Codex, approved its own new hooks, and answered the native permission card on the
phone-width app. Current helper done INCL-1 completed through core; native marker
NATIVE_CORE_INCLUDE_SEED_AND_COMPLETION_OK arrived. Independent read-only checks
confirmed workflow closed/outcome done, no pending copy/cleanup, checkout removed,
all three source fixture byte strings unchanged, and REMO-15's held bytes, workflow,
launch and PID unchanged. Marker:
NATIVE_CORE_INCLUDE_SEED_COMPLETION_AND_SOURCE_HELD_WORK_PRESERVATION_OK.
Screenshots she301-includes-done-phone*.png captured and inspected. This is a
same-host remote-core run, not external vm-ssa acceptance. The earlier helper
failure above is resolved for this fixture. Endpoint and resumed-routing scopes
received fresh reviews with no findings. Local bun run typecheck passed; no local
suite/build was run. GitHub 41026721786 passed the preceding capacity fix.

The broader branch Check 41026368007 passed types/build but failed all test shards.
Its contained To-do capacity failure was fixed in a94fd58b and then passed the
rewrite workflow. Remaining full-suite failures include design-policy assertions,
agent controls, reader fixture expectations and several existing layout fixtures;
they are not waived as acceptance or hidden by the selected rewrite checks.

### Native model/effort display, separate from launch choices (2026-10-30)

The retained Claude/Codex readers already emit runtime observations; the rewrite
was saving those events without exposing them to the unchanged composer controls.
Hooks also incorrectly replaced selected model policy with a reported model.
CoreAgent now keeps runtime separately. Current-launch native runtime events update
it using their own observation timestamp, not unrelated newer activity timestamps;
a full native snapshot clears omitted runtime fields. Hook model reports update
only runtime. Chat exposes this to the existing Agent/Model/Effort menu. Historical
and retired-launch observations cannot change a replacement's runtime. Previously
stored launch fields are not guessed or rewritten.

Manual before/after on unchanged native GITH-2: the same phone menu said Model Not
reported before, then claude-opus-5-5 after rereading its real Claude transcript.
Effort remains Not reported because this native session does not report it. Main
Codex also reports its real gpt-6.1-sol model; its actual turn_context has no effort,
so none is invented. No agent was restarted or sent work for this display check;
only the isolated app restarted. Screenshots she301-native-runtime-before.png and
she301-native-runtime-after.png captured and inspected. Fresh scoped review found
no findings; local bun run typecheck passed. Native GitHub regressions cover policy
separation, old runtime, replacement launches and removal of omitted effort fields.

### Full-suite baseline fixture reconciliation (2026-10-30)

Check 41026368007 exposed older assertions that no longer describe verified legacy
ebb17d5. Fresh read-only review compared source: existing 20px pick chevron and
search-row corner, Search this chat and beyond menu, native runtime events, target
branch suffixes, selected-first Backup choices, duplicate responsive base banners,
Home's cross-machine attention default and split need/ready badges. Tests now
assert those established details instead of changing the product to an older
fixture. Responsive composer operations target visible elements. Several failing
layout pages use a 10-second locator timeout to show the failing action before the
enclosing 30-second test expires. No suite is skipped or removed by this change.
Review found one minor remaining hidden composer wait, fixed. Types passed locally;
full GitHub rerun remains necessary. Rewrite CI 41027509005 passed native runtime
integration; endpoint/resume CI 41027247187 also passed.

### Scoped secret replacement and artifact note/delete (2026-10-30)

Manual phone Settings → Secrets, scoped only to the scratch github-proof space:
created a masked disposable random value, used Replace with a different generated
value, then native GITH-2 secret run checked only its replacement-generation prefix
and printed SECRET_UI_REPLACEMENT_USED_OK. No value/suffix was printed or placed
in command words/files/chat. Remove → Remove it revoked it; native secret list
excluded the name and secret run refused before its test child could execute:
SECRET_UI_REPLACEMENT_REMOVAL_REVOKED_OK. Independent chat/task reads confirmed
both markers, To do and the same scratch PR #2. No test secret remains. Screenshot
she301-secret-replace-phone.png captured and inspected.

Existing second-core native coordinator created disposable artifact ef77bfac. In
the actual phone viewer, Mark up selected NOTE_TARGET; sent a real note asking for
NOTE_ACCEPTED_OK. Native transcript independently contains exactly one artifact-note
for version 1 and target NOTE_TARGET (button#note-target). The native keeper updated
the same artifact to version 2, visible in the still-open viewer, and replied
NATIVE_ARTIFACT_NOTE_UPDATED_OK. Independent private-state reads verified two
versions and the requested new HTML marker:
NATIVE_ARTIFACT_NOTE_VERSION_TARGET_AND_UPDATE_OK. Screenshots
she301-artifact-note-sent-phone.png and she301-artifact-note-updated-phone.png were
captured and inspected. Only this disposable artifact was then removed through
More → Delete artifact → the named final delete action. The viewer closed and list
showed no artifacts. Independent snapshot/private-state reads confirmed its list
entry, both HTML versions and thumbnails gone:
TEMPORARY_ARTIFACT_DELETE_REMOVES_LIST_AND_STORED_VERSIONS_OK.
she301-artifact-deleted-phone-final.png records the completed deletion. The live
SHE-301 proof artifact and prior acceptance artifacts were not removed.

The second full Check 41028188221 passed types/build and test shards 1/3 and 2/3.
Its only failure was a branch-banner selector: desktop can render two matching
visible labels, so the narrow exact-text assertion now accepts the first visible
matching banner at each viewport. It still checks the saved space default changed
while the existing task base stayed main. No product layout change.

Capacity follow-up preserves the conservative original count for a missing native
holder, distinct from a confirmed live ended turn or a finished holder. Regression
checks those three states; a fresh scoped review found no critical/major findings.

### Final full integration review: real Settings gaps (2026-10-30)

Round 1 found two majors missed by fictional-demo layout coverage: fresh core
snapshots omitted device push enrollment, and real Repository/Task IDs pages and
actions were missing. Both are implemented on CoreSource now, reusing the existing
UI. Global Alerts and voice supplies Notifications' Add this device action and
Voice page; the actual Push instance supplies safe device names and delivery
warnings. Device enrollment remains global from every scope. Real-source HTTP CI
coverage exercises enrollment/name refresh and private failure diagnostics without
sending a network push. Physical phone/lock-screen delivery remains unverified.

Repository base writes validate the branch through the owning machine's core and
recheck space/coordinator identity after that read. Existing tasks retain their
saved base. Task IDs keeps permanent per-machine prefix ownership and ID tombstones,
forward-only numbers across prefix changes, and automatic unique prefixes for new
spaces. Settings snapshots are read-only. Reservation, counter and space-sequence
writes are one SQLite transaction; a stale settings snapshot cannot allocate under
an old prefix. No legacy state was imported or moved.

Manual before: the actual isolated core snapshot contained none of Alerts and
voice, Repository or Task IDs. After app-only restart all appeared. The phone
Notifications page showed Add this device; clicking reached the browser permission
flow, which returned Alerts are off for this device. This is enrollment reachability,
not a claim of successful device registration or delivery. Repository changed only
includes-proof's base to the new harmless she301-settings-next fixture branch;
independent snapshot confirmed INCL-1 still targets main:
CORE_REPOSITORY_UI_BASE_EDIT_EXISTING_TASK_TARGET_PRESERVED_OK. In the same phone UI,
Task IDs changed its prefix INCL→INCQ and next number to 40. A real task using these
settings is pending; no allocation pass is claimed yet. Screenshots captured and
inspected. Full review round 2 confirmed both Settings findings fixed and found a
separate main-check observer issue being repaired. Local typecheck passed; no local
suite/browser test/full build was run.

### Final review: pending main heads and diagnostic context

Round 2 found that polling only the base's newest commit hid an earlier failed
commit while newer work was pending. The observer now orders candidates by verified
GitHub base history, skips pending heads and confirms the selected commit's bounded
run set before changing the durable incident. A second authoritative base read
rejects races. A confirmed green re-arms notifications; missing/unknown/truncated
results never clear red. New incidents include bounded merged-commit titles since
known green (or the failed commit) and a bounded failed-log tail when available;
diagnostic permission failures are marked unavailable. Regression coverage includes
pending-newer/failed-older, unrelated history, reruns and context. Real GitHub
observation remains unverified: this environment's configured token denies check
reads (403); no credentials or access settings were changed. Settings rewrite CI
41030400506 passed. Only typecheck ran locally.

Settings native acceptance completed: probe/INCQ-40 ran on Codex with the selected
she301-settings-next base, verified and removed its copied public config, closed
its research checkout and replied NATIVE_CORE_SETTINGS_TASK_OK. Independent reads
confirmed cleanup, unchanged source files and unchanged unrelated held-work actor
and bytes: NATIVE_CORE_SETTINGS_COMPLETION_SOURCE_AND_HELD_WORK_PRESERVATION_OK.
The next number advanced to 41. Trying 40 was refused durably but exposed a UI
feedback gap: HTTP errors bypassed Settings' existing inline refusal presentation.
Settings now catches those responses and displays the existing safe error message;
the layout regression uses the actual HTTP 500 shape. Manual before omitted the
message; after displays Use 41 or higher. Earlier numbers are reserved. Inspected
phone screenshots record the native result, next number and refusal. Typecheck
passed, no local suites. Full integration review round 3 at ed75b57e reported no
remaining concrete critical/major findings; this subsequent small feedback fix is
not included in that review. External/device/voice/provider-failure proof remains
unverified; review is not acceptance evidence.

### Settings navigation comparison against preserved legacy source

A separate UI-only demo copy of verified v2.0 was rendered with scratch state,
127.0.0.1 ports 17892/17893 and no legacy agents or live home. Only its preview
proxy/asset allowlist was adjusted. It is a historical visual reference, not
backend acceptance. Manual comparison exposed further real-source omissions:
Time zone needed its existing global marker; Plugins needed to be an unscoped
About page; the read-only Machines page was absent. Restored all three, existing
Browser name/help, private-rules prompt grouping and familiar section ordering.
Machine values use current core connection state and saved display names, never
invent a last-disconnect time. CI regressions inspect real-source section scope
and machine presentation. Only isolated preview restarted; live state unchanged.
These follow-up changes postdate final review round 3 and are recorded separately.

Full Check 41031514810 passed all three test shards, types and build at 7bd30e01.
Rewrite CI 41032009696 passed at de674bb8 including restored navigation regression.
The Repository screen was compared by hand to the preserved v2.0 UI at 390×844,
820×1180 and 1440×1000, light/dark. Source names/data differ; the page's layout,
field, wording, spacing and colours are retained. This is one screen comparison,
not a full per-feature visual parity pass. Screenshots are outside Git.

Added a separate branch-only CI job for the actual production plugin compiler:
real client/server extension, hot replacement with persistent state, then invalid
TypeScript retaining last-good compiled assets/runtime. It is explicitly enabled
only by SHEPHERDR_REAL_PLUGIN_BUILD=1 in that job; ordinary suite runs skip that
costly build case. It has not run locally. This adds production-path coverage beyond
injected compiler fixtures, not physical-device or authenticated native-agent proof.

The additional production-plugin job in rewrite run 41032408275 passed: actual
production client/server compiler, edited assets/runtime, durable counter and
invalid-TypeScript last-good fallback (11 assertions, 4.12 seconds on GitHub).
The VM did not run that build. PR #507 is draft and explicitly not for merge/deploy.
The restored source fixture base/prefix are main/INCL; historical INCQ-40 retains
she301-settings-next and is Done; next number remains forward-only. Native keeper
confirmed removal of only its temporary artifact-note source fixture. The separate
legacy UI reference processes were stopped after screenshots; main preview and
existing native tasks remain untouched.

A further harmless foreground-shell Pause attempt created only scratch INCL-41.
Its native Claude Bash policy refused `sleep 60; printf LONG_TOOL_FINISHED` before
execution, directing Monitor/background usage and explicitly forbidding chained
sleep workarounds. No policy bypass, alternate wait or authentication change was
attempted. That long-shell interruption remains unverified; the earlier native
foreground-analysis Pause is distinct evidence. The operator selected Stop here
and requested clean research-only completion, preserving all other work.

Terminal follow-up: the same live GITH-2 native Claude process (t37/PID 308220,
launch 3127ab0b-d576-4b04-8176-56aa78d64167, workflow To do) was attached by the
actual phone/tablet/desktop panel. Authoritative core reads confirmed 80×69 phone,
80×105 tablet and 80×66 desktop. Last-view detach restores the core holder's
200×120 default; that is not a viewer resize. App-only stop/start with the desktop
Terminal selected reconnected the live panel and restored 80×66 with the same
PID/launch/workflow. Raw native output and returned panel were inspected; no keys
or task/file/PR changes were sent. This proves actual resize and output reconnect,
not delivery of uncertain input or replay safety under a deliberately lost input ack.

Terminal inspection also exposed a limitation in the earlier synthetic env-file
acceptance: the native delete tool previewed the removed file's line outside the
helper's output masking. The disposable synthetic key had already been removed;
no human/provider credential was used. That historical claim of no value ever
appearing in native output is not valid for this env-cleanup step. The raw core
terminal/transcript is not sanitized or rewritten. Public agent guidance now says
to remove secret env files with a plain non-printing removal command, never a native
read/edit/patch/delete preview. Docs distinguish authenticated transport masking
from arbitrary native-tool output. The screenshot containing that synthetic line
was discarded and is not in the proof artifact. Existing revoked synthetic fixture
history was not selectively erased.

### Visual pass follow-up: elapsed task ages

The real task list exposed a missed parity detail: CoreTask persisted the placeholder
age now and the presenter never recomputed it. Preserved 2.0 derives task age from
archive/completion time, creation for To do, or last workflow/status change; agent
age uses its launch. Restored those sources with a shared pure formatter. Workflow
writes save updatedAt; existing automation observations persist a changed-status
timestamp without refreshing it every scan. Snapshots remain read-only, old records
fall back to their known timestamps, and the existing five-second snapshot refresh
updates ages. Regressions cover working/status, To do, Done and archived precedence
without mutating task records. Typecheck passed; real phone before showed now on
all old tasks. Only the isolated preview restarted for the after check.

### Artifact viewer follow-up: friendly keeper names

The real desktop viewer showed Ask p:<core-id>:~ for a change and used that internal
ID in sent confirmations. Legacy presents a coordinator name or TASK agent there.
The public artifact view and action reply now resolve saved display names while
routing continues to use only the canonical keeper chat. A completed task still
hands ownership back to its artifact's space. Regressions cover renamed spaces,
active tasks, completed tasks and unchanged canonical note delivery. Manual before
and after on the same live artifact/desktop show the raw ID replaced by ~; no
artifact version/data or native agent was changed for that comparison. Typecheck
passed. Task-age CI 41034443552 passed at 69dc6c4e; its phone before/after was inspected.

The artifact keeper correction also passed a real comment roundtrip: the existing
remote-home artifact's UI confirmed Sent to ~ and its canonical native Claude
keeper replied FRIENDLY_KEEPER_ROUTE_OK exactly once. Its HTML/data/version were
unchanged. Another retained-label mismatch appeared in real task headers and agent
controls: public cli fields contained internal claude/codex kinds. Public task/chat
views now show Claude Code/Codex, while agent.kind and launch arguments remain
unchanged. The legacy Task.on presentation field also names the CLI rather than
incorrectly naming the main host. Regressions verify public names and internal kind
separation. Only typecheck ran locally, followed by an isolated app restart for
manual before/after screenshots; all native processes and work are preserved.

The preserved legacy default home label is home, not the rewrite's internal ~ key.
Fresh core homes now store home; existing isolated rewrite records named ~ display
home without rewriting records or identities. Explicit saved display names still
win. Both home/~ aliases select the same home, and those aliases stay reserved
against ambiguous new repository names. Sidebar, CLI space listing and new artifact
keeper/author labels share the presentation helper. CI regression covers old-record
read-only presentation, canonical identity, aliases and explicit rename. Typecheck
passed; no legacy state import/mutation or native-agent replacement.

### Real main-red acceptance and configured-host log access

A harmless isolated core/gh read distinguished the actual restrictions: Actions
run/history reads work on the configured github.localhost target. `gh run view
--log-failed` tried api.github.com and hit an anonymous rate-limit 403; that is not
proof that the configured login cannot read Actions logs. Explicit same-login
REST job/log reads on the configured host succeeded (the installed CLI required
its documented --allow-escape-sequences flag for raw logs). No login/token/access
configuration changed. PR check-read denial remains separate and unverified.

In the existing private disposable she301-core-acceptance-20261030 repository,
actual main commit ecf37da intentionally failed Acceptance run 41036379555. Newer
27271ab ran a harmless 90-second CI wait (41036465897). The production observer
kept the earlier failed SHA, posted one card, included merged-commit context and
delivered one native MAIN_RED_NATIVE_OBSERVED_OK. Its log tail was explicitly
unavailable on this first run. A read-only independent check compared the incident
milliseconds with GitHub's newer-run created/job-completed timestamps, confirmed
exactly-one card/native reply, then confirmed green re-arming. Restored the exact
original workflow/content in 6da8d2f; restore run 41036818996 passed. Marker:
REAL_MAIN_RED_DURING_NEWER_PENDING_RUN_NATIVE_ONCE_GREEN_REARM_RESTORED_OK.
This was a real private scratch Actions run, not a local test suite or a claim
about PR check-dependent merge. Rewrite main/v2.0 and live state were untouched.

The log reader now uses the documented Actions jobs/log endpoints through the
same CoreGit/core machine.exec route and explicit configured host. It validates
bounded job results, fetches at most two failed jobs, honors the core output bound,
keeps a 12,000-character tail, and strips terminal controls before agent delivery.
An explicitly requested CLI control-sequence flag is retried only for that exact
CLI refusal; permission/other failures remain unavailable with no alternate account.
Regression coverage checks host pinning, invalid/truncated job lists, terminal
controls and refusal behavior. Typecheck passed; actual new-tail delivery is next.
Primary API reference: [GitHub workflow job logs](https://docs.github.com/en/rest/actions/workflow-jobs#download-job-logs-for-a-workflow-run).

### Search race: real repro and retained layout

Rewrite run 41037269798 passed core/types/build and production-plugin jobs, but its
layout job exposed the existing search debounce race: a pointer click selected the
old artifact (a5) before the newly typed query settled, opening the wrong place.
Reproduced in the real core app: search Remote core proof, immediately type
no-such-she301-artifact, click the still-visible old artifact. Before, it opened
9788e43f despite the new query. After, old hits are removed during Filtering and
stale pointer picks cannot close/navigate the dialog; the URL remains github-proof.
The existing fresh-query Enter behavior is retained. No style/layout redesign.
The originally failing identity-navigation regression is unchanged and remains the
CI regression. Typecheck passed; shared-browser before/after inspected. No local
browser suite ran.

### Stable main-machine identity and readable machine labels

The real All entrance exposed a major identity/presentation mismatch: snapshot.host
held the main machine's readable name, while Place.machine holds core's stable ID.
The retained UI could not identify its main home, fell back to the first sorted
remote home, and lost the intended all-machine overview. Before, All opened probe's
home and its machine filter. After, All opens the main core home and shows Home ·
every machine / Everything; Show all tasks includes both GITH-2 and probe/REMO-2.
No agent, workflow or file changed for this comparison.

Snapshot.host now holds the stable main machine key. Browser/voice/secret labels
resolve readable names from the machine list; new Task.on values name their CLI.
Settings inheritance descriptions honor explicit machine display names. Health
cards likewise show names, not core IDs; old raw-ID card copies are adapted only
when rendering, without changing their stored identity or already-readable history.
Regression coverage uses deliberately different main ID/name, remote ordering,
renames, voice/Settings names, future health events and read-only old-card display.
Only typecheck ran locally; shared-browser before/after captured and inspected.

### Final parity: human sender profile (2026-10-30)

Restored the legacy human-name fallback: first word of the main machine's global Git name, then capitalized
account name. An optional profile is read only from the selected initialized installation's config.json;
no legacy home is consulted. The profile reader rejects links, oversized/nonregular/multiply-linked/foreign-owner
files and invalid sender strings. The name is presentation, never authentication. Native reply, attachment,
reaction, artifact-action and secret-saved lines now carry the selected name, matching answers/browser notes.
Git lookup goes through the main core's documented exec API with a three-second bound.

Manual isolated application startup with a newly created private profile returned SHE301 Profile in the real
snapshot (ISOLATED_PROFILE_STARTUP_OK). Removed that exact owned file, restarted only the preview and confirmed
the actual global Git first name returned (ISOLATED_GIT_NAME_RESTORED_OK). Core agents were not stopped.
CI coverage checks profile fallbacks/rejections and named remote attachment delivery; only typecheck ran locally.
This correction postdates the third full fresh-eyes review and is not claimed as reviewed by that round.

### Final real main-red job logs and restoration (2026-10-30)

A second deliberately failing commit in the owned private acceptance repository, 4d3e9a874d744285f027b754f45b3f355e396fc3,
failed Actions 41037375181. The production observer fetched the actual failed job's bounded log through the
configured host's documented Actions REST endpoint and delivered it to the native coordinator, which replied
MAIN_RED_LOG_NATIVE_OBSERVED_OK exactly once. Its stored context contains SHE301_MAIN_RED_EXPECTED_FAILURE and
no unavailable marker. Restore commit 6c4a7bf3a721b193e9832f26c6255a19d28347e2 passed Actions 41037544708; the
observer re-armed to that green head with no red incident. Git diff against the original scratch baseline confirms
exact original workflow/example bytes. GITH-2 remains To do with its same PID 308220 and launch identity.
Read-only confirmation: REAL_MAIN_RED_LOG_NATIVE_ONCE_GREEN_REARM_EXACT_RESTORE_HELD_AGENT_OK.

This proves real main-red observation/log context/native notification/green recovery, separately from the first
pending-newer-head timeline proof. It does not prove check-dependent product merge: the correct-host `gh pr checks`
still refuses GraphQL statusCheckRollup access for the configured token. No permissions or authentication changed.

### Final Agents layout comparison (2026-10-30)

Manual desktop dark comparison against the isolated verified-v2.0 UI found Agents groups ordered Tasks/Backup/
Coordinators and missing the legacy explanatory paragraph. Restored Tasks/Coordinators/Backup and the exact
explanation, then restarted only the isolated preview and captured the corrected screen. Configured values and
inheritance naturally differ between the fixture baseline and fresh installation; their styling is unchanged.
Autopilot comparison retained the existing layout; its policy description names actual core containment differences,
and now uses public Claude Code/Codex names. The baseline also appends read-only Wake-up diagnostic rows after the
editable groups, so that ordering is preserved. CI asserts the restored Agents group order. Local typecheck passed.
These changes postdate the third full fresh-eyes review; no fourth round or new review claim was added.

### Fresh installation found and corrected repository creation (2026-10-30)

Started a wholly separate private home/core session on loopback ports 17896/17897. The real phone-width UI opened
with a fresh home, created a new scratch space, and native Claude replied FRESH_INSTALL_CHAT_OK. Cleanup then
reproduced a real defect: the Create space promise said “first commit”, but `git rev-parse HEAD` failed because
only git init had run. Existing non-Git folders were also refused despite the UI offering to initialize them.

The core-only initializer now handles a new leaf or an existing ordinary folder within that machine's home,
creates an empty First commit on main, leaves all existing files untracked/unchanged, and verifies HEAD. It never
initializes home itself or a folder outside home. Existing repositories remain unchanged. Initialization strips
inherited Git repository/index/config routing variables and disables commit hooks/signing for this empty setup
commit. Adding an unborn existing repository now refuses with an explicit first-commit explanation rather than
registering a space whose tasks cannot start. The app still uses only documented core exec for remote work.

Manual after-check: the real UI created she301-fresh-fixed-20261030 with f2483d3 First commit. It also converted
she301-existing-folder-20261030 to 841270e First commit while held.txt retained SHE301_EXISTING_FOLDER_BYTES and
remained untracked. Its native Claude coordinator started real Codex research task SHEE-1, whose separate worktree
has that exact HEAD and an empty committed tree: FRESH_REPO_REAL_CODEX_WORKTREE_EMPTY_HEAD_SOURCE_BYTES_OK.
No live state/service/agent/sharing configuration changed. CI coverage exercises both folder cases, unchanged
existing repository, preserved untracked bytes and refusal of home itself. Only typecheck ran locally.

Repository creation CI 41041167625 passed its new real-filesystem regression, build/types, layout and production
plugin jobs. Three older space-control fixtures failed because their fake git.head rejected an omitted ref;
the real CoreGit.head defaults it to HEAD. Updated that fixture to accept the same default, retaining all branch
validation and removal-race assertions. No local suite was run.

Fresh Codex first-use acceptance also exposed a native trust timing edge: Codex completed its first check while
its hooks awaited approval, so no session/transcript hook reached the app and follow-up chat stayed queued.
After reviewing/trusting the owned folder and generated hooks in the native Terminal panel, the operator sent
one short Terminal message. The next real hook supplied the transcript identity; the app recovered the original
FRESH_REPO_TASK_OK reply and queued chat. Native Codex then reported ready through its current helper and finished
SHEE-1 Done without a commit/merge, with the source file unchanged. Setup guidance now explains that explicit
recovery step rather than promising trust alone always connects chat. No screen guessing, auto-trust or alternate
transport was added. Native trust prompts remain an operator action on a first Codex launch.

Final owned first-install cleanup confirmed SHEE-1 closed/Done with no cleanupPending, preserved source bytes,
and successful app space removal. Core listed only finished owned t1–t4. Stopped only that private preview/core
and its Vite process, then removed the three exact newly created scratch folders after checking their complete
entry sets and public fixture bytes. Kept private proof state/transcripts for review. Main acceptance agents,
waiting worktrees, live legacy and all Tailscale mappings remained untouched.

CI 41041708042 passed core/types/build and production plugin, but its lost-response automation layout case timed
out waiting for the different-action refusal after tapping Pause. The server run snapshot and lost-response error
arrive separately and the inserted Last run moves that control. The regression now waits for the authoritative
GTM-51 run and uses the repository's existing still() helper before Pause/retry. It retains all same-ID/no-extra-
command assertions; no product retry behavior changed. This timing explanation is being checked by branch CI,
not claimed as a reproduced production defect. Only typecheck ran locally.


### Current integration handoff (2026-10-30)

Code validation: local typecheck passed; rewrite CI 41042086343 passed all three jobs at 15318781, including
build/types, 440 core tests (two expected skips are covered separately or environment-specific), browser/layout
cases and the real production plugin compiler. The earlier 41041708042 layout timeout is superseded by that pass;
no product duplicate-action safeguard was removed. Full Check 41031514810 passed all three shards at 7bd30e01.
No later whole-suite pass is claimed. Proof artifact hf2s v30 was checked and its light/dark phone images viewed; the final text-only CI update is v31.

Source preservation audit against verified v2.0: src/styles.css, src/ui.tsx, src/App.tsx, the folder picker,
artifact viewer and keyboard plugin entrypoint (plugins/keyboard/client.tsx) remain byte-for-byte identical Git objects. The search submodule changed as documented below. Reviewed the changed client files:
core-only browser/terminal transports, canonical remote task IDs, bounded log-loading/error messages, safe closed
cards, observed runtime labels, explicit refusal feedback, duplicate-safe actions and search result invalidation.
These explain the client differences; this source audit does not replace remaining full-device visual acceptance.

The fresh-install check's exact new Codex project trust entry was removed after deleting its owned scratch folder.
Parsed configuration comparison confirmed every other setting unchanged. Native historical logs/cache metadata
remain; no credentials or unrelated trust entries were copied, deleted or altered.

This is a complete reviewable implementation branch, not approved deployment or verified full parity. The
remaining gates are the unchecked matrix entries and front-page limits: external vm-ssa skipped for absent usable
access; physical-device notifications/offline return, actual voice, native provider failure/takeover, restricted
product GitHub check-dependent merge, installed service/macOS and full per-feature/device parity. Final full review
ended cleanly at ed75b57e after three rounds; subsequent manual corrections are explicitly outside that review.
Do not merge or cut over based solely on this handoff. The concrete safe execution/rollback order is in cutover.md;
actual legacy writer/launcher inventory must be reverified at the separately approved maintenance window.

Final read-only safety recheck: origin/main and origin/v2.0 both still resolve to
 ebb17d585c82906b788a8473237921802920b5c5. The active herdr user service is owned by
/home/exedev/.config/systemd/user/herdr.service (ExecStart /home/exedev/.local/bin/herdr server);
its main PID was 742764 at inspection. helper/main.sock currently has exedev ownership. These observations do not
identify every live supervisor/forward owner or authorize stopping anything. Re-inventory at cutover; do not rely
on older ownership/PID observations as permanent launch configuration. Only the owned baseline UI reference
servers were stopped; the isolated core preview remains available in the shared browser for review.

### Native effort and speed, correcting the 2026-10-30 display note (2026-10-30)

"Native model/effort display" above said Claude's session did not report effort. That
was wrong: main assistant records from Claude Code 2.1.285 on (the oldest kept here) carry
top-level `effort`, and the reader only took the model. Its Codex note was right for
that session (no effort was set, so none is logged) but missed why effort stayed blank
even when set: Codex hooks report `model` on every event with the hook's later time,
and that time then rejected the transcript's own records. Records now always outrank
hooks. Speed comes from Claude `usage.speed` and Codex `thread_settings_applied`
(`priority` shows as Fast); see [runtime state](../runtime-state.md).

Manual proof in an isolated app on Claude Code 2.1.308 and Codex 0.163.0, phone and
desktop width. Codex: Fast and Normal through the restart sheet and live `/fast`.
Claude: effort and `/effort`. `--fast-mode on` was real but this account has no usage
credits for Fast, so its records stayed `standard` and the line correctly showed no
Fast. A real Claude `usage.speed: "fast"` record is not proven; a fixture covers it.

## Device default permissions

Regular Codex coordinators and task agents no longer pass `--sandbox`, `--ask-for-approval` or
`sandbox_workspace_write.network_access`: the device's Codex configuration decides, as it already did for Claude
Code. This replaces the ordinary Codex launch policy recorded above. Read-only reviewers and Isolated workspace
launches are unchanged. Real Codex 0.163.0 runs: bypass config ran with no permission prompts, wrote a file and
reached the network with hooks firing; default config kept its sandbox and fired PermissionRequest; `exec --sandbox
read-only` stayed read-only on bypass config. Codex's trust screen in a new Git repository stays on any config, even
with `--dangerously-bypass-approvals-and-sandbox`, and neither `-c projects...trust_level` nor a trusted parent
folder clears it; a worktree inherits its repository's answer. Resuming a session started with the old flags took
the device's sandbox but kept `on-request` approvals.
