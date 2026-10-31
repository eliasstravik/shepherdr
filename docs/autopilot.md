# Autopilot

Autopilot is a brief, a wake-up schedule and a constrained coordinator. Settings → Autopilot has one editable
plain-text **Heartbeat**: direction, priorities, constraints, evaluation, reporting, escalation and an optional
stopping goal all belong there. Generated launch settings follow it as ordinary text. There are no mission,
evaluation or reporting forms and no mission dashboard. Task briefs and Heartbeat use the plain-text treatment
introduced in SHE-294.

An ongoing instruction such as “keep improving the game” has no invented stopping target. A finite goal such as
“halve startup time” ends when the coordinator proves it, saves evidence and calls `shepherdr complete "evidence"`.
Each wake reads Heartbeat and saved progress, inspects Shepherdr with its tools, chooses permitted useful work,
acts, evaluates evidence and saves progress/next step with `shepherdr progress "…"`.

When, Events and time zone reuse the existing trigger machinery. Selected events wake immediately; other news
waits for the next heartbeat. Run now queues a wake until the coordinator is idle. Next and Last show schedule,
time, wake reason and delivery/turn outcome; a turn ending is not a claim that the goal succeeded. The coordinator's
actual messages and saved progress carry its results; Shepherdr generates no separate status report.

The ⋯ switch asks first, with what it replaces and spends and the limits now set. Where it can't run (a home space,
the wrong permission profile for its system, a quarantined Codex helper or an old Bun in the Mac sandbox, no usable bubblewrap, or its CLI missing or signed out) the switch is greyed with the reason, and
Settings → Autopilot shows the same line. Turning off is one tap.

Turning ON closes/replaces the regular coordinator with a fresh selected Autopilot session. OFF starts a fresh
regular coordinator using normal defaults. The chat key, old transcripts, queued human messages and saved progress
stay. During replacement, messages wait and new launches are blocked. Old-run events are discarded. Failed starts
leave Autopilot stopped with the error; they never launch an unrestricted fallback. Retry by applying settings or
turning OFF/ON. Changing launch/access settings while ON replaces the coordinator and stops its owned workers.

Task/reviewer defaults are reused. Agent, Model and Effort accept optional Autopilot overrides; `inherit` follows
the regular coordinator default and `default` uses the selected CLI's own default. An incompatible inherited model
or effort is refused rather than silently substituted. Automatic fallback is disabled for owned tasks.
Before an isolated launch, the new pane switches to a clean non-login `/bin/sh`; its actual process arguments and
wrapper PATH are verified before Herdr starts any agent. A shell configuration that cannot make this handover is refused.

## Capabilities and limits

| Runtime | Claude Code | Codex | Other Herdr agents |
| --- | --- | --- | --- |
| Shepherdr chat reader, model/effort adapter | Yes | Yes | Not currently viable for coordinator chat; refused |
| Shared Linux isolation, schedule, fresh mode replacement | Yes | Yes | Refused |
| Isolated workspace: local Linux repository space with usable bubblewrap namespaces | Required | Required | — |
| Mac sandbox profile on a local macOS repository space | Yes | Once its helper is out of quarantine; real model not verified, see below | Refused |
| Mac sandbox profile on a connected Mac | Nothing refuses it; not verified | Not verified | Refused |
| Mac sandbox with local ports, for Gradle builds | Yes, on a local Mac; see its section below | Same as Mac sandbox; Gradle under it not verified with Codex | Refused |
| Home-space Autopilot | Refused | Refused | — |
| Connected Linux machines | Nothing refuses them; not verified | Nothing refuses them; not verified | — |

The **Isolated workspace** profile uses bubblewrap PID, mount, user and network namespaces, drops capabilities,
clears inherited environment and starts with a private provider home. It applies to the whole process tree,
including shell commands, native helpers and headless reviewers, regardless of their own sandbox flags. System executables, libraries and certificate configuration are read-only. Other host
home files, Herdr/Shepherdr control sockets and local/private network are absent. The coordinator sees its project read-only;
workers can write only their own worktree and private runtime home. Host Git metadata is read-only. A worktree
containing hardlinks to shared files is refused rather than exposing those shared inodes for writing.

