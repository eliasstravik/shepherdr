<p align="center"><img src="https://img.shields.io/badge/Shepherdr-Mission%20control%20for%20herdr--core-c2410c?style=flat-square&labelColor=09090b" alt="Shepherdr | Mission control for herdr-core" /></p>

<h3 align="center">Manage hundreds of coding agents across your machines from one Herdr window, without the cognitive overload</h3>

<p align="center">Shepherdr is mission control for <a href="https://herdr.dev">herdr-core</a>, as a layout for the Herdr app: your spaces in a sidebar, each with its own Assistant. You tell a space's Assistant what needs doing and it turns it into tasks. Every task runs as an ordinary herdr-core agent in its own git worktree, can be reviewed by fresh eyes before it merges, and asks you on a card when it needs a decision. The Tasks panel shows which need you, which are ready and which are still working.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/assets/shepherdr-launch.mp4"><img src="assets/shepherdr-launch.webp" width="88%" alt="Animation: Shepherdr on a desktop and a phone; you ask the gtm space's coordinator, it adds two tasks that run in parallel, each in its own worktree, reviewed and merged; then a voice call with the home space asks what needs you today" /></a></p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/install.md"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;inside&nbsp;the&nbsp;Herdr&nbsp;app &nbsp; ✓&nbsp;Shepherdr&nbsp;3.1.9,&nbsp;herdr-app&nbsp;0.1.12+</sub></p>

<br />

## Keep every project moving while you're away from the keyboard

The Herdr app is the overview and the remote control; herdr-core is the engine. A space is a folder on a machine with its own Assistant, and each task gets its own agent on its own branch in a git worktree. Agents work outside your checkout, and it only gets main moved forward when a task merges. That's a rule agents follow, not a lock: an Assistant starts there and could still edit it. You answer the cards that need you and let the rest run, and the agents keep working in herdr-core when the window closes.

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

## Tell the Assistant what you want. See which task needs you at a glance.

### 📈 See every task at a glance

Each space's Assistant chat is in the middle and its tasks on the right, by what they need: `Needs you`, `Ready`, `Merging`, `Working`, `Queued`, `Scheduled`, `To do` and `Done`. A working task's dot fills like a pie with its % done and its minutes left, and its second line says what it is doing (`Fixing the two failing tests`). The sidebar groups your spaces by machine, with Pinned and sections of your own, and marks the ones that wait on you. A task opens in the panel with its chat, terminal, files, diff, pull request and browser; Herdr's own panes and splits work as always.

### 🧩 Make it yours: everything is an add-on

Tasks, Assistants, chat, artifacts, voice, reactions, the task browser, Autopilot, other machines: every part of Shepherdr is an add-on made of Herdr mods, listed in one file with what it needs. Switch Artifacts, Voice, Reactions, the Task browser, Autopilot, the sync to other machines or the web app off in Shepherdr settings → Window; the rest is always on in 3.1.9. Your own mods and layouts sit beside Shepherdr's in your Herdr folder and are never touched: an update replaces only the files it put there and you didn't change, and keeps a copy of anything it replaces. Herdr's themes and keys stay yours. [Add-ons](docs/addons.md) lists each one and its switch.

### ⚡ Stop briefing every agent yourself

Write what needs doing to a space's Assistant: it makes it a task or several with `herdr-task`, each with a brief and a Settings block that says how it is reviewed and merged. Each agent starts on Claude Code or Codex, in a worktree of its own, at once or as soon as the machine has room. Want more control? Ask for it "for later", "after SHE-12", or "ask me before merging". Turn on Autopilot in the Assistant's header and it works on its own between your messages, from a heartbeat you write, or add automations that start tasks on a schedule.

### 💬 Know when a task needs an answer

An agent that asks you something, wants a permission or a plan approved shows under `Needs you`, and its question comes as a card you answer with a click, in its chat or from the Assistant's. Each task also shows its live terminal, files, diff, pull request and its own browser you can take over. Reports and draft screens come as artifacts you mark up beside the chat, the Accept card shows a task's proof before you approve it, and you can dictate or call an Assistant by voice.

