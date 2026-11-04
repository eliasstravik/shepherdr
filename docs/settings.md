# Settings: Everywhere and a space's own

Every setting has a value for **Everywhere**, the default. A setting that makes sense per space can also be set for
one **space**: the space's own wins there, and a setting the space doesn't set is inherited from Everywhere. Reset
drops the space's own, and it inherits again. A few settings are one for every space, or one per machine.

## Where you set them

- **Settings, the level switch.** At the top of each page a space can set its own of (Agents, Tasks, Autopilot,
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
| Agents | Instructions (assistant.md, worker.md, reviewer.md) | Everywhere only | Repo rules belong in the repo's AGENTS.md or CLAUDE.md, which every agent there reads |
| Tasks | Merge, Review, Must fix, Proof | Everywhere, space | How much care a repo needs differs |
| Tasks | Tasks at once | Everywhere, space | It counts per folder already |
| Tasks | Archive Done after | Everywhere, space | Some repos keep done work in view longer |
| Tasks | Worktrees | Everywhere, space | A folder that isn't a repo, or one that can't take worktrees |
| Tasks | Base branch | Space only | A branch only means something in one repo |
| Tasks | Run automations | Everywhere, space | Pause one repo's automations |
| Tasks | When a task starts / finishes | Everywhere, space | Setup and cleanup steps are a repo's |
| Autopilot | Heartbeat, Schedule, Events | Everywhere, space | Each space works toward its own goal, at its own pace |
| Autopilot | On or off | Space only | The header's switch: Everywhere never turns a space on |
| Notify | All / Needs me / Off | Everywhere, space | A busy space can be quiet |
| Secrets | A secret | Everywhere, machine, space | A key for one repo, or one machine's own |
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
  with `coordinator`, `worker`, `reviewer`, `backup`, `tasks`, `automations` and `autopilot`
  (`{ every, events, heartbeat }`). The window pushes each machine its share (Everywhere's and its spaces' by their
  ids there), and when the web app is served from another machine its service keeps the file in step with that host
  (`service/sync.ts`). So a space on any machine, and the web on the Mac mini, see the same values.
- Notify is in the shared document (`notify`), kept in step the same way.
- herdr-task reads the effective value: `settings_for()` for agents and tasks (the Settings block every brief ends
  with names who set each line), `autopilot.resolve()` for Autopilot (`herdr-task autopilot show` lists which parts are
  the space's own). Autopilot's schedule and events from before Settings kept them (`~/.herdr/tasks/.autopilot.json`
  `everywhere`) and its heartbeat file (`~/.config/herdr-core/autopilot/everywhere.md`) are what Everywhere inherits
  until it's set.
