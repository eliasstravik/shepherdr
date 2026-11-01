# Standalone Shepherdr on core

Standalone 2.1 installation and service instructions. See the
[delivery record](implementation.md) and [launch checklist](launch-readiness.md)
for accepted, unverified limits. Stop and preserve legacy writers/state through the
[cutover runbook](cutover.md) before creating the fresh installation.

## Requirements and installation

- Bun 1.4.2 (the CI-pinned version), Git, and herdr-core **0.1.14 or newer**, generation 1. A core that herdr-app or
  `hc update` moved forward is fine.
- Claude Code or Codex installed and signed in on each machine that runs agents.
- Tailscale on the server and the devices opening the app.

Build the reviewed source on a build machine or CI, not the shared agent VM:

```sh
bun install --frozen-lockfile
bun run build
```

Put this checkout's `bin` directory on PATH. The application is standalone:
there is no terminal-herdr plugin installation and no herdr-app dependency.
Core has its own `shepherdr` session, keeping these agents separate from a
desktop client's default core session. The server checks hello and the live
schema before accepting work: the core's generation and every method Shepherdr
uses. Core's API only grows within a generation, so a newer core passes; another
generation, or one with a method missing, is refused with what to do.

## Manual control

```sh
shepherdr start
shepherdr status
shepherdr stop
```

Start refuses an application that has not been built, and names the step: it would
otherwise report running while its page is an error. Start is idempotent. It returns the running PID, core connection status, and
any existing private Tailscale Serve URL for that port. Stop stops only the
application: core and its agent terminals keep running. A stopped application
does not receive new phone requests until restarted.

The permanent home is `~/.shepherdr`. Startup refuses an unmarked, nonempty
home, so it cannot silently reuse legacy state. `status` is read-only. Build
previews must explicitly choose separate state, port and core session:

```sh
shepherdr start --home /tmp/shepherdr-preview --port 17887 \
  --core-session shepherdr-preview --core-bin /path/to/hc --no-plugin-updates
shepherdr status --home /tmp/shepherdr-preview
shepherdr stop --home /tmp/shepherdr-preview
```

`--core-socket` can select an endpoint inside a private directory. Keep custom
socket paths short. Never share the core socket over the network.

`--no-plugin-updates` is for Vite previews on a machine where build checks are prohibited. It disables the plugin
watcher and switches. Ordinary startup watches the selected home's plugins and off list, builds from a fixed copy
of the started application, and swaps plugin runtime/assets without restarting agents. It never follows main or
another checkout ref. Keep the installed source/dependencies available while it runs. See [Plugins](../plugins.md).

## First Codex start

Codex can ask you to trust the new folder and Shepherdr's generated hooks, whatever its permission settings: even
`approval_policy = "never"` with `sandbox_mode = "danger-full-access"` still asks in a new Git repository. It asks
once per repository (its worktrees share the answer) and again for hooks only when they change. Each of its screens
comes to the chat as a card ([Chats](../chat.md)); trust only the intended folder and generated hooks.
Codex reads hooks as it starts, so `Trust all and continue` connects the chat straight away. Reviewing them one by one
leaves that first turn unconnected: the card then shows Codex's message box, and one short message in Terminal
connects the chat and recovers earlier replies. Normal chat messages saved during setup stay queued until then.
Readiness still comes from native hooks, never from the screen.

## Your chat name

The human sender name keeps the legacy default: the first name from the main machine's global Git name,
then the capitalized account name. An optional `config.json` in this installation's initialized home can set
`{"user":"Avery Lee"}`; restart the application after changing it. Replies, reactions, attachments, artifact
comments, browser notes and secret-saved notices use that name. It is presentation only, never mailbox or secret
authority. Preview homes do not read or import the legacy home's profile.

## Private URL

The server binds only to `127.0.0.1`. Startup discovers existing Serve mappings;
it never installs or changes one, and never enables Funnel. After deployment
approval, the operator can inspect `tailscale serve status` and add a private
path without replacing existing mappings:

```sh
tailscale serve status
tailscale serve --bg --set-path /shepherdr 7787
shepherdr status
```

Use the private HTTPS URL printed by status. Relative frontend assets and API
URLs support a path prefix. If that path is already occupied, choose a separate
HTTPS port using documented Tailscale Serve options. Do not expose raw core RPC
or use Funnel. No Tailscale changes are part of development checks.

## Background service and crash recovery