Exact public HTTPS host names are allowed through a trusted CONNECT gateway. Wildcards, arbitrary ports, direct
network access and private/loopback/Tailscale destinations are blocked. Provider clients must honor the HTTP(S)
proxy. This limits CONNECT destinations and their resolved public IPs; encrypted application traffic is not inspected,
so another service hosted on the same IP may be reachable. Custom providers may need their public host added; a local provider is unsupported. Failure never enables
host networking. Provider configuration is copied selectively: host MCP executors, hooks and installed plugins
are not imported. The selected agent and reviewer login files are copied into the private home; the host login files are not overwritten.
A login that cannot work in the isolated runtime needs the human; it never falls back to another account. The Mac sandbox differs: Claude follows the host's live login (below).

The gateway fixes command chat/cwd identity itself. A caller cannot choose another task, secret scope or permission
profile. Secret values use the existing masked CLI flow, only for names explicitly in this profile. Settings,
deleting tasks, unrelated work and host-file artifacts require the human. Merges require human approval by default;
choosing `none` permits managed-task merges while each task brief's merge policy still applies. Workers save a
commit using `shepherdr checkpoint "message"`; this broker operation stages their worktree and commits with hooks, filters, custom Git credential helpers
and filesystem monitors disabled. Broker Git uses normal SSH configuration or the authenticated GitHub account;
workspace-controlled scripts are not run on the host. Custom clean/smudge filters and custom SSH command wrappers
are unavailable through this broker. Direct Git metadata writes are refused.

Each task stores its trusted run owner before startup. Cross-harness managed workers inherit the same profile.
Turning OFF stops owned workers by default; “Turn off; let workers finish” keeps their existing boundaries and shared
allowance/deadline. Unrelated earlier tasks are neither stopped nor relabelled. Native descendants stay inside their
parent's namespace, and stopping that runtime kills the namespace. Server restart fails closed: old runs stop and
need explicit retry, rather than being revived without their gateway.

## The Mac sandbox profile

macOS has no namespaces, so **Isolated workspace** is refused there and you choose **Mac sandbox** instead (Settings →
Autopilot → Permission profile). It is refused on Linux. Coordinator, workers and reviewers, Claude Code or Codex, all
run under one generated Seatbelt profile that denies by default, through `sandbox-exec`. If it can't start, Autopilot
stays stopped; nothing runs unrestricted. It needs Bun 1.4.2 or newer on that machine, and `flock` (`brew install
flock`) to adopt an existing task into a run. The gateway, exact-host allowlist, broker Git, secrets and limits are the
same code as on Linux.

What it does not give you, compared with Linux:

- **Files are denied, not hidden.** Other home files, Git metadata writes and control sockets are refused by rule. An
  agent can't list or read them, but can test whether a path it guesses exists and see its size and dates. It can
  start a program elsewhere in the home folder, under the same profile. Linux shows it an empty world instead.
- **No PID namespace.** Other processes are visible by PID and name through `sysctl`, and they can't be signalled. Seatbelt
  doesn't stop a direct `sysctl` asking for another same-user process's arguments and environment. So an agent can read
  tokens in the environment of host processes on this Mac, and a secret another agent is using through
  `shepherdr secret run` while it runs. Setuid programs, including `ps` and `sudo`, don't run.
- **Stopping is a sweep, not a kernel guarantee.** A process can't leave its profile, and the kernel answers for any
  PID what that profile allows, so a watcher outside finds this run's processes exactly, detached daemons included.
  It lives in its own session and ends them when the runtime stops, its wrapper crashes or the shared runtime is up.
  Killing that watcher and the wrapper together from outside could leave one running. So could a process that keeps
  forking to dodge each pass: the watcher keeps trying for an hour, and its failure shows only on that terminal, so
  Autopilot can show the run as stopped meanwhile. Until it's caught, that process has no gateway or network, but can
  still write its worktree.
- **Loopback is shared with the whole Mac.** There's no private localhost, and Shepherdr's own web port would be on
  it, so an agent reaches only this run's CONNECT port. Anything that talks to itself over localhost fails, including
  local test servers. Gradle can't run at all, even with `--no-daemon`: it binds a local socket at startup and stops at
  `FileLockContentionHandler` with `SocketException: Operation not permitted`; use the profile below for that. Unix
  sockets inside the private home work.
- **Java needs settings of its own.** A JVM's default sockets use IPv4-mapped addresses, which the rule for this run's
  CONNECT port doesn't match, so it can't reach even that port without `-Djava.net.preferIPv4Stack=true`. It also
  ignores `HTTPS_PROXY`, and takes its home folder from the system rather than `HOME`, so it's denied the real one
  unless told otherwise. A JDK kept in the home folder, or linked there from `/Library/Java`, can't be read. The
  profile below sets all of this for you.
