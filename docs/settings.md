# Settings

- Settings (sidebar, or `,` on a desktop) holds the few app settings, in two groups. What agents are told: How tasks
  work, only words in each new brief's Settings block (review, the Reviewer a brief suggests, Must fix, Review rounds,
  merge), each row offering its exact line under Brief wording. How Shepherdr runs: the agent, model and effort tasks and
  coordinators start with (model:
  an id or alias, or default for the CLI's own; effort: default, lowest, low, medium, high, xhigh or max, each CLI
  taking it its own way) and tasks' backup agent, when Done tasks archive themselves, Autopilot's heartbeat (its trigger) and checklist, the time zone of every schedule, each machine's limits, the idle browser, Notifications and Voice. Notifications gathers scoped delivery rules and device enrolment; device delivery is Everywhere. Space menus still offer Notify. Its
  defaults are set Everywhere, for a machine or for a space (`shepherdr set <key> <value> [--machine | --space NAME]`, from any machine);
  the most specific one set wins. Settings always opens on Everywhere, whichever space it came from. Editing above the content names the scope; its searchable hierarchy handles many machines and spaces, and each row on Everywhere offers **For this space only** for the space it came from, or says that space sets its own. Values set here are highlighted, with their inherited value, source and Reset beside them. And, kept on each device, its Appearance: System (the device's own light
  or dark), Light or Dark, set before the first paint, with the browser's bar and artifacts following it. A phone
  lists the sections in groups, as iOS's Settings does, and opens one over the list; a wider screen keeps the list
  down its side.
- Reviewer and Backup default to a CLI that is installed and signed in, checked on each machine with the CLI's own
  status command every 15 minutes: the other CLI than the task agent's where it works. A reviewer falls back on the task
  agent's CLI. A backup doesn't, because a task never fails over to the CLI it runs on, so with no other CLI Backup is
  off and says so. A saved choice stays as it is, and warns where that CLI is missing or signed out: on its row, and
  How tasks work repeats a backup's. A machine not checked yet (it just connected, or the check can't run there)
  keeps the other CLI, unverified, until one succeeds, and its row says so if the check failed.
- Secrets (How Shepherdr runs) holds the keys, tokens and passwords agents use, by name: add, replace and remove them
  in masked boxes, Everywhere (or tick For this space only), for a machine or for a space; the most specific one wins. An agent that needs one asks
  with `shepherdr secret ask NAME --why "…"`: its chat shows a masked box, and the agent is told by name once it is
  kept. Agents run commands with them (`shepherdr secret run NAME -- <command>`, which masks them in what the command prints) or write them to a file git ignores
  (`shepherdr secret env NAME --file .env`), and never see them in a chat, a terminal or a log. All of them are kept
  in one file on the main machine, readable by you only (`~/.shepherdr/vault.json`); a value goes to another machine
  only when an authenticated agent there uses one, over its SSH link. Agent credentials bind access to that agent’s
  own space and machine; loopback or a forwarded socket alone grants nothing. See [agent secret access](secrets.md)
  for provisioning and the upgrade steps for already-running agents.

- Interactive task, coordinator and backup chat choices require both runtime log discovery and a chat reader.
  Settings and Restart offer Claude Code and Codex; other herdr CLIs are refused before a chat launch because
  their replies cannot be shown. Existing saved choices are kept, but an unsupported choice must be changed before
  launching again. Headless reviewer choices are separate; this does not add or prove support for other reviewers.

## Private instructions

Settings → Private instructions has three small text fields: Coordinators, Task agents and Reviewers. Each uses the
existing Everywhere / machine / space picker and Reset. For each role separately, the most specific value set wins:
space > machine > Everywhere > empty. Values are not concatenated across scopes. Save an empty value to suppress
inherited rules for that role; Reset restores inheritance. Backup agents use Task agents' rules. Home coordinators
use their home space's settings, then the machine's and Everywhere's.

These are personal rules, stored with every other setting in the main machine's `~/.shepherdr/state.sqlite` (or
`SHEPHERDR_HOME`), outside the shared repo. Every scope's value stays there; another machine gets a role's effective
rules only in the launch of an agent it runs. No repository `AGENTS.md`, `CLAUDE.md`, override file or worktree copy is
created or changed. Keep passwords, tokens and keys in **Secrets**, never here: this text is visible in settings,
agent prompts and session history. Agents must never copy it into git, task briefs, proof reports or GitHub.

Private rules supplement repository/team rules. Explicit human instructions and the task brief take precedence over
private rules. A conflict with team rules must be surfaced to the human, not silently resolved by replacing them.
Shepherdr's normal role prompt and skills still apply.

A new launch snapshots the role's current effective instructions. Claude Code gets them in its appended prompt file,
Codex as its developer instructions. Saving does not interrupt, restart or update an
already-running agent. Start a new agent or explicitly restart it to deliver changes. A resumed session gets the
current snapshot the same way; it says the new private snapshot replaces the previous one, including when empty. This delivers words, not proof that a model read or obeyed them; old session history is still present.

Reviewers are started by task agents, not by a separate settings service. A task launch includes a clearly marked
reviewer-only snapshot and tells the task agent to pass that snapshot, privacy/precedence rules and repository rules
to every headless or subagent reviewer, without applying reviewer rules to itself or passing task-only private rules.
Changes to reviewer rules therefore need a new task agent or an explicit restart of the existing task agent too.

The CLI uses the same fields, for example:

```sh
shepherdr set task.instructions "Keep replies short." --space my-space
shepherdr set coordinator.instructions "Ask before adding tasks." --machine
shepherdr set reviewer.instructions "Pay extra attention to data loss."
shepherdr unset task.instructions --space my-space
```

Text is limited to 16,000 characters per field. These settings are not part of the saved task brief or its Settings
block, and are not per-task `task add --set` options.