## Open Shepherdr in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1️⃣</h3><b>Install it into Herdr</b><br /><sub>With the Herdr app opened once, clone this repo and run <code>./install.sh --dry-run</code> to see what it does, then <code>./install.sh</code>. <code>./install.sh --web</code> installs the web app alone.</sub></td>
<td align="center" valign="top" width="33%"><h3>2️⃣</h3><b>Check it and switch to it</b><br /><sub>Run <code>shepherdr doctor</code>. In Herdr, <code>Ctrl+Shift+L</code> picks the Shepherdr layout.</sub></td>
<td align="center" valign="top" width="33%"><h3>3️⃣</h3><b>Write to an Assistant</b><br /><sub>Make a space for a folder (<code>Ctrl+Shift+N</code>) and say what needs doing. <code>Ctrl+K</code> jumps anywhere and <code>Ctrl+Shift+?</code> shows every key.</sub></td>
</tr>
</table>

[The docs](docs/) have the full install, the add-ons, upgrading from 2.x and how to develop it.

## Get everything included, free

<table align="center">
<tr>
<td align="center" valign="top"><sub>For developers who run coding agents with the Herdr app on macOS or Linux</sub><br /><h2>Free</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; An Assistant for every space that turns what you write into tasks<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every task on its own worktree and branch, with its own agent<br />&nbsp;&nbsp;&nbsp;✓&nbsp; A review by fresh eyes before it merges, through a pull request on GitHub<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Cards, alerts, dictation and voice calls in the chat<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every machine you added to herdr-core, from one window<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Your own mods, layouts and keys, kept through every update<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Autopilot, automations, artifacts, secrets and a browser per task</div></td>
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

Shepherdr doesn't update itself: it never follows main, so a merge can't change what runs. An update replaces only the files it put there that you haven't changed (yours stay, with the new copy beside them as `.new`), one mod at a time, and keeps a backup of anything it replaces. Agents keep running in herdr-core meanwhile. Until `shepherdr doctor` says the install is whole, your other machines don't get the new helpers. [Upgrading](docs/upgrading.md) has the details.

## Get your questions answered

### Do I need to know how to code?

You need to be comfortable in a terminal for the install. After that everything happens in the Herdr window or the web app: you write to Assistants and answer cards, and Shepherdr settings holds the few defaults. You'll need macOS or Linux, the Herdr app 0.1.12 or newer with herdr-core 0.1.17 or newer, Python 3.8+, Git, and Claude Code or Codex, installed and signed in. `gh` (pull requests), agent-browser and Chrome for the task browser, and an ElevenLabs key for voice and dictation are optional; the web app needs Bun and Tailscale. [Install](docs/install.md) covers the prerequisites.

### Can my coding agent install it for me?

