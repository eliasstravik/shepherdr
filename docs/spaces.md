# Spaces

Run many coding agents across machines from a phone, tablet or desktop. Shepherdr is a standalone herdr-core client: one private web
app on your tailnet (installable on a phone) with your spaces in a sidebar, as herdr has them: a space is a folder on
a machine plus a name, with its own coordinator. Each machine is a section, as Slack's: its emoji (a server icon without
one) and its name, both set in its ⋯ menu's Rename machine and kept for every device, with its spaces under it, its
home space (its home folder, ~) first until dragged; the machines sit side by side with Pinned and the sections you
make. Sections only organize spaces: one at the top (the sidebar header's +) holds spaces from any machine, one inside a
machine (its ⋯, New section) only that machine's; a space moves into one from its ⋯ (Move to section) or by a drag onto
it, and back where it was when taken out or its section is deleted. Pinned is one of them, built in. Headings are only
headings: no chat, never selected; a tap anywhere on one folds it with its chevron, remembered on the device. Folded,
it hides all its spaces, with a quiet dot where one is unread (grey) or waits on you (red); going to a space opens the
heading it sits under. Spaces keep Slack's # icon. Each space's coordinator chat is in the middle and its
tasks on the right. Under their filter box, chips say what Tasks and Artifacts show: a space (`# gtm · vm-str`) or a
whole machine, any of them (none: everything), and the filter's words narrow within them. They follow the space you
pick; × takes one off and **+ Filter** adds a space or a machine from the sidebar's tree. The pin in their header keeps
the chips while the middle changes (a task from them opens in the middle); unpinned, they follow again. Chips and pin
are remembered on the device; a phone's scroll sideways. Every agent, coordinator or
task agent, gets the same chat: replies, reactions, files, search, talk-to-type, voice calls and artifacts. A task's chat
also has a side panel: its live core terminal, its files, its diff against main and its pull request.

- Every machine has at least one space: its **home space**, at its home folder (~), named `home`. It can be renamed
  but not removed; it comes first under its machine until dragged, and moves like any space. Its coordinator also looks after the machine: health, load and
  disk news, its processes, adding spaces. The main machine's home space also sees every machine: what needs you
  across them all, which alerts reach your phone, and alerts about a whole machine. A space's tasks list holds its
  own tasks, a home space's too; a machine's chip lists its spaces', grouped by status or by space, and chips on more
  machines (or none: everything) also by machine, or machine › space. A machine's heading has a + (New space) and a ⋯ (New space…, New section…,
  Rename machine…: its emoji and name), and says when it is in trouble: `Can't reach`, `herdr down`, or a limit it is over.
- Add a space with the + on a machine's heading (it shows on hover with a mouse), its ⋯ (New space…), `N` on a desktop
  (on the machine you are in), or by asking a coordinator (`add ~/dev/x as a space`, or `shepherdr space add <path>
  [--name NAME]`). Pick the machine when there is more than one, then a folder in your home there: the picker starts at
  ~ (~ itself is refused: it is the home space). Type the path to narrow the list (Tab goes into a folder, Enter
  picks); your latest repos are listed first. Then its name, filled in from the folder's. Names follow Slack's channel
  rules: lowercase letters, numbers, hyphens and underscores, at most 80 characters, each its own on its machine;
  typing lowercases and turns spaces into `-` (`My Project` becomes `my-project`), and a taken or bad name is refused
  in the box. The name is the space's slug in links (`?place=vm-str/gtm`) and in the CLI; its tasks' id prefix (SHE,
  TG…) is its own. A repo is added as it is; any other folder, or one not made yet, becomes a new repo first (git init
  on main with an empty first commit; files already there stay uncommitted). Either way it gets its own herdr space
  and coordinator, and opens. Only folders in your home are listed or made.
