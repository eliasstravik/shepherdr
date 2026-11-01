# Tasks

- A task is one core child agent in its own git worktree and branch from its chosen base (`work/<n>-<slug>`).
  Shepherdr creates the checkout through core-owned execution; it does not create a terminal-herdr space or show
  the task in herdr-app. Its outlive-parent lifetime is independent of a coordinator restart. The base checkout is
  preserved. A task has no
  settings: its brief is all the agent goes by. The coordinator writes the work and your wishes for it ("wait until I
  say go", "skip the review", "ask me before merging"), and Shepherdr ends every brief with its Settings block,
  one plain line per setting that shapes how the agent works, the source it follows: whether it is reviewed and by whom (the reviewer tags each finding critical, major, minor or trivial; the agent fixes
  those at or above Must fix, `review.mustFix`, major by default, and reviews again, at most Review rounds,
  `review.rounds`, 3 by default), and whether it merges on its own (by default once its own quick checks pass,
  without waiting for GitHub's checks), on its own after GitHub's checks, or asks you first, and the agent, model
  and effort it runs on (only so it knows). A line that differs from Shepherdr's default says who changed it: this
  space's setting, this machine's, yours for every machine, or set by the coordinator for this task (`task add --set
  review.rounds=1 --set merge="ask me first"`). The brief's own words win, so a wish for one task needs no setting
  changed. The task's chat shows the block at the end of its first message, the changed lines picked out. The rest is the agent's judgment, by its
  skills: whether to plan first, how to build and check it, what to fix after a review and what proof to show. Ask for another CLI, model or effort for one task and the coordinator adds
  `--agent`, `--model` or `--effort` to `task add`; for another reviewer, `--reviewer`, `--reviewer-model` or
  `--reviewer-effort`. Tap the task and you are in its agent's chat, where it asks, shows
  artifacts and tells you when it is done; the task's brief shows exactly what its agent got.
- Want something noted but not started? Ask for it "for later": the coordinator adds it with `--later`, and its agent
  starts all the same, with "don't start yet, wait for a go" in its brief. It says in one line that it has it and the task shows To do (`shepherdr todo`).
  Tap it and you are in its chat, like any other: say go when you are ready, or say what to change. The agent decides
  from your words.
- "Do this after that" ("then", "once that is merged", "after SHE-12") queues it: the coordinator adds it with
  `--after SHE-12` (`shepherdr task queue <id> --after …` changes or clears it on a task that exists). Its agent starts
  at once, reads the brief and waits; the task shows under Queued, its line naming what it still waits for (`after
  SHE-12, SHE-13`). Once they are all done (merged, or nothing to merge), Shepherdr tells its agent to go,
  and a small card in its chat says why it started. While it waits, `shepherdr todo` is refused: it would drop the task
  out of its queue. A task of another machine is named with its machine first
  (`vm-str:SHE-12`), from the main machine's home space. If one it waits for is stopped or goes wrong, the queued task needs
  you, saying which; it goes back to waiting once that task is going again. Want it started early? Just write to it:
  its agent decides from your words, and clears its queue itself when they are a go (a note leaves it queued).
- A task's dot comes from its agent alone: Working, Needs you (it asks, or waits for your reply), Queued (it waits
  for other tasks), To do (it waits for a go, or is still starting up; a To do row is its title alone), Ready
  (`shepherdr ready`: finished, waits for you to merge it), Merging (`shepherdr merge` under way: GitHub's checks run,
  a rebase or the merge itself, nothing for you to do) and Done (`shepherdr merge`: Merged, or closed: Nothing to merge). The list and the task's chat always show
  the same. Once started, only the agent puts a task in To do; one that stops for any other reason needs you, except
  while work it started in the background (a reviewer subagent, a shell, a monitor) still runs and will wake it: that
  is still Working (shells alone for up to 10 minutes, since a server it started for you never wakes it; a shell
  running a headless reviewer of another CLI, `codex exec` or `claude -p`, counts as a subagent), unless its last
  words ask you something. So is a task whose agent ended its turn for the reviewer `shepherdr review` started: its
  line says Waiting for review, with no card, news or alert, unless its last words ask you something. A reviewer that asks, dies, stays quiet for 20 minutes or
  ends with no report reaching the agent ends that wait, and the task needs you. A task that needs you says why in at most 40
  characters, never by pasting the agent's message and never in a model's words: a standard reason (Plan to approve,
  Asks permission, Signed out, Question for you, Waits for your reply), or the agent's own question cut to fit
  (from its question tool, its choice card, or the last sentence of its last message that asks). The tasks list, the
  row in its space's chat, alerts and coordinator news all say the same; the full message stays in the task's chat.
- A permission, question or plan card from the CLI lasts only as long as the CLI waits on it. Its own records say when
  that is over: the tool call's result or the turn's end, on Claude Code and Codex alike, and the hook the CLI stops
  when its prompt is declined. The card then closes with what happened (Answered in the terminal, Timed out in the CLI
  and was denied), and so do its copy in the coordinator's chat, the count and the phone's alert. A tap on it fails and
  says why. With no such record it stays open, however long it waits. Shepherdr's own restart ends what it was waiting
  on: its open cards close as denied, and a line in the chat says what was denied and that nobody refused it, so the
  agent can ask again.
- A turn cut off by the model's provider (overloaded, at capacity, a rate limit, a dropped connection) is no question
  for you: Shepherdr waits and tells the agent, task or coordinator, to carry on, after 1, 2, 4 and 8 minutes. Meanwhile
  a task stays Working, its line saying why and when (`Provider overloaded · retry in 2m`). Only when the fifth try is
  cut off too does it need you (`Provider overloaded, still after 5 tries`); a coordinator says so in its chat, with an
  alert. Errors waiting can't fix (signed out, out of allowance, a model that isn't there) go to you at once. Anything
  written to the agent starts the count again. Each CLI's log says what cut it off (`server/common/provider-error.ts` decides).
