// The Secrets section (DECISIONS.md, "Shepherdr gaps being closed": Secrets as Shepherdr's):
// keys, tokens and passwords agents use by name (bin/herdr-secret), kept in the owner-only vault
// on the machine that keeps them (Kept on: this one or another, moved with `shepherdr secrets
// move-to`). Add or replace one in masked boxes, for Everywhere, a machine or a space (a
// space's own settings start on that space); the most specific wins. Values are never shown: the list has names and where each is kept. Agents
// waiting on one (herdr-secret ask) are listed first, and giving it here answers them too.
// The vault itself is lib/secrets.js's (its copy here: ./secrets.js).

import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { machines, exec, home } from "herdr";
import { spaces, terminals } from "./live.js";
import * as vault from "./secrets.js";
import { TEXT, RADIUS, H } from "./ui.js";
// Every word on the page: core/settings.js, shared with the web app.
import { SECRETS as W, SECTIONS, EVERYWHERE as EVERYWHERE_WORD } from "./core/settings.js";

const EVERYWHERE = { scope: "everywhere", machine: null, space: null };

// The section's state, made in the window's init (boxes need a live host call).
export function secretsInit(cx) {
  const s = { name: InputState.new({ placeholder: W.namePlaceholder }), value: InputState.new({ placeholder: W.valuePlaceholder }),
    scope: EVERYWHERE, open: false, list: null, err: "", note: "", busy: false, confirm: null,
    // Kept on: its menu open, the machine picked to confirm ("" this one), a move under way, what it said
    keptOpen: false, keptSure: null, moving: null, moveErr: "" };
  s.value.set_masked(true);
  s.name.on("change", (_e, cx) => { s.err = ""; cx.notify(); });
  s.value.on("change", (_e, cx) => { s.err = ""; cx.notify(); });
  s.value.on("submit", (_e, cx) => save(s, cx));
  s.reload = (cx) => cx.spawn(async (cx) => {
    try { s.list = await vault.entries(); } catch (e) { s.list = []; s.err = String(e?.message ?? e); }
    cx.notify();
  });
  s.reload(cx);
  return s;
}

function save(s, cx) {
  const name = s.name.value().trim(), value = s.value.value();
  if (s.busy) return;
  if (!vault.NAME.test(name)) { s.err = W.badName; cx.notify(); return; }
  if (!value) { s.err = W.noValue; cx.notify(); return; }
  s.busy = true;
  cx.spawn(async (cx) => {
    try {
      await vault.keep(name, s.scope, value);
      s.value.set_value("");
      s.name.set_value("");
      s.note = W.keptNote(name, vault.where(s.scope));
      s.err = "";
    } catch (e) { s.err = String(e?.message ?? e); }
    s.busy = false;
    s.reload(cx);
  });
}

// Moves the secrets to a machine ("": this one): shepherdr secrets move-to, run beside the app.
function moveTo(s, m, cx) {
  s.keptSure = null;
  s.moving = m || W.keptHere;
  s.moveErr = "";
  cx.spawn(async (cx) => {
    const r = await exec("sh", ["-c", 'PATH="$HOME/.local/bin:$PATH"; exec shepherdr secrets move-to "$1" --json', "x", m || "here"]).catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
    let out = null;
    try { out = JSON.parse(r.stdout.trim().split("\n").pop()); } catch {}
    if (r.code !== 0 || !out?.ok) s.moveErr = out?.error || r.stderr.trim().split("\n").pop()?.replace(/^shepherdr: /, "") || "The move didn't finish.";
    s.moving = null;
    await vault.whereNow?.();
    s.reload(cx);
  });
}

// Every scope there is: Everywhere, each machine, each space.
function scopes() {
  const out = [{ ...EVERYWHERE, label: EVERYWHERE_WORD, group: "" }];
  for (const m of [null, ...machines().map((m) => m.name).filter(Boolean)]) out.push({ scope: "machine", machine: m, space: null, label: vault.machineName(m), group: W.machine });
  for (const sp of spaces()) out.push({ scope: "space", machine: null, space: sp.id, label: sp.name, sub: sp.machine ?? "", group: W.space });
  return out;
}

