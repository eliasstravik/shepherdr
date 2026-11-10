// An artifact's recipe (recipe.json, core/recipe.js) drawn natively in the window: the GPUI side of the one file the
// web app draws as HTML (web/src/screens/Recipe.tsx). herdr-artifact copies this file, recipe.js and a main.js that
// its recipe (recipe-data.js, from recipe.json) into each recipe artifact it installs, so the viewer, its versions and Mark up stay as they are.
// Colors from theme() only; text 12-15 px; works from 320 px wide. A choice, a form or a button sends its words to
// the agent that made it (artifact.js reply), from a click only.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input } from "gpui-base";
import { image } from "gpui-kit";
import { theme } from "herdr";
import { asset, reply } from "./artifact.js";
import data from "./recipe-data.js";
import { chartShapes, choiceReply, formReply, isLink, mediaKind, withIds } from "./recipe.js";

const TONE = { info: "surface", good: "done", warn: "working", bad: "blocked" };

export default class RecipeView extends View {
  init() {
    this.recipe = null;
    this.error = null;
    this.tab = new Map();      // a tabs block's picked tab
    this.open = new Set();     // details blocks unfolded
    this.sent = new Map();     // a choice's or form's words, once sent
    this.inputs = new Map();   // a form field's InputState
    this.checks = new Map();   // a form checkbox's value
    try { this.recipe = withIds(data); } catch { this.error = "This artifact's recipe can't be read."; }
  }

  md(id, text, t) {
    return div().w_full().min_w(0).text_size(13).text_color(t.foreground).child(TextView.markdown(`md-${id}`, String(text ?? " ")).selectable(true));
  }

  send(key, text, cx) {
    if (this.sent.has(key)) return;
    this.sent.set(key, text);
    cx.notify();
    cx.spawn(async (cx) => { if (!(await reply(text))) this.sent.delete(key); cx.notify(); });
  }

  input(b, f) {
    const k = `${b.id}:${f.name}`;
    if (!this.inputs.has(k)) this.inputs.set(k, InputState.new({ placeholder: f.label ?? f.name, ...(f.kind === "textarea" ? { multi_line: true } : {}) }));
    return this.inputs.get(k);
  }

  chart(b, t) {
    const s = chartShapes(b);
    const colors = [t.accent, t.working, t.done, t.blocked, t.muted];
    if (b.kind === "pie") {
      // one bar of shares, then its legend: the same numbers as the web's pie, readable at any width
      return v_flex().gap(8)
        .child(h_flex().w_full().h(14).rounded(7).overflow_hidden()
          .children(s.slices.map((x, i) => div().h_full().flex_basis(`${Math.max(0.5, x.share * 100)}%`).flex_grow(0).bg(colors[i % colors.length]))))
        .children(s.slices.map((x, i) => h_flex().gap(8).items_center()
          .child(div().size(10).rounded(5).bg(colors[i % colors.length]))
          .child(div().text_size(13).child(String(x.label)))
          .child(div().text_size(12).text_color(t.muted).child(`${Math.round(x.share * 100)}%`))));
    }
    if (b.kind === "line") {
      // each series' points, joined by their order: dots on a plot, a value's height from the bottom
      return div().relative().w_full().h(140).border_b_1().border_color(t.border)
        .children(s.lines.flatMap((l, li) => l.points.map((p, i) => div().absolute().size(6).rounded(3).bg(colors[li % colors.length])
          .left(`${p.x * 96}%`).bottom(`${p.y * 92}%`))));
    }
    // bars: each label's group, a bar per series, its height from the biggest value
    const series = b.series ?? [], groups = (b.labels ?? []).length || Math.max(0, ...series.map((x) => x.values.length));
    return v_flex().gap(6)
      .child(h_flex().w_full().h(140).items_end().gap(4).border_b_1().border_color(t.border)
        .children(Array.from({ length: groups }, (_, gi) => h_flex().flex_1().h_full().items_end().justify_center().gap(2)
          .children(series.map((x, si) => div().flex_1().max_w(28).h(`${Math.max(1, (Math.max(0, x.values[gi] ?? 0) / s.max) * 100)}%`)
            .rounded_t(2).bg(colors[si % colors.length]))))))
      .child(h_flex().w_full().children((b.labels ?? []).map((l) => div().flex_1().text_size(11).text_color(t.muted).text_center().truncate().child(String(l)))))
      .when(series.length > 1, (e) => e.child(h_flex().flex_wrap().gap(10).children(series.map((x, si) => h_flex().gap(6).items_center()
        .child(div().size(10).rounded(5).bg(colors[si % colors.length])).child(div().text_size(12).child(String(x.name ?? "")))))));
  }

