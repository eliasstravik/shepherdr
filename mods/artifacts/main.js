// Artifacts: recipes agents write to show the person something (a report, a board, a form; rarely
// a custom panel). Each folder's list is ~/.herdr/artifacts/<slug>.json on the machine the folder is on,
// changed only through the herdr-artifact CLI (bin/herdr-artifact), which agents use. This panel
// only shows them: a click opens one inside this sidebar (drill in, ‹ Artifacts back; see
// sidebar.js); a layout without that view opens it full window (artview.js), as chat cards and
// Ctrl+K do. Those are the only two ways. An artifact on another machine is pulled into this app
// (art-<machine>-<id>) as it opens. With All, every folder's show, each with its folder.
//
// The same mod is also the header over an artifact in the sidebar (props.head), that view's
// placeholder before one is picked (props.blank), and the title bar of an artifact window kept
// from before windows were cut (props.bar), so it can still be closed.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, agents, readTextFile, watchFolder, home, theme, closeOverlay, props, shared, setShared } from "herdr";
import { showInSidebar, backToList } from "./sidebar.js";
import { artifactCli as cli, showViewer } from "./artview.js";
import { toast, plainError, TEXT, RADIUS } from "./ui.js";

const ICON = "mods/artifacts/artifacts.svg";
const modOf = (machine, id) => (machine ? `art-${machine.replace(/[^A-Za-z0-9_-]+/g, "-")}-${id}` : `art-${id}`);

// The shown space and where it works now: its focused pane's folder, else its first terminal's.
function where() {
  const space = spaces().find((s) => s.active);
  if (!space) return null;
  const tabs = new Set(space.tabs.map((t) => t.id));
  const mine = panes().filter((p) => tabs.has(p.tab) && p.terminal && p.cwd);
  const pane = mine.find((p) => p.focused) ?? mine[0];
  return { space: space.id, machine: space.machine ?? null, cwd: pane?.cwd || space.folder || "" };
}

export default class Artifacts extends View {
  init(_props, cx) {
    if (props()?.bar || props()?.head || props()?.blank) return;
    this.ctx = null;      // { space, machine, cwd }
    this.store = null;    // { folder, name, store, machine }
    this.items = [];
    this.error = null;
    this.all = true;      // every folder's, like Tasks; the toggle narrows it to this space's
    this.opening = null;
    // The search field (Shepherdr's "Filter artifacts"): by title or the task that made them, as
    // you type. Esc clears it; F gets to it while the list holds the keyboard.
    this.query = InputState.new({ placeholder: "Filter artifacts" });
    this.query.on("change", (_e, cx) => cx.notify());
    this.query.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.query.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    this.listFocus = cx.focus_handle();
    if (!bound) {
      bound = true;
      try { cx.bind_keys([{ keystroke: "escape", action: "art_search_clear", context: "art_search > Input" }]); } catch {}
    }
    cx.timer.every(4000, (cx) => { if (this.ctx?.machine || this.all) cx.spawn(async (cx) => this.load(cx)); });
    // "2h ago" moves on by the minute.
    cx.timer.every(60000, (cx) => cx.notify());
  }

  locate(w, cx) {
    const ctx = (this.ctx = w);
    cx.spawn(async (cx) => {
      let out;
      try {
        // A space can outlive its folder (a deleted test folder): its artifacts are then home's.
        out = await cli(w.machine, ["where", "--folder", w.cwd || "~"])
          .catch((e) => (String(e?.message).startsWith("No such folder") ? cli(w.machine, ["where", "--folder", "~"]) : Promise.reject(e)));
      } catch (e) {
        if (this.ctx === ctx) { this.store = null; this.error = `Couldn't find this space's artifacts. ${plainError(e)}`.trim(); cx.notify(); }
        return;
      }
      if (this.ctx !== ctx) return;
      const store = { folder: out.folder, name: out.name, path: out.store, machine: w.machine };
      if (this.store?.path !== store.path || this.store?.machine !== store.machine) { this.items = []; this.loaded = null; }
      this.store = store;
      this.error = null;
      await this.load(cx);
      if (!w.machine) this.watch(cx);
    });
  }