- **There's no private `/tmp` or `/dev`.** `TMPDIR` points into the private home; a tool that hardcodes `/tmp` fails.
  Only named devices and the run's own terminal are open, so a tool that needs a new pseudo-terminal fails too.
- **Shared memory, semaphores and system notifications aren't private.** An agent can open the host's named segments,
  such as the notification center's, and post or read notifications.
- **`sandbox-exec` is deprecated.** Apple marks it deprecated but still ships it and uses Seatbelt itself; Claude Code
  and Codex rely on it too. A future macOS could remove it, and Autopilot would then refuse to start on a Mac.

Readable system locations are `/usr`, `/bin`, `/sbin`, parts of `/System` and `/Library`, Xcode, Homebrew and
`/private/etc`, without the Data volume's second path to user files. The Keychain, LaunchServices (`open`), AppleEvents,
launchd, the pasteboard, Spotlight and preferences are out of reach. macOS refuses nested sandboxes, so Claude Code's
and Codex's own are turned off inside and the outer profile is the boundary. A tool that builds its own sandbox fails
too: for `xcodebuild`, pass `-IDEPackageSupportDisableManifestSandbox=1 -IDEPackageSupportDisablePluginExecutionSandbox=1`.
Apple's `trustd` is out of reach because it fetches URLs named in a certificate from outside the sandbox, so Go and
Swift programs that verify TLS through the system fail. `xcrun` and the `/usr/bin` developer shims can't run, because their shared cache would steer the host's own tools;
Xcode's own tools and its toolchain's compilers come first on `PATH` instead. iOS simulators and full Xcode builds are untested.

## Mac sandbox with local ports

Gradle needs sockets of its own: a UDP lock socket, a daemon, and workers that connect back over TCP. Seatbelt has no
private loopback to give it, so this separate profile opens a part of the shared one. Choose it only for a repository
that builds with Gradle, knowing these limits, none of which **Mac sandbox** has:

- **Another machine can connect to an agent.** Seatbelt can't confine a listener to loopback. An agent can listen on
  every address, and any machine that can reach this Mac, on its network or tailnet, can connect and read what it
  sends, past the gateway and its host list. A second machine reading from a contained listener confirmed this. The
  agent still can't start that connection itself. Use it on networks you trust; macOS's firewall may block this, but
  that isn't tested.
- **A service that starts later is reachable.** An agent can connect to local ports 49152–65535, where the system
  assigns a listener's port, and 17001–18000, where Kotlin's compile daemon picks one. Seatbelt can't tell which
  listeners are the run's own, so each launch reads what listens now and closes those ports, whoever owns them. That
  covers Shepherdr's web port and any host service already up. Something that starts afterwards on those ranges, such
  as a browser's debugging port or a dev server on an assigned port, can be reached until the next launch. So can
  another run's CONNECT port, and UDP services on those ranges whenever they started. Every other local port stays closed.
- **A launch takes about 4 s longer.** Seatbelt has no port ranges, so the profile holds one rule per port and takes
  that long to compile.
- **A port that closes after the launch stays closed.** If the system assigns one to a Gradle listener, that build
  fails with `Could not connect`; it's rare, and the next launch reads the ports again. Rerunning the build usually
  gets another port.

Each agent's JVMs get `JAVA_TOOL_OPTIONS`, which every JVM prints a line about when it starts. It sends them through
the gateway and gives them private home and temporary folders, and `GRADLE_USER_HOME` is private as well. So a build's
caches start empty, and nothing reads the host's `~/.gradle`. JVMs reach each other over `::1`, because a plain JVM
reaches `127.0.0.1` through an IPv4-mapped address that no rule can match without opening the internet. So a JVM
connecting to the literal `127.0.0.1` fails, and `localhost` works; other programs can use either.

`JAVA_HOME` is whatever `/usr/libexec/java_home` finds. JDKs in `~/Library/Java/JavaVirtualMachines` and the JDK
folders mise and SDKMAN keep, and the Android SDK at `~/Library/Android/sdk`, are readable, and `ANDROID_HOME` points to
that SDK. The SDK is read-only: install what a build needs before starting Autopilot. Add the hosts it downloads
from to **Network hosts**. A Kotlin Android build here needed `services.gradle.org`, `github.com` and
`release-assets.githubusercontent.com` (the wrapper), `plugins.gradle.org`, `plugins-artifacts.gradle.org`,
`repo.maven.apache.org`, `dl.google.com` and `maven.google.com`. A file Git ignores, such as `google-services.json`, isn't
in a worktree unless the project makes one. Android emulators, instrumented tests and Kotlin/Native builds are untested.

