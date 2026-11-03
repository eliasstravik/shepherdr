"""herdr-task as a package; ../herdr-task runs it. Modules, each importing only from the ones
before it:

  base         Shared ground: paths, Fail, the clock, this herdr-task's own files, and running
               programs (hc, herdr-app, git) only in the real environment.
  settings     The person's settings (~/.herdr/shepherdr.json and per-folder), the agent each task
               runs, and the Settings block a task's brief ends with.
  templates    The instructions agents start with: ~/.config/herdr-core/templates, and the built-in
               ones.
  agents       Live agents: a task's terminals, its status and what its agent last said or asks.
  provider     Provider errors: a turn the model's provider cut off, and whether to retry it.
  sessions     Agent sessions: the Claude Code or Codex session a task's agent runs, so it can
               resume.
  github       GitHub and merging: pull requests, checks, and finishing a merged task.
  launch       Starting agents: their argv, labels, brief, tab and coordinator.
  takeover     The backup agent: a task whose CLI can't go on is taken over, once, by the other
               CLI; and which CLIs each machine has installed and signed in.
  store        Where a folder's tasks live (~/.herdr/tasks/<slug>.json) and the locked Store that
               edits them.
  queues       Queues: tasks that come after others, and how many may run at once.
  archive      The archive: done tasks set aside after a while.
  output       Output: a task as JSON and as one line of text.
  scheduler    Keeps the scheduler (herdr-automations) running on this machine.
  commands     The task commands: add, start, status, ready, accept, merge and the rest.
  news         News: what changed in a space's tasks, told to its Assistant.
  ghnews       GitHub news: a Ready task's pull request news to its agent, and its base branch
               going red after merges, to the Assistant.
  tick         Tick: one pass over the tasks (start queued ones, finish merged ones, retry cut
               turns).
  backups      Backups of every machine's spaces, and restoring them.
  machines     Other machines: the task tools kept in step there (sync), the reach map hop by
               hop, the Assistants on every reachable machine and messages between them.
  automations  Automations (a saved task added again by a time or an event), and the scheduler's
               loop.
  autopilot    Autopilot: a space's Assistant woken on a schedule or by events, with its heartbeat
               and saved progress.
  cli          The command line, and running herdr-task on another machine (--on).
"""
