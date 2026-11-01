<p align="center"><img src="https://img.shields.io/badge/Shepherdr-Mission%20control%20for%20herdr--core-c2410c?style=flat-square&labelColor=09090b" alt="Shepherdr | Mission control for herdr-core" /></p>

<h3 align="center">Manage hundreds of coding agents across your machines from your phone, tablet or desktop, without the cognitive overload</h3>

<p align="center">Shepherdr is mission control for <a href="https://herdr.dev">herdr-core</a>: one private app on your tailnet with your spaces in a sidebar, each with its own coordinator. You tell a space's coordinator what needs doing and it turns it into tasks. Every task runs as an ordinary herdr-core agent in its own git worktree, gets reviewed by fresh eyes before it merges, and asks you on a card when it needs a decision. The tasks list shows which need you, which are ready and which are still working.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/assets/shepherdr-launch.mp4"><img src="assets/shepherdr-launch.webp" width="88%" alt="Animation: Shepherdr on a desktop and a phone; you ask the gtm space's coordinator, it adds two tasks that run in parallel, each in its own worktree, reviewed and merged; then a voice call with the home space asks what needs you today" /></a></p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/core/start.md#requirements-and-installation"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;private&nbsp;on&nbsp;your&nbsp;tailnet &nbsp; ✓&nbsp;macOS&nbsp;and&nbsp;Linux,&nbsp;herdr-core&nbsp;0.1.14</sub></p>

<br />

## Keep every project moving while you're away from the keyboard

The app is an overview and a remote control; herdr-core is the engine. A space is a folder on a machine with its own coordinator, and each task gets its own agent on its own branch in a git worktree. Agents work outside your checkout, and it only gets main moved forward when a task merges. That's a rule agents follow, not a lock: a coordinator starts there and could still edit it. You answer the cards that need you and let the rest run, from whichever screen is in your hand.

## Choose between briefing each agent by hand, one long agent session, a cloud agents product, or mission control for herdr-core

| | **Shepherdr** | Briefing agents by hand | One long agent session | Cloud agents products |
|---|:---:|:---:|:---:|:---:|
| **No extra software fee** | ✅ | ✅ | ✅ | ❌ |
| **Parallel tasks on separate branches** | ✅ | ✅ | ❌ | ✅ |
| **Same rules for every agent** | ✅ | ❌ | ✅ | ✅ |
| **Fresh eyes review each task before it merges (on by default)** | ✅ | ❌ | ❌ | ❌ |
| **Questions reach your phone as cards and alerts** | ✅ | ❌ | ❌ | ✅ |
| **Several machines from one screen** | ✅ | ❌ | ❌ | ✅ |
| **Runs on your own machines** | ✅ | ✅ | ✅ | ❌ |
| **Works with the agent CLI you already use** | ✅ | ✅ | ✅ | ❌ |
| **Runs with no machine of yours switched on** | ❌ | ❌ | ❌ | ✅ |

Keep your attention on decisions. Shepherdr starts, follows and puts away the tasks, your agents do the work, and you choose what to answer, approve, or merge.

## Tell the coordinator what you want. See which task needs you from anywhere.

### 📈 See every task at a glance

Each space's chat is in the middle and its tasks on the right, by what they need: `Needs you`, `Ready`, `Merging`, `Working`, `Queued`, `To do` and `Done`. A working task's dot fills like a pie with its % done and its minutes left, and its second line says what it is doing (`Fixing the two failing tests`). The sidebar groups your [spaces](docs/spaces.md) by machine, with Pinned and sections of your own, and marks the ones that wait on you. On a desktop, [split view](docs/chat.md) puts up to three chats, task lists or artifacts side by side.

### 🧩 Make it yours: everything is a plugin

