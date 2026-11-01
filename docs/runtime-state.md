# Current model, effort and speed

A quiet line under every chat's message box says what its agent runs on, for example
`Opus 5.5 · medium · ⚡ Fast`, with no tap needed; tapping it opens the + menu, which has
the same Model, Effort and Speed. Normal speed is left out of the line. Native CLI
observations stay separate from selected launch settings: a configured model or catalog
default is not evidence of what a turn actually used. What was asked for at launch shows
only until a record says otherwise, marked as such (`Asked for: Opus 5.5 · high`, per
field: `Opus 5.5 · Asked for: high`). Not known yet means nothing either way. Before any
agent has started, the line says what Settings will use, marked as that too
(`Haiku 5.5, from Settings`): nothing runs yet, so it is never shown as observed. Restart
keeps the recorded running agent and requested replacement distinct, and starts from
Settings while nothing has run. Its Default names no level, so where a record says what
that came to, the sheet says so beside it.

| | Model | Effort | Speed |
|---|---|---|---|
| Claude Code | assistant `message.model`, the `SessionStart` hook's `model` first | assistant top-level `effort` | assistant `message.usage.speed` |
| Codex | `turn_context` and `thread_settings_applied`, any hook's `model` first | `turn_context.effort`, `thread_settings.reasoning_effort` | `thread_settings.service_tier` |

Claude Code's own `/model`, `/effort` and `/fast` print a `local-command-stdout` record
at once, read as what they say; its next reply then says what really ran. So Fast asked
for on an account or model that doesn't allow it shows as Normal after the first reply.
Claude Code's `usage.service_tier` is not speed and is not read.

Codex writes `thread_settings_applied` at each turn's start and straight after `/fast` or
`/model`. Its API name is shown as the human word: `priority` is Fast, `default` is
Normal, though its config may say `service_tier = "fast"`. It records an effort only
when one was set; without one the model's own default runs, shown as Default.

A hook's time is when it fired, often after the turn it reports, so any transcript
record replaces hook data and a hook never replaces a record. Readers are tied to the
current launch and transcript, handle truncation and partial records conservatively,
and never read the terminal screen to guess state. A picker change without a subsequent
native record remains unobserved.

Speed can be picked in the restart sheet: Claude Code's `--fast-mode on|off` and Codex's
`-c service_tier="fast"|"default"`, both for that launch only, kept across later restarts
of the same chat. Unlike model and effort it is not a Setting, so it isn't saved for
future agents.

Shepherdr 2.1 launches Claude Code and Codex. Pi is a later addition. Remote logs and
hooks use the same core file/event interfaces as local agents, without an SSH log
mirror or daemon-proxy fallback. Native process liveness and explicit OSC status are
separate from task workflow: an idle or ended turn does not mean the task is Done.

## Plan limits

How much of a plan is left and when it refills sit beside Settings, at the foot of the spaces list (in the drawer on a
phone): a thin bar per CLI and the least left of any window, amber at 25% and red at 10%. A tap shows every window, each
machine's own, and reads them again if they are over a minute old; otherwise each machine is read every ten minutes,
at the lowest CPU priority. Each machine has its own sign-ins, so its numbers are shown under its name.

| | Source | What comes back |
|---|---|---|
| Claude Code | `claude -p /usage` | whatever windows it prints: its 5-hour session while one runs, its weekly ones |
| Codex | `codex app-server`, `account/rateLimits/read` | its primary and secondary windows and plan type |

Both are their own short process, so nothing is typed into a running agent, and neither spends tokens. Claude Code's
structured usage request is marked experimental and its status line data needs a live session, so `/usage`'s printed
words are read, in the one wording they have today. Words that no longer match show as Unknown, never a guess.

Reads are read-only. Even a read makes Claude Code save `~/.claude.json`, so each runs in `bwrap` with the whole machine
read-only; Codex won't start without writable state, so it gets a throwaway folder in place of its own, with its real
`config.toml` and `auth.json` read-only inside and plugin sync off. Without its seal a CLI is never run: it shows as
Unknown, with why.

A Mac has no `bwrap`, so the same promise comes from `/usr/bin/sandbox-exec`: every file and preference write denied
but in a throwaway folder, which is also each CLI's working and temporary folder, and no way to run `security`, the
Keychain's one command for reading and writing, or to reach the Keychain's daemons. A short sealed run shows the seal holds (it writes where it's open, fails
where it's shut, and can't start `security`) before any CLI goes in. A seal that won't start or doesn't hold refuses.

Claude Code runs there with a throwaway `CLAUDE_CONFIG_DIR` holding only its login with the renewal token taken out, so
it can't renew at all, even if the server turns its token down early: no real config, Keychain item or login file is
in its reach. The Keychain's login is the one used, as a renewal leaves any old `.credentials.json` behind; with none in
the Keychain the file's is. A Keychain that can't be read refuses. The helper reads the login with `security` itself,
holds it in memory, and writes only that short-lived token to the throwaway folder, which goes once it's read.

Nothing can show a folder over `~/.codex` there, so `CODEX_HOME` names a throwaway home with links to the real
`auth.json` and `config.toml`: a save lands in the throwaway home or is denied, no login is copied, and Codex is told to
keep to the file. A Codex login kept only in the Keychain has no file to check, so it isn't run.

A seal can't save a renewed login, and one renewed but not saved signs the CLI out. So a login within an hour of its end
(Claude Code's last about eight hours), or a Codex one past seven days since its last renewal, isn't read: the next agent
there renews it, and until then the last numbers stand with their age. The same holds for a Mac's Keychain login, whose
token is no use to a read once it ends.

### Checking a Mac

Read-only. It runs the one read the app runs, sealed, and compares file times and the Keychain item's date, whose
secret it doesn't print. Run it from the Shepherdr checkout on the Mac, after an update that has this seal:

```sh
state() { stat -f '%m %N' ~/.claude.json ~/.claude/settings.json ~/.claude/.credentials.json ~/.codex/config.toml ~/.codex/auth.json
  security find-generic-password -a "$USER" -s 'Claude Code-credentials' | grep mdat; }
before=$(state 2>&1)
bun -e "import { read } from './helper/core-plan-limits.ts'; console.log(JSON.stringify(await read()))"
[ "$before" = "$(state 2>&1)" ] && echo unchanged || diff <(echo "$before") <(state 2>&1)
find "${TMPDIR:-/tmp}/" -maxdepth 1 -name 'shepherdr-limits-*'
```

It passes when each CLI's line is `"state":"ok"` with windows, the times say `unchanged` (a running agent may move
`~/.claude.json` by itself: only that line may differ) and the last line lists nothing. `Its sign-in is due for renewal`
is the guard working: run it again once an agent has renewed. `the Mac seal wouldn't hold` or `Couldn't check its
sign-in` is a safe refusal, and `Couldn't read Claude Code's answer` or `Codex stopped before answering` means a CLI
wouldn't work sealed. `"signed-out"` for a CLI that is signed in means it didn't take the throwaway login. Report any of
these rather than loosening the seal.

A number always says how old it is. Once a window's reset time passes it says it has refilled and hasn't been read
since. A read that fails keeps the last numbers, with their age and what went wrong; never-read shows Unknown.
Only percentages, reset times and the plan's name leave the machine. Pi and anything else with no such data is left out.

The [acceptance record](core/implementation.md) names actual native versions, tested
status/restart cases and remaining provider/device limits. No hard token or money cap
is inferred from delayed native usage reports.
