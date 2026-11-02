# Other machines

Shepherdr connects only to its local herdr-core socket. Configure remotes with the
core's documented remote commands (`hc schema`/`hc --help`), using existing
SSH authentication. Core owns the remote connection, combined events and qualified
terminal identities. Shepherdr does not configure machine access or credentials.

A core session's machines are the ones added to that session (`HC_SESSION=shepherdr hc machine add …`). The app
reaches every machine on its session: from start it runs health, CLI and plan-limit reads there, and it copies its
agent helpers only when you start an agent there. So a new home never takes on machines by chance: if its core already
has some, the first start stops and lists them, without starting a stopped core, until `--core-session` names a core,
a new one for a trial or that same one to use them. A home remembers its core, and a later start on another one stops
and names it. A machine added to a core is added for every home on it, so give a trial its own core. Homes from before
this check have no record and keep working as they are.

Only Shepherdr-owned spaces and agents appear. Tasks are coordinator children with
outlive-parent enabled; workflow status remains separate from process liveness.
Each machine needs Git, Bun and the chosen signed-in Claude Code/Codex CLI. Optional
GitHub and browser capabilities need their existing tools/accounts too. See the
[requirements](core/start.md).

Remote agent commands use their own core's authenticated encrypted document mailbox.
The server answers through core. Artifacts and files are read using core file/exec
APIs. Browser frames, controls and terminal traffic use core children/attach and the
application's bounded WebSocket connection. No SSH mirror, tunnel, worker, extra
machine listener or remote HTTP bridge is installed.

On disconnect, saved chats remain visible and queued messages wait. After missed
events or core restart, the app takes an authoritative snapshot and rereads logs;
core has no event replay. Unknown outcomes are not reported as successful actions.

Health is sampled through bounded core exec on each connected machine. Settings
retain task-capacity, load, memory and alert limits. A stale sample is shown as stale;
a remote connection failure is distinct from an agent finishing or a task being Done.

Actual same-host two-core and isolated SSH-loopback acceptance are recorded separately
from external-machine acceptance. The selected external target is vm-ssa; configured
access was unavailable, so that test is unverified, not passed. See the
[acceptance evidence](core/implementation.md).
