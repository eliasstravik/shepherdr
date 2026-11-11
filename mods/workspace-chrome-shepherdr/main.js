import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, appHome, readTextFile, writeTextFile } from "herdr";
import { openSettings, toast, plainError, red } from "./ui.js";
import { visibleWallpaper, terminalWallpaper, WALLPAPER_KEY } from "./core/wallpaper.js";
import { on as addonOn } from "./addons.js";

// SHEP-135: the voice call on (mods/chat's shared "chat.calls", its heartbeat in the last 45 s), as spaces-chat's liveCall
function liveCall() {
  for (const [pane, c] of Object.entries(shared("chat.calls") ?? {})) if (Date.now() - (c?.beat ?? 0) < 45000) return { pane, ...c };
  return null;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    if (!props()?.footer) return;
    let last = null, busy = false;
    const sync = (cx) => {
      const value = visibleWallpaper(shared(WALLPAPER_KEY), shared("layout"), cx.theme().appearance);
      if (!value) { last = null; return; }
      const base = theme().background;
      const key = JSON.stringify([value, base]);
      if (busy || key === last) return;
      busy = true;
      cx.spawn(async () => {
        try {
          const path = `${appHome()}/layouts/BossGoat.json`;
          for (let attempt = 0; ; attempt++) {
            const raw = await readTextFile(path);
            if (raw === null) throw new Error("The BossGoat layout is missing.");
            const tree = JSON.parse(raw), next = terminalWallpaper(tree, value, base);
            if (JSON.stringify(next) === JSON.stringify(tree)) break;
            // Edit only the backdrop; leave saved sizes, tabs and other layout choices alone.
            try { await writeTextFile(path, JSON.stringify(next, null, 2) + "\n", raw); break; }
            catch (error) { if (attempt >= 2) throw error; }
          }
        } catch (error) { toast({ title: "Terminal background didn’t update", body: plainError(error), level: "error" }); }
        finally { last = key; busy = false; }
      });
    };
    sync(cx);
    cx.timer.every(1000, sync);
  }

  button(id, label, action) {
    const t = theme();
    const hint = id === "voice" ? "Talk to BossGoat" : id === "search" ? "Search" : narrow() ? "Show sidebar" : "Hide sidebar";
    return div().id(id).size(32).flex_none().flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).accessibility_label(hint).tooltip(hint).child(label);
  }
  // SHEP-135: on a call the voice button turns into the call's Mute and End, held in one outlined capsule (as the web's
  // brand row and phone bar): its buttons the row's size and as far apart as Search and the toggle, the ring drawn in
  // the margin. Asked of the chat running the call through shared "chat.callreq" (mods/chat).
  callControls(t, call) {
    const req = (action) => setShared("chat.callreq", { pane: call.pane, at: Date.now(), action });
    const round = (id, bg, fg, icon, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(13).cursor_pointer()
      .bg(bg).text_color(fg)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => req(action)).child(svg(icon).size(14));
    return h_flex().id("voice-call").mx(-2).p(2).gap(4).flex_none().items_center().rounded(15).border_1().border_color(t.border)
      .child(call.muted ? round("voice-mute", t.foreground, t.background, "mods/workspace-chrome-shepherdr/mic-off.svg", "mute")
        : round("voice-mute", "#00000000", t.muted, "mods/workspace-chrome-shepherdr/mic.svg", "mute").hover((s) => s.bg(t.hover).text_color(t.foreground)))
      .child(round("voice-end", red(), "#ffffff", "mods/workspace-chrome-shepherdr/phone-x.svg", "end").hover((s) => s.opacity(0.85)));
  }

  render() {
    const t = theme();
    const chrome = shared("layout") === "BossGoat" ? "#00000000" : t.chrome;
    const collapsed = narrow();
    const call = !collapsed && addonOn("voice") ? liveCall() : null;
    if (props()?.footer) {
      const row = (id, icon, label, action) => h_flex().id(id).h(28).px(8).gap(9).items_center().rounded(8)
        .text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).accessibility_label(label)
        .when(collapsed, el => el.justify_center().tooltip(label))
        .child(svg(`mods/workspace-chrome-shepherdr/${icon}.svg`).size(20))
        .when(!collapsed, el => el.child(label));
      return v_flex().size_full().bg(chrome).border_t(1).border_color(t.border).px(8).pt(4).pb(8).text_size(13)
        // Herdr's settings (with its update dot), then BossGoat's settings.
        .child(row("settings", "settings", "Settings", () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("shepherdr", "goat", "BossGoat", () => openSettings()))
        .child(row("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add-chat" })));
    }
    return h_flex().size_full().bg(chrome).pl(collapsed ? 6 : 14).pr(10).gap(4).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().gap(8).items_center().child(image("frame/welcome/herdr.png").size(20).rounded(5)).child(div().font_semibold().text_color(t.foreground).child("Herdr"))))
      // SHEP-135: the voice call, beside Search: mods/spaces-chat starts it (shared "voice.startreq"); on a call, its
      // Mute and End in their place
      .when(Boolean(call), el => el.child(this.callControls(t, call)))
      .when(!collapsed && addonOn("voice") && !call, el => el.child(this.button("voice", svg("mods/workspace-chrome-shepherdr/audio-lines.svg").size(20), () => setShared("voice.startreq", { at: Date.now() }))))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/workspace-chrome-shepherdr/search.svg").size(20), () => run("mod.open", { name: "jump" }))))
      // On the macOS rail the traffic lights fill the row; the spaces list repeats the sidebar button below them.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/workspace-chrome-shepherdr/sidebar.svg").size(20), toggleSidebar)));
  }
}
