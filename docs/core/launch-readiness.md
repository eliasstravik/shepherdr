# Frozen launch-readiness checklist — SHE-301

> Production update, 2026-10-30: Elias subsequently authorized the Mac cutover and
> 2.1.0 release, accepting the named device/voice/external-machine/full-parity limits.
> The historical NO-GO and approval wording below is superseded by that decision.
> The Mac now runs the standalone login service with fresh state; private HTTPS/assets/
> WebSocket/core, a real coordinator reply and a default harmless research task Done
> passed. A reviewed macOS reclaimable-memory fix passed full Check 41051303371.
> Login/reboot behavior, physical devices, voice, external-machine operation and
> complete parity are not promoted to verified. Check-read permission refusals remain.
> Final release CI is bound to its exact commit in the GitHub release.

Frozen against the agreed 2.1 plan and Elias's finite-readiness instruction, 2026-10-30.
No new product features, scope reduction, merge, deployment, state migration, release or version change.
The implementation/parity baseline is implementation.md; historical proof remains artifact hf2s.
Outcome words: PASS = listed evidence meets that check; FAIL = observed defect; UNVERIFIED = evidence absent; UNTESTED = an explicitly skipped acceptance test.
A fixture pass is identified as a fixture and never promoted to native/device/external proof.

| Gate | Proof required to close | Current outcome / finite remaining action |
| --- | --- | --- |
| Scope and parity freeze | Every agreed feature mapped to implementation and existing evidence; no deleted capabilities | PASS for scope inventory in implementation.md; complete visual/device parity UNVERIFIED |
| Post-review changes | Fresh independent review of ed75b57e..final code; resolve critical/major and re-review fixes | PASS: fresh Codex rounds cover ed75b57e..9c3e2d78; no critical/major at final round, documentation minor fixed |
| Exact final commit CI | Full Check on exact final code SHA, all shards/types/build green; re-run after any code correction | PASS on code 9c3e2d78: full Check 41045612532, all shards/types/build; report-head full Check is PENDING until its exact binding/result is recorded in PR #507/hf2s |
| Recurrence | Recurring time rule fires twice, restart does not duplicate, pause stops, resume advances, timezone/DST/bounded catch-up cases | PASS: two real minute-spaced Codex tasks LAUN-2/3 Done, paused and no replay after restart; CI core-launch-matrix covers calendar/count/exclusions, DST, pause/resume and bounded catch-up |
| Events | added/ready/failed/needs-you/merged/stalled and filters, no replay/recursive automation loop; heartbeat health/main-red | PASS for named fixture/filter/durable scanner matrix plus historical native failed/stalled/main-red; every event on every device remains UNVERIFIED, not claimed |
| Provider retry/fallback | Native failure classified; documented retries/one-shot takeover preserve checkout; auth/permissions/containment exclusions | PASS: owned native Claude authentication_failed/401 → one Codex takeover → LAUN-1 Done; ended-error/blocked fix and CI exclusions/backoff covered. Synthetic invalid isolated credential, not a live-account outage |
| GitHub checks/merge | Existing authorized identity reads checks on exact task head; product merge confirms exact head and cleans safely | UNTESTED per Elias: existing configured login returns HTTP 403 for Checks REST and GraphQL statusCheckRollup. No access/credential changes made; Elias declined the earlier access request, and no further requests/attempts follow |
| Install/manual/service lifecycle | Isolated home and pinned core; idempotent start/status/stop; transient service crash recovery and manual control, children survive | PASS: private transient Linux unit, SIGKILL recovery NRestarts=1, unchanged core/coordinator identity, idempotent start and manual stop/start. Not enabled/installed; production autostart/macOS remain UNVERIFIED |
| Physical phone alerts | Private preview; enroll this device, lock it, receive and answer harmless permission/question once; same card settled | UNVERIFIED per Elias: declined preview route; guided session prepared, no new mapping |
| Phone offline/reconnect | Phone offline ten minutes during harmless work; reconnect gives authoritative state/no duplicate answer/action | Simulated browser PASS historically; physical phone UNVERIFIED per Elias, no preview route authorized |
| Real voice | Isolated scoped key supplied through masked UI by Elias; mic/listen/speak/interrupt/tool result/end, no recording/value exposure | UNVERIFIED: no isolated key or authorized device route; never inspect/copy live credentials or ask for them in chat |
| External vm-ssa | Existing configured authenticated core-only connection; remote lifecycle/mailbox/files/resync | UNVERIFIED, SKIPPED per Elias: no configured address/working trusted connection. No retry unless usable details arrive; same-host SSH is distinct |
| macOS | Actual supported launcher/service and native agents on macOS | UNVERIFIED: no accessible Mac in authorized target scope. Documented only; not a pass |
| Cutover/rollback | Reviewed exact source/checks, protected v2.0, writer inventory, verified stopped-state backup, legacy relocation/config, fresh new home; rollback retains both | Runbook prepared in cutover.md; execution UNVERIFIED and prohibited until separate approval |

## Launch impact and stopping rule

Current verdict: NO-GO for launch/cutover. Software review and full code CI passed; required physical-device/voice and complete per-feature UX proof remain unresolved. Elias accepted skipping the access/device tests, not a launch or parity downgrade. External vm-ssa
is an explicitly skippable limitation, not evidence that remote deployment is verified. macOS remains unverified
and must not be advertised as runtime-validated. No launch gap is silently accepted by this checklist.