Manual `start` detaches the application from the terminal. For autostart and
automatic application crash recovery on Linux, an operator can install this
user unit **after cutover approval**, replacing every absolute placeholder:

```ini
[Unit]
Description=Shepherdr standalone application
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/shepherdr
ExecStart=/absolute/path/to/shepherdr/bin/shepherdr start --foreground
Environment=PATH=/absolute/path/to/bun/bin:/absolute/path/to/hc/bin:/usr/local/bin:/usr/bin:/bin
Environment=SHEPHERDR_HOME=%h/.shepherdr
Restart=on-failure
RestartSec=2
KillMode=process
TimeoutStopSec=120

[Install]
WantedBy=default.target
```

Manual service control uses `systemctl --user start|stop|status shepherdr`.
Enabling it is an explicit operator action; the application never enables it.
Choose either service control or detached manual startup as the process owner.
`shepherdr status` reports either; do not start a second supervisor.

For Linux boot startup without a login, the operator must also choose whether to
allow user services to linger (`loginctl enable-linger USER`). Inspect the current
setting first; this build does not change it. Add `UMask=0077` to the service unit.

On macOS, first initialise the approved home with a manual start/stop, then an
operator can save the following as `~/Library/LaunchAgents/dev.shepherdr.plist`.
Replace every absolute path and NAME; do not leave a detached manual instance running.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.shepherdr</string>
  <key>ProgramArguments</key><array>
    <string>/absolute/path/to/shepherdr/bin/shepherdr</string>
    <string>start</string><string>--foreground</string>
    <string>--home</string><string>/Users/NAME/.shepherdr</string>
  </array>
  <key>WorkingDirectory</key><string>/absolute/path/to/shepherdr</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/absolute/path/to/bun/bin:/absolute/path/to/hc/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>/Users/NAME/.shepherdr/service.log</string>
  <key>StandardErrorPath</key><string>/Users/NAME/.shepherdr/service.log</string>
</dict></plist>
```

After deployment approval, operator commands are:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.shepherdr.plist
launchctl print gui/$(id -u)/dev.shepherdr
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/dev.shepherdr.plist
```

LaunchAgents start at user login, not before login. `shepherdr stop` exits normally
and leaves agents running; the unsuccessful-exit policy does not immediately undo
that manual stop. For manual service restart use bootout/bootstrap. The plist is a
reviewable template. Installation and manual service startup were verified on the
production Mac during the authorized 2.1 cutover; reboot/login and crash recovery
remain unverified. No plist is installed or loaded automatically.

The application reconnects with a fresh core snapshot after disconnect. Its
recovery loop starts the configured core again if that core crashes; it never
updates binaries or kills holders. Core holders preserve agent programs across
core/server restart. A host reboot ends those programs: the app must report their
real stopped state, rather than automatically rerun potentially completed work.

## Command compatibility

`start`, `stop`, and `status` with no task ID are application lifecycle commands.
`status TASK ...` remains an agent progress report. Core agents receive a private
credential file at launch; their remaining commands go through authenticated
core documents. `shepherdr agent ...` is an explicit spelling inside that
session. Their chat names do not grant authority, and `--url` cannot redirect
their credential to a web server.

Existing 2.0 helper sessions keep their installed authoritative helper and
legacy routing. Development never replaces that helper. At cutover, legacy
code is pinned to `v2.0`, all legacy writers are stopped, the verified legacy
home is backed up and relocated, and only then is the fresh core home created.
The detailed cutover/rollback inventory is a delivery gate, not an installer side effect.

Task dependencies accept full task IDs, a bare ID on the task’s machine, or a bare number in its space.
Use `machine-name:TASK-1` (or the stable machine ID before the colon) to select a main-machine task when its
bare ID also exists locally on a remote machine. Names are resolved when queued; saved edges use permanent IDs.
Unknown, ambiguous, self and circular dependencies are refused without replacing the previous queue.

### Repository SSH in contained runs

Repository operations stay in the trusted checked Git broker; SSH here is only Git transport, never an agent,
mailbox or core transport fallback. Keys and agent sockets remain outside contained agents. Ordinary host aliases,
users/ports, static IdentityFile/IdentityAgent/certificate/known-host paths and literal ProxyJump hosts are copied
into a private checked profile only when Git actually chooses SSH. Nested Include conditions keep native OpenSSH
scoping; every included branch is inspected. Already trusted host keys and noninteractive account authentication
are required. No new host key is silently accepted. HTTP and local Git never parse this SSH profile.