- When a task's agent can't go on (out of allowance, signed out, its provider still down after the tries), its
  **backup agent** takes over, once: Settings → Agents → Backup (`task.fallback`: unless set, the other CLI where it is signed in, else off).
  It starts in the same worktree and branch, on its CLI's own model, with the brief and a short handover: who it takes
  over from and why, the branch's commits, what lies uncommitted and the chat so far. A card in the task's chat says
  so. Contained Autopilot tasks keep their selected run policy and never switch provider automatically. If the backup can't go on either, or isn't installed, the task needs you.
- Status comes from native logs/hooks and explicit OSC 7501 reports. Both Claude Code and Codex receive their
  launch-specific hook configuration; personal settings are not changed. A native ended turn with no recorded
  background work needs you, but remains a Working task until its workflow changes. Process liveness never means
  Done. Shepherdr reads the terminal screen only for an agent with no session yet, to show it as a card
  ([Chats](chat.md)); readiness and every later status never come from the screen. Missing observations remain unknown.
- On a repo with a GitHub remote that `gh` is logged in to, each task gets a pull request. The shepherdr-agent skill runs
  `shepherdr pr <id>`: it pushes the branch and opens a draft (its title the task's, its words the agent's summary, the
  brief's gist and a "Generated with" footer), and pushes to it again after new commits. `shepherdr checks <id>` waits
  for GitHub's checks (merging waits for them only when Settings → How tasks work → Merge is "after GitHub checks", or the task's --set says so);
  failed ones go back to the agent to fix. Reporting it ready takes the pull request out of draft.
  While it waits, Shepherdr looks at it every two minutes and passes news on to the resting agent once, in
  `<shepherdr>` tags: a check that failed (its link and the end of its log) and new reviews and comments with words (a
  bare approval is not news). The agent decides what to do (shepherdr-agent says how); Shepherdr only passes it on.
  Its number shows on the task's row, links from its chat's header and from the Done card. The remote is read live, as
  written and as git rewrites it (`url.insteadOf`), and `gh` is told the host (`GH_HOST`, such as `github.localhost`).
  No remote, or no `gh` login: tasks merge here, as below. Logged in but GitHub not answering: nothing merges until it
  does.
