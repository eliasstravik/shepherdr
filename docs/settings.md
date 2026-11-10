# Settings: Everywhere and a space's own

Every setting has a value for **Everywhere**, the default. A setting that makes sense per space can also be set for
one **space**: the space's own wins there, and a setting the space doesn't set is inherited from Everywhere. Reset
drops the space's own, and it inherits again. A few settings are one for every space, or one per machine.

## Where you set them

- **Settings, the level switch.** At the top of each page a space can set its own of (Agents, HolyCow, Tasks, Autopilot,
  Notify, Secrets): *Applies to: Everywhere ⌄*. The picker lists Everywhere, then every space by machine (a Find box
  once there are many). Pages that are one for every space (Machines, Window, Web) say so instead.
- **A space's menu › Space settings…** opens Settings on that space, in the window and on the web.
- **Under each row, in a space:** *Inherited from Everywhere*, or *Set for this space · Reset*. On Everywhere, a row
  that some spaces set their own of says *2 spaces set their own*, which lists them (each opens that space's).
- **The header's Autopilot switch** turns Autopilot on or off in its space; *Write a heartbeat* opens that space's
  Autopilot page.

## The audit

| Page | Setting | Level | Why |
|---|---|---|---|
| Agents | Assistant (CLI, model, effort, fast, permissions) | Everywhere, space | A repo may want a stronger model or another CLI |
| Agents | Workers | Everywhere, space | The same: what a task in this space runs on |
| Agents | Reviewer | Everywhere, space | The same |
| Agents | Backup agent | Everywhere, space | A space whose work shouldn't move to the other CLI |
| Agents | Reactions (every agent reacts with an emoji; on) | Everywhere, space | A space may want a plainer chat |
| Agents | Ask for a GitHub star (on; once asked, just when) | Everywhere only | One ask per person, ever, on every machine (`star_prompt`, herdr-task's `star.py`) |
| Agents | Instructions (assistant.md, worker.md, reviewer.md) | Everywhere only | Repo rules belong in the repo's AGENTS.md or CLAUDE.md, which every agent there reads |
| Tasks | Merge, Review, Must fix, Proof | Everywhere, space | How much care a repo needs differs |
| Tasks | Tasks at once | Everywhere, space | It counts per folder already |
| Tasks | Archive Done after | Everywhere, space | Some repos keep done work in view longer |
| Tasks | Worktrees | Everywhere, space | A folder that isn't a repo, or one that can't take worktrees |
| Tasks | Base branch | Space only | A branch only means something in one repo |
| Tasks | Branch names (a pattern: `{n}`, `{key}`, `{slug}`; empty: `task/{n}-{slug}`; a task's own `--branch` wins) | Everywhere, space | A team may name branches after its tickets |
| Tasks | Run automations | Everywhere, space | Pause one repo's automations |
| Tasks | When a task starts / finishes | Everywhere, space | Setup and cleanup steps are a repo's |
| Autopilot | Heartbeat, Schedule, Events | Everywhere, space | Each space works toward its own goal, at its own pace |
| Autopilot | On or off | Space only | The header's switch: Everywhere never turns a space on |
| Notify | All / Needs me / Off | Everywhere, space | A busy space can be quiet |
| Secrets | A secret | Everywhere, machine, space | A key for one repo, or one machine's own |
| Secrets | Kept on | All machines | One vault every machine's agents and voice calls use; follows Serve from unless picked |
| Machines | When new tasks wait (memory, CPU, disk), low priority, memory cap per worker | All machines, machine | About a machine's hardware, not a space's work |
| Machines | Home Assistant | Machine only | One per machine |
| Window | Tabs, sidebar, counts, filters, subagents, Assistant in new spaces | Everywhere only | How the screen looks; the last is about spaces not made yet |
| Window | Add-ons | Everywhere only | Which mods run: the window's, for every space |
| Web | Serve from, link | Everywhere only | One web app for every machine |

**No Machine level for the rest.** A space already lives on one machine, so a space's own covers "this machine's
repos" without a third layer, and one less layer keeps "where does this value come from" one line long. What a machine
genuinely differs in (its hardware, its home space, a key only it has) is already on Machines and Secrets. Agent and
task values a machine set before (the old machine scope) still apply there until Reset, and say so on Machines.

## Where they're kept, and how they travel

- `~/.herdr/shepherdr.json`: `everywhere` and `spaces[<space id>]` (another machine's space as `<machine>/<id>`), each
  with `coordinator`, `worker`, `reviewer`, `backup`, `tasks`, `automations`, `agents` (`{ reactions }`) and
  `autopilot` (`{ every, events, heartbeat }`). The window pushes each machine its share (Everywhere's and its spaces' by their
  ids there), and when the web app is served from another machine its service keeps the file in step with that host
  (`service/sync.ts`). So a space on any machine, and the web on the Mac mini, see the same values.
- Secrets live in one vault, `~/.herdr/vault.json` on the machine that keeps them (Secrets › Kept on). Which one:
  herdr-core document `shepherdr.secrets` = `{ id, at, by }` on every machine, handed on by each service as
  `shepherdr.host` is (`core/secrets.js`). `herdr-secret` on any other machine passes `set`, `rm` and `names` there
  over herdr-core (the value on stdin, scopes renamed into that machine's words); that machine's service answers every
  agent's request even with no window open, and voice calls read the ElevenLabs key from there into memory only.
  `shepherdr secrets move-to <machine>` moves the vault (a backup on both sides; `move-to here --restore` on the old
  one rolls back when the other is gone). By default the secrets follow Serve from (Kept on says "Same as Serve from:
  <machine>"): with no machine picked, each service names where the secrets are now (the machine whose vault has
  some, else the one serving the web app: `autoKeeper`, a record with `auto: true`) and hands it on, so voice calls
  and agents work with no setup; then the machine serving the web app moves them to itself with `move-to` (backup,
  verified copy, rollback), and does so again when Serve from moves. Picking another machine in Kept on stops the
  following; picking the Serve from machine starts it again. Voice calls with no record yet ask each linked machine
  for the key. No record and nothing to decide yet: the machine without `~/.herdr/secret-remote` keeps them.
- Notify is in the shared document (`notify`), kept in step the same way.
- herdr-task reads the effective value: `settings_for()` for agents and tasks (the Settings block every brief ends
  with names who set each line), `autopilot.resolve()` for Autopilot (`herdr-task autopilot show` lists which parts are
  the space's own). Autopilot's schedule and events from before Settings kept them (`~/.herdr/tasks/.autopilot.json`
  `everywhere`) and its heartbeat file (`~/.config/herdr-core/autopilot/everywhere.md`) are what Everywhere inherits
  until it's set.

## Reactions

Agents › Reactions, on by default: every agent reacts to some of your messages with one emoji, as a person would:
Assistants, task workers, automation runs and plain agent tabs, on every machine. It picks the most specific,
delightful or funny one that fits, not a generic 👍 or 👀 by default (🚀 for a launch, 🔥 for a great result, 🐛 for a
bug report, 🧹 for a cleanup ask, 🫡 for a direct order, 🤌 for a nice detail, 🍿 for drama). Tasteful: most messages
get none, never more than one, and never instead of an answer you need. Off, none reacts. The reactions show on your messages in every chat, the
Assistant's, a task's and an agent tab's, in the window and on the web (`core/chat-log.js`).

- **Kept as** `agents.reactions` at each level. SHEP-42 kept it as the Assistant's, `assistant.reactions`: it still
  applies where a level has no `agents.reactions` (herdr-task, the window's chain), and the window and the web app
  move it there when they read the file (`upgradeReactions` in `core/settings.js`), so their next change writes it.
- **How it's told.** The chat's SessionStart hook (`mods/chat/session-note.sh`) asks `herdr-task _session-note` for
  every agent's extra words: an Assistant's settings block (below) ends with them, any other agent gets just them
  (`herdr_task/reactions.py`): the when-and-how paragraph (GUIDE) when on, "never react" when off, by its space (its
  terminal's space or task-space label, else the space whose folder holds its folder, else Everywhere's). It runs at
  every start, resume and compaction, for Claude Code and Codex, and labels the terminal `herdr.reactions=on|off`. The
  role instructions (`assistant.md`, `worker.md`, `reviewer.md`) don't carry it: they are your words to edit, and the
  hook is the one start path that knows the setting now.
- **Changed mid-session.** A `<herdr-setting name="reactions" value scope>` line: an Assistant's comes with its other
  changed settings (below); every other live agent its hook taught gets it alone from herdr-task's news pass
  (`reactions_pass`), once, ending "carry on with what you were doing; if nothing, reply only `<hc no-reply/>`", so a
  worker mid-task keeps working. One started before this isn't told until it starts again.
- **Reviewers** run as their worker's own helper agents (an hc child, shown as a subagent in its chat): their hook
  teaches them too, but your messages rarely reach them, so they seldom react.
- **A reaction only.** A reply of a `<hc react … />` line and `<hc no-reply/>` shows just the reaction on your
  message.

## What the Assistant is told

A space's Assistant knows the settings that shape how it makes and runs tasks, resolved for its space (Everywhere's,
then the space's own), without guessing (`herdr_task/assistant_settings.py`):

- **At every start, resume, compaction and handoff** the chat's SessionStart hook (`mods/chat/session-note.sh`) asks
  `herdr-task _session-note` for a "Your settings" block, like the Settings block a worker's brief ends with: Review
  (rounds, must fix, reviewer), Merge, Proof, Task agent, Base branch, Worktrees, Tasks at once, Task notes (start and
  finish notes set or not), Autopilot (on or off, schedule, direction) and Reactions, one line each. A line that differs
  from Herdr's default says who set it (*set for this space*, *your setting everywhere*). The terminal is labelled
  `herdr.settings` with a short hash of each line.
- **Changed while it runs** (in the window or on the web, Everywhere or the space): herdr-task's news pass (on a
  settings change, and every minute for Autopilot's switch) sends each live Assistant whose lines differ one message,
  a line per changed setting: `<herdr-setting name="review" value="on" scope="everywhere|space">Review is now on, …
  Tasks you add from now on get it; running ones keep their brief.</herdr-setting>`, the last ending "reply only
  `<hc no-reply/>`". A save that changes nothing for its space says nothing. One started before this (no label) gets the
  whole block once it has had a turn. Busy with the person: next pass.
- **The chat hides them**, as every Herdr tag (`core/chat-log.js`), and the `<hc no-reply/>` after: a settings change
  already shows where it was made, so a news row would only repeat it.
- **Other agents get only Reactions** (above): a worker's brief's Settings block is fixed when it starts.

## BossGoat desktop background

BossGoat includes `bossgoat-background.png` as its default background, so a new installation needs no file
selection or download. Existing custom images remain selected. The default transparency is 50%; saved image transparency is preserved.

In the desktop sidebar, open **BossGoat → Appearance → Background** and select **Solid colour** or **Image**.
Solid colours use HolyCow’s [Eden palette](https://github.com/NeuralHerd/HolyCow/blob/main/website/src/styles/eden.css):
Paper, Pearl, Sage and Peach for light backgrounds; Ink, Midnight and Charcoal for dark backgrounds.
New installations default to dark mode unless an appearance is already saved. Light mode always uses a solid background: a selected light colour, or Paper when an image or dark colour is selected. Switching back to dark restores the saved image or colour. Chat and Terminal follow the same rule.
Switching modes remembers your last solid colour and image, including its transparency, on this computer.

For an image, choose a PNG, JPEG or WebP file,
or drop one onto the preview. Images up to 30 MB and 60 megapixels are accepted and copied
locally, with a maximum edge of 4096 pixels. The original image stays untouched.

In dark mode, the picture fills the conversation area without stretching. **Transparency** ranges from 0% (fully visible)
to 100% (hidden against the selected Herdr theme), while messages keep readable surfaces. Transparency applies only to images. Changes save automatically.
The message box follows Herdr’s native light or dark theme so its typing cursor stays visible, regardless of the background.
**Reset to default** restores `bossgoat-background.png` and its default transparency. Chat and Terminal share the same background and transparency. Other Herdr layouts and the web app
keep their existing appearance.

This preference belongs to this computer, not a space or an agent. It is stored in Herdr’s local
shared state; image copies live in `~/.config/herdr-app/data/bossgoat-wallpaper/`. They are not sent
to agents or other machines, and updates preserve them. Reset restores the bundled image without deleting
your original image or the local image cache. Older Fade settings retain their appearance.

The macOS picker uses Apple’s Command Line Tools. Linux uses the desktop portal and PyGObject /
GdkPixbuf, as the chat attachment picker does.


## HolyCow

Install the [HolyCow skills](https://github.com/NeuralHerd/HolyCow) on each machine that runs them.
**HolyCow → Skill assignment** is **Required for software tasks**. The Assistant uses HolyCow's guide
to select the relevant skill automatically; there is no mandatory sequence and routine questions need no skill task.
The old Use HolyCow switch no longer disables this requirement, including in settings files saved with it off.

Guide, Init, Compass, Refine, Lab, Plan, Build, Review, PR and Retro each have their own Claude Code, Codex or
Cursor model picker, including the selected CLI's reasoning, speed and permission options. Permissions are also shown beside each skill's model. Choices inherit from Everywhere
unless a space sets its own. **Use role defaults** removes the complete global skill choice, including permissions; a space's **Reset to inherited settings** restores
its inherited choice. The running Assistant's chat permissions do not change these task defaults. Unset Guide tasks follow Assistant, Review follows Reviewer, and the others follow Workers.
Guide's picker controls delegated Guide tasks, not the already-running Assistant.

The Assistant creates work with `herdr-task add "Title" --skill hc-build --prompt "Scope and evidence"` (or another
skill id). The chosen skill is saved on the task. Explicit task model/agent overrides win over its skill's model.
Changing a skill choice applies to new launches; running sessions and already-queued commands keep their choice.
`herdr-task edit <id> --skill hc-plan` changes a task's skill. `--skill default` can remove it from a draft,
but that draft cannot start until a valid skill is assigned.

Role instructions still provide BossGoat's task, status, proof and review rules. The task also receives the path
to the selected installed `SKILL.md` and must read it and its references. Repo-local skills take precedence over
home-installed skills; the selected CLI's skills folder and `.agents/skills` are supported (Cursor also accepts
shared `.claude/skills`). Missing skills stop the launch with an installation message instead of silently skipping
them. Every launch, including queued starts, saved-session resumes, switches and backup agents, validates the
assignment and installed instructions. Resumed sessions receive the current skill instructions again.
Existing role instruction files are not overwritten. Remove old hard-coded model routing from custom
instructions when adopting these settings.

For a HolyCow task whose review is on, its existing worker-led review uses the **Review** model and `hc-review`
instructions. Review runs read-only regardless of the model picker's permission choice. This does not enable
review when it is off or add another review loop.

Tasks default to `--kind software`, including older tasks with no kind. Unassigned drafts remain readable and
editable, but start/schedule/resume/switch refuses them with the command to assign a skill. An explicit CLI or
cached launch command does not bypass this check. Already-running agents are not stopped by the upgrade.

Only work that is genuinely unrelated to software may use `--kind non-software`, for example a meeting agenda.
The Assistant judges the task's purpose; BossGoat does not guess from keywords. This explicit exemption uses
ordinary Workers/Reviewer settings. A non-software task cannot also carry a HolyCow skill. Greetings, status
checks and board administration usually stay in the Assistant chat without creating a task.

Automations accept `--skill` and `--kind` on `auto add` and `auto edit`, and carry them into every generated task.
Software automations require a valid skill before they can be saved or resumed. Older unassigned automations
report a missing-assignment error instead of launching a worker; assign their skill with
`herdr-task auto edit <id> --skill <skill-id>`.


### Shared permission choices

Chat, Agents and HolyCow use the same three choices, with icons and an About permissions button:

| Choice | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| Ask for approval | Manual permission mode | Workspace write, approval on request, user reviewer | Normal launch without forced or automatic approval flags |
| Approve for me | Auto permission mode | Workspace write, approval on request, automatic reviewer | Auto-review |
| Full access | Bypass permissions | Bypass approvals and sandbox | Force allow, except denied commands |

Approval checks still differ by agent. Cursor's saved approval settings and allow rules apply to its normal launch. Automatic review needs support from the installed CLI, account, model and organization policy. Full access does not override every provider or organization restriction. The info button explains the active agent's behavior.

Existing special modes remain saved and appear as Custom (or Read only); opening a menu never migrates them. HolyCow Review remains read-only. Changing agents maps the selected shared choice to the new CLI and preserves read-only restrictions. Settings affect new launches; chat changes restart only the current agent.

Mappings follow the [official OpenAI sandbox documentation](https://learn.chatgpt.com/docs/sandboxing), [Claude permission modes](https://code.claude.com/docs/en/permissions), and [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters). Cursor Auto-review is also verified against the installed CLI's help.