// `view`: the settings window, for its heading and row.
export function secretsSection(view, t) {
  const s = view.sec;
  const field = (box, w, mono) => div().h(H.lg).when(w != null, (el) => el.w(w)).when(w == null, (el) => el.w_full()).px(9).flex().items_center().rounded(RADIUS.control).border_1().border_color(t.input).bg(t.background)
    .child(Input.new(box).w_full().text_size(TEXT.body).text_color(t.foreground).when(mono, (el) => el.font_family("JetBrains Mono")));
  const small = (id, label, fn, kind = "secondary") => h_flex().id(id).h(H.sm).px(8).flex_none().items_center().rounded(RADIUS.control).cursor_pointer().text_size(TEXT.label).font_medium()
    .when(kind === "secondary", (el) => el.border_1().border_color(t.border).bg(t.raised).text_color(t.foreground).hover((st) => st.bg(t.hover)))
    .when(kind === "danger", (el) => el.bg(t.blocked).text_color(t.background).hover((st) => st.opacity(0.88)))
    .when(kind === "ghost", (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
    .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); cx.notify(); }).child(label);
  const all = scopes();
  const picked = all.find((x) => vault.scopeKey(x) === vault.scopeKey(s.scope)) ?? all[0];
  const item = (x) => h_flex().id(`sec-scope-${vault.scopeKey(x)}`).h(29).px(9).gap(10).rounded(7).items_center().cursor_pointer()
    .hover((st) => st.bg(t.selected))
    .on_click((_e, cx) => { s.scope = { scope: x.scope, machine: x.machine, space: x.space }; s.open = false; cx.notify(); })
    .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(x.label))
    .child(div().text_size(11).text_color(t.dim).child(x.sub ?? ""))
    .child(div().size(14).flex_none().when(vault.scopeKey(x) === vault.scopeKey(s.scope), (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground))));
  const group = (g) => all.filter((x) => x.group === g);
  const picker = h_flex().id("sec-scope").h(H.lg).pl(10).pr(6).gap(6).items_center().rounded(RADIUS.control).border_1().border_color(t.border).bg(t.raised)
    .cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => { s.open = !s.open; cx.notify(); })
    .child(div().max_w(150).truncate().text_size(TEXT.body).text_color(t.foreground).child(picked.group === W.space ? `Space ${picked.label}` : picked.label))
    .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim));
  const menu = v_flex().id("sec-scope-menu").absolute().top(66).right(0).w(260).max_h(300).overflow_y_scroll().p(5).rounded(8).bg(t.popover)
    .border_1().border_color(t.border).shadow_md()
    .child(item(all[0]))
    .children([W.machine, W.space].flatMap((g) => [div().px(9).pt(8).pb(3).text_size(11).font_medium().text_color(t.dim).child(g), ...group(g).map(item)]));

  // Agents waiting on one: the form fills with its name and their narrowest scope.
  const asks = vault.allAsks();
  const who = (a) => terminals().find((x) => x.address === a.address)?.name || a.address;
  const askRows = asks.map((a) => h_flex().w_full().gap(12).py(10).items_center().border_b(1).border_color(t.border)
    .child(div().size(7).flex_none().rounded(4).bg(t.blocked))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().text_size(TEXT.body).text_color(t.foreground).child(W.asks(who(a), a.name)))
      .when(Boolean(a.why), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim).child(a.why))))
    .child(small(`sec-give-${a.address}-${a.name}`, W.give, (cx) => {
      const lv = vault.levels(a.address)[0];
      s.name.set_value(a.name);
      s.scope = { scope: lv.scope, machine: lv.machine, space: lv.space };
      s.value.focus();
    })));

  const form = v_flex().relative().gap(8).py(12).border_b(1).border_color(t.border)
    .child(h_flex().gap(8).items_center()
      .child(v_flex().gap(4).child(div().text_size(TEXT.label).text_color(t.dim).child(W.name)).child(field(s.name, 190, true)))
      .child(v_flex().flex_1().min_w(0).gap(4).child(div().text_size(TEXT.label).text_color(t.dim).child(W.value)).child(field(s.value, null, false)))
      .child(v_flex().gap(4).child(div().text_size(TEXT.label).text_color(t.dim).child(W.for)).child(picker)))
    .child(h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(TEXT.label).line_height("17px").text_color(s.err ? t.blocked : t.dim)
        .child(s.err || s.note || W.hint))
      .child(h_flex().id("sec-save").h(H.sm).px(8).flex_none().items_center().rounded(RADIUS.control).text_size(TEXT.label).font_medium()
        .when(Boolean(s.name.value().trim() && s.value.value()) && !s.busy, (el) => el.cursor_pointer().bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.88))
          .on_click((_e, cx) => save(s, cx)))
        .when(!(s.name.value().trim() && s.value.value()) || s.busy, (el) => el.bg(t.raised).text_color(t.dim))
        .child(s.busy ? W.saving : W.save)))
    .when(s.open, (el) => el.child(menu));

  const list = s.list ?? [];
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope));
  const rows = sorted.map((e) => {
    const k = `${e.name}|${vault.scopeKey(e)}`;
    return h_flex().id(`sec-row-${k}`).w_full().gap(12).py(9).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/shepherdr-settings/key.svg").size(14).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_family("JetBrains Mono").text_color(t.foreground).child(e.name))
      .child(div().max_w(180).truncate().text_size(TEXT.label).text_color(t.muted).child(vault.where(e)))
      .child(small(`sec-replace-${k}`, W.replace, () => {
        s.name.set_value(e.name);
        s.scope = { scope: e.scope, machine: e.machine, space: e.space };
        s.note = W.pasteNew(e.name);
        s.value.focus();
      }, "ghost"))
      .child(s.confirm === k
        ? h_flex().gap(4).child(small(`sec-rm-yes-${k}`, W.remove, (cx) => {
            s.confirm = null;
            cx.spawn(async (cx) => {
              try { await vault.remove(e.name, e); s.note = W.removedNote(e.name, vault.where(e)); } catch (err) { s.err = String(err?.message ?? err); }
              s.reload(cx);
            });
          }, "danger")).child(small(`sec-rm-no-${k}`, W.keep, () => { s.confirm = null; }, "ghost"))
        : small(`sec-rm-${k}`, W.remove, () => { s.confirm = k; }, "ghost"));
  });

  // Kept on: the machine whose vault every machine uses, and the others to move it to
  const kept = vault.keptOn();
  const ms = machines();
  const keptWhere = !kept ? W.loading : kept.here ? W.keptHere : kept.name || W.notLinked;
  // following Serve from: kept there already, or still where they were (they move on their own)
  const serve = kept?.serve === null ? W.thisOne : kept?.serve || "";
  const same = !!kept?.auto && (kept.serve === null ? kept.here : !!kept.serve && kept.serve === kept.name);
  const keptName = !kept?.auto ? keptWhere : same ? W.sameAsServe(keptWhere) : W.forNow(keptWhere);
  const reach = !kept || kept.here || ms.some((m) => m.name === kept.name && m.layout !== "unavailable");
  const choices = [{ name: "", label: W.keptHere, on: !!kept?.here, off: false },
    ...ms.filter((m) => m.name).map((m) => ({ name: m.name, label: m.name, on: !kept?.here && kept?.name === m.name, off: m.layout === "unavailable" }))];
  const keptMenu = v_flex().id("sec-kept-menu").absolute().top(40).right(0).w(240).max_h(300).overflow_y_scroll().p(5).rounded(8).bg(t.popover)
    .border_1().border_color(t.border).shadow_md()
    .children(choices.map((c) => h_flex().id(`sec-kept-${c.name || "here"}`).h(29).px(9).gap(10).rounded(7).items_center()
      .when(!c.on && !c.off, (el) => el.cursor_pointer().hover((st) => st.bg(t.selected)).on_click((_e, cx) => { s.keptOpen = false; s.keptSure = c.name; cx.notify(); }))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.off ? t.dim : t.foreground).child(c.label))
      .child(div().text_size(11).text_color(t.dim).child(c.off ? W.offline : ""))
      .child(div().size(14).flex_none().when(c.on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).text_color(t.foreground))))));
  const keptStatus = s.moving ? W.moving(s.moving) : s.moveErr || (!reach ? W.unreachable(kept.name) : !kept?.auto ? W.keptAbout : same || !serve ? W.sameAbout : W.following(serve));
  const keptRow = v_flex().relative().gap(8).py(12).border_b(1).border_color(t.border)
    .child(h_flex().gap(10).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).text_color(t.foreground).child(keptName))
      .child(s.moving ? div() : small("sec-kept-move", W.moveVerb, () => { s.keptOpen = !s.keptOpen; })))
    .when(s.keptSure !== null, (el) => el.child(v_flex().gap(6).p(10).rounded(RADIUS.control).border_1().border_color(t.border)
      .child(div().text_size(TEXT.body).font_medium().text_color(t.foreground).child(W.moveConfirm(s.keptSure || W.thisOne)))
      .child(div().text_size(TEXT.label).line_height("17px").text_color(t.dim).child(W.moveDetail(s.keptSure || W.thisOne, kept?.here ? W.thisOne : keptWhere)))
      .child(h_flex().gap(4).justify_end()
        .child(small("sec-kept-no", W.keep, () => { s.keptSure = null; }, "ghost"))
        .child(small("sec-kept-yes", W.moveVerb, (cx) => moveTo(s, s.keptSure, cx))))))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(s.moveErr || !reach ? t.blocked : t.dim).child(keptStatus))
    .when(s.keptOpen, (el) => el.child(keptMenu));

  return v_flex()
    .child(view.title(t, SECTIONS.find((x) => x.id === "secrets").title))
    .child(div().text_size(TEXT.label).line_height("17px").text_color(t.dim).child(W.about))
    .child(view.heading(t, W.keptOn))
    .child(keptRow)
    .when(asks.length > 0, (el) => el.child(view.heading(t, W.asked)).children(askRows))
    .child(view.heading(t, W.add))
    .child(form)
    .child(view.heading(t, W.kept))
    .when(s.list === null, (el) => el.child(div().py(10).text_size(TEXT.body).text_color(t.dim).child(W.loading)))
    .when(s.list !== null && !rows.length, (el) => el.child(div().py(10).text_size(TEXT.body).text_color(t.dim).child(W.none)))
    .children(rows);
}
