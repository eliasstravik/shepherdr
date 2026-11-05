// The chat's emoji picker (mods/chat): reacting to a message, like Slack. Category icons on top
// (they jump to their section), a search over every emoji's name and words, Frequently used
// first, then the categories as sections; a skin tone at the bottom right (remembered in
// data/chat-emoji-tone.json). Picking one toggles your reaction; the chat sends it.
// Opened as a popup: props { pane, target (message id), text (the message), mine (your emoji
// on it), frequent (your most used, from the chat's data/chat-emoji-uses.json), overlay }.
// The pick goes back through shared "chat.reactreq" = { pane, at, target, text, emoji }.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list, Scrollbar } from "gpui-base";
import { theme, props, setShared, closeOverlay, appHome } from "herdr";
import * as fs from "fs/promises";
import DATA from "./emoji-data.js";

const PER = 9, CELL = 36, HEAD = 28, PAD = 6;
const FREQUENT_ICON = "clock";
const TONES = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const GROUPS = DATA.map(([name, icon, list]) => ({ name, icon, list: list.map(([e, tone, n, words]) => ({ e, tone: Boolean(tone), name: n, words })) }));
// Tones 1-5 go after each person or hand in it; 0 is the yellow default.
const fq = (s) => s.replace(/(\p{Emoji_Presentation})️/gu, "$1");
const withTone = (s, tone) => (tone ? fq(s).replace(/(\p{Emoji_Modifier_Base})️?/gu, `$1${String.fromCodePoint(0x1f3fa + tone)}`) : s);

export default class EmojiPicker extends View {
  init(_props, cx) {
    this.p = props() ?? {};
    this.tone = 0;
    this.toneOpen = false;
    this.range = null;
    this.pressX = null;
    this.scroll = VirtualListScrollHandle.new();
    this.search = InputState.new({ placeholder: "Search all emoji" });
    this.search.on("change", (_e, cx) => { this.scroll.scroll_to_item(0, "top"); cx.notify(); });
    this.toneFile = `${appHome()}/data/chat-emoji-tone.json`;
    cx.timer.after(0, () => this.search.focus());
    cx.spawn(async (cx) => {
      try { this.tone = Number(JSON.parse(await fs.readFile(this.toneFile, "utf8"))?.tone) || 0; } catch {}
      cx.notify();
    });
  }

  close() { this.search.release(); this.scroll.release(); }

  pick(emoji) {
    setShared("chat.reactreq", { pane: this.p.pane, at: Date.now(), target: this.p.target, text: this.p.text, emoji });
    closeOverlay(this.p.overlay);
  }

  setTone(tone) {
    this.tone = tone;
    this.toneOpen = false;
    fs.mkdir(`${appHome()}/data`, { recursive: true }).then(() => fs.writeFile(this.toneFile, JSON.stringify({ tone }))).catch(() => {});
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
    const frequent = (this.p.frequent ?? []).slice(0, PER * 2).map((e) => ({ e, tone: false }));
    if (frequent.length) { out.push({ kind: "head", key: "h:Frequently used", name: "Frequently used", icon: FREQUENT_ICON }); chunk("frequent", frequent); }
    for (const g of GROUPS) { out.push({ kind: "head", key: `h:${g.name}`, name: g.name, icon: g.icon }); chunk(g.name, g.list); }
    return out;
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const sizes = rows.map((r) => (r.kind === "head" ? HEAD : CELL));
    const mine = new Set(this.p.mine ?? []);
    const heads = rows.map((r, i) => [r, i]).filter(([r]) => r.kind === "head");
    // The section shown at the top of the list, for the category bar.
    const at = this.range?.start ?? 0;
    const current = heads.filter(([, i]) => i <= at + 1).pop()?.[0]?.name ?? heads[0]?.[0]?.name;
    const searching = Boolean(this.search.value().trim());
    const cats = [...(this.p.frequent?.length ? [{ name: "Frequently used", icon: FREQUENT_ICON }] : []), ...GROUPS.map((g) => ({ name: g.name, icon: g.icon }))];
    // A popup's root needs its size spelled out: the list below fills what is left of it.
    return v_flex().id("emoji-picker").w(this.p.width ?? 360).h(this.p.height ?? 420).bg(t.popover).text_color(t.foreground).text_size(12.8)
      // Categories: each jumps to its section.
      .child(h_flex().h(38).flex_none().px(PAD).gap(1).items_center().border_b(1).border_color(t.border)
        // Line icons (Lucide, cat/), never emoji in chrome; the shown category bright, the rest dim.
        .children(cats.map((c) => div().id(`cat-${c.name}`).flex_1().h(28).flex().items_center().justify_center().rounded(6).cursor_pointer()
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
        .child(svg("mods/chat-react/search.svg").size(14).flex_none().text_color(t.dim))
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
              .text_size(21).cursor_pointer().when(mine.has(withTone(x.e, x.tone ? this.tone : 0)), (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .child(withTone(x.e, x.tone ? this.tone : 0))));
          });
        })
          .track_scroll(this.scroll).size_full()
          // Rows take no handlers: the press's place says which emoji.
          .on_item_click((key, cx) => {
            const r = this.rows().find((x) => x.key === key);
            if (r?.kind !== "row" || this.pressX === null) return;
            const x = r.list[Math.floor((this.pressX - PAD) / CELL)];
            if (x) this.pick(withTone(x.e, x.tone ? this.tone : 0));
          }))
        .child(Scrollbar.vertical("emoji-list").absolute().inset_0()))
      // Skin tone, bottom right.
      .child(h_flex().h(40).flex_none().px(PAD + 2).gap(2).items_center().justify_end().border_t(1).border_color(t.border)
        .when(this.toneOpen, (el) => el.children(TONES.map((h, i) => div().id(`tone-${i}`).size(30).flex_none().flex().items_center().justify_center()
          .rounded(6).cursor_pointer().text_size(17).when(i === this.tone, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.setTone(i); cx.notify(); })
          .child(h))))
        .when(!this.toneOpen, (el) => el.child(div().id("tone").size(30).flex_none().flex().items_center().justify_center().rounded(6)
          .cursor_pointer().text_size(17).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { cx.stop_propagation(); this.toneOpen = true; cx.notify(); })
          .child(TONES[this.tone]))));
  }
}