- The agent merges when its brief or you say so: `shepherdr merge <id>` squash-merges the branch into main.
  On GitHub that goes through its pull request (opened then if the agent never did), as soon as the agent's own quick
  checks pass (in Shepherdr: `bun run typecheck` only), without waiting for GitHub's checks: they still run on
  every push to main (and on the pull request where a repo's checks do), and only a failure GitHub already shows at that commit stops the merge.
  With Settings → How tasks work → Merge on "after GitHub checks", it merges only once GitHub's checks pass. Either way only
  at the commit this machine has (`gh pr merge --squash --match-head-commit`), then its branch on GitHub is deleted
  and main here is pulled, so Shepherdr's own update sees the merge. Failed checks are sent back to the agent. A branch
  behind main is merged as it is: rebasing it would make a new commit and run all of GitHub's checks again, and again
  each time another task lands meanwhile. Only a conflict with main is rebased (by `shepherdr merge` when git can, else
  by the agent), and when waiting for GitHub's checks they run on that commit before it merges. For a few hours after
  a task merges through its pull request, Shepherdr watches GitHub's runs on main: once one fails, the space's
  coordinator hears it once (news), with the failing run, the end of its log and the tasks merged since main was last
  green, and decides on a fix-forward task (Autopilot adds one by itself). It hears again only after main was green. GitHub's
  merge queue would test each one on top of the others, but it needs an organisation's repo. Elsewhere it is rebased
  and squash-merged into main here (and main pushed when there is a remote). Uncommitted work in that checkout stops
  this only when the merge would overwrite it, and the refusal names the file; on GitHub the merge goes ahead and main
  here keeps retrying its update. Then the task is marked merged. Once the
  agent's turn ends, the task is put away through herdr: the worktree removed (which closes its space and agent), then
  the branch deleted. Nothing is forced: a checkout with uncommitted changes, or a branch with work main lacks, is kept
  and said so (in the coordinator's news and in `shepherdr status`), and its space and agent close all the same.
  Something still running in its space puts it all off until later. You can also just ask its coordinator to merge it.
  Task agents learn the way from brief to merged from [shepherdr-agent](../skill/shepherdr-agent/SKILL.md): the review the
  brief's Settings block asks for (Settings → How tasks work → Review, Reviewer, Must fix and Review rounds: only words
  in the brief; the agent runs it however it sees fit, a subagent or a
  headless CLI), what the change broke, left undone or added beyond the brief; only the choices no experiment can
  settle as cards for you, and your yes before anything irreversible; the proof in one small artifact; ready with a facts line; then merge or ask. How to
  build and check the work is the agent's own judgment: Shepherdr only gives it the brief, your defaults and the house
  rules.
- Review rounds are a limit so no agent reviews for ever, and an agent can't raise its own. One that has used them all
  with its final commit unreviewed is refused and told to ask its coordinator, who gives it exactly one more with
  `shepherdr task review-more <id>`: you ask the coordinator, as for any task control. It works only once all are
  used, and `task show` records it (`reviewRoundsAdded`).
- One menu holds a task's controls: its row's ⋯ (a mouse finds it on hover; on a phone tap the ⋯ or hold the row) and its
  chat's ⋯. It ends a task three ways: Stop, Done and Delete. Stop and Delete ask first; Done asks first only when
  work would stay unmerged. It also holds Pin and Restart agent, and Unarchive on an archived task.
- A task with nothing to merge (an answer, research, or work no longer wanted) is Done: Done in its menu, `shepherdr task
  close <id> [--summary "..."]`, or just ask its coordinator. Its agent stops, its space closes, its worktree and branch go when
  they hold nothing unsaved or unmerged (else they are kept, and it says so) and it shows in Done with its summary
  (Nothing to merge by default); its row in the space's chat says so. An agent whose `shepherdr ready` finds no changes on
  its branch goes straight to Done the same way.
- Stop in its menu, or `shepherdr task stop <id>`, closes a task's agent and space and puts it in To do. Its work stays: a worktree with unsaved or unmerged work
  is kept, one with none goes with its branch. Writing to the task opens its space again (or makes a fresh worktree)
  and resumes its agent.
- Delete in its menu, or `shepherdr task delete <id>`, removes a task for good; a coordinator does it only when you
  plainly ask: its agent
  stops, its space closes (with anything else running there), its worktree, branch, chat log and record go, so it
  leaves every list, and nothing is posted. A worktree with uncommitted changes, or a branch with work main lacks, is
  refused with what it holds, unless `--force` (the menu says what would be lost and offers Delete anyway). A merged task can be deleted too: its commits stay on main. Its number
  is never given out again.
- Archive is no longer a way to end a task, but nothing archived is lost. Done tasks (merged or closed) archive
  themselves after a week: Settings → Tasks → Archive Done after (`tasks.archiveAfter`: a number of days, or off; each
  machine keeps its own). An archived task, however it got there, leaves every list and count but keeps its record, chat
  and summary: ⌘K finds it, and **Archived · 12** at the bottom of the tasks list shows a space's archived tasks, the
  latest first, each with Unarchive and Delete in its ⋯ (`shepherdr task unarchive <id>`). Writing to an archived task
  brings it back. `shepherdr task list` leaves archived tasks out; `--archived` lists them.
- The field at the top of the Tasks and the Artifacts lists filters them as you type (F gets to it on a keyboard):
  tasks by id, title, status line or summary, Done and archived ones too; artifacts by title or the task that made
  them. Esc clears it.
- Leftovers of merged or closed tasks are swept up when Shepherdr starts and every hour after (a merge updates main,
  and the restart that follows can cut a clean-up short). Only tasks Shepherdr made and finished are looked at, never
  one whose agent is at work or that you talk to again, never your own worktrees or branches, and nothing while herdr
  does not answer. A branch counts as merged when main holds its exact tree (what the squash merge made), when
  squash-merging it again would make its task's own squash commit (so nothing came after the merge, however main
  moved on since), or when merging it into main would change nothing.
