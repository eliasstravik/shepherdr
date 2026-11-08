// Accept shows what you approve (as Shepherdr's merge card): a Ready task's Accept (the Tasks
// panel's row, the task chat's header, the Assistant chat's live row) opens this dialog first.
// Props { ref, folder, machine?, title? }. It reads `herdr-task show --evidence` (from Git,
// GitHub and the task's artifacts, never the agent's own words but its summary and details): the
// short summary first, then small sections: Changes (commits, files), Checks, Proof (opens its
// proof artifact in a modal of a fitting size over this card: the artifact viewer's toolbar,
// mods/chat-image's bar, over the artifact's mod) and a folded Details with the agent's long
// text, as short markdown bullets.
// Accept runs `herdr-task accept` (merges first when there is something to merge); Cancel, the X
// and Esc close it. A task that isn't Ready (accepted from elsewhere a moment ago, say) says so
// calmly, with only Close.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openViewer } from "./artview.js";
import { appHome, closeOverlay, exec, notify, openOverlay, props, shared, setShared, theme } from "herdr";
import { note } from "./usage.js";
import { dialogFooter, green, red, amber, H, RADIUS, TEXT } from "./ui.js";
// The card's words, the summary cut and the details as bullets: core/accept.js, shared with the web app's card.
import { ACCEPT, words, readable, commitsLine, filesLine, moreLine, proofTitle, whereNow } from "./core/accept.js";

export { words, readable };

const CLI = () => `${appHome()}/mods/tasks/bin/herdr-task`;
const MONO = "JetBrains Mono";

async function task(p, args) {
  const r = await exec(CLI(), [...(p.machine ? ["--on", p.machine] : []), ...args, "--folder", p.folder, "--json"])
    .catch((e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) }));
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch {}
  if (r.code !== 0 || !out || out.error) throw new Error(out?.error || r.stderr?.trim().split("\n").pop() || "herdr-task failed");
  return out;
}