  // A clip, a sound or a PDF: the window's player can't play them, so it shows the clip's poster (or a tile) and says
  // where to play it: the web app (the same artifact on the phone and in a browser plays it).
  media(b, t, mark, what, poster) {
    return v_flex().w_full().min_w(0).gap(4)
      .child(poster ? image(asset(poster)).w_full().rounded(6).border_1().border_color(t.border)
        : v_flex().w_full().h(96).rounded(6).bg(t.surface).items_center().justify_center().gap(2)
          .child(div().text_size(17).text_color(t.muted).child(mark))
          .child(div().text_size(12).text_color(t.muted).child(what)))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(`${String(b.caption ?? b.src ?? what)} · plays in the web app`));
  }

  block(b, t, cx) {
    switch (b.type) {
      case "heading": return div().text_size((b.level ?? 2) <= 1 ? 17 : 15).font_semibold().whitespace_normal().child(b.text);
      case "text": return this.md(b.id, b.md, t);
      case "list": return v_flex().gap(4).children(b.items.map((x, i) => h_flex().gap(8).items_start()
        .child(div().flex_none().w(16).text_size(13).text_color(t.muted).child(b.ordered ? `${i + 1}.` : "•"))
        .child(this.md(`${b.id}-${i}`, x, t))));
      case "table": return v_flex().w_full().rounded(8).border_1().border_color(t.border).overflow_hidden()
        .child(h_flex().w_full().px(10).py(6).bg(t.surface).children(b.columns.map((c, i) => div().flex_1().min_w(0).text_size(12).font_medium().text_color(t.muted)
          .when((c.align ?? "") === "right", (e) => e.text_right()).child(String(c.label ?? c)))))
        .children(b.rows.map((r, ri) => h_flex().w_full().px(10).py(6).border_t_1().border_color(t.border)
          .children(r.map((c, i) => div().flex_1().min_w(0).text_size(13).whitespace_normal().when(b.columns[i]?.align === "right", (e) => e.text_right()).child(String(c ?? ""))))));
      case "chart": return this.chart(b, t);
      case "stats": return h_flex().flex_wrap().gap(8).children(b.items.map((x) => v_flex().min_w(120).flex_1().p(10).gap(2).rounded(8).bg(t.surface)
        .child(div().text_size(12).text_color(t.muted).child(String(x.label)))
        .child(div().text_size(17).font_semibold().child(String(x.value)))
        .when(!!x.note, (e) => e.child(div().text_size(12).text_color(t.dim).child(String(x.note))))));
      case "video": return this.media(b, t, "▶", "Video", b.poster ? b.poster : null);
      case "audio": return this.media(b, t, "♪", "Sound", null);
      case "pdf": return this.media(b, t, "PDF", "PDF", null);
      case "image": return v_flex().gap(4)
        .child(image(asset(b.src)).w_full().when(!!b.w && !!b.h, (e) => e.max_w(b.w)).rounded(6).border_1().border_color(t.border))
        .when(!!b.caption, (e) => e.child(div().text_size(12).text_color(t.muted).whitespace_normal().child(b.caption)));
      case "pair": return h_flex().flex_wrap().gap(10).children([["Before", b.before], ["After", b.after]].map(([w, x]) => v_flex().flex_1().min_w(240).gap(4)
        .child(mediaKind(x.src) === "video" ? this.media(x, t, "▶", "Clip", x.poster ?? null)
          : image(asset(x.src)).w_full().rounded(6).border_1().border_color(t.border))
        .child(div().text_size(12).text_color(t.muted).child(x.caption ?? w))));
      case "code": return div().w_full().p(10).rounded(8).bg(t.surface).font_family("JetBrains Mono").text_size(12).whitespace_normal().child(b.text);
      case "callout": return v_flex().gap(4).p(12).rounded(8).bg(t[TONE[b.tone ?? "info"]] ? t.surface : t.surface).border_l(3).border_color(t[TONE[b.tone ?? "info"]] ?? t.border)
        .when(!!b.title, (e) => e.child(div().text_size(13).font_semibold().child(b.title)))
        .when(!!b.md, (e) => e.child(this.md(b.id, b.md, t)));
      case "columns": return h_flex().flex_wrap().gap(16).items_start().children(b.columns.map((c) => v_flex().flex_1().min_w(240).gap(14).children(c.map((x) => this.block(x, t, cx)))));
      case "tabs": {
        const on = this.tab.get(b.id) ?? 0;
        return v_flex().gap(12)
          .child(h_flex().gap(4).flex_wrap().children(b.tabs.map((x, i) => div().id(`tab-${b.id}-${i}`).h(26).px(10).flex().items_center().rounded(6).cursor_pointer()
            .bg(i === on ? t.surface : t.background).border_1().border_color(i === on ? t.border : t.background)
            .on_click((_e, cx) => { this.tab.set(b.id, i); cx.notify(); })
            .child(div().text_size(13).text_color(i === on ? t.foreground : t.muted).child(x.label)))))
          .child(v_flex().gap(14).children((b.tabs[on]?.blocks ?? []).map((x) => this.block(x, t, cx))));
      }
      case "details": {
        const open = this.open.has(b.id);
        return v_flex().gap(10)
          .child(div().id(`det-${b.id}`).cursor_pointer().text_size(13).font_medium().text_color(t.muted)
            .on_click((_e, cx) => { if (open) this.open.delete(b.id); else this.open.add(b.id); cx.notify(); })
            .child(`${open ? "▾" : "▸"} ${b.summary}`))
          .when(open, (e) => e.child(v_flex().gap(14).pl(14).children(b.blocks.map((x) => this.block(x, t, cx)))));
      }
      case "divider": return div().w_full().h(1).bg(t.border);
      case "choice": {
        const sent = this.sent.get(b.id);
        return v_flex().gap(6)
          .child(div().text_size(13).font_semibold().whitespace_normal().child(b.question))
          .children(b.options.map((o, i) => v_flex().id(`ch-${b.id}-${i}`).p(10).gap(2).rounded(8).border_1().border_color(t.border)
            .bg(sent === choiceReply(b, o.label) ? t.surface : t.background).when(!sent, (e) => e.cursor_pointer().hover((s) => s.bg(t.surface)))
            .on_click((_e, cx) => this.send(b.id, choiceReply(b, o.label), cx))
            .child(div().text_size(13).font_medium().child(sent === choiceReply(b, o.label) ? `${o.label} · Sent` : o.label))
            .when(!!o.description, (e) => e.child(div().text_size(12).text_color(t.muted).whitespace_normal().child(o.description)))));
      }
      case "form": {
        const sent = this.sent.has(b.id);
        return v_flex().gap(8)
          .children(b.fields.map((f) => f.kind === "checkbox"
            ? h_flex().id(`cb-${b.id}-${f.name}`).gap(8).items_center().cursor_pointer()
              .on_click((_e, cx) => { this.checks.set(`${b.id}:${f.name}`, !this.checks.get(`${b.id}:${f.name}`)); cx.notify(); })
              .child(div().size(14).rounded(3).border_1().border_color(t.border).when(!!this.checks.get(`${b.id}:${f.name}`), (e) => e.bg(t.accent)))
              .child(div().text_size(13).child(f.label ?? f.name))
            : v_flex().gap(4).child(div().text_size(12).text_color(t.muted).child(f.label ?? f.name))
              .child(div().px(8).py(5).rounded(6).border_1().border_color(t.border).child(Input.new(this.input(b, f)).w_full().text_size(13)))))
          .child(div().id(`fs-${b.id}`).self_start().px(12).py(6).rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(13)
            .when(!sent, (e) => e.cursor_pointer()).on_click((_e, cx) => {
              const values = Object.fromEntries(b.fields.map((f) => [f.name, f.kind === "checkbox" ? !!this.checks.get(`${b.id}:${f.name}`) : this.input(b, f).value()]));
              this.send(b.id, formReply(b, values), cx);
            }).child(sent ? "Sent" : b.submit ?? "Send"));
      }
      case "button": return this.button(b, b.id, t).self_start();
      case "buttons": return h_flex().flex_wrap().gap(8).items_center().children(b.items.map((x, i) => this.button(x, `${b.id}-${i}`, t)));
    }
    return div();
  }

  // A button: a press sends its reply, once; with an href (https only) it opens that page in the browser each press, a
  // plain link the person acts on themselves. quiet: the softer look, beside the one to press.
  button(b, key, t) {
    const link = isLink(b.href) ? b.href : null;
    const sent = this.sent.has(key);
    const answers = typeof b.reply === "string";
    const live = link || !sent;
    return div().id(`bt-${key}`).px(12).py(6).rounded(6).text_size(13)
      .when(!b.quiet, (e) => e.bg(t.solid).text_color(t.solid_foreground))
      .when(!!b.quiet, (e) => e.border_1().border_color(t.border).text_color(t.foreground))
      .when(live, (e) => e.cursor_pointer()).on_click((_e, cx) => {
        if (link) cx.open_url(link);
        if (answers) this.send(key, b.reply, cx);
      }).child(sent && !link ? `${b.label} · Sent` : link ? `${b.label} ↗` : b.label);
  }

  render(cx) {
    const t = theme();
    const body = this.error ? [div().text_size(13).text_color(t.muted).child(this.error)]
      : !this.recipe ? [] : this.recipe.blocks.map((b) => v_flex().id(`blk-${b.id}`).w_full().min_w(0).child(this.block(b, t, cx)));
    return v_flex().id("recipe").size_full().overflow_y_scrollbar().bg(t.background).text_color(t.foreground)
      .child(v_flex().p(16).gap(14).max_w(860).children(body));
  }
}
