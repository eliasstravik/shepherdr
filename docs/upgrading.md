# Upgrading

## From 3.1 to 3.2

```bash
git pull --ff-only
shepherdr update
shepherdr doctor
```

3.2 replaces 3.1 in one switch. There is no time with both. A web-only 3.1 install switches the same way.

What the update does, in order:

1. It waits while tasks are working. It names them and changes nothing. Run it again once they finished or you
   stopped them. `--force` switches anyway.
2. It builds the app. A build that fails stops the update before anything is changed.
3. It takes out what 3.1 put in the Herdr app: its mods, its layout, `lib/`, `core/`, `bin/`, its keys and its
   hooks. A file you changed there goes to the backup folder first, and the update says where. Shepherdr's own files
   go in `~/.local/share/shepherdr`. Each old mod is swapped for a small notice in one step, so a Herdr window that
   is open keeps working: see [The Herdr window after 3.2](#the-herdr-window-after-32).
4. It carries your spaces, groups and linked machines into Shepherdr's own herdr-core session, and removes 3.1's
   scheduler from the default one. Shepherdr's agents still in the default session (an Assistant, a task's agent)
   move too, each on its own conversation, once it's idle; one at work waits, and the update says so.
   `herdr-task carry-over` tries again when a machine couldn't be reached or an agent was busy. `shepherdr doctor`
   names any agent still left behind. Who keeps the secrets and who serves the web app are kept by each machine's
   id, which differs per session: the carry-over changes them to the new ids, here and on linked machines, and
   repairs what 3.2.0 left naming the old ones (each update and `herdr-task carry-over` look again). `shepherdr
   doctor` says when one names a machine none knows, and how to fix it.
5. It starts the service and prints the app's link.
6. It converts old artifacts to pages, once. `herdr-artifact convert --all` tries again if that failed.

Then, in Herdr, pick another layout (Ctrl+Shift+L) if Shepherdr's was selected. Where the Herdr app is installed it
gets one "Open Shepherdr" button (Ctrl+Shift+O, when that key is free).

What carries over:

- Spaces. Sections become groups.
- Tasks in every state, and schedules (3.1's automations).
- Settings and secrets. Settings with no row in the new window still apply ([Settings](settings.md)).
- Each chat's history. It shows above a "New session" line once its agent starts again.

What does not:

- Autopilot. Ask for a repeating schedule instead.
- Tasks at once. A task starts the moment it is asked to.
- Automatic retry. An agent that stopped stays stopped until you press Restart.
- Pinned spaces, per-space Notify, tabs, the Files and Changes panels, usage insights.
- Your own changes to Shepherdr's window mods and layout. They are in the backup folder.

Shepherdr's agents now run in a herdr-core session of their own. They no longer show in the Herdr app.

Other machines: a machine that only runs tasks gets the new helpers by itself once `shepherdr doctor` passes here. A
machine that serves the app, or had its own 3.1 install, is switched with `shepherdr web install-on <machine>`
(`--force` there too).

## The Herdr window after 3.2

3.2.0 to 3.2.2 took 3.1's views out from under an open Herdr window. The window kept showing them, each with a red
"This view could not be re-rendered" banner ("out of memory", `Null "null"`), a task's pane hung on "Opening the
conversation…", and after a restart each space's Assistant tab said "chat did not load". Nothing was lost: the
agents, chats and tasks run on in Shepherdr's own session and show in the web app.

From the next update on, each of those views is a notice instead: the main chat says "Shepherdr now lives in the web
app" with an Open Shepherdr button (at the same space, from an Assistant tab) and how to open it on a phone; the
rest of the old layout is blank. Herdr's own terminals and layouts work as before. Shepherdr's chats, tasks,
artifacts and browser are in the web app only: its agents run in a session of their own, which the window doesn't
show.

- Herdr's own layout: Ctrl+Shift+L in the window (a restart picks it too).
- `shepherdr doctor` says when the window has notices, or needs them.
- `shepherdr window --remove` takes the notices out, once you closed the old Assistant tabs (one left open then says
  it can't load). Updates don't put them back. `shepherdr uninstall` takes them out too.

Already on 3.2.0 to 3.2.2 with red banners in the window, before an update with the notices:

1. In Herdr, press Ctrl+Shift+L to leave Shepherdr's old layout, and close each space's old Assistant tab.
2. Open Shepherdr: Ctrl+Shift+O in Herdr, or the link `shepherdr web status` prints. On a phone, open the same link.

Your agents keep running throughout; nothing needs a restart.

## Later updates

The same three commands. The service stops while the files change and starts again after, also when an update fails
halfway. Shepherdr's own folder is replaced whole. An instructions file you changed stays, with the
new one beside it as `.new`. Agents keep running in herdr-core. Until `shepherdr doctor` passes, the sync to other
machines waits.

On Android, reinstall the app once to get the dark bottom bar, if you installed it before 3.2.3: remove it and add it
to the home screen again. Chrome refreshes an installed app's colours only now and then, so it may keep the old white
bar.

## Data from before 3.1.27

A Shepherdr older than 3.1.27 kept its data in `~/.herdr`. The first install or update moves it into Shepherdr's own
folders ([Install](install.md)), once per machine, and leaves links at the old paths. Task worktrees stay where they
are until their tasks are done.

```bash
shepherdr where                           # every path, and whether the move is done
shepherdr migrate --rollback              # everything back to ~/.herdr, for an older Shepherdr
shepherdr migrate --cleanup-legacy --yes  # remove the old links, once every machine is updated
```

## From 2.1 or 2.0

2.x was a web app (2.1) or a terminal-herdr plugin (2.0). Nothing carries over: 2.x's data in `~/.shepherdr` stays
where it is, and 3.x never reads or changes it. 2.1 lives on on the `v2.1` branch and 2.0 on `v2.0`, each with its own
README. Don't pull main into them or update them from main.

To move to 3.2: install herdr-core, then [Install](install.md). Stop 2.1 (`shepherdr stop` from your 2.1 checkout)
when you no longer want it.
