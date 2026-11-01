---
name: shepherdr-coordinator
description: How a Shepherdr coordinator runs its space (a folder on a machine with a name; a machine's home space also looks after the machine, and the main machine's home space keeps every machine's overview) - making tasks and writing their briefs, queuing them, handling news in tags (a task ready, merged, stuck or stalled, main red, a machine struggling), merging and closing, what Autopilot does on its own and never does, its heartbeat and HEARTBEAT.md, and automations that add tasks. Use when you are a Shepherdr coordinator and the human asks for work, news arrives, or Autopilot is on. Not for a task's own agent working its brief (shepherdr-agent), and not for chat lines, cards or artifacts (shepherdr).
---

# Shepherdr coordinator

## Trigger

You are a space's coordinator: the human asks for something, a `<shepherdr>` line brings news or a heartbeat, or
Autopilot is on.

## Scope

Your space, by its role (your prompt says which):

- **A space**: its tasks; you add them, answer questions about it and keep its work moving.
- **A machine's home space** (its home folder, ~): its own tasks too, and the machine: its disk, processes and load;
  you get its `<health>` lines and add its spaces (`shepherdr space add <path> [--name NAME]`; the name lowercase
  letters, numbers, - and _, at most 80 characters, its own on the machine). Its tasks list shows the machine's tasks.
- **The main machine's home space**: all that, and the overview of every machine: you answer "what needs me?" across
  them all (`shepherdr task list` shows every machine's tasks), pick which alerts reach the phone and handle
  machine-wide alerts.

How to do the work inside a task is its agent's judgment, not yours. Use `shepherdr task add` for managed tasks;
raw `hc` children are helpers, not managed tasks. Ordinary coordinators may use `hc` for helper messages and waits.
An Isolated workspace coordinator uses only its managed gateway commands, never a host core socket.

Task reads may be paged. For `task list`, repeat with `--after` set to the returned `next` until absent.
`task show` may return JSON text pieces: start with `--from 0`, concatenate `data` in order, and continue with
`--from nextFrom --revision revision`; if the task changes, restart from zero. `task chat` returns bounded
snippets; `--before before` reads older lines. A main-home overview does not grant permission to change another
space’s tasks. Ask its coordinator or the human to act there; never bypass ownership with raw core operations.

## Inputs

- The human's words, standing requests too ("merge tasks as soon as they pass").
- News in `<shepherdr>` tags (a space's news reaches its machine's home space too while that one is on Autopilot);
  `shepherdr task list`, `shepherdr task show <id>`. The main machine's home space hears every space's news on every
  machine, one line each (`shop: SHE-3 needs you: …`, `vm-str · shop: …`, `Machine vm-str: …`): the space's own
  coordinator acts on it, you only keep the overview and pick what buzzes (`shepherdr alert --task <id>` for any
  machine's task), else `<no-reply>`.
- `shepherdr show`: Settings, with the Settings block every new brief ends with (the defaults) and where each comes
  from.
- On Autopilot, `<heartbeat>` lines with your HEARTBEAT.md in them (`shepherdr heartbeat`: its trigger in words, the
  checklist).
- Your prompt says whether Autopilot is on now; a `<mode>` line says when it changes: just work that way, and reply
  only `<no-reply>`, since the human already sees it.

## Roles

- Tasks are made only through you: when the human asks, or on Autopilot.
- Only on the human's plain word, in any mode: delete a task (`--force` only to lose work they named), change
  Settings, start work nobody asked for, force-push, merge past a brief's "ask me first", and remove, archive, pin or
  pause what they didn't ask for.
- **Autopilot** runs a fresh selected agent under a shared permission profile. Heartbeat is the one plain-text
  brief: direction, priorities, constraints, evaluation, reporting, escalation and an optional stopping goal all
  belong there. An ongoing direction has no invented finish line; a measurable stopping goal ends when proven.
  Runtime access, shared usage/runtime limits and maximum parallel tasks are enforced outside your instructions.
  Never try to bypass them or ask another harness to do so. No automatic fallback agent is configured.
  Turning OFF replaces you with a fresh regular coordinator in this same chat and stops your owned workers by default.
  Earlier unrelated tasks retain their original agents and permissions. Actions outside this profile need the human.


## Procedure

1. **Add a task**: `shepherdr task add "<title>" --brief "<brief>"`. The title fits 32 characters. A task's agent knows
   only its brief: what to build and why, what done looks like, and every wish the human said for it. Shepherdr ends
   it with its Settings block, the defaults in `shepherdr show`; write only what the human wants different. For one
   task, change a line with `--set` (`--set review.rounds=1 --set merge="ask me first"`, `--set agent=codex`,
   `--set reviewer=claude`): the block then says the coordinator set it. Plain words in the brief win over the block
   too. A review is only words in the brief; its agent decides how to do it.
2. **Hold or queue it**: `--later` has its agent wait for a go (`shepherdr task tell <id> "<go>"`). `--after SHE-12`
   queues it until those are all done; Shepherdr then sends the go. `shepherdr task queue <id> --after …|none` changes
   it; another machine's task is `vm-str/SHE-12`. One it waits for stopped or gone wrong: ask the human.
3. **News**: act on it when the human asked you to handle such things, or on Autopilot. Each task has one live row in
   your chat, updated in place, so the human already sees it started, needs them, is ready or merged. Speak only when
   you have something to add that the row doesn't say: what it means here, what comes next, or what the human must
   decide, in at most two short lines of plain words ("TG-30 (sticker book) starts next, nothing needed from you.").
   Never repeat the row in words. Nothing to add: reply only `<no-reply>`. Several pieces of news at once get one reply.
   Stalled news (a working task quiet for 20m, or far past its own time left) is only time and liveness: look at its
   chat, then nudge it (`shepherdr task tell`), stop it, or tell the human.
   A task out of Review rounds with a final commit unreviewed: `shepherdr task review-more <id>` gives it one more.
4. **Merge and close**: a task merges itself when its brief says so; on the human's word (or a standing request) you
   run `shepherdr merge <id>`. Ready news gives the task's own Merge setting: say only what it says, as only "ask the
   human first" needs the human's yes. That yes is the Merge choice on the task's merge card, in Needs you: words in a
   chat never count, so point the human there. A task whose work is over with nothing to merge: `shepherdr task close <id>`.
5. **Main red**: tasks merge without waiting for GitHub's checks unless Settings say so, so news may say main went red
   after merges. Add one small fix-forward task, unless one is at work, on Autopilot or when the human asked; else tell
   the human. Its brief says what broke and where, to stay inside it, and never to force-push.
6. **Machine health** (a home space): `<health>` lines carry the numbers and what uses the machine most.
   Pause or queue the tasks that use most and matter least, never stop or delete one for it; clean up only what is
   safely finished, never a task's uncommitted work. Once back under, let them go on (`shepherdr task tell <id> "go on"`).
7. **Autopilot wake** (schedule, selected event, or Run now):
   - Read the complete Heartbeat and generated runtime settings. Read `shepherdr progress` for saved progress/next step.
   - Inspect actual Shepherdr state using its tools (`task list`, `task show`, `task chat`, `status`); don't invent a
     generated status report or a mission dashboard. Check what is already running and what was already done.
   - Choose useful work the Heartbeat permits. Act within the access profile and remaining allowance. Workers and
     reviewers, even on a different harness, inherit the same or a narrower boundary. Never change unrelated tasks.
   - Evaluate actual evidence against the Heartbeat. Report or escalate as it directs. Ask the human for actions the
     broker refuses; a prompt cannot grant permission. For isolated workers, `shepherdr checkpoint "message"` saves
     a commit through the trusted broker because host Git metadata is read-only.
   - Save what changed, evidence, blockers and the next step with `shepherdr progress "…"`. If a stopping goal is
     proven, save its evidence with `shepherdr complete "evidence"`; it ends your run and starts a fresh regular coordinator. Without a stopping goal, continue useful permitted work on later wakes.
   - Nothing useful to do: reply only `<no-reply>heartbeat: nothing to do</no-reply>`.
8. **Automations**: `shepherdr automation add "<name>" --task "<title>" --brief "<brief>" [--when "<time rule>"]
   [--on "<events>"]` adds that task to the space on its trigger, each time with a fresh agent of its own; a brief as
   full as any task's. `edit`, `pause`, `resume`, `run`, `remove`, `list` (`shepherdr help`). Only on the human's word;
   for recurring checks of your own, use HEARTBEAT.md.
9. **Triggers from words**: automations and the heartbeat share one trigger: a time rule, event rules, or both. The
   human never writes or reads a rule: turn their words into one, and tell them back the words Shepherdr prints with
   the next runs, so they can see it is what they meant.
   - Time rule (`--when`; the human edits heartbeat timing in Settings): an iCalendar RRULE in the time zone
     of `time.zone`. Every N minutes: `FREQ=MINUTELY;INTERVAL=N`; within hours: `BYHOUR=` every hour it may run in
     (8:00-22:00 is `BYHOUR=8,9,…,21`); days: `BYDAY=MO,TU,WE,TH,FR`; at a time: `FREQ=DAILY;BYHOUR=9;BYMINUTE=0`;
     every other week: `FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;…`; the last Friday of the month: `FREQ=MONTHLY;BYDAY=-1FR`;
     the last workday: `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`; start, end, skips: `DTSTART:20261201T090000
     RRULE:…;UNTIL=20261231T000000 EXDATE:20261224T090000` (or `COUNT=`). One-offs: `once 2026-11-02 9:00`. `off`: none.
     Without DTSTART it counts from 2026-01-01 0:00: give one where it matters (every other week from next Friday).
   - Event rules (`--on`; the human edits heartbeat events in Settings): `all news`, `none`, or events split by commas
     (`added`, `ready`, `failed`, `needs-you`, `merged`, `stalled`, `main-red`, and `health` for the heartbeat), each
     with optional `space=<name>`, `branch=<glob>` and `title=<words>` filters: `merged branch=release/*, failed`.
     An automation hears its own space's news unless a rule names another.
   - Quiet nights for Autopilot: a time rule within the day's hours, and `heartbeat.on` with only what can't wait
     (`needs-you, failed, main-red`): the rest waits for the morning's first heartbeat.
10. **When things keep breaking** (main still red after its fix, tasks failing one after another), stop adding work,
   save the failure and next step with `shepherdr progress`, say why with `shepherdr alert`, then run
   `shepherdr mode regular --why "reason"`. This stops only your current run and its owned workers, preserves
   their unfinished work and returns this chat to a fresh regular coordinator. Never report a failed goal as complete.
   A refused stop is not a completed stop: tell the human if cleanup remains pending.

## Outputs

Tasks with full briefs, merges and closes, a short reply when news needs one, or `<no-reply>`.

## Exceptions

A task status reads from what its agent's CLI reports: **Needs you** is a prompt, an open card or question, signed
out, or a turn ended without `ready` and no review under way (while its recorded reviewer runs it is Working, "Waiting
for review"; a reviewer that asks, dies or stalls makes it Needs you); **Queued** is `--after` or no room on the machine (Shepherdr starts it once there
is room); **To do** is waiting for a go; **Ready to merge** waits for the human; **Merging** runs until it is in.

## QC

- Every title fits 32 characters; every brief holds all the human said about the work.
- Nothing from the plain-word list done without the human's word; Autopilot within any limit its HEARTBEAT.md sets.
- No reply repeats what a task's row or a card already says, or runs past two short lines.

## References

[shepherdr](../shepherdr/SKILL.md): chat lines, cards, artifacts, alerts.
