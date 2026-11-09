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
// Under them, Add-ons: a switch for each add-on lib/addons.json gives one (lib/addons.js). Off is
// shared "addons.off" (the mods follow at once) and Everywhere's "off" in ~/.config/shepherdr/settings.json
// (herdr-task, here and on other machines). One that others need, or that needs one that's off,
// can't flip until they do: its line says which.
// Usage insights has a Delete under its switch: the usage log here and on every linked machine
// (core/usage.js DELETE, over herdr-core's link as every other cross-machine read).

import { v_flex } from "gpui-base";
import { shared, setShared, exec, machines } from "herdr";
import { toggleSwitch, button } from "./ui.js";
import { DELETE } from "./core/usage.js";
import { on, blockers, flip } from "./addons.js";
// The switches, their words and an add-on's line: core/settings.js, shared with the web app.
import { SWITCHES, ADDONS, SECTIONS, INSIGHTS, addonAbout } from "./core/settings.js";
export { SWITCHES };

// A switch kept in shared state: on unless set to false.
const flag = (key) => ({ on: shared(key) !== false, flip: (on) => setShared(key, !on) });

// Delete: here, then each linked machine; its line then says how it went.
let deleted = null;
function deleteUsage(cx) {
  deleted = "…";
  cx.spawn(async (cx) => {
    const run = (on) => exec("sh", ["-c", DELETE], on ? { on } : {}).then((r) => r?.code === 0).catch(() => false);
    await run(null);
    // the window's open view counts from now (lib/usage.js)
    setShared("usage.deletedAt", Date.now());
    const others = machines().map((m) => m.name).filter(Boolean);
    const missed = (await Promise.all(others.map(async (m) => ((await run(m)) ? null : m)))).filter(Boolean);
    deleted = missed.length ? INSIGHTS.missed(missed.join(", ")) : INSIGHTS.done;
    cx.notify();
  });
}

// `view`: the settings window, for its title, heading, row and change; view.addons: lib/addons.json
// once read (null until then).
export function layoutSection(view, t) {
  const m = view.addons, title = (id) => m.addons.find((a) => a.id === id)?.title ?? id;
  return v_flex()
    .child(view.title(t, SECTIONS.find((s) => s.id === "window").title))
    .children(SWITCHES.map((s) => {
      const st = flag(s.key);
      return view.row(t, s.title, s.about, toggleSwitch(`layout-${s.id}`, st.on, () => st.flip(st.on)));
    }))
    .when(Boolean(m?.addons?.some((a) => a.switch)), (el) => el
      .child(view.heading(t, ADDONS))
      .children(m.addons.filter((a) => a.switch).flatMap((a) => {
        const now = on(a.id), stop = blockers(m, a.id, !now);
        const about = addonAbout(a.about, now, stop.map(title));
        const row = view.row(t, a.title, about, toggleSwitch(`addon-${a.id}`, now, (next, _e, cx) => {
          const list = flip(a.id, next);
          view.change((cfg) => { const e = (cfg.everywhere ??= {}); if (list.length) e.off = list; else delete e.off; }, cx);
        }, { disabled: stop.length > 0 }));
        if (a.id !== "insights") return [row];
        return [row, view.row(t, INSIGHTS.title, deleted && deleted !== "…" ? deleted : INSIGHTS.about,
          button("insights-delete", INSIGHTS.button, { disabled: deleted === "…", onClick: (_e, cx) => deleteUsage(cx) }))];
      })));
}