**Codex needs its helper out of quarantine.** A current model runs commands through a `codex-code-mode-host` helper
beside the CLI. A Homebrew cask leaves that helper quarantined and unapproved, and macOS then hangs it, in or out of a
sandbox, so Codex says only `timed out negotiating with the code-mode host`. Autopilot refuses such an install and names
what clears it: `xattr -d com.apple.quarantine <path>`, if you trust it. Cleared, real Codex ran commands through that
helper inside this profile against a local fake endpoint; a real model hasn't been run that way. Rust and OpenSSL clients get their trust roots from `/etc/ssl/cert.pem`,
not the Keychain, so a private certificate authority isn't trusted.

**Logins.** Claude Code on a Mac keeps its login in the Keychain, and the profile denies the Keychain. A process outside
the sandbox writes the host's live login to a file in the private home, the only file Claude falls back to, and
rewrites it within about a second of any change; Claude rereads it on its next request, with no restart. So a running
agent moves to whichever login the host switches to, where on Linux it stays on the login it started with. Only the
short-lived access token crosses: no refresh token, other Keychain items or MCP logins. When it nears expiry that
process runs the host's own `claude auth status`, which refreshes through Claude's own lock and store. The agent can't
change this file or move its folder. Codex's login file is copied at launch, as on Linux.

**Usage readings.** Claude's status line reports each session's 5-hour and weekly usage. If an executable
`~/.config/shepherdr/autopilot-usage` exists on the machine, not writable by group or others, it runs outside the
sandbox with each reading on stdin, latest first and one at a time, its output ignored:

```json
{"rate_limits":{"five_hour":{"used_percentage":42,"resets_at":1793456338},"seven_day":{"used_percentage":17,"resets_at":1793539138}}}
```

Only those numbers cross, and an agent can write them, so treat them as a hint.

To rerun the escape attempts on a Mac: `bun test test/core-pilot-mac-escape.test.ts`.

Access and limits are behind an expansion:

- **Shared HTTPS allowance (MiB):** a hard cap on encrypted traffic through the gateway, both directions, including
  coordinator, workers and reviewers. It measures network traffic, not tokens or money. A chunk that exceeds the
  remaining allowance is refused. Exhaustion closes the run.
- **Shared reported tokens:** an optional best-effort stop threshold using every transcript in the runtime homes,
  including helpers and reviewers. Log bytes are captured from inside the namespace into host-owned storage, never
  opened from an agent-supplied host path. Reports are delayed and agent-written, so they can overshoot or be missing; this
  is not a hard token or money cap. No exact financial spending cap is offered.
- **Shared runtime:** elapsed wall time since ON, including idle time. Every runtime gets the same absolute deadline
  through an external timeout (on a Mac, the watcher above); the manager also checks it. This ends all descendants, not just a turn.
- **Maximum parallel tasks:** the number of active managed Shepherdr tasks belonging to this run. It does not count
  native helper processes as separate tasks; they share their parent's namespace, network allowance and deadline.

The new `autopilot.*` settings, `autopilot-run` action, optional mode `keepWorkers` and optional
`SettingRow.instructions` are additive. Existing plugin names, `definePlugin` and registry slots remain unchanged.

## Automations

An automation is separate from Autopilot and needs neither its switch nor Linux: a repository space's saved task and
a trigger that adds that task again, each time with a fresh agent of its own. Nothing runs in the coordinator's chat,
and the new task goes through the usual start, review and merge. It runs with nobody watching.

Ask a space's coordinator for one in your own words. It turns them into the trigger, tells you back when it will run,
and keeps it with `shepherdr automation add` (`edit`, `list`, `pause`, `resume`, `run`, `remove`); only a coordinator
can add or edit one, and a home space has none. The trigger is the same kind as the heartbeat's: a time rule in the
Settings time zone (`every weekday at 9`), events, or both. The events are a task `added`, `ready`, `failed`,
`needs-you`, `merged` or `stalled`, and `main-red`, all of which can be narrowed by space, branch or title, plus a
machine's `health` (a meter crossing its alert limit or coming back). It hears its own space (`health`: its own machine) unless a rule names another. A task an automation
added never counts as `added`; its later events count as any task's.

Once a space has one, its tasks list ends with **Automations**: each shows when it runs, its next runs, the task it
adds and its last runs, with Run now, Pause (or Resume) and Remove. A failed run says why there. A start cut off by a
stopped server is never started a second time: its task shows in Last runs, or if none is found the run says it was
interrupted, so check the tasks before running it again. Events that were waiting to run still run after a restart.
