<p align="center"><img src="https://img.shields.io/badge/Shepherdr-Mission%20control%20for%20herdr--core-c2410c?style=flat-square&labelColor=09090b" alt="Shepherdr | Mission control for herdr-core" /></p>

<h3 align="center">Manage hundreds of coding agents across your machines from one browser tab, without the cognitive overload</h3>

<p align="center">Shepherdr is mission control for <a href="https://herdr.dev">herdr-core</a>, as one web app in your browser: your spaces in a list, each with its own chat. You tell a space what needs doing and Shepherdr turns it into tasks. Every task runs as an ordinary herdr-core agent in its own git worktree, can be reviewed by fresh eyes before it merges, and asks you on a card when it needs a decision. The Tasks pane shows which need you, which are working and which are up next.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/assets/shepherdr-launch.mp4"><img src="assets/shepherdr-launch.webp" width="88%" alt="Animation: Shepherdr on a desktop and a phone; you ask the gtm space's coordinator, it adds two tasks that run in parallel, each in its own worktree, reviewed and merged; then a voice call with the home space asks what needs you today" /></a></p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/install.md"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;private&nbsp;on&nbsp;your&nbsp;tailnet &nbsp; ✓&nbsp;Shepherdr&nbsp;3.2.9,&nbsp;herdr-core&nbsp;0.1.17+</sub></p>

<br />

## Keep every project moving while you're away from the keyboard

Shepherdr is the overview and the remote control; herdr-core is the engine. A space is a folder on a machine with its own chat, and each task gets its own agent on its own branch in a git worktree. Agents work outside your checkout, and it only gets main moved forward when a task merges. That's a rule agents follow, not a lock: a space's own agent starts there and could still edit it. You answer the cards that need you and let the rest run, and the agents keep working in herdr-core when you close the tab.

## Choose between briefing each agent by hand, one long agent session, a cloud agents product, or mission control for herdr-core

| | **Shepherdr** | Briefing agents by hand | One long agent session | Cloud agents products |
|---|:---:|:---:|:---:|:---:|
| **No extra software fee** | ✅ | ✅ | ✅ | ❌ |
| **Parallel tasks on separate branches** | ✅ | ✅ | ❌ | ✅ |
| **Same rules for every agent** | ✅ | ❌ | ✅ | ✅ |
| **Fresh eyes review each task before it merges (one setting)** | ✅ | ❌ | ❌ | ❌ |
| **Questions reach you as cards and alerts** | ✅ | ❌ | ❌ | ✅ |
| **Several machines from one screen** | ✅ | ❌ | ❌ | ✅ |
| **Runs on your own machines** | ✅ | ✅ | ✅ | ❌ |
| **Works with the agent CLI you already use** | ✅ | ✅ | ✅ | ❌ |
| **Runs with no machine of yours switched on** | ❌ | ❌ | ❌ | ✅ |

Keep your attention on decisions. Shepherdr starts, follows and puts away the tasks, your agents do the work, and you choose what to answer, approve, or merge.

## Tell Shepherdr what you want. See which task needs you at a glance.

### 📈 See every task at a glance

Each space's chat is in the middle and its tasks on the right, by what they need: `Needs you`, `Working`, `Up next` and `Done`, with `Ready for review` under Needs you. A working task shows its time left, worked out from the progress its agent reports, and its second line says what it is doing (`Fixing the two failing tests`). The list puts your spaces under their machine, in groups of your own, and counts what waits on you in each. A task opens in the pane with its chat, its pull request link, a terminal of your own and its Screen; every edge between the list, the chat and the pane can be dragged.

### 🧩 Make it yours: every feature is a plugin

Tasks, chat, artifacts, voice, reactions, Screens, schedules, the terminal, search, alerts: every feature of Shepherdr is a plugin, listed in one file. Switch Screens, Voice, Schedules, Reactions or Terminal off in Settings › Plugins; the rest is always on in 3.2.9. Every space starts with Everything's settings and can set its own Assistant and secrets; each repo can set how its tasks run. An update replaces only Shepherdr's own folder, and keeps a copy of anything of yours it replaces. The Herdr app stays yours: it only gets one "Open Shepherdr" button. [Plugins](docs/plugins.md) lists each one and its switch.

### ⚡ Stop briefing every agent yourself

Write what needs doing in a space's chat: Shepherdr makes it a task or several with `herdr-task`, each with a brief and a Settings block that says how it is reviewed and merged. Each agent starts on Claude Code or Codex, in a worktree of its own, the moment it is asked to. Want more control? Ask for it "for later", "after the login fix", or "ask me before merging". Ask for a schedule and it starts tasks on its own, at a time or when something happens, such as a merge.

