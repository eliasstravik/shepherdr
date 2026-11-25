"""herdr-task as a package; ../herdr-task runs it. Modules, each importing only from the ones
before it:

  base         Shared ground: paths, Fail, the clock, this herdr-task's own files, and running
               programs (hc, herdr-app, git) only in the real environment.
  settings     The person's settings (~/.config/shepherdr/settings.json and per-folder), the agent each task
               runs, and the Settings block a task's brief ends with.
  templates    The instructions agents start with: ~/.config/herdr-core/templates, and the built-in
               ones.
  agents       Live agents: a task's terminals, its status and what its agent last said or asks.
  provider     Provider errors: a turn the model's provider cut off, in a few words.
  sessions     Agent sessions: the Claude Code or Codex session a task's agent runs, so it can
               resume.
  github       GitHub and merging: pull requests, checks, and finishing a merged task.
  launch       Starting agents: their argv, labels, brief, tab and coordinator.
  takeover     Which agent CLIs this machine has installed and signed in (cli-check.json).
  store        Where a folder's tasks live (~/.herdr/tasks/<slug>.json) and the locked Store that
               edits them.
  queues       Queues: tasks that come after others, and a machine too busy to start more.
  archive      The archive: done tasks set aside after a while.
  output       Output: a task as JSON and as one line of text.
  carry_over   The 3.1 to 3.2 switch: the default herdr-core session's documents and machines into Shepherdr's own.
  scheduler    Keeps the scheduler (herdr-automations) running on this machine.
  commands     The task commands: add, start, status, ready, accept, merge and the rest.
  news         News: what changed in a space's tasks, told to its Assistant.
  ghnews       GitHub news: a Ready task's pull request news to its agent, and its base branch
               going red after merges, to the Assistant.
  systemic     One failure behind many tasks (a red base, one check failing many merge-queue
               groups): the Assistant told once, fix requests held till it is green again.
  tick         Tick: one pass over the tasks (start queued ones, finish merged ones, note the
               ones whose agent stopped).
  reviewers    A worker's reviewer that never started, froze or failed: ended, and its worker
               told why and what next.
  machines     Other machines: the task tools kept in step there (sync), the reach map hop by
               hop, the Assistants on every reachable machine and messages between them.
  automations  Schedules, stored as automations (a saved task added again by a time or an
               event; every run is a task), and the scheduler's loop.
  cli          The command line, and running herdr-task on another machine (--on).
"""