// Markdown drawn here rather than by TextView, whose code spans pad like spaces ("( crook.svg ,"):
// blocks (bullets, paragraphs, headings, code blocks), each starting with a capital, and inline
// `code`, **bold** and [links](…) as their words.
function mdBlocks(md) {
  const out = [];
  let fence = null;
  for (const raw of md.split("\n")) {
    if (fence) {
      if (/^\s*```/.test(raw)) { out.push({ kind: "code", text: fence.join("\n") }); fence = null; }
      else fence.push(raw);
      continue;
    }
    if (/^\s*```/.test(raw)) { fence = []; continue; }
    const line = raw.trim(), last = out[out.length - 1];
    let m;
    if (!line) out.push({ kind: "gap" });
    else if ((m = line.match(/^#{1,6}\s+(.*)$/))) out.push({ kind: "heading", text: m[1] });
    else if ((m = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/))) out.push({ kind: "item", text: m[1], deep: /^\s{2,}/.test(raw) });
    else if (last && (last.kind === "item" || last.kind === "para")) last.text += ` ${line}`;
    else out.push({ kind: "para", text: line });
  }
  if (fence) out.push({ kind: "code", text: fence.join("\n") });
  return out.filter((b) => b.kind !== "gap");
}

const capital = (s) => s.replace(/^([("'*]*)([a-z])/, (_m, pre, c) => pre + c.toUpperCase());

function pieces(s) {
  const out = [], re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g;
  let at = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    out.push(m[1] != null ? { text: m[1], code: true } : m[2] != null ? { text: m[2], bold: true } : { text: m[3] });
    at = re.lastIndex;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}

// Words that wrap, for a run with code or bold in it: plain text breaks at its spaces; a code
// span stays whole and keeps the punctuation touching it, so no space ever shows inside
// "(`crook.svg`,". Each word but the last ends in a no-break space, the font's own space width,
// so the words sit as close as in plain text (a fixed gap looked stretched, justified).
function wrapWords(ps) {
  const out = [[]];
  for (const p of ps) {
    if (p.code) { out[out.length - 1].push(p); continue; }
    for (const part of p.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { if (out[out.length - 1].length) out.push([]); }
      else out[out.length - 1].push({ text: part, bold: p.bold });
    }
  }
  const words = out.filter((w) => w.length);
  words.slice(0, -1).forEach((w) => {
    const end = w[w.length - 1];
    if (end.code) w.push({ text: " " });
    else end.text += " ";
  });
  return words;
}

// One run of text, left-aligned at the font's own spacing: plain words alone are one text, as in
// the summary; with code, words wrap one by one and code is a quiet mono chip on the same line.
function inlineRun(t, s) {
  const ps = pieces(s);
  if (ps.every((p) => !p.code && !p.bold)) return div().w_full().min_w(0).child(ps.map((p) => p.text).join(""));
  return div().w_full().flex().flex_wrap().items_center().min_w(0)
    .children(wrapWords(ps).map((w) => h_flex().items_center().min_w(0).children(w.map((p) => p.code
      ? div().min_w(0).px(3).rounded(3).bg(t.raised).font_family(MONO).text_size(12).line_height("18px").child(p.text)
      : div().when(Boolean(p.bold), (el) => el.font_semibold()).child(p.text)))));
}

function mdView(t, md) {
  return v_flex().w_full().gap(8).line_height("21px").text_color(t.foreground)
    .children(mdBlocks(md).map((b) => {
      if (b.kind === "code") return div().w_full().p(10).rounded(RADIUS.control).bg(t.raised).font_family(MONO).text_size(12).line_height("18px").child(b.text);
      const run = inlineRun(t, b.text.startsWith("`") ? b.text : capital(b.text));
      if (b.kind === "heading") return div().w_full().pt(4).font_semibold().child(run);
      if (b.kind === "para") return run;
      return h_flex().w_full().items_start().gap(8).when(b.deep, (el) => el.pl(16))
        .child(div().h(21).w(8).flex_none().flex().items_center().justify_center().child(div().size(4).rounded(2).bg(t.dim)))
        .child(div().flex_1().min_w(0).child(run));
    }));
}

export default class AcceptCard extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.t = null;        // the task, with its evidence
    this.error = null;    // why it couldn't be read, or accepted
    this.busy = false;    // accepting
    this.opening = false; // pulling the proof
    this.details = false; // Details unfolded
    const p = props() ?? {};
    // Opened without a task (the palette's mod.open, say): nothing to approve, so it goes.
    if (!p.ref || !p.folder) {
      this.error = ACCEPT.noTask;
      cx.timer.after(0, () => this.close());
      return;
    }
    cx.spawn(async (cx) => {
      try { this.t = await task(p, ["show", p.ref, "--evidence"]); }
      catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  close() {
    const o = props()?.overlay;
    if (o) closeOverlay(o);
  }

  accept(cx) {
    if (this.busy || !this.t || this.t.state !== "ready") return;
    const p = props() ?? {};
    note("act", { type: "accept", task: p.ref });
    this.busy = true;
    this.error = null;
    // The task's row in the Tasks list says "Accepting…" meanwhile (shared "tasks.accepting").
    const key = `${p.machine ?? ""}:${p.folder}:${p.ref}`;
    const mark = (on) => {
      const v = { ...(shared("tasks.accepting") ?? {}) };
      if (on) v[key] = Date.now(); else delete v[key];
      setShared("tasks.accepting", v);
    };
    mark(true);
    cx.spawn(async (cx) => {
      // Before close(): closing the card ends its tasks.
      try {
        await task(p, ["accept", p.ref]);
        mark(false);
        this.close();
      } catch (e) {
        mark(false);
        this.error = String(e?.message ?? e);
        // Accepted (or changed) from elsewhere meanwhile: show where it is now, not the refusal.
        const now = await task(p, ["show", p.ref]).catch(() => null);
        if (now && now.state !== "ready") {
          this.t = { ...now, evidence: this.t.evidence };
          this.error = null;
        }
        this.busy = false;
      }
      cx.notify();
    });
  }

  // The proof in a modal over this card (artview.js: its mod is made in this app first, pulled
  // from the task's machine); closing it comes back here as it was.
  // Its other artifacts (SHEP-96: a research task's report) open the same way.
  openProof(cx, art = this.t?.evidence?.proof) {
    const machine = props()?.machine ?? null;
    if (!art || this.opening) return;
    this.opening = art.id;
    cx.spawn(async (cx) => {
      await openViewer({ id: art.id, title: art.title, machine, modal: true });
      this.opening = false;
      cx.notify();
    });
  }

  // One small section: a hairline above, a quiet label, then what it says at reading size.
  section(t, label, content) {
    return v_flex().w_full().gap(6).pt(14).border_t(1).border_color(t.border)
      .child(div().text_size(TEXT.label).font_medium().text_color(t.muted).child(label))
      .child(content);
  }

  // Changes: one line of counts, then its newest commits and its biggest files by name.
  changes(t, e) {
    if (e.git === false) return div().text_color(t.muted).child(ACCEPT.notGit);
    const c = e.commits ?? { count: 0, list: [] }, d = e.diff;
    if (!c.count && !d?.files) return div().text_color(t.muted).child(ACCEPT.noCommits);
    const counts = h_flex().gap(8).items_center().flex_wrap()
      .child(div().text_color(t.foreground).child(commitsLine(c.count)))
      .when(Boolean(d), (el) => el
        .child(div().text_color(t.dim).child("·"))
        .child(div().text_color(t.foreground).child(filesLine(d.files)))
        .child(div().font_family(MONO).text_size(TEXT.label).text_color(green()).child(`+${d.added}`))
        .child(div().font_family(MONO).text_size(TEXT.label).text_color(red()).child(`−${d.removed}`)))
      .when(!d, (el) => el.child(div().text_color(red()).child(ACCEPT.noFiles)));
    const commit = (x) => h_flex().gap(8).min_w(0).items_center()
      .child(div().flex_none().font_family(MONO).text_size(12).text_color(t.dim).child(x.sha))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(x.subject));
    const file = (f) => div().min_w(0).truncate().font_family(MONO).text_size(12).text_color(t.muted).child(f.path);
    return v_flex().gap(8).min_w(0)
      .child(counts)
      .when(c.list.length > 0, (el) => el.child(v_flex().gap(3).min_w(0).children(c.list.map(commit))
        .when(c.count > c.list.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(moreLine(c.count - c.list.length))))))
      .when(Boolean(d?.list?.length), (el) => el.child(v_flex().gap(2).min_w(0).children(d.list.map(file))
        .when(d.files > d.list.length, (el) => el.child(div().text_size(12).text_color(t.dim).child(moreLine(d.files - d.list.length))))));
  }

  checks(t, e) {
    const c = e.checks ?? { state: "none", text: ACCEPT.noChecks };
    const color = { passed: green(), failed: red(), running: amber(), unknown: red() }[c.state] ?? t.muted;
    return h_flex().gap(8).items_center()
      .when(c.state !== "none", (el) => el.child(div().size(7).flex_none().rounded(4).bg(color)))
      .child(div().text_color(c.state === "none" ? t.muted : t.foreground).child(c.text));
  }

  // Proof: a row that looks pressable, opening the artifact in a modal.
  proof(t, e) {
    if (!e.proof) return div().text_color(t.muted).child(ACCEPT.noProof);
    return this.artRow(t, e.proof, "open-proof");
  }

  // Artifacts: its others (SHEP-96), one row each, as its proof's.
  artifacts(t, e) {
    return v_flex().w_full().gap(6).children(e.artifacts.map((a) => this.artRow(t, a, `open-art-${a.id}`)));
  }

  artRow(t, a, id) {
    return h_flex().id(id).w_full().h(32).px(10).gap(8).items_center().rounded(RADIUS.card)
      .border_1().border_color(t.border).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.openProof(cx, a); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
        .child(this.opening === a.id ? ACCEPT.opening : proofTitle(a.title)))
      .child(div().flex_none().text_size(TEXT.label).text_color(t.muted).child(ACCEPT.open))
      .child(svg("mods/chat-image/external-link.svg").size(13).flex_none().text_color(t.muted));
  }

  // Details: folded; its header is the toggle, the long text below it selectable.
  detailsSection(t, text) {
    const open = this.details;
    return v_flex().w_full().gap(8).pt(14).border_t(1).border_color(t.border)
      .child(h_flex().id("details-toggle").gap(6).items_center().cursor_pointer().text_color(t.muted)
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.details = !open; cx.notify(); })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(13).flex_none())
        .child(div().text_size(TEXT.label).font_medium().child(ACCEPT.details)))
      .when(open, (el) => el.child(div().w_full().pl(19).child(mdView(t, readable(text)))));
  }

  // No longer Ready: where it is now, calmly (a dot in its color, no red error).
  where(t, x) {
    const done = x.state === "done";
    const text = whereNow(x);
    return h_flex().gap(8).items_center()
      .child(div().size(7).flex_none().rounded(4).bg(done ? green() : t.muted))
      .child(div().text_color(t.foreground).child(text));
  }

  // The top-right X: closes like Cancel and Esc.
  closeButton(t) {
    return div().id("accept-close").size(H.sm).flex_none().flex().items_center().justify_center()
      .rounded(RADIUS.control).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); this.close(); })
      .child(svg("mods/chat-image/x.svg").size(14));
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const x = this.t, e = x?.evidence;
    const ready = x?.state === "ready";
    const settled = Boolean(x && !ready);
    const w = e ? words(e) : null;
    const body = !x
      ? div().text_color(this.error ? red() : t.dim).child(this.error ?? ACCEPT.reading)
      : v_flex().w_full().gap(16).pb(4)
        .child(div().max_w(560).text_size(TEXT.body).line_height("20px").text_color(w.summary ? t.foreground : t.muted)
          .child(w.summary || ACCEPT.noSummary))
        .child(this.section(t, ACCEPT.changes, this.changes(t, e)))
        .child(this.section(t, ACCEPT.checks, this.checks(t, e)))
        .child(this.section(t, ACCEPT.proof, this.proof(t, e)))
        .when(Boolean(e.artifacts?.length), (el) => el.child(this.section(t, ACCEPT.artifacts, this.artifacts(t, e))))
        .when(Boolean(w.details), (el) => el.child(this.detailsSection(t, w.details)));
    return v_flex().id("accept-card").track_focus(this.handle)
      .on_key_down((ev, cx) => {
        if (ev.key === "escape") this.close();
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(22).gap(18).bg(t.popover).text_size(TEXT.body).line_height("20px")
      // The title (the task's ID, a question while it can be accepted), its name, and the X.
      .child(h_flex().flex_none().gap(12).items_start()
        .child(v_flex().flex_1().min_w(0).gap(4)
          .child(div().text_size(TEXT.title).font_semibold().text_color(t.foreground)
            .child(!p.ref ? ACCEPT.accept : settled ? p.ref : ACCEPT.title(p.ref)))
          .child(div().min_w(0).truncate().text_color(t.muted).child(x?.title ?? p.title ?? "")))
        .child(div().mt(-2).mr(-6).child(this.closeButton(t))))
      .child(div().id("accept-body").flex_1().min_h(0).overflow_y_scrollbar().pr(6).child(body))
      .child(v_flex().flex_none().gap(10)
        .when(Boolean(x && this.error), (el) => el.child(div().text_color(red()).child(this.error)))
        .when(settled, (el) => el.child(this.where(t, x)))
        // The dialog's one footer (ui.js): Cancel, then Accept; only Close once there's nothing
        // to accept.
        .child(settled ? dialogFooter({ onCancel: () => this.close(), cancelLabel: ACCEPT.close })
          : dialogFooter({ onCancel: () => this.close(), cancelLabel: ACCEPT.cancel,
            primary: { id: "accept", label: this.busy ? ACCEPT.accepting : ACCEPT.accept, disabled: !(ready && !this.busy), onClick: (_e, cx) => this.accept(cx) } })));
  }
}