### 💬 Know when a task needs an answer

An agent that asks you something, wants a permission or a plan approved shows under `Needs you`, and its question comes as a card you answer with a click, in its task, its space's chat or Everything's. Each task also has a terminal, its pull request link and a Screen: the agent's browser and desktop, to watch and take over. Reports and draft screens come as artifacts, real web pages you mark up beside the chat, the review card shows a task's proof before you press "Mark as done and merge", and you can dictate or run the whole app by voice.

## Open Shepherdr in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1️⃣</h3><b>Install it on your machine</b><br /><sub>With herdr-core installed, clone this repo and run <code>./install.sh --dry-run</code> to see what it does, then <code>./install.sh</code>. It builds the web app and starts its service.</sub></td>
<td align="center" valign="top" width="33%"><h3>2️⃣</h3><b>Check it and open it</b><br /><sub>Run <code>shepherdr doctor</code>. Open the link it prints, on any device on your tailnet.</sub></td>
<td align="center" valign="top" width="33%"><h3>3️⃣</h3><b>Write in a chat</b><br /><sub>Make a space for a folder (<code>New space</code>) and say what needs doing. <code>Ctrl+K</code> searches everything and <code>Ctrl+`</code> opens your own terminal.</sub></td>
</tr>
</table>

[The docs](docs/) have the full install, the plugins, upgrading from 3.1 and how to develop it.

## Get everything included, free

<table align="center">
<tr>
<td align="center" valign="top"><sub>For developers who run coding agents with herdr-core on macOS or Linux</sub><br /><h2>Free</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; A chat for every space that turns what you write into tasks<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every task on its own worktree and branch, with its own agent<br />&nbsp;&nbsp;&nbsp;✓&nbsp; A review by fresh eyes before it merges, through a pull request on GitHub<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Cards, alerts, dictation and voice over the whole app<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every machine you added to herdr-core, from one browser tab<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Your own settings, for everything, per space or per repo<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Schedules, artifacts, secrets, and each agent's browser and desktop</div></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/install.md"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></td>
</tr>
</table>

## Updating

```bash
git pull --ff-only
shepherdr update
shepherdr doctor
```

Shepherdr doesn't update itself: it never follows main, so a merge can't change what runs. An update replaces Shepherdr's own folder (a role instruction you changed stays, with the new copy beside it as `.new`) and keeps a backup of anything of yours it replaces. Agents keep running in herdr-core meanwhile. Until `shepherdr doctor` says the install is whole, your other machines don't get the new helpers. [Upgrading](docs/upgrading.md) has the details.

## Get your questions answered

### Do I need to know how to code?

You need to be comfortable in a terminal for the install. After that everything happens in the web app: you write in chats and answer cards, and Settings holds the few defaults. You'll need macOS or Linux, herdr-core 0.1.17 or newer, Python 3.8+, Git, Tailscale, and Claude Code or Codex, installed and signed in. `gh` (pull requests), an ElevenLabs key for voice and dictation, and the Herdr app are optional; the installer gets Bun, and agent-browser and Chrome for Screens, when they're missing. [Install](docs/install.md) covers the prerequisites.

### Can my coding agent install it for me?

Yes. Give it this, in any agent session on that machine:

```text
Clone https://github.com/eliasstravik/shepherdr, read its docs/install.md, run ./install.sh and shepherdr doctor, then give me the link it prints.
```

### Can I use it without the Herdr app?

Yes: herdr-core runs the agents and the web app is your window, in a browser on your tailnet. The Herdr app is optional. Give your agent this:

```text
Install herdr-core (https://herdr.dev), Tailscale (signed in), python3, git and Claude Code or Codex. Then clone https://github.com/eliasstravik/shepherdr, read its docs/install.md and docs/web.md, and install it with ./install.sh. Check it with shepherdr doctor, then give me the link from shepherdr web status. Keep it private to my tailnet: never Tailscale Funnel.
```

### How do I check that Shepherdr is installed right?

Run this: it checks every file it installed, the helper links, the programs it needs and that its service answers, and says what's missing.

```bash
shepherdr doctor
```

Settings › Machines says how each machine is, with its agents, processor, memory and disk, and a machine that needs a look gets a warning mark in the list.

### What permissions do the agents get?

**Codex and Claude Code start with your own permission settings**, so each machine decides; Shepherdr's installer adds only its hooks (with a backup, and `--no-hooks` leaves them out), and herdr-task allows its own commands. A permission prompt shows the task under `Needs you`, with a card to allow or decline it, and an agent that waits at a prompt of its own (trusting a folder, signing in) gets a card that opens its terminal. The brief's rules and the review are guidance, not a sandbox.

### Does Shepherdr send my work to a hosted service?

No. Shepherdr runs on your own machine, keeps its files there, talks to your local herdr-core, and reaches your other machines over herdr-core's remote and your own SSH. The web app is served from your own machine to your tailnet only. Your agent CLI still uses its own service as usual, `gh` talks to GitHub, and voice and dictation go through ElevenLabs if you set them up.

### Will it touch my branches or worktrees on its own?

Only the ones it made. Every task works in its own worktree, on its own branch `task/<n>-<slug>`, never in your checkout; a merge only moves your main forward (fast-forward, or a squash merge when there's no GitHub remote). By default a task asks you first: you press "Mark as done and merge" on its review card; Settings › Tasks › Merge can let it merge on its own, or say so for one task. On GitHub it merges through the task's pull request. When a task is done its worktree and branch are removed; one with uncommitted or unmerged work stays, and Shepherdr says so.

### Where do my tasks live?

In Shepherdr's own folders on each machine: tasks, artifacts, task worktrees and the secrets vault in `~/.local/share/shepherdr`, Shepherdr's settings in `~/.config/shepherdr`, the agents' browsers and the service's files in `~/.local/state/shepherdr` (`shepherdr where` lists them; older ones stay in `~/.herdr`, which links there). What a browser keeps for itself (drafts, the theme) stays in that browser. Uninstalling never touches your data. [Develop](docs/develop.md) covers the code.

### Can I use several machines?

Yes. Shepherdr is installed once, on the machine that serves it. Every other machine you add to herdr-core (Settings › Machines › Add a machine shows the command) shows up as a heading in the list, with its spaces and tasks. herdr-task copies itself, its helpers and the role instructions there, and keeps them current. It needs herdr-core, Python, Git and your agent CLI, and nothing of Shepherdr's installed by hand. The web app can be served from one of them that stays on (a Mac mini, a cloud VM): `shepherdr web serve-from <machine>`; [The app](docs/web.md) has how.

### Do I have to start every task through a chat?

Yes. There's no new-task button: you ask in a space's chat in your own words and Shepherdr adds the task (`herdr-task add`), so every one gets a brief and the same rules. A schedule adds tasks at a time or when something happens, such as a merge.

### What if the safety settings aren't enough?

They are soft. A task's review, merge and rules are lines in its brief, and its agent follows them. Every agent has a shell, and a CLI's own sandbox doesn't make it a safe boundary: one can do anything you can, a review is another agent's judgement and not a proof, and schedules run with nobody watching. Keep Merge on "When I mark it as done" for a yes before anything lands, and pause a schedule where you want to decide every step.

### What does it cost?

Shepherdr is free and [MIT licensed](LICENSE). Your agent CLI's usual usage charges still apply: every task is a full agent session (plus a review when it's on), each chat spends tokens on each message, every run of a schedule is a task, and voice uses your ElevenLabs account.

### What is herdr-core?

The small engine under the Herdr app, with the `hc` command. It holds your agents' terminals, keeps them running when the window closes, and links your machines. The Herdr app is its desktop window, and Shepherdr is a web app beside it that runs its agents in a herdr-core session of its own.

### How is 3.0 different from 2.1?

2.1 was its own web app beside herdr-core, opened in a browser over your tailnet. 3.0 lived inside the Herdr desktop app: a layout and its mods, installed with `./install.sh` and listed on herdr.dev. The ideas are the same (spaces, a chat per space, tasks in worktrees, cards, artifacts), but it's a new build: 2.1's data in `~/.shepherdr` isn't carried over, and 2.1's plugins don't run in it. 3.1 brought back a web app for phone and tablet, on the same data as the window. 3.2 makes that web app all of Shepherdr, on phone, tablet and desktop: the layout and its mods are gone, and your spaces, tasks and settings carry over.

### I'm on 2.1 or 2.0. Where did my version go?

Nowhere: 2.1 is on the `v2.1` branch and 2.0 on the `v2.0` branch, each with its own README, and 3.x never touches their data. Don't pull main into them or update them from main. [Upgrading](docs/upgrading.md) has the steps when you want 3.2.

## Open Shepherdr in three steps

<p align="center">Shepherdr starts with an install, one link to open, and one sentence in a chat about what needs doing. It starts the agents, follows their work and brings what needs you to the top. You choose what to answer and what to merge.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/install.md"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;private&nbsp;on&nbsp;your&nbsp;tailnet &nbsp; ✓&nbsp;Shepherdr&nbsp;3.2.9,&nbsp;herdr-core&nbsp;0.1.17+</sub></p>