Each software acceptance gets one bounded attempt plus fixes for concrete failures; no repeated auth/setup guesses.
CI fixtures cover deterministic timing/error cases; actual harmless runs cover the feasible native/lifecycle path.
At the end report a single go/no-go, exact code/review/CI SHAs, every accepted/unresolved gap and cutover order.
A missing credential/device action becomes one precise human choice with a recommendation, not more feature work.

## Guided human session (prepared; not yet run)

Use an isolated private preview only. Existing live 2.0 URL/state stays unchanged. A new private route requires the
operator's explicit action/authorization; development must not replace existing Serve mappings. Session order:
1. Open preview on phone; confirm home/space/task/terminal/artifact navigation in light/dark and intended orientation.
2. Add this device in Notifications; lock phone. Receive one harmless approval, answer, confirm same card settles once.
3. Put phone offline for ten minutes while one harmless task completes; return and confirm final state/transcript once.
4. For voice only, Elias supplies a separately authorized key through the preview's masked Secrets UI (not chat/files).
   Start a short call, speak/listen/interrupt, ask a harmless status question, end. Remove only the isolated test key.
Record device/browser, timestamps, outcomes and exact missing steps; do not call desktop emulation a phone pass.

## Finite phase evidence log

- Fresh independent Codex review round 1 covered ed75b57e..88937344: no critical/major; one minor audit wording
  corrected to name the unchanged keyboard entrypoint, excluding its changed search submodule. Round 2 reviewed
  new matrix/tests through a7852072: no critical/major. No local checks were run by the reviewer.
- GitHub existing configured identity: owned repository check-runs REST call returns HTTP 403 “Resource not
  accessible by personal access token”. No credential inspected/copied or alternate identity injected. Elias was
  asked only to enable Checks/Commit statuses read for the existing login, or retain no-go for that gate.
- Native owned provider attempt: only the new transient application's Claude environment uses an empty private
  config and deliberately invalid synthetic API credential. Claude emitted native authentication_failed/401 and
  OSC blocked; the UI showed the real error. Before correction no provider retry/takeover was recorded because
  the generic blocked guard excluded even an ended provider failure. Correction permits recovery only with a
  caught-up ended native error, retaining permission/question/secret/background/identity gates. After restart,
  the product performed exactly one Claude→Codex takeover for Signed out; native Codex replied
  OWNED_PROVIDER_FALLBACK_OK and task LAUN-1 finished Done. This is an actual native failure with an intentionally
  invalid isolated credential, not a real account outage or failure manufactured in a live agent. Backoff timing
  and exclusion cases remain deterministic CI fixtures.
- Transient Linux service she301-launch-accept: never installed/enabled. Own main process killed once with
  SIGKILL; systemd restarted it (NRestarts=1), private core ID and coordinator PID/launch unchanged. Idempotent
  manual start returned the service PID. Only this owned service/core/home/port were involved.


## Final bounded outcomes and cleanup

- Code commit 9c3e2d786c31658a08f15b5fa5525d5acf40f73b: independent final round clean; full Check
  41045612532 and rewrite 41045613515 PASS. Earlier a7852072 full Check was cancelled after the concrete provider
  correction; it is not final-code evidence. This report-only commit receives its own full Check; exact final
  SHA/run/result are recorded in PR #507 and proof hf2s without changing checked code afterward.
- Actual native recurrence: UTC DTSTART 20261030T110600, one-minute interval COUNT=2. Exactly LAUN-2 and LAUN-3
  replied FINITE_RECURRENCE_NATIVE_OK and closed Done. Restart retained the same coordinator and no third run;
  paused the rule, confirmed no cleanupPending on any of LAUN-1/2/3, then removed only the owned space.
- Owned transient service was collected after stop (LoadState=not-found, ActiveState=inactive). Manual detached
  app stopped; private core listed only finished owned t1–t9, then stopped. Own Vite server stopped. Removed only
  the exact newly created empty scratch repository and its added native Codex project trust entry; every other
  parsed setting unchanged. Private proof state/logs retained. No live agent, service or state was stopped/moved.
- Elias explicitly chose no broader GitHub access and no private preview route. GitHub merge test is UNTESTED;
  physical device/voice checks stay UNVERIFIED. No repeated access guesses, permission requests or key requests.
- External vm-ssa stays UNTESTED/UNVERIFIED for missing configured usable/trusted connection. macOS stays
  UNVERIFIED for unavailable authorized machine. Same-host two-core/loopback proof is not external-machine proof.

## One safe future cutover order (not authorized)

1. Finish/explicitly accept unresolved launch gates; bind exact reviewed SHA to green full CI and proof.
2. Re-inventory all legacy writers/launchers; stop follow-main rebuild/autostart and pin a protected v2.0 build.
3. During separately approved maintenance, finish or explicitly stop legacy agents and all writers.
4. Back up stopped legacy state including WALs; verify a separate restore, then relocate to ~/.shepherdr-legacy.
5. Configure every legacy launcher/helper to its pinned build and relocated home; prove no writes to the new home.
6. Only then integrate the reviewed result without the old deploying merge helper; initialize fresh ~/.shepherdr.
7. Start the pinned standalone build/core; change private sharing or enable services only within explicit approval.
8. Rollback: stop new writers, preserve new state separately, restore recorded private sharing and verified pinned
   legacy configuration/backup. Never mix stores, overwrite work or force-reset main/v2.0. See cutover.md.

No remaining choice is hidden: recommended verdict is no-go until the unresolved required acceptance is completed
or Elias explicitly accepts a named limitation. No permission for merge/deploy/cutover/release is implied.
