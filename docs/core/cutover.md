# Cutover and rollback — approval required

This is a reviewable operator runbook, not an installer or an action already taken.
Do not execute it during development. Elias must separately approve deployment/cutover;
2.1.0 version/tag/release/publication needs another explicit yes.

## Verified development baseline

- The live installation is `/home/exedev/dev/shepherdr`. Its current 2.0 supervisor
  follows main and can rebuild/restart immediately after integration.
- Verified legacy main and protected `v2.0` baseline:
  `ebb17d585c82906b788a8473237921802920b5c5`.
- The rewrite stays on `work/301-build-shepherdr-2-1-on-core` until complete and reviewed.
  No partial slices may be merged into live-followed main.
- Development state is `/tmp/she-301-accept`, port 17887, core session `she301`;
  it is disposable proof state, never a source of production migration.

## Before requesting the final cutover

Record the final reviewed integration commit and its GitHub check run. Retain the
verified `v2.0` ref without force-pushing or overwriting any ref. Inventory the actual
running legacy supervisor, app, all machine workers, task/coordinator/reviewer agents,
installed helpers, login/background launch configuration, plugin launch actions and
Tailscale Serve status. Record exact executable paths, configured homes and owners.
Do not print environment/credential contents. Resolve any unknown writer before moving
state. Include a maintenance window and the human's decision on unfinished legacy work.

Build the final source in CI or a build machine and retain both reviewed builds.
Verify the pinned core and native CLIs, private URL plan, service configuration,
backup destination/capacity and rollback permissions. Do not enable a new service or
replace a Tailscale mapping as part of these checks.

## Approved execution order

1. Freeze legacy source updates first. Stop its automatic follow-main/rebuild supervisor
   and autostart paths, then protect the installed legacy application with a dedicated
   checkout/build pinned to the verified `v2.0` commit. Do not run legacy from the main
   checkout while main becomes 2.1. Verify the protected build before proceeding.
2. Finish or explicitly stop all legacy agents and writers on every machine during the
   approved maintenance window. Stop the legacy app/workers and their autostart owners.
   Confirm no helper, hook, worker or agent still writes the old home. Moving a socket
   or JSON file under a running writer is not safe. No agent is silently restarted.
3. Back up the entire stopped `~/.shepherdr`, preserving modes, symlinks, vault, SQLite,
   logs, plugins and browser profiles. Use a private destination outside both homes.
   Save a manifest/checksum inventory and verify a restore into a separate private
   scratch directory. Retain the original stopped state until the backup is verified.
4. Refuse if `~/.shepherdr-legacy` already exists; inspect it with the human instead of
   overwriting/merging it. Relocate the stopped legacy home there. Configure every
   legacy launcher/service/worker/helper reference to that home and the pinned legacy
   build. Audit absolute `~/.shepherdr/helper` paths in saved launch instructions;
   old sessions must not be resumed with stale commands. Reprovision only explicitly
   approved legacy sessions with their own legacy command and credential references.
5. Confirm the legacy configuration reads/writes only `~/.shepherdr-legacy`. Restart it
   only if approved, then verify a harmless status/read operation and ownership paths.
   The legacy code and its agents must never write the fresh 2.1 home.
6. With live-following disabled and the protected legacy installation verified, perform
   the separately approved final integration into main using the reviewed task result.
   Record the resulting commit. A task merge must not invoke the old live deployment
   path. If the legacy merge helper would deploy or restart the unprotected checkout,
   stop here and settle the concrete integration command before executing it.
7. Start the reviewed standalone build with fresh `~/.shepherdr` and its dedicated core
   session. There is no JSON/SQLite/plugin/session import. Verify the new installation
   marker and private state permissions, core schema check, status and native agent run.
8. Install/enable the reviewed background service only if included in deployment
   approval. Change the private Tailscale mapping only with that same explicit scope,
   after saving its prior configuration. Open the private HTTPS URL and verify phone,
   tablet, desktop, alerts and microphone as applicable. Never publish the core socket.
9. Record exact new/legacy homes, source commits, core version/session, URL, service
   owner, backup and rollback locations. Confirm there is one writer per home.

## Rollback

Stop only the new app/service and explicitly approved new agents/writers first.
Preserve the entire new 2.1 home under a fresh private rollback name; never overwrite
it with legacy JSON. Restore the recorded private sharing configuration if changed.
Keep 2.1's core session separate from legacy terminal-herdr.

For legacy recovery, use the pinned legacy build and verified `~/.shepherdr-legacy`
configuration. If restoring the original home is required, first prove both versions
and all their writers are stopped, verify the backup, and refuse any occupied target.
Restore the stopped legacy backup with its recorded permissions; restore the matching
legacy home/path configuration before starting legacy. Never run old helpers against
2.1 state, never merge the two stores, and never discard either version's work.

A source rollback does not imply a state-format rollback. Do not reset or force-push
main/v2.0 as a recovery shortcut. Retain the new integration and evidence for review.