Match exec, ProxyCommand, LocalCommand, KnownHostsCommand, external key-provider programs and unknown SSH
extensions refuse with an explicit adapter message. Forwarding, shared control sockets, environment forwarding,
interactive prompts and host commands are disabled. Only standard git-upload-pack/git-receive-pack services are
accepted. Dynamic host/environment substitutions in account paths, ProxyJump URIs, and nonstandard custom Git
remote programs still need explicit adapters; do not claim those configurations work. Ordinary Include wildcards
are supported, not recursive globstar or brace extensions. This checked profile does not change normal agents or
any user's SSH configuration. Private request/config copies are removed with the repository operation.

## Isolated Autopilot prerequisites

The contained workspace adapter currently requires Linux with working unprivileged
user/mount/network namespaces, `bubblewrap` (`bwrap`) and `flock`. Ordinary native
agent sessions and the app launcher do not use this boundary. Missing prerequisites
refuse contained startup/adoption; there is no unrestricted fallback. The native
Claude Code/Codex CLI and its account must already be installed on that machine.
The build checks used Claude Code 2.1.314 and Codex 0.163.0; Codex's installed
`codex-code-mode-host` companion is mounted with its CLI. Other native versions
still need acceptance. Legacy 2.0's `server/live/autopilot-sandbox.ts` also refuses
non-Linux contained startup; this preserves that platform limit. Ordinary macOS
remote sessions still require their separate acceptance checks.
No dependency installation or live service enablement is part of these checks.

### Ordinary Codex command access

Ordinary Codex coordinators and task agents launch with no permission or sandbox flags, like Claude Code, so each
machine’s own Codex configuration decides. With `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"` they run without asking. With Codex’s defaults they stay in its workspace-write
sandbox, its prompts reach the human as permission cards through the PermissionRequest hook, and
hooks run outside that sandbox, so chat keeps working. That sandbox has no network, and this includes the agent’s own
local core Unix socket, so each `shepherdr` command needs an approved run outside it. A device that wants those
commands to run freely can set `sandbox_workspace_write.network_access = true`; it also allows all other network use.

Core socket access already grants shell/file authority as that account. Native workspace write restrictions are not
a security boundary against an ordinary agent that can use core. Use the Isolated workspace profile when an enforced
host/network boundary is required; its outer gateway/allowlist remains separate. Read-only reviewers keep their
read-only native mode, whatever the machine’s default.

Shepherdr never writes the human’s Codex configuration. Managed Codex requirements still apply; an incompatible
managed policy must be resolved by the operator, never bypassed. See the official
[approval/security configuration](https://learn.chatgpt.com/docs/agent-approvals-security) and pinned
[0.163.0 schema](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/config.schema.json).

## GitHub access on an agent machine

The existing Git/GitHub CLI login on that machine is used through core; no
separate worker or copied credential is installed. Private repository access,
Git push, pull-request read/write, commit status read, and check-run read must
be granted by its operator. In particular, a token that can open a PR can still
lack permission to read GitHub checks. A 403 or incomplete check snapshot is
an error, never green checks or permission to merge. PR identity/Ready promotion
can work independently of check-read access. Published comments and merge
observation use the same explicit repository/host identity.

A confirmed GitHub merge is recorded even when performed outside Shepherdr.
The base checkout is fetched and fast-forwarded only when it is on the expected
branch and clean; dirty/diverged work is kept and syncing retries. Cleanup waits
for sync and captured native completion before removing only landed clean work.
The observer never initiates a GitHub merge or grants an approval.

### Human secret commands

On the main machine, use `shepherdr secret set NAME [--machine | --space NAME] < file`
and `shepherdr secret rm NAME [--machine | --space NAME]`. Default scope is Everywhere;
space names include renamed display names. Use `--home PATH` for an isolated preview.
Values are accepted only on bounded stdin, never as command words. Settings remains
the masked interactive route. The running server is the sole vault writer.

These two human commands use an OS-owned mode-0600 Unix socket inside the mode-0700
installation home. They have no HTTP endpoint and do not pass values through core
documents or chat. Socket location is recorded per server boot in private `run.json`.
The OS account is trusted, as it already owns the core socket and vault. Agents keep
using their launch credential and authenticated core mailbox; their `secret set/rm`
commands are refused. Agent `secret list/ask/run/env` scope rules are unchanged.
A stopped server must be started explicitly; these commands never start it or migrate
legacy state. Existing installed 2.0 helpers remain the command for legacy sessions.