- While a task's agent works, it says itself what it is doing and how far along it is, at the start and at each
  natural step: `shepherdr status <id> "Fixing the two failing tests" --done 40 --left 5m` (its instructions tell it
  to). Shepherdr guesses nothing: it shows what the agent said, and counts the minutes left down while it works. Its dot fills like a pie with
  the % done and the minutes left sit small under it in the same orange (`6m`, `<1m`); its row's second line says
  what it does in at most 40 characters, so the title and that line each keep the row's whole width. Its chat header
  says the same with the minutes at the end (`Fixing the two failing tests · ~6 min`). Coordinators report no
  progress: their typing dots say a message is on its way (at once for yours; for news, once the reply shows on its
  screen and isn't a hidden `<no-reply>`); while they only work in the background they show nothing (no dots, no word in
  the header). Task titles
  are at most 32 characters, so each fits one line on a phone. A line longer than 40 characters is cut at a word,
  and the agent is told so. An agent that waits on you keeps its last line, frozen at its % (its minutes stop too);
  once it reports ready, or waits for a go or for other tasks, it has none.

- New tasks capture their space's base branch when added. Use `shepherdr task add "Title" --brief "…"
  --base feature/topic --space NAME` to choose another target for just that task. Its list, chat and
  `shepherdr task show ID` show the target before merging. With an origin remote the branch must exist there and is
  fetched before work starts; without origin a local branch is required. GitHub write access (or a non-GitHub
  remote's push access) and local repository write access are checked before starting. A failed check starts no
  agent. A branch available only on origin gets a local counterpart when the worktree starts.
  Rebase, pull requests and merge use this captured target. A pull request retargeted on GitHub must be corrected
  before Shepherdr will merge it. Branch protection and merge rules still apply at merge time.
