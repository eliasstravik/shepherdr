# Agent secret access in 2.1

Use secrets by name. The human adds, replaces and removes values in Settings → Secrets, at Everywhere,
machine or space scope; the most specific scope wins. An agent requests a masked input card with
`shepherdr secret ask NAME --why "purpose"`, then ends its turn. Values never belong in chat or artifacts.

`secret run NAME -- COMMAND` obtains the requested names through the current launch’s authenticated core
mailbox and adds values only to the child environment. Its output masks exact values, including values split
across output chunks. Masking is a safety net, not permission to print secrets. `secret env NAME --file .env`
requires an existing Git repository that ignores the target and writes an owner-only plain file. Prefer `run`.
Remove an env file with a plain removal command that does not print its contents. Do not use a native
read/edit/patch/delete tool that previews the file or its removed lines: that preview is outside the helper’s
output masking and can enter the native transcript and raw terminal. Core attach remains the real terminal.

## Authority and transport

Each launch receives a fresh 256-bit AES-GCM mailbox capability. The server privately binds it to the installation,
launch, chat, machine and permitted actions. The launch environment carries only the owner-only file reference
`SHEPHERDR_CORE_CREDENTIAL`, including Codex’s shell policy. Preserve that reference in tool environments without
reading or printing its contents. Never borrow another launch’s credential. The launch prompt and
`SHEPHERDR_COMMAND` select the owning command; remembered paths from an earlier start are superseded.

Requests and replies are encrypted/authenticated documents in that machine’s core. The server reads them through
its local core socket and the documented remote API. There is no SSH worker, tunnel, main.sock or HTTP secret
retrieval endpoint. Labels, request text, cwd, a chosen chat and possession of the socket’s address grant no mailbox
authority. The private grant and current agent launch/process binding are checked before dispatch. Durable request
receipts prevent repeated actions after lost responses; uncertain outcomes are reported rather than guessed.

Secret scope comes from the private agent record: its space, its owning machine, then Everywhere. Main/home task
overview access does not widen that scope. Separately launched reviewers receive no secret permission and cannot
retrieve values. A child process of an ordinary agent can inherit that agent’s capability; it is the same authority,
not a new reviewer grant. Isolated workspace agents reach only their fixed gateway and the run’s explicit secret
allowlist. They cannot read a host core socket or credential.

Grants rotate/revoke on replacement and explicit lifecycle changes. They persist privately across an application
restart so a still-running core agent can reconnect; server restart alone does not grant a new identity. A stopped,
replaced or unconfirmed actor fails closed. An old agent missing its reference needs a planned restart; never repair
it by copying a different session’s file. The secret transport never writes plaintext values into core docs, product snapshots or chat records.
This does not redact arbitrary native tool output when an agent disobeys the no-print rule.
The vault and mailbox database belong to the selected private application home.

Core is not a sandbox. Its socket allows shell/file access as the owning account, and owner-only files do not
protect ordinary agents from hostile code already running as that same account. Use the supported isolated profile
or separate accounts/machines for the required boundary. The browser never receives a core socket or raw RPC.

## Installation and legacy

The permanent 2.1 home is `~/.shepherdr`; build previews use a separate home. Backing up/relocating live 2.0 state is
an explicit later cutover action. The 2.0 worker/capability implementation remains on `v2.0` and is incompatible
with this mailbox transport. Install/start instructions are in [core/start.md](core/start.md).

Only `bun run typecheck` runs on this development VM. GitHub runs regression suites using temporary homes,
synthetic secrets and private fake/core endpoints. Existing real acceptance used a synthetic demo value, not a human
credential; full production acceptance remains in [the delivery record](core/implementation.md).
