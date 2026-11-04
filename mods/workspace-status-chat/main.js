// The status bar: the shown space's machine (as the sidebar names it) and branch, the red Needs-you
// badge (the Tasks panel's count, inbox.js) when something needs the person, and the palette key.
// No agent count: the Tasks panel shows the work.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, keys, shared } from "herdr";
import { spaces, inRender } from "./live.js";
import { count as needsYou } from "./inbox.js";
import { countBadge, TEXT, RADIUS } from "./ui.js";

// A machine as the sidebar shows it (mods/spaces-chat sections.js machineLook): the name it was
// given there, else its own.
const machineName = (m) => (shared("spaces-chat")?.machines?.[m ?? ""]?.name) || (m ?? "This computer");

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("Commands") instead of lying.
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  Commands` : "Commands";
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const needs = needsYou();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(14)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(TEXT.label).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", machineName(space?.machine ?? null)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .when(needs > 0, el => el.child(h_flex().gap(6).items_center().child(countBadge(needs, 0, t.chrome)).child("Needs you")))
      .child(div().flex_1())
      .child(div().id("palette").px(6).h(20).flex().items_center().rounded(RADIUS.control).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("app.palette")).child(this.hint()));
  }
}
