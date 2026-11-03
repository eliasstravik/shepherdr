// The Window section (was Layout): on/off switches for how the window looks and what a new space
// opens with (DECISIONS.md, "Shepherdr settings: layout switches"). The same everywhere, no scope. Each
// default is today's choice, so nothing changes until one is flipped; each takes effect at once:
// - Tabs: shared "tabbar.tabs" (mods/tabs-tasks). Only the tabs go: the bar also holds +, the
//   side panels' buttons, and work for the rest of the app (new spaces, tasks' watcher).
// - Worktrees: shared "sidebar.worktrees" (mods/spaces-chat).
// - Red counts / Green counts: shared "counts.red" / "counts.green" (mods/spaces-chat, mods/tabs-tasks).
// - Bold unread spaces: shared "sidebar.unread" (mods/spaces-chat).
// - Status filters, Show space on task rows: shared "tasks.filters", "tasks.place" (mods/tasks).
// - Show subagents above the chat box: shared "chat.helpers" (mods/chat).
// - Assistant: shared "coordinator.auto" (coordinator.js watchNewSpaces, mods/newspace).

import { v_flex } from "gpui-base";
import { shared, setShared } from "herdr";
import { toggleSwitch } from "./ui.js";

// A switch kept in shared state: on unless set to false.
const flag = (key) => ({ on: shared(key) !== false, flip: (on) => setShared(key, !on) });

export const SWITCHES = [
  { id: "tabs", title: "Show tabs", about: "The space's tabs, in the bar at the top. The bar's buttons stay either way.",
    key: "tabbar.tabs" },
  { id: "worktrees", title: "Worktrees in the sidebar", about: "A repo's worktree spaces, listed under it.",
    key: "sidebar.worktrees" },
  { id: "unread", title: "Bold unread spaces", about: "A space whose Assistant has something new shows bold and bright.",
    key: "sidebar.unread" },
  { id: "counts", title: "Red counts", about: "What needs you, counted in red on spaces, tabs and Tasks.", key: "counts.red" },
  { id: "greens", title: "Green counts", about: "Tasks in Ready, counted in green on spaces, tabs and Tasks.", key: "counts.green" },
  { id: "filters", title: "Status filters in Tasks", about: "The row of status chips under the Tasks search.",
    key: "tasks.filters" },
  { id: "place", title: "Show space on task rows", about: "Each task row names its space and machine, dimmed on the right.",
    key: "tasks.place" },
  { id: "helpers", title: "Show subagents above the chat box", about: "The agent's own subagents at work, listed over the box.",
    key: "chat.helpers" },
  { id: "assistant", title: "Assistant in new spaces", about: "A new space opens with its Assistant's chat, else a terminal.",
    key: "coordinator.auto" },
];

// `view`: the settings window, for its title and row.
export function layoutSection(view, t) {
  return v_flex()
    .child(view.title(t, "Window"))
    .children(SWITCHES.map((s) => {
      const st = flag(s.key);
      return view.row(t, s.title, s.about, toggleSwitch(`layout-${s.id}`, st.on, () => st.flip(st.on)));
    }));
}