- New messages show like Slack's unread, for coordinators' chats only: a coordinator's chat with something new from it
  or Shepherdr that you haven't seen makes its space's row bold in the sidebar (a task's row in the space's chat changing
  counts too). A folded heading still shows the spaces under it with something new or a
  red count, and the open one, as a collapsed Slack section does. Headings carry no marks of their own. Having a chat on screen reads it,
  and the main machine keeps the marks, so every device shows the same; a row's menu has **Mark as read**. Tasks' chats never make a row bold: the tasks list shows each
  task's own status. A row's red count still shows what waits on you, a task's need ending as a card in its chat.
- Each space's row menu sets its coordinator's **Notify**:
  **All** (every new message from it buzzes too), **Needs me** (the default: its questions and alerts) or **Off**
  (nothing from it; muted, its row stays dimmed with a crossed-out bell and new messages don't make it bold, though
  a red count still shows what waits on you). Tasks alert as always, whatever it says. Settings → Notify sets it
  Everywhere, for a machine or for a space; the most specific one set wins, as Settings' other defaults, and picking
  in a row's menu what it would get anyway goes back to following it.
- Rename a space from its row's menu, or a machine from its heading's ⋯: its name becomes a box right there; Enter (or tapping
  away) keeps the new name, Escape the old, and an empty one gives it back its own. Only the name you read changes,
  everywhere it shows (the sidebar, the header, search, task rows, alerts, links) and on every device: the main machine
  keeps it (`names.json`). A space's new name follows the same rules as a new one's (`shepherdr space rename <name>
  <new-name>`). Its folder, repo, herdr space, task ids and the machine's SSH and herdr name stay as they were.
- Remove a space from its row's menu (a held finger on a phone or tablet; its ⋯ or a right click on a
  desktop, where it opens beside the row): Remove asks first. Its folder and code stay on disk; Shepherdr forgets it and closes its
  coordinator. Its open tasks hide with it (their worktrees and branches stay) and come back, with its chat, when it is
  added again under the same name. Not while one of its tasks is working: pause it or let it finish first. Never a
  home space, so a machine always keeps one. A coordinator can do the same (`shepherdr space remove <name>`).
- Machines, and each machine's spaces (its home space first), show A to Z. Drag one to reorder them (with a mouse at
  once; a finger holds the row, its menu opens, and sliding it closes the menu and moves the row); a machine takes its
  spaces and sections along, a section its spaces, and Option+Shift+↑/↓ (Alt+Shift off a Mac) moves a focused space. The main
  machine keeps the order (`order.json`), so every device sees it; a space added later slots in A to Z among the
  rest.
- A space's ⋯ pins it (Pin / Unpin), as Slack stars a channel: it moves out of the tree into Pinned, a heading at the
  top of the sidebar that folds like the others (each pin with its machine after its name), and Unpin puts it back.
  Only spaces pin. Pins drag into order and Option+↑/↓ walks them first; the main machine keeps them with the order,
  so every device has them.
- Sections, as Slack's, only organize spaces (`sections.json`, what is in them with the order). The sidebar header's +
  makes one at the top, beside Pinned, for any machine's spaces (each shows its machine after its name); a machine's ⋯
  (New section…) one inside it, one small step in, for that machine's only. A space's ⋯ › Move to section moves it
  into one, or back under its machine; a drag onto a section's heading or among its spaces does the same. A section
  folds, drags among its peers, and its ⋯ renames it (emoji and name) or deletes it: its spaces go back where they
  were. Pinned is one of them that can't be deleted.

- A repository space starts with the base detected when it was added (usually `origin/HEAD`, then main or master).
  Change it under **Settings → Repository → Base branch**, or with
  `shepherdr set space.base develop --space NAME` (`shepherdr space set base develop --space NAME` also works).
  `shepherdr show --space NAME` shows it. The branch and write access are checked before saving.
  This changes only new tasks; existing and waiting tasks keep their own target. It never changes the repository's
  default branch, space key or task IDs. Home spaces have no repository base.