  // ~/.herdr/artifacts here changes: read again. One watch for the panel's life.
  watch(cx) {
    if (this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try {
        let w = null;
        for (;;) {
          // At most 5 s per wait, so a reload's old build ends at its next cx use.
          w ??= watchFolder(`${home()}/.herdr/artifacts`).then(() => true);
          if (!(await Promise.race([w, cx.sleep(5000)]))) continue;
          w = null;
          if (!this.ctx?.machine) await this.load(cx);
        }
      } catch {}
      this.watching = false;
    });
  }

  async load(cx) {
    const s = this.store;
    if (!s) return;
    let items;
    try {
      if (this.all) items = (await cli(s.machine, ["list", "--all"])).artifacts;
      else {
        const text = await readTextFile(s.path, { on: s.machine });
        items = text ? JSON.parse(text).artifacts ?? [] : [];
      }
    } catch (e) {
      if (s === this.store) { this.error = `Couldn't read the artifacts. ${plainError(e)}`.trim(); cx.notify(); }
      return;
    }
    if (s !== this.store) return;
    const key = JSON.stringify(items);
    if (key === this.loaded) return;
    this.loaded = key;
    this.items = items.filter((a) => a?.id);
    this.error = null;
    // Pane headers show an open artifact by its title (mods/pane-chat reads this).
    const titles = { ...(shared("artifacts.titles") ?? {}) };
    let changed = false;
    for (const a of this.items) {
      const m = modOf(s.machine, a.id), v = `${a.title} · v${a.version}`;
      if (titles[m] !== v) { titles[m] = v; changed = true; }
    }
    if (changed) setShared("artifacts.titles", titles);
    cx.notify();
  }

  // Makes sure the artifact's mod is in this app (pulling it from its machine), then calls fn(mod).
  open(a, how, cx) {
    const machine = this.store?.machine ?? null;
    let mod = modOf(machine, a.id);
    this.opening = a.id;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // Pulled every time: another machine's copies it, and either way it gets this app's Mark up.
        mod = (await cli(null, ["pull", a.id, ...(machine ? ["--from", machine] : [])])).mod ?? mod;
        how(mod);
      } catch (e) {
        toast({ title: "Artifact didn't open", body: plainError(e), level: "error" });
      }
      this.opening = null;
      cx.notify();
    });
  }

  // Inside this sidebar; a layout without the drill-in view shows it full window.
  inPlace(mod, a) {
    const view = { mod, base: mod, id: a.id, title: a.title, version: a.version, latest: a.version, machine: this.store?.machine ?? null };
    if (!showInSidebar(view)) showViewer(view);
  }

  render(cx) {
    const bar = props()?.bar;
    if (bar) return this.titleBar(bar);
    if (props()?.head) return this.viewHead(cx);
    if (props()?.blank) return this.blankView();
    const w = where();
    const key = JSON.stringify(w);
    if (w && key !== this.whereKey) { this.whereKey = key; this.locate(w, cx); }
    const t = theme();
    const empty = !this.error && this.store && !this.items.length;
    const q = this.query.value().trim();
    const shown = q ? this.items.filter((a) => this.found(a, q)) : this.items;
    return v_flex().id("artifacts").size_full().min_h(0).rounded(RADIUS.card).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(TEXT.body)
      .child(h_flex().h(42).flex_none().pl(14).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Artifacts"))
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT.label).text_color(t.dim).child(this.all ? "All folders" : this.store?.name ?? ""))
        .child(this.toggle("art-all", "All", this.all, t, (cx) => { this.all = !this.all; this.loaded = null; cx.spawn(async (cx) => this.load(cx)); })))
      .when(Boolean(this.store), (el) => el.child(this.searchField(t)))
      // A press in the list gives it the keyboard: F then goes to the search field.
      .child(v_flex().id("art-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2)
        .track_focus(this.listFocus)
        .on_mouse_down("left", () => this.listFocus.focus())
        .on_key_down((e, cx) => { if (e.keystroke === "f" && !this.searching) { cx.stop_propagation(); this.query.focus(); cx.notify(); } })
        .when(Boolean(this.error), (el) => el.child(h_flex().m(6).p(10).gap(8).items_start().rounded(8).bg(t.surface).border_1().border_color(t.border)
          .child(div().size(8).mt(5).flex_none().rounded(4).bg(t.blocked))
          .child(div().flex_1().text_size(12).text_color(t.muted).child(this.error))))
        .when(!this.store && !this.error, (el) => el.child(div().px(18).py(28).text_center().text_size(TEXT.label).text_color(t.dim).child("Finding this space's folder…")))
        .when(empty, (el) => el.child(this.emptyView(t)))
        .when(Boolean(q) && !empty && !shown.length, (el) => el.child(div().px(18).py(28).text_center().text_size(TEXT.label).text_color(t.dim)
          .child(`No artifacts match “${q}”.`)))
        .children(shown.map((a) => this.row(a, t))));
  }

  // An artifact the search finds: by its title, the task that made it, who made it, or (with
  // All) its folder.
  found(a, q) {
    const m = this.store?.machine;
    const who = a.publisher && agents().find((x) => x.address === (m ? `${m}/${a.publisher}` : a.publisher));
    return matches(q, a.title, a.task, who?.program?.name, this.all ? folderName(a.folder) : null, this.all ? a.folder : null);
  }

  // The search field, as the Tasks panel's: a magnifier, the box, and at its end F (its key)
  // while empty, or an X that clears it.
  searchField(t) {
    const q = this.query.value();
    return div().flex_none().px(6).pt(6)
      .child(h_flex().id("art-search").h(30).pl(9).pr(4).gap(7).items_center().rounded(8).border_1()
        .border_color(this.searching ? t.accent : t.input).bg(t.background)
        .key_context("art_search")
        .on_action("art_search_clear", (_e, cx) => {
          // Esc: clears it; with nothing in it, the keyboard goes back to the list.
          cx.stop_propagation();
          if (this.query.value()) this.query.set_value(""); else this.listFocus.focus();
          cx.notify();
        })
        .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.dim))
        .child(Input.new(this.query).flex_1().min_w(0).text_size(13).text_color(t.foreground))
        .when(Boolean(q), (el) => el.child(h_flex().id("art-search-x").size(22).flex_none().items_center().justify_center().rounded(6)
          .cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); this.query.set_value(""); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none())))
        .when(!q && !this.searching, (el) => el.child(h_flex().h(18).px(5).mr(3).flex_none().items_center().rounded(4).border_1()
          .border_color(t.border).font_family("JetBrains Mono").text_size(TEXT.id).text_color(t.dim).child("F"))));
  }

  emptyView(t) {
    return v_flex().px(18).py(28).gap(6).items_center()
      .child(svg(ICON).size(16).flex_none().text_color(t.dim))
      .child(div().pt(4).font_medium().child("No artifacts."))
      .child(div().max_w(250).text_center().text_size(TEXT.label).text_color(t.muted)
        .child(this.all ? "Reports, boards and forms agents make show here."
          : `Reports, boards and forms agents make for ${this.store.name} show here. Ask an agent to make one.`));
  }

  toggle(id, label, on, t, fn) {
    return h_flex().id(id).h(24).px(8).flex_none().items_center().rounded(RADIUS.control).cursor_pointer().text_size(TEXT.label).font_medium()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(on ? t.selected : t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { fn(cx); cx.notify(); })
      .child(label);
  }

  // Which version, who made it and when: "v3 · Claude Code · 2h ago".
  detail(a) {
    const m = this.store?.machine;
    const who = a.publisher && agents().find((x) => x.address === (m ? `${m}/${a.publisher}` : a.publisher));
    return [`v${a.version}`, who?.program?.name, a.at ? ago(a.at) : null].filter(Boolean).join(" · ");
  }

  row(a, t) {
    const mod = modOf(this.store?.machine ?? null, a.id);
    const space = spaces().find((s) => s.active);
    const tabs = new Set(space?.tabs.map((x) => x.id) ?? []);
    const open = panes().find((p) => p.mod === mod && tabs.has(p.tab));
    const shown = shared("artifacts.view")?.mod === mod;
    const busy = this.opening === a.id;
    return h_flex().id(`art-${a.id}`).flex_none().px(8).py(7).gap(10).items_start().rounded(RADIUS.card).cursor_pointer()
      .when(shown, (el) => el.bg(t.selected))
      .hover((s) => s.bg(shown ? t.selected : t.hover))
      .on_click((_e, cx) => this.open(a, (m) => this.inPlace(m, a), cx))
      .child(h_flex().h(18).flex_none().items_center()
        .child(svg(ICON).size(14).flex_none().text_color(shown || open ? t.accent : t.dim)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().min_w(0).truncate().child(a.title))
        .child(h_flex().min_w(0).gap(8).text_size(TEXT.label).text_color(t.dim)
          .child(div().flex_1().min_w(0).truncate().child(busy ? "Opening…" : open ? `Open · ${this.detail(a)}` : this.detail(a)))
          // With All: its folder, dimmed, at the right (as task rows show where they ran).
          .when(this.all && Boolean(a.folder), (el) => el.child(div().flex_none().max_w(140).truncate().child(folderName(a.folder))))));
  }

  // Over an artifact in the sidebar: ‹ Artifacts back to the list, its title, which version with
  // the version stepper (‹ v3 of 5 ›, then "· Latest ›" when an older one shows), and Mark up
  // (markup.js lays its layer over the artifact while shared "artifacts.markup" names it). The
  // full-screen viewer has the same (mods/chat-image/artifact-bar.js; keep the two in step).
  viewHead(cx) {
    const t = theme();
    const v = shared("artifacts.view") ?? null;
    const titles = shared("artifacts.titles") ?? {};
    const base = v?.base ?? v?.mod;
    const title = v ? (titles[base] ?? v.title ?? "").split(" · ")[0] : "";
    const hv = (this.hv ??= { key: null, versions: [], busy: false });
    const key = v ? `${v.machine ?? ""}/${v.id}` : null;
    if (key && key !== hv.key) {
      hv.key = key;
      hv.versions = [];
      cx.spawn(async (cx) => {
        try { const vs = (await cli(v.machine, ["show", v.id])).versions ?? []; if (hv.key === key) hv.versions = vs; } catch {}
        cx.notify();
      });
    }
    const kept = hv.versions.map((x) => x.v);
    const fromTitles = Number(/· v(\d+)$/.exec(titles[base] ?? "")?.[1]);
    const latest = Math.max(...[fromTitles, kept[kept.length - 1], v?.latest, v?.version].filter((n) => Number.isFinite(n)));
    const shown = v?.version ?? latest;
    const older = shown < latest;
    const prev = kept.filter((n) => n < shown).pop() ?? null;
    const next = kept.find((n) => n > shown) ?? null;
    const me = hv.versions.find((x) => x.v === shown);
    const mk = shared("artifacts.markup");
    const marking = Boolean(v) && mk?.mod === v.mod && mk?.where === "panel";
    const step = (n, cx) => {
      if (hv.busy || !v) return;
      hv.busy = true;
      cx.spawn(async (cx) => {
        try {
          const out = await cli(null, ["pull", v.id, ...(v.machine ? ["--from", v.machine] : []), ...(n ? ["--version", String(n)] : [])]);
          if (marking) setShared("artifacts.markup", null);
          await showInSidebar({ mod: out.mod, base, id: v.id, title: v.title, version: n ?? latest, latest, machine: v.machine });
        } catch (e) {
          toast({ title: "That version didn't open", body: plainError(e), level: "error" });
        }
        hv.busy = false;
        cx.notify();
      });
      cx.notify();
    };
    const arrow = (id, icon, n) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(n && !hv.busy ? t.muted : t.border)
      .when(Boolean(n) && !hv.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); step(n === latest ? null : n, cx); }))
      .child(svg(icon).size(14));
    return h_flex().id("art-head").size_full().pl(6).pr(8).gap(6).items_center().border_b(1).border_color(t.border).bg(t.background)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().id("art-back").h(24).pl(4).pr(8).gap(2).flex_none().items_center().rounded(6).cursor_pointer()
        .text_size(TEXT.label).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); if (marking) setShared("artifacts.markup", null); backToList(); })
        .child(svg("mods/workspace-chrome/chevron-left.svg").size(14).flex_none())
        .child("Artifacts"))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(title))
      .when(Boolean(v), (el) => el.child(h_flex().flex_none().items_center()
        .when(kept.length > 1 || older, (row) => row.child(arrow("art-v-prev", "mods/workspace-chrome/chevron-left.svg", prev)))
        .child(div().id("art-v").px(2).flex_none().text_size(TEXT.label).text_color(older ? t.foreground : t.dim)
          .child(hv.busy ? "Opening…" : kept.length > 1 || older ? `v${shown} of ${latest}` : `v${shown}`))
        .when(kept.length > 1 || older, (row) => row.child(arrow("art-v-next", "mods/workspace-chrome/chevron-right.svg", next)))
        // An older one: "v2 of 5 · Latest ›".
        .when(older && !hv.busy, (row) => row.child(div().px(4).text_size(TEXT.label).text_color(t.dim).child("·"))
          .child(h_flex().id("art-latest").h(24).px(6).flex_none().items_center().rounded(RADIUS.control).cursor_pointer()
            .text_size(TEXT.label).font_medium().text_color(t.accent).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); step(null, cx); })
            .child("Latest ›")))))
      // Mark up / Done, as the viewer's bar (chat-image/artifact-bar.js) and the web's: a pointer clicking a spot; while
      // marking, Done with a tick, tinted the accent of the frame round what you mark (square-cornered, as the window's other bar buttons)
      .when(Boolean(v), (el) => el.child(h_flex().id("art-markup").h(24).pl(5).pr(8).gap(5).flex_none().items_center().rounded(RADIUS.control).cursor_pointer()
        .text_size(TEXT.label).font_medium().text_color(marking ? t.foreground : t.muted).when(marking, (b) => b.bg(`${t.accent}24`))
        .hover((s) => s.bg(marking ? `${t.accent}33` : t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); setShared("artifacts.markup", marking ? null : { mod: v.mod, where: "panel", at: Date.now() }); cx.notify(); })
        .child(marking ? svg("mods/artifacts/check.svg").size(14).flex_none().text_color(t.accent) : svg("mods/artifacts/markup.svg").size(14).flex_none())
        .child(marking ? "Done" : "Mark up")));
  }

  blankView() {
    const t = theme();
    return v_flex().size_full().items_center().justify_center().px(18).bg(t.background).text_size(TEXT.label).text_color(t.dim)
      .child("Pick an artifact to see it here.");
  }

  // A window's title bar: its title, and a close button. Pressing elsewhere drags the window.
  titleBar(bar) {
    const t = theme();
    const titles = shared("artifacts.titles") ?? {};
    return h_flex().id("art-bar").size_full().px(12).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).text_size(12.5)
      .child(svg(ICON).size(14).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().font_medium().child(titles[bar.mod] ?? `${bar.title} · v${bar.version}`))
      .child(div().id("art-close").p(4).flex_none().rounded(5).cursor_pointer().text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => closeOverlay(props().overlay))
        .child(svg("mods/workspace-chrome/x.svg").size(14)));
  }
}

// A folder by its last part ("~" at home), as the sidebar names spaces.
function folderName(folder) {
  if (!folder) return "";
  const h = home();
  return folder === h ? "~" : String(folder).split("/").filter(Boolean).pop() ?? folder;
}

// Esc in the search field clears it (bound once: the art_search_clear action).
let bound = false;

// Whether every word typed is in one of these, any case (Shepherdr's matches(): its lists' filters).
function matches(q, ...fields) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const all = fields.filter((f) => f != null && f !== "").join(" ").toLowerCase();
  return words.every((w) => all.includes(w));
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}