Yes. Give it this, in the Herdr app's terminal or any agent session on that machine:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/eliasstravik/shepherdr/tree/main
```

### Can I use it without the Herdr app?

Yes: herdr-core runs the agents and the web app is your window, in a browser on your tailnet. Give your agent this:

```text
Install herdr-core (https://herdr.dev), Tailscale (signed in), python3, git and Claude Code or Codex. Then clone https://github.com/eliasstravik/shepherdr, read its docs/install.md and docs/web.md, and install only the web app with ./install.sh --web. Check it with shepherdr doctor, then give me the link from shepherdr web status. Keep it private to my tailnet: never Tailscale Funnel.
```

### How do I check that Shepherdr is installed right?

Run this: it checks every file it installed, the helper links, the shared copies and the programs it needs, and says what's missing.

```bash
shepherdr doctor
```

Shepherdr settings → Machines says how each machine is, and each machine shows its load, memory and disk in the sidebar.

### What permissions do the agents get?

**Codex and Claude Code start with your own permission settings**, so each machine decides; Shepherdr's installer adds only its hooks (with a backup, and `--no-hooks` leaves them out), and herdr-task allows its own commands. A permission prompt shows the task under `Needs you` (`Asks permission`), and a CLI's own startup screens (trusting a folder, signing in, Codex's hooks) come to the chat as a card. The brief's rules and the review are guidance, not a sandbox.

### Does Shepherdr send my work to a hosted service?

No. Shepherdr runs inside the Herdr app on your own machine, keeps its files there, talks to your local herdr-core, and reaches your other machines over herdr-core's remote and your own SSH. The web app is served from your own machine to your tailnet only. Your agent CLI still uses its own service as usual, `gh` talks to GitHub, and voice calls and dictation go through ElevenLabs if you set them up.

### Will it touch my branches or worktrees on its own?

Only the ones it made. Every task works in its own worktree, on its own branch `work/<n>-<slug>`, never in your checkout; a merge only moves your main forward (fast-forward, or a squash merge when there's no GitHub remote). By default a task asks you first: you accept it from the Tasks panel, which merges it; Shepherdr settings → Tasks → Merge can let it merge on its own, or say so for one task. On GitHub it merges through the task's pull request. When a task is done its worktree and branch are removed; one with uncommitted or unmerged work stays, and Shepherdr says so.

### Where do my tasks live?

In `~/.herdr/` on each machine: tasks (`~/.herdr/tasks`), worktrees, artifacts, the secrets vault and Shepherdr's settings (`~/.herdr/shepherdr.json`). The window's own state (chat drafts, attachments) is in your Herdr folder's `data/`. Installing, updating or uninstalling never touches either. [Develop](docs/develop.md) covers the code.

### Can I use several machines?

Yes. Shepherdr is installed once, in the Herdr app on your main machine. Every other machine you add to herdr-core (`hc machine add <ssh target>`, or Add machine in the sidebar) shows up in the sidebar on its own, with its spaces, tasks and Assistants. herdr-task copies itself, its helpers and the role instructions there, and keeps them current. It needs herdr-core, Python, Git and your agent CLI, and nothing of Shepherdr's installed by hand. The web app can be served from one of them that stays on (a Mac mini, a cloud VM): Shepherdr settings → Web → Serve from, or `shepherdr web serve-from <machine>`; [Web](docs/web.md) has how.

### Do I have to start every task through an Assistant?

Mostly. There's no new-task button: you ask a space's Assistant in your own words and it adds the task (`herdr-task add`), so every one gets a brief and the same rules. An automation adds tasks on a schedule or when something happens, such as a merge.

### What if the safety settings aren't enough?

They are soft. A task's review, merge and rules are lines in its brief, and its agent follows them. Every agent has a shell, and a CLI's own sandbox doesn't make it a safe boundary: one can do anything you can, a review is another agent's judgement and not a proof, and Autopilot and automations run with nobody watching. Keep Merge on "ask me first" for a yes before anything lands, and keep Autopilot off where you want to decide every step.

### What does it cost?

Shepherdr is free and [MIT licensed](LICENSE). Your agent CLI's usual usage charges still apply: every task is a full agent session (plus a review when it's on), each Assistant spends tokens on each message and on Autopilot's heartbeat, and voice calls use your ElevenLabs account.

### What is herdr-core?

The small engine under the Herdr app, with the `hc` command. It holds your agents' terminals, keeps them running when the window closes, and links your machines. The Herdr app is its desktop window, and Shepherdr is a layout and a set of mods inside that window.

### How is 3.0 different from 2.1?

2.1 was its own web app beside herdr-core, opened in a browser over your tailnet. 3.0 lives inside the Herdr desktop app: a layout and its mods, installed with `./install.sh` and listed on herdr.dev. The ideas are the same (spaces, an Assistant per space, tasks in worktrees, cards, artifacts, Autopilot), but it's a new build: 2.1's data in `~/.shepherdr` isn't carried over, and 2.1's plugins don't run in it. 3.1 brings back a web app for phone and tablet, on the same data as the window.

### I'm on 2.1 or 2.0. Where did my version go?

Nowhere: 2.1 is on the `v2.1` branch and 2.0 on the `v2.0` branch, each with its own README, and 3.0 never touches their data. Don't pull main into them or update them from main. [Upgrading](docs/upgrading.md) has the steps when you want 3.0.

## Open Shepherdr in three steps

<p align="center">Shepherdr starts with an install, one layout switch, and one sentence to an Assistant about what needs doing. It starts the agents, follows their work and brings what needs you to the top. You choose what to answer and what to merge.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/install.md"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;inside&nbsp;the&nbsp;Herdr&nbsp;app &nbsp; ✓&nbsp;Shepherdr&nbsp;3.1.9,&nbsp;herdr-app&nbsp;0.1.12+</sub></p>