Places, chats, tasks, artifacts, the terminal, the browser, voice, alerts, Autopilot: every part of Shepherdr is a plugin, and yours sit beside them in `~/.shepherdr/plugins/<name>/`. Write one yourself or ask an agent to build it. Add a feature to any of the screen's slots (a bar at the top, a menu item, a side panel tab, a settings page, a key), change or replace any built-in plugin's screen parts by giving yours its name (copy it there, add a `shepherdr.json` and edit it; the server's own behaviour stays), and switch any plugin off in Settings → Plugins. A theme of your own works the same way: Shepherdr's colours are CSS variables that a plugin can set. Updates never touch that folder, so you keep every new release without a fork: save a file and Shepherdr rebuilds its plugins in seconds, with the app and agents still running, and a plugin that breaks is set aside with its error while the rest runs. [Plugins](docs/plugins.md) has a hello world and every slot.

### ⚡ Stop briefing every agent yourself

Write what needs doing to a space's coordinator: it makes it a task or several, each with a brief and a Settings block that says how it is reviewed and merged. Each agent starts on Claude Code or Codex, in a worktree of its own, at once or as soon as the machine has room. Want more control? Ask for it "for later", "after SHE-12", or "ask me before merging". Turn on [Autopilot](docs/autopilot.md) (a repo space on Linux) and the coordinator works on its own between your messages, or add [automations](docs/autopilot.md) that start tasks on a schedule.

### 💬 Know when a task needs an answer

An agent that asks you something, wants a permission or a plan approved shows under `Needs you`, and its question comes as a card you answer with a tap, from the chat or straight from an [alert](docs/get-started.md) on your lock screen. Each task's chat also shows its live terminal, files, diff, pull request and a [shared browser](docs/browser.md) you can take over. Reports and draft screens come as [artifacts](docs/artifacts.md) you mark up beside the chat, and you can call a coordinator by [voice](docs/get-started.md).

## Open Shepherdr in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1️⃣</h3><b>Install the app</b><br /><sub>With herdr-core and Bun there, clone this repo, run <code>bun install --frozen-lockfile</code> and <code>bun run build</code>, put its <code>bin</code> on your PATH and run <code>shepherdr start</code>.</sub></td>
<td align="center" valign="top" width="33%"><h3>2️⃣</h3><b>Share it on your tailnet</b><br /><sub>Run <code>tailscale serve --bg --set-path /shepherdr 7787</code>. It serves the app privately, never public, and <code>shepherdr status</code> prints its link.</sub></td>
<td align="center" valign="top" width="33%"><h3>3️⃣</h3><b>Write to a coordinator</b><br /><sub>Open the link on your phone and add it to the home screen, then turn alerts on in Settings. Pick a space and say what needs doing. <code>?</code> on a keyboard shows everything else.</sub></td>
</tr>
</table>

[The docs](docs/) have the full install, every screen and setting, and how it all works.

## Get everything included, free

<table align="center">
<tr>
<td align="center" valign="top"><sub>For developers who run coding agents on herdr-core on macOS or Linux</sub><br /><h2>Free</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; A coordinator for every space that turns what you write into tasks<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every task on its own worktree and branch, with its own agent<br />&nbsp;&nbsp;&nbsp;✓&nbsp; A review by fresh eyes before it merges, through a pull request on GitHub<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Cards, alerts and voice calls on your phone, tablet or desktop<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every machine you added to herdr-core, from one app<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Your own plugins and themes, kept through every update<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Autopilot, automations, artifacts, a shared browser and split view</div></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/core/start.md#requirements-and-installation"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></td>
</tr>
</table>

## Updating

```bash
shepherdr stop
git pull --ff-only
bun install --frozen-lockfile && bun run build
shepherdr start
```

Shepherdr doesn't update itself: it never follows main, so a merge can't change what runs. Agents keep running in herdr-core meanwhile, and every open screen reloads with what you were typing kept. Check first that the new version pins the herdr-core you run. [Upgrading and updates](docs/upgrading.md) has the details.

## Get your questions answered

### Do I need to know how to code?

You need to be comfortable in a terminal for the install. After that everything happens in the app: you write to coordinators and answer cards, and Settings holds the few defaults. You'll need macOS or Linux, herdr-core 0.1.14, Bun 1.4.2, Git, Tailscale to reach it from your other devices, and Claude Code or Codex, installed and signed in. `gh` (pull requests), Chrome for the shared browser and an ElevenLabs key for voice are optional. [Get started](docs/core/start.md#requirements-and-installation) covers the prerequisites.

### How do I check that Shepherdr is running?

Run this on the main machine: it says how the app is and shows its link. `shepherdr start` starts it when it is not running.

```bash
shepherdr status
```

Settings → Machines says how each one is, and each machine's home space shows its load, memory and disk. [Other machines](docs/machines.md) has the details.

### What permissions do the agents get?

**Codex and Claude Code start with your own permission settings**, so each machine decides; Shepherdr adds only its hooks and allows its own commands, and your settings are never touched. A permission prompt shows the task under `Needs you` (`Asks permission`), and a CLI's own startup screens (trusting a folder, signing in, Codex's hooks) come to the chat as a card. The brief's rules and the review are guidance, not a sandbox. [Tasks](docs/tasks.md) has the details.

