// The rename dialog's icon picker (rename.js): the chat's emoji picker (mods/chat-react, copied:
// categories on top that jump to their section, a search over every emoji's name and words, then
// the sections), with a reset at the bottom ("#" for a space, the folder for a section). Opened as
// a popup with props { view: "icon", for (the dialog's overlay), current, section, machine ("server" |
// "monitor": a machine's), width, height }.
// The pick goes back to the dialog through shared "spaces-chat.iconpick" = { for, emoji, at };
// Save there stores it.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay, setShared, appHome, readTextFile } from "herdr";
import { PICK } from "./rename.js";

const PER = 9, CELL = 36, HEAD = 28, PAD = 6;
// The emoji list (emoji-data.js, ~150 KB) is read when a picker first opens, not with the
// sidebar: once per build, as text (its one export is a JSON array).
let GROUPS = [], loading = null;
function loadGroups() {
  return loading ??= readTextFile(`${appHome()}/mods/spaces-chat/emoji-data.js`).then((s) => {
    const data = JSON.parse(s.slice(s.indexOf("export default ") + 15).trim().replace(/;$/, ""));
    GROUPS = data.map(([name, icon, list]) => ({ name, icon, list: list.map(([e, , n, words]) => ({ e, name: n, words })) }));
  }).catch(() => { loading = null; });
}

export class IconPicker {
  init(cx) {
    this.p = props() ?? {};
    this.range = null;
    this.pressX = null;
    this.scroll = VirtualListScrollHandle.new();
    this.search = InputState.new({ placeholder: "Search all emoji" });
    this.search.on("change", (_e, cx) => { this.scroll.scroll_to_item(0, "top"); cx.notify(); });
    cx.timer.after(0, () => this.search.focus());
    if (!GROUPS.length) cx.spawn(async (cx) => { await loadGroups(); cx.notify(); });
  }

  close() { this.search.release(); this.scroll.release(); }

  pick(emoji) {
    setShared(PICK, { for: this.p.for, emoji, at: Date.now() });
    closeOverlay(this.p.overlay);
  }

  // Best first: the name itself, a name that starts with it, a word of the name, any word.
  found(q) {
    const t = q.toLowerCase().replaceAll(":", "").replaceAll("_", " ").trim().replace(/\s+/g, " ");
    const terms = t.split(" ");
    const tiers = [[], [], [], []];
    for (const g of GROUPS) for (const x of g.list) {
      if (!terms.every((w) => x.words.includes(w))) continue;
      const name = x.name.toLowerCase();
      tiers[name === t ? 0 : name.startsWith(t) ? 1 : terms.every((w) => ` ${name}`.includes(` ${w}`)) ? 2 : 3].push(x);
    }
    return tiers.flat();
  }

  // The list's rows: section headers and rows of up to PER emoji.
  rows() {
    const out = [];
    const chunk = (key, list) => { for (let i = 0; i < list.length; i += PER) out.push({ kind: "row", key: `${key}:${i}`, list: list.slice(i, i + PER) }); };
    const q = this.search.value().trim();
    if (q) {
      chunk("found", this.found(q));
      if (!out.length) out.push({ kind: "none", key: "none" });
      return out;
    }
    for (const g of GROUPS) { out.push({ kind: "head", key: `h:${g.name}`, name: g.name, icon: g.icon }); chunk(g.name, g.list); }
    return out;
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const sizes = rows.map((r) => (r.kind === "head" ? HEAD : CELL));
    const now = this.p.current ?? null;
    const heads = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === "head");
    // The section shown at the top of the list, for the category bar.
    const at = this.range?.start ?? 0;
    const current = heads.filter(([, i]) => i <= at + 1).pop()?.[0]?.name ?? heads[0]?.[0]?.name;
    const searching = Boolean(this.search.value().trim());
    // A popup's root needs its size spelled out: the list below fills what is left of it.
    return v_flex().id("emoji-picker").w(this.p.width ?? 360).h(this.p.height ?? 420).bg(t.popover).text_color(t.foreground).text_size(12.8)
      // Categories: each jumps to its section.
      .child(h_flex().h(38).flex_none().px(PAD).gap(1).items_center().border_b(1).border_color(t.border)
        // Line icons (the reaction picker's, mods/chat-react/cat), never emoji in chrome.
        .children(GROUPS.map((c) => div().id(`cat-${c.name}`).flex_1().h(28).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .when(!searching && c.name === current, (el) => el.bg(t.selected).text_color(t.foreground))
          .when(searching || c.name !== current, (el) => el.text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            if (searching) this.search.set_value("");
            const i = this.rows().findIndex((r) => r.kind === "head" && r.name === c.name);
            if (i >= 0) this.scroll.scroll_to_item(i, "top");
            cx.notify();
          })
          .child(svg(`mods/chat-react/cat/${c.icon}.svg`).size(16)))))
      // Search.
      .child(h_flex().h(40).flex_none().mx(PAD + 2).gap(8).items_center()
        .child(svg("mods/spaces-chat/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.search).flex_1().text_size(12.8).text_color(t.foreground)))
      // Sections.
      .child(v_flex().id("emoji-list-area").relative().flex_1().min_h(0).px(PAD)
        .on_mouse_down("left", (e) => { this.pressX = e.local_position?.x ?? null; })
        .child(v_virtual_list("emoji-list", rows.length, sizes, (i) => rows[i].key, (range) => {
          this.range = range;
          return rows.slice(range.start, range.end).map((r) => {
            if (r.kind === "head") return div().w_full().h(HEAD).px(4).pt(9).text_size(11).text_color(t.dim).child(r.name);
            if (r.kind === "none") return div().w_full().h(CELL).px(4).flex().items_center().text_color(t.dim).child("No emoji found");
            return h_flex().w_full().h(CELL).children(r.list.map((x) => div().size(CELL).flex_none().flex().items_center().justify_center().rounded(7)
              .text_size(21).cursor_pointer().when(x.e === now, (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .child(x.e)));
          });
        })
          .track_scroll(this.scroll).size_full()
          // Rows take no handlers: the press's place says which emoji.
          .on_item_click((key) => {
            const r = this.rows().find((x) => x.key === key);
            if (r?.kind !== "row" || this.pressX === null) return;
            const x = r.list[Math.floor((this.pressX - PAD) / CELL)];
            if (x) this.pick(x.e);
          }))
        .child(Scrollbar.vertical("emoji-list").absolute().inset_0()))
      // Back to the plain "#", a section's folder, or a machine's server / monitor.
      .child(h_flex().h(40).flex_none().px(PAD).items_center().border_t(1).border_color(t.border)
        .child(h_flex().id("reset").h(28).px(8).gap(8).items_center().rounded(6)
          .text_color(now ? t.foreground : t.dim)
          .when(Boolean(now), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.pick(null)))
          .child(this.p.machine
            ? svg(`mods/workspace-chrome/${this.p.machine}.svg`).size(13).flex_none()
            : this.p.section
            ? svg("mods/workspace-chrome/folder.svg").size(13).flex_none()
            : div().w(14).text_center().text_size(15).child("#"))
          .child(this.p.machine ? `Reset to ${this.p.machine} icon` : this.p.section ? "Reset to folder" : "Reset to #")));
  }
}