### Does Shepherdr send my work to a hosted service?

No. Shepherdr runs on your own machine, keeps its files there, talks to your local herdr-core, and reaches your other machines over herdr-core's remote and your own SSH. The app is shared only on your tailnet. Your agent CLI still uses its own service as usual, alerts go through your browser's push service, and voice calls go through ElevenLabs if you set them up.

### Will it touch my branches or worktrees on its own?

Only the ones it made. Every task works in its own worktree, on its own branch `work/<n>-<slug>`, never in your checkout; a merge only moves your main forward (fast-forward, or a squash merge when there's no GitHub remote). By default a task merges on its own once its review is done and its quick checks pass; set Settings → How tasks work → Merge to "ask me first", or say so for one task. On GitHub it merges through the task's pull request. When a task is done its worktree and branch are removed; one with uncommitted or unmerged work stays, and Shepherdr says so.

### Where do my tasks live?

In `~/.shepherdr/` on the main machine (`SHEPHERDR_HOME` to move it): your spaces, tasks, chats, artifacts, settings, Autopilot checklists and your own plugins. Other machines get only a small helper folder. [Develop](docs/develop.md) and [Plugins](docs/plugins.md) cover the code and how to change Shepherdr's screen for yourself.

### Can I use several machines?

Yes. Shepherdr is installed once, on the main machine. Every other machine you add to herdr-core (`hc machine add <ssh target>`) shows up in the sidebar on its own, with its spaces, tasks and coordinators. It needs herdr-core, Git, Bun and your agent CLI, and nothing of Shepherdr's installed by hand. [Other machines](docs/machines.md) has the details.

### Do I have to start every task through a coordinator?

Mostly. The app has no new-task button: you ask a space's coordinator in your own words and it adds the task (`shepherdr task add`), so every one gets a brief and the same rules. An [automation](docs/autopilot.md) adds tasks on a schedule or when something happens, such as a merge.

### What if the safety settings aren't enough?

They are soft. A task's review, merge and rules are lines in its brief, and its agent follows them. Every agent has a shell, and a CLI's own sandbox doesn't make it a safe boundary: one can do anything you can, a review is another agent's judgement and not a proof, and Autopilot and automations run with nobody watching. Set Merge to "ask me first" for a yes before anything lands, and keep Autopilot off where you want to decide every step.

### What does it cost?

Shepherdr is free and [MIT licensed](LICENSE). Your agent CLI's usual usage charges still apply: every task is a full agent session plus a review, each coordinator spends tokens on each message and on Autopilot's heartbeat, and voice calls use your ElevenLabs account.

### What is herdr-core?

The small engine under Shepherdr, with the `hc` command. It holds your agents' terminals, keeps them running when the app or your screen closes, and links your machines. Shepherdr is its private web app, talking to it over a local socket that never goes on the network.

### How is 2.1 different from the 2.0 herdr plugin?

2.0 was a plugin inside terminal herdr: installed with `herdr plugin install`, updating itself from main, and reaching other machines with SSH workers, helpers and tunnels. 2.1 stands alone beside herdr-core and needs no herdr app: you install it from a checkout, start it with `shepherdr start` and update it by hand, and herdr-core links the machines. The app itself looks and works the same. It runs Claude Code and Codex (not pi, for now), its home starts fresh, and your own plugins need a small change.

### I'm on 2.0. Where do I go?

Nowhere until you want to: 2.0 and its data stay as they are, on the `v2.0` branch with its own README, and 2.1 never imports them. Don't pull main into it or update it from main. When you want 2.1, [Upgrading from 2.0](docs/core/cutover.md) has the steps.

## Open Shepherdr in three steps

<p align="center">Shepherdr starts with an install, one link, and one sentence to a coordinator about what needs doing. It starts the agents, follows their work and brings what needs you to your phone. You choose what to answer and what to merge.</p>

<p align="center"><a href="https://github.com/eliasstravik/shepherdr/blob/main/docs/core/start.md#requirements-and-installation"><img src="assets/buttons/install-shepherdr.svg" alt="Install Shepherdr" /></a></p>

<p align="center"><sub>✓&nbsp;Free,&nbsp;MIT&nbsp;licensed &nbsp; ✓&nbsp;Runs&nbsp;on&nbsp;your&nbsp;machines,&nbsp;private&nbsp;on&nbsp;your&nbsp;tailnet &nbsp; ✓&nbsp;macOS&nbsp;and&nbsp;Linux,&nbsp;herdr-core&nbsp;0.1.14</sub></p>
