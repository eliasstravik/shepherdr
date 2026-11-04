// Settings: Shepherdr's settings window (the sidebar foot's Shepherdr; lib/ui.js openSettings). How
// Assistants, workers and reviewers run, how tasks are reviewed, merged and queued, Autopilot,
// Notify, Secrets, Machines and the Window's switches; Herdr's own settings are the sidebar foot's
// other button, Settings. Props: { space?: that space's own settings, section? }.
// One scope (DECISIONS.md, "UI/UX review decisions"): it edits Everywhere. A space's own values
// are set from that space ("Space settings…" in its sidebar menu): the same window with a banner,
// where each row says "Same as everywhere" or "Changed here · Reset". On Everywhere, a row some
// space changed says so in one dim line. Machine-only settings are rows under Machines; values a
// machine set for everything before (the old machine scope) still apply and show there, with Reset.
// Writes ~/.herdr/shepherdr.json at once, no Save step (coordinator.js documents the shape;
// herdr-task reads it too). Other machines get their share pushed (pushRemotes) for their
// herdr-task. Agents use the chat's own model button (settings.js and agent.js from lib/).
// The window draws its own frame (frame: "none"), most of Herdr's height, at most 900.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, TextareaState, Textarea } from "gpui-base";
import { props, theme, machines, home, exec, readTextFile, writeTextFile, closeOverlay, openOverlay, shared } from "herdr";
import { spaces, inRender } from "./live.js";
import { SHEPHERDR_FILE, SHEPHERDR_DEFAULTS, LOCAL_MACHINE, shepherdrFor, shepherdrLayers, machineOfSpace } from "./coordinator.js";
import * as models from "./settings.js";
import { layoutSection } from "./layout.js";
import { manifest } from "./addons.js";
import { secretsInit, secretsSection } from "./secrets-section.js";
import { baseInit, baseRow } from "./base-branch.js";
import { autopilotInit, autopilotSection, autopilotFlush } from "./autopilot-section.js";
import { spaceName } from "./core/spaces.js";
import { NOTIFY, NOTIFY_DEFAULT, notifyMachine, notifyMachineOwn, notifyOf, notifyOwn, notifyEverywhere,
  setNotifyEverywhere, setNotifyMachine, setNotify } from "./notify.js";
import { machinesSection } from "./machines-section.js";
import { TEXT, RADIUS, H, button, link, toggleSwitch, segmented } from "./ui.js";
import { webSection } from "./web-section.js";
// Every page's, row's and button's words, and the rows' choices: core/settings.js, shared with the web app.
// herdr-task's merge policy (MERGE): "ask" waits for the person's Accept (which merges), the others merge without it.
// NOTES: what a task's agent is told to do first and last (tasks.start_notes / finish_notes): herdr-task puts them
// into its starting prompt; Herdr runs nothing itself.
import { SECTIONS, ROLES, NOTES, MERGE, MUST_FIX, ROUNDS, ARCHIVE, ABOUT, BACKUP, NOTIFY_ABOUT, TITLE, SPACE_TITLE,
  EVERYWHERE, CHANGED_HERE, RESET, EDIT_INSTRUCTIONS, USE_OTHER_CLI, LOADING_AGENTS, SAVED, sameAs as sameAsWords,
  spacesOwn, onlyFor, otherCli, otherCliWords, backupProblem, notifyMachineAbout, machineLabel, TASK_ROWS } from "./core/settings.js";

const I = (name) => `mods/shepherdr-settings/${name}.svg`;
// A page's title, and a Tasks row's (by its key, section.field).
const page = (id) => SECTIONS.find((s) => s.id === id).title;
const rowTitle = (key) => TASK_ROWS.find(([s, f]) => `${s}.${f}` === key)[2];
// Pages that moved: older openers still name them.
const MOVED = { layout: "window", instructions: "agents", automations: "tasks" };
const TEMPLATES = () => `${home()}/.config/herdr-core/templates`;
const CLI_CHECK = () => `${home()}/.herdr/cli-check.json`;
const tilde = (p) => (p && p.startsWith(home() + "/") ? "~" + p.slice(home().length) : p ?? "");
const machineKeys = () => [LOCAL_MACHINE, ...machines().filter((m) => m.name && !m.temporary).map((m) => m.name)];
const spaceById = (id) => spaces().find((s) => s.id === id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// A short choice's options, with a value set before that isn't one of them kept in its place.
const withValue = (opts, v, words) => (opts.some(([k]) => k === v) ? opts : [...opts, [v, words(v)]].sort((a, b) => a[0] - b[0]));
const daysWord = (d) => plural(d, "day", "days");
const roundsWord = (n) => plural(n, "round", "rounds");
// A pushed copy's mark: a machine whose file lacks it keeps its own settings, and is left alone.
const PUSH = `f="$HOME/.herdr/shepherdr.json"; mkdir -p "$HOME/.herdr" || exit 1
if [ -f "$f" ] && ! grep -q '"pushed_from"' "$f"; then echo own; exit 0; fi
if [ -f "$f" ] && [ "$(cat "$f")" = "$1" ]; then exit 0; fi
umask 077; printf '%s\n' "$1" > "$f.tmp" && mv "$f.tmp" "$f"`;

export default class ShepherdrSettings extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // null: Everywhere; else the space whose own settings these are.
    this.scope = p.space && spaceById(p.space) ? p.space : null;
    const want = MOVED[p.section] ?? p.section;
    this.section = this.shows(want) ? want : "agents";
    this.listOpen = null; // the row whose "N spaces use their own" list is open
    this.kept = {}; // machine -> true: it keeps its own settings file, so pushes skip it
    this.cfg = {};
    this.raw = null;
    this.data = null; // the agents on offer (settings.js loadChoices)
    this.roles = {}; // role -> { sel, data, saved }: the model buttons' state for this scope
    this.folders = {}; // space id -> its task folder (repo root)
    this.handle = cx.focus_handle();
    this.handle.focus();
    // Secrets: its boxes and list (secrets-section.js); a space's settings add for that space.
    this.sec = secretsInit(cx);
    this.secFor();
    // Tasks > Base branch, a space's (base-branch.js).
    this.bb = baseInit(this);
    // Autopilot: one setting for every space, kept by herdr-task (autopilot-section.js).
    this.ap = autopilotInit(this, cx);
    // The add-ons Window's switches offer (lib/addons.json, layout.js).
    this.addons = null;
    cx.spawn(async (cx) => { this.addons = await manifest(); cx.notify(); });
    // The two notes' text boxes: saved a moment after typing stops, on leaving the box, and on
    // close; "Saved" shows dim for a moment after.
    this.notes = {};
    for (const n of NOTES) {
      // No built-in placeholder: it draws in the text's color. noteRow() draws the example, dim.
      const note = (this.notes[n.id] = { box: TextareaState.new({ placeholder: "" }), saved: "", gen: 0, savedAt: 0 });
      note.box.set_auto_grow(3, 10);
      note.box.on("change", (_e, cx) => {
        const gen = ++note.gen;
        cx.notify(); // the example shows only while the box is empty
        cx.timer.after(500, (cx) => { if (gen === note.gen) this.saveNotes(cx); });
      });
      note.box.on("focus", (_e, cx) => { this.noteFocus = n.id; cx.notify(); });
      note.box.on("blur", (_e, cx) => { this.noteFocus = null; this.saveNotes(cx); });
    }
    cx.spawn(async (cx) => {
      await this.load();
      try { this.data = await models.loadChoices(null); } catch { this.data = null; }
      this.resetRoles();
      this.resetNotes();
      if (this.scope) await this.folderOf(this.scope);
      cx.notify();
      await this.pushRemotes();
      cx.notify();
    });
  }

  // Whether a page shows in this scope.
  shows(id, scope = this.scope) {
    const s = SECTIONS.find((x) => x.id === id);
    if (!s) return false;
    if (!scope) return true;
    return s.space === "local" ? !spaceById(scope)?.machine && !scope.includes("/") : Boolean(s.space);
  }

  async load() {
    this.raw = await readTextFile(SHEPHERDR_FILE()).catch(() => null);
    try { this.cfg = this.raw ? JSON.parse(this.raw) : {}; } catch { this.cfg = {}; }
    // Each machine's CLIs, installed and signed in: herdr-task's scheduler checks every 15 minutes.
    try { this.clis = JSON.parse((await readTextFile(CLI_CHECK())) ?? "{}")?.machines ?? {}; } catch { this.clis = {}; }
  }

  // Changes the file as an agent would: read, change, write only if nobody changed it meanwhile.
  change(edit, cx) {
    cx.spawn(async (cx) => { await this.apply(edit); cx.notify(); });
  }

  // Other machines' herdr-task read their own ~/.herdr/shepherdr.json: each gets Everywhere, its
  // machine's and its spaces' (by their ids there), marked so it knows which machine it is.
  // A file there without the mark is that machine's own (its own Herdr window): left alone.
  // Unreachable machines are skipped; the next change or opening catches them up.
  // One push at a time: changes made meanwhile go out in one more push after it.
  pushRemotes() {
    if (this.pushing) { this.pushAgain = true; return this.pushing; }
    this.pushing = Promise.all(machineKeys().filter((m) => m !== LOCAL_MACHINE).map(async (m) => {
      const spacesThere = Object.fromEntries(Object.entries(this.cfg.spaces ?? {})
        .filter(([id]) => machineOfSpace(id) === m).map(([id, v]) => [id.split("/").pop(), v]));
      const body = JSON.stringify({ version: 1, pushed_from: "herdr-app", here: m, everywhere: this.cfg.everywhere ?? {},
        machines: this.cfg.machines?.[m] ? { [m]: this.cfg.machines[m] } : {}, spaces: spacesThere }, null, 2);
      const r = await exec("sh", ["-c", PUSH, "sh", body], { on: m }).catch(() => null);
      if (r?.code === 0) this.kept[m] = r.stdout.trim() === "own";
    })).finally(() => {
      this.pushing = null;
      if (this.pushAgain) { this.pushAgain = false; this.pushRemotes(); }
    });
    return this.pushing;
  }

  async apply(edit) {
    for (let i = 0; i < 3; i++) {
      await this.load();
      const next = JSON.parse(JSON.stringify(this.cfg));
      next.version = 1;
      edit(next);
      try {
        await writeTextFile(SHEPHERDR_FILE(), JSON.stringify(next, null, 2) + "\n", this.raw);
        this.cfg = next;
        this.pushRemotes();
        return true;
      } catch {}
    }
    return false;
  }

  // The object a scope writes to: everywhere, or the space's entry (with its folder, name and
  // machine).
  target(next, scope = this.scope) {
    if (!scope) return (next.everywhere ??= {});
    const s = spaceById(scope);
    next.spaces ??= {};
    const own = (next.spaces[scope] ??= {});
    own.folder = this.folders[scope] ?? s?.folder ?? own.folder;
    own.name = s?.name ?? own.name;
    if (s?.machine) own.machine = s.machine;
    return own;
  }

  // The object a scope holds now, if any (for Reset).
  layerOf(cfg, scope = this.scope) {
    return scope ? cfg.spaces?.[scope] : cfg.everywhere;
  }

  drop(own, key, field) {
    if (!own) return;
    if (!field) delete own[key];
    else if (own[key] && typeof own[key] === "object") { delete own[key][field]; if (!Object.keys(own[key]).length) delete own[key]; }
  }

  // As Shepherdr's: setting what this scope would inherit anyway unsets it, so it follows again.
  set(key, field, value, cx) {
    const follows = JSON.stringify(value) === JSON.stringify(this.inherited(key, field).value);
    this.change((next) => {
      if (follows) return this.drop(this.layerOf(next), key, field);
      const tg = this.target(next);
      if (field) tg[key] = { ...(tg[key] ?? {}), [field]: value };
      else tg[key] = value;
    }, cx);
  }

  // Reset: this scope's own value goes, and what it inherits applies again.
  reset(key, field, cx) {
    cx.spawn(async (cx) => {
      await this.apply((next) => this.drop(this.layerOf(next), key, field));
      if (!field) this.resetRoles();
      cx.notify();
    });
  }

  valueIn(obj, key, field) {
    const o = obj?.[key];
    if (!field) return o ?? undefined;
    return o && typeof o === "object" && o[field] != null ? o[field] : undefined;
  }

  // Where a scope's value comes from, most specific first, ending with the default:
  // [{ level, key, value }] (value undefined: that layer sets none). A space reads its own, then
  // its machine's (only values set before machine scope went), then Everywhere's.
  chain(key, field, scope = this.scope) {
    const out = shepherdrLayers(this.cfg, scope).map((l) => ({ level: l.level, key: l.key, value: this.valueIn(l.obj, key, field) }));
    out.push({ level: "default", key: null, value: field ? SHEPHERDR_DEFAULTS[key]?.[field] ?? null : null });
    return out;
  }

  // What a setting would be without this scope's own value.
  inherited(key, field) {
    return this.chain(key, field).slice(1).find((x) => x.value !== undefined);
  }

  // "Same as everywhere", or the machine a value set before still comes from.
  sameAs(level, key) {
    return sameAsWords(level, key);
  }

  scopeName(scope = this.scope) {
    if (!scope) return EVERYWHERE;
    // As the sidebar calls it (core/spaces.js): never "~".
    const s = spaceById(scope);
    return s ? spaceName(s, { home: home(), named: Boolean(s.named) }) : this.cfg.spaces?.[scope]?.name ?? "This space";
  }

  // The spaces that set their own value for a setting: [{ id, name }].
  ownSpaces(key, field) {
    return Object.entries(this.cfg.spaces ?? {}).filter(([, v]) => this.valueIn(v, key, field) !== undefined)
      .map(([id, v]) => ({ id, name: spaceById(id) ? this.scopeName(id) : v?.name ?? id }));
  }

  // A row's scope facts (scopeLine() draws them): in a space, whether it's changed there; on
  // Everywhere, which spaces use their own.
  scoped(key, field, reset = null) {
    const id = `${key}-${field ?? "all"}`;
    if (!this.scope) return { id, others: this.ownSpaces(key, field) };
    const inh = this.inherited(key, field);
    return { id, mine: this.valueIn(this.layerOf(this.cfg), key, field) !== undefined, from: this.sameAs(inh.level, inh.key),
      reset: reset ?? ((cx) => this.reset(key, field, cx)) };
  }

  // Into a space's own settings (null: Everywhere's). A page the space doesn't have goes to Agents.
  pickScope(id, cx) {
    const saving = this.flushNotes();
    this.scope = id;
    this.listOpen = null;
    if (!this.shows(this.section)) this.section = "agents";
    this.secFor();
    this.handle.focus();
    cx.spawn(async (cx) => { await saving; if (id) await this.folderOf(id); await this.load(); this.resetRoles(); this.resetNotes(); cx.notify(); });
  }

  // Secrets' Add is for the space whose settings these are, else Everywhere.
  secFor() {
    this.sec.scope = this.scope ? { scope: "space", machine: null, space: this.scope } : { scope: "everywhere", machine: null, space: null };
  }

  // A space's task folder (its repo root), on its own machine.
  async folderOf(id) {
    const s = spaceById(id);
    if (!s || this.folders[id]) return;
    const r = await exec("git", ["-C", s.folder || home(), "rev-parse", "--show-toplevel"], { on: s.machine ?? null }).catch(() => null);
    this.folders[id] = r?.code === 0 ? r.stdout.trim() : s.folder;
  }

  // The CLI a worker runs here, and the other one (an unset Reviewer and Backup use it).
  otherCli() {
    const worker = shepherdrFor(this.cfg, this.scope).worker?.agent ?? "claude";
    return otherCli(worker, this.data?.menus);
  }

  // The model buttons start from what applies in this scope. An unset role shows what runs: the
  // CLI's own defaults, and for the Reviewer the other CLI's (its button says "Other CLI").
  resetRoles() {
    const eff = shepherdrFor(this.cfg, this.scope);
    for (const r of ROLES) {
      let sel = eff[r.id] ?? null;
      const unset = !sel;
      if (!sel && r.id === "reviewer" && this.data?.menus?.[this.otherCli()]) {
        const o = this.otherCli();
        sel = { agent: o, model: this.data.menus[o].models[0]?.id ?? null, effort: null, fast: false, perm: this.data.permDefault?.[o] ?? null };
      }
      sel ??= this.data?.defaults ?? null;
      this.roles[r.id] = { ...(this.roles[r.id] ?? {}), sel: sel ? { ...sel } : null, data: this.data, saved: JSON.stringify(sel), unset };
    }
  }

  // A model button's choice changed (it changes coord.sel itself): write it to this scope.
  saveRoles(cx) {
    for (const r of ROLES) {
      const c = this.roles[r.id];
      if (!c?.sel) continue;
      const now = JSON.stringify(c.sel);
      if (now === c.saved) continue;
      c.saved = now;
      c.unset = false;
      this.set(r.id, null, { ...c.sel }, cx);
    }
  }

  // The notes' boxes show what applies in this scope.
  resetNotes() {
    const k = shepherdrFor(this.cfg, this.scope).tasks;
    for (const n of NOTES) {
      const note = this.notes[n.id];
      note.saved = k[`${n.id}_notes`] ?? "";
      note.box.set_value(note.saved);
    }
  }

  // Writes the notes changed since they were saved to `scope` (taken when called). Resolves with
  // the notes it wrote, when the last write is in the file.
  flushNotes(scope = this.scope) {
    const changed = NOTES.filter((n) => this.notes[n.id].box.value() !== this.notes[n.id].saved);
    if (!changed.length) return (this.writing ?? Promise.resolve()).then(() => []);
    const values = Object.fromEntries(changed.map((n) => [`${n.id}_notes`, (this.notes[n.id].saved = this.notes[n.id].box.value())]));
    this.writing = this.apply((next) => { const tg = this.target(next, scope); tg.tasks = { ...(tg.tasks ?? {}), ...values }; });
    return this.writing.then((ok) => (ok ? changed.map((n) => n.id) : []));
  }

  // Saves the notes, then "Saved" beside each one written, for two seconds.
  saveNotes(cx) {
    cx.spawn(async (cx) => {
      const ids = await this.flushNotes();
      const at = Date.now();
      for (const id of ids) this.notes[id].savedAt = at;
      cx.notify();
      if (ids.length) cx.timer.after(2100, (cx) => cx.notify());
    });
  }

  resetNote(id, cx) {
    cx.spawn(async (cx) => {
      await this.apply((next) => this.drop(this.layerOf(next), "tasks", `${id}_notes`));
      this.resetNotes();
      cx.notify();
    });
  }

  // Escape, a click beside the window, and Herdr's own close: a note typed a moment ago is
  // still saved.
  close() {
    const saving = Promise.all([this.flushNotes(), autopilotFlush(this)]);
    this.sec?.value.set_value("");
    closeOverlay(props().overlay);
    return saving;
  }

  // A text file in an editor over this window (mods/coordinator's instructions view); this
  // window and the layout stay as they are.
  edit(f) {
    openOverlay({ mod: "coordinator", kind: "dialog", width: 760, height: 0.8, props: { view: "instructions", file: f.file, role: f.id, title: f.title } });
  }

  // Pieces --------------------------------------------------------------------

  title(t, text) {
    return div().pb(6).text_size(TEXT.title).font_semibold().text_color(t.foreground).child(text);
  }

  // A small dim heading over a group of rows, in sentence case.
  heading(t, text) {
    return div().pt(22).pb(2).text_size(TEXT.label).font_medium().text_color(t.dim).child(text);
  }

  // One setting: its name and one line on the left, the control on the right, the scope line
  // (scoped(), or `under` as given) under the words, and `below` (a text box) under all of it.
  row(t, title, about, control, sc = null, below = null, under = null) {
    const line = under ?? (sc ? this.scopeLine(t, sc) : null);
    return v_flex().w_full().gap(10).py(12).border_b(1).border_color(t.border)
      .child(h_flex().w_full().gap(16).items_center()
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(TEXT.body).font_medium().text_color(t.foreground).child(title))
          .when(Boolean(about), (el) => el.child(typeof about === "string"
            ? div().text_size(TEXT.label).line_height("17px").text_color(t.dim).child(about) : about))
          .when(Boolean(line), (el) => el.child(line)))
        .when(Boolean(control), (el) => el.child(div().flex_none().child(control))))
      .when(Boolean(below), (el) => el.child(below));
  }

  // In a space: "Changed here · Reset" or "Same as everywhere". On Everywhere: "2 spaces use
  // their own", which opens the list of them (each opens its settings).
  scopeLine(t, sc) {
    const line = h_flex().gap(6).items_center().text_size(TEXT.label);
    if (this.scope) {
      return sc.mine
        ? line.child(div().text_color(t.muted).child(CHANGED_HERE)).child(div().text_color(t.dim).child("·"))
          .child(link(`reset-${sc.id}`, RESET, (_e, cx) => sc.reset(cx)))
        : line.child(div().text_color(t.dim).child(sc.from));
    }
    if (!sc.others?.length) return null;
    const open = this.listOpen === sc.id;
    const n = sc.others.length;
    return v_flex().gap(4)
      .child(line.child(link(`own-${sc.id}`, spacesOwn(n),
        () => { this.listOpen = open ? null : sc.id; })))
      .when(open, (el) => el.child(h_flex().flex_wrap().gap(12).children(sc.others.map((o) => spaceById(o.id)
        ? link(`own-${sc.id}-${o.id}`, o.name, (_e, cx) => this.pickScope(o.id, cx))
        : div().text_size(TEXT.label).text_color(t.dim).child(o.name)))));
  }

  stepper(t, id, value, onMinus, onPlus) {
    const b = (k, label, f) => div().id(`${id}-${k}`).w(H.sm).h_full().flex().items_center().justify_center().cursor_pointer()
      .text_size(TEXT.body).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(f).child(label);
    return h_flex().h(H.sm).items_center().rounded(RADIUS.control).border_1().border_color(t.input).bg(t.background).overflow_hidden()
      .child(b("minus", "−", onMinus))
      .child(div().min_w(48).px(6).text_size(TEXT.label).text_color(t.foreground).flex().justify_center().whitespace_nowrap().child(String(value)))
      .child(b("plus", "+", onPlus));
  }

  // Sections -------------------------------------------------------------

  // Notify (notify.js), as Shepherdr's: what reaches you from a space's Assistant. A space's own
  // is set in its settings or its sidebar menu.
  notify(t) {
    const sc = this.scope;
    const st = shared("notify") ?? {};
    const value = sc ? notifyOf(sc) : notifyEverywhere();
    const pick = (v) => (sc ? setNotify(sc, v) : setNotifyEverywhere(v));
    const mk = sc ? machineOfSpace(sc) : null;
    const facts = sc
      ? { id: "notify", mine: notifyOwn(sc), from: this.sameAs(notifyMachineOwn(mk) ? "machine" : "everywhere", mk),
          reset: (cx) => { setNotify(sc, null); cx.notify(); } }
      : { id: "notify", others: Object.entries(st.spaces ?? {}).filter(([, v]) => NOTIFY.includes(v))
          .map(([id]) => ({ id, name: spaceById(id)?.name ?? id })) };
    // Machines that set their own before machine scope went: still applied, shown with Reset.
    const ownMachines = sc ? [] : Object.entries(st.machines ?? {}).filter(([, v]) => NOTIFY.includes(v));
    return v_flex()
      .child(this.title(t, page("notify")))
      .child(this.row(t, page("notify"), NOTIFY_ABOUT,
        segmented("notify", NOTIFY.map((v) => [v, v]), value, (v) => pick(v)), facts))
      .children(ownMachines.map(([key, v]) => this.row(t, machineLabel(key), notifyMachineAbout(v),
        button(`notify-reset-${key}`, RESET, { kind: "plain", onClick: () => setNotifyMachine(key, null) }))));
  }

  agents(t, cx) {
    this.saveRoles(cx);
    return v_flex()
      .child(this.title(t, page("agents")))
      .children(ROLES.map((r) => this.roleRow(t, r, cx)))
      .child(this.backupRow(t));
  }

  // A role: its model button and, on Everywhere, "Edit instructions" (the same for every space).
  // An unset Reviewer's button says what runs: "Other CLI (Codex)".
  roleRow(t, r, cx) {
    const c = this.roles[r.id];
    const label = r.id === "reviewer" && c?.unset ? otherCliWords(this.otherCli()) : undefined;
    const control = h_flex().gap(8).items_center()
      .child(c?.sel ? models.modelButton(t, c, { label }, cx) : div().text_size(TEXT.label).text_color(t.dim).child(LOADING_AGENTS))
      .when(!this.scope && r.id === "reviewer" && c && !c.unset,
        (el) => el.child(button("reviewer-other", USE_OTHER_CLI, { kind: "plain", onClick: (_e, cx) => this.reset("reviewer", null, cx) })))
      .when(!this.scope, (el) => el.child(button(`edit-${r.id}`, EDIT_INSTRUCTIONS,
        { onClick: () => this.edit({ id: r.id, title: r.told, file: `${TEMPLATES()}/${r.file}` }) })));
    return this.row(t, r.title, r.about, control, this.scoped(r.id, null));
  }

  // Backup (herdr-task's takeover.py): the other CLI takes over a task, once, when its agent
  // can't go on. One switch: on is unset (the other CLI), off is "off". A value set before to a
  // named CLI still applies, and shows as on. A machine where the other CLI can't is one dim line.
  backupRow(t) {
    const chain = this.chain("backup", "agent");
    const value = chain.find((x) => x.value !== undefined)?.value ?? null;
    const on = value !== "off";
    const other = value && value !== "off" ? value : this.otherCli();
    // The machines this scope reaches (the check names this computer ""): all of them for Everywhere.
    const m = this.scope ? machineOfSpace(this.scope) : null;
    const problem = on ? backupProblem(this.clis, m, other) : "";
    const about = BACKUP.about;
    // Turning it on follows what it would get anyway when that is on, else names the other CLI.
    const flip = (_next, _e, cx) => {
      if (on) return this.set("backup", "agent", "off", cx);
      const inh = this.inherited("backup", "agent").value;
      this.set("backup", "agent", inh !== "off" ? inh : this.otherCli(), cx);
    };
    return this.row(t, BACKUP.title, problem ? v_flex().gap(2)
      .child(div().text_size(TEXT.label).line_height("17px").text_color(t.dim).child(about))
      .child(div().text_size(TEXT.label).line_height("17px").text_color(t.dim).child(problem)) : about,
      toggleSwitch("backup", on, flip), this.scoped("backup", "agent"));
  }

  tasks(t) {
    const k = shepherdrFor(this.cfg, this.scope).tasks;
    const step = (field, d, lo, hi) => (_e, cx) => this.set("tasks", field, Math.max(lo, Math.min(hi, (k[field] ?? 0) + d)), cx);
    const rounds = Math.max(0, parseInt(k.review_rounds, 10) || 0);
    // Archive Done after, in days ("off" and 0: never).
    const days = Math.max(0, parseInt(k.archive_after, 10) || 0);
    const autoOn = shepherdrFor(this.cfg, this.scope).automations.enabled !== false;
    const base = baseRow(this, t);
    return v_flex()
      .child(this.title(t, page("tasks")))
      .child(this.row(t, rowTitle("tasks.merge"), ABOUT["tasks.merge"],
        segmented("merge", MERGE, k.merge, (v, _e, cx) => this.set("tasks", "merge", v, cx)), this.scoped("tasks", "merge")))
      .child(this.row(t, rowTitle("tasks.review_rounds"), ABOUT["tasks.review_rounds"],
        segmented("rounds", withValue(ROUNDS, rounds, roundsWord), rounds, (v, _e, cx) => this.set("tasks", "review_rounds", v, cx)),
        this.scoped("tasks", "review_rounds")))
      .when(rounds > 0, (el) => el.child(this.row(t, rowTitle("tasks.must_fix"), ABOUT["tasks.must_fix"],
        segmented("mustfix", MUST_FIX, k.must_fix, (v, _e, cx) => this.set("tasks", "must_fix", v, cx)), this.scoped("tasks", "must_fix"))))
      // As Shepherdr's task agents: one artifact of real proof the Accept card links to. Only a
      // line in each brief's Settings block (herdr-task's Proof line); a task may turn it off.
      .child(this.row(t, rowTitle("tasks.proof"), ABOUT["tasks.proof"],
        toggleSwitch("proof", k.proof !== false, (next, _e, cx) => this.set("tasks", "proof", next, cx)), this.scoped("tasks", "proof")))
      .child(this.row(t, rowTitle("tasks.max_running"), ABOUT["tasks.max_running"],
        this.stepper(t, "running", k.max_running, step("max_running", -1, 1, 10), step("max_running", 1, 1, 10)),
        this.scoped("tasks", "max_running")))
      // Done tasks archive themselves after this many days (herdr-task's tick): out of every list
      // and count, still kept. 0 is Off.
      .child(this.row(t, rowTitle("tasks.archive_after"), ABOUT["tasks.archive_after"],
        segmented("archive", withValue(ARCHIVE, days, daysWord), days, (v, _e, cx) => this.set("tasks", "archive_after", v, cx)),
        this.scoped("tasks", "archive_after")))
      // Per repo (a space's scope is its repo): off, its tasks work in the folder itself, as in a
      // folder without git, and the Assistant queues tasks that touch the same files.
      .child(this.row(t, rowTitle("tasks.worktrees"), ABOUT["tasks.worktrees"],
        toggleSwitch("worktrees", k.worktrees !== false, (next, _e, cx) => this.set("tasks", "worktrees", next, cx)),
        this.scoped("tasks", "worktrees")))
      .when(Boolean(base), (el) => el.child(base))
      .child(this.row(t, rowTitle("automations.enabled"), ABOUT["automations.enabled"],
        toggleSwitch("auto", autoOn, (next, _e, cx) => this.set("automations", "enabled", next, cx)),
        this.scoped("automations", "enabled")))
      .children(NOTES.map((n) => this.noteRow(t, n)));
  }

  // A note: its title and what it's for, then the text box under them, as wide as the page.
  noteRow(t, n) {
    const note = this.notes[n.id];
    const sc = this.scoped("tasks", `${n.id}_notes`, (cx) => this.resetNote(n.id, cx));
    const saved = Date.now() - note.savedAt < 2000;
    const box = div().relative().w_full()
      .child(Textarea.new(note.box).w_full().px(10).py(8).rounded(RADIUS.control).border(1)
        .border_color(this.noteFocus === n.id ? t.accent : t.input).bg(t.background)
        .text_size(TEXT.body).line_height("19px").text_color(t.foreground))
      .when(!note.box.value(), (el) => el.child(div().absolute().top(9).left(11).right(11)
        .text_size(TEXT.body).line_height("19px").text_color(t.dim).child(n.example)));
    return this.row(t, n.title, n.about, saved ? div().text_size(TEXT.label).text_color(t.dim).child(SAVED) : null, sc, box);
  }

  // The window's top: in a space's own settings, which space, and the way to Everywhere's.
  banner(t) {
    const s = spaceById(this.scope);
    const where = machineLabel(machineOfSpace(this.scope));
    const folder = tilde(this.folders[this.scope] ?? s?.folder);
    return h_flex().w_full().mb(18).px(12).py(9).gap(12).items_center().rounded(RADIUS.card).bg(t.raised)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(TEXT.body).text_color(t.foreground).child(onlyFor(this.scopeName(), where)))
        .when(Boolean(folder), (el) => el.child(div().truncate().text_size(TEXT.label).text_color(t.dim).child(folder))))
      .child(button("to-everywhere", EVERYWHERE, { kind: "plain", onClick: (_e, cx) => this.pickScope(null, cx) }));
  }

  // One copy of Herdr's live lists for the whole render (live.js): past ~50 ms Herdr stops it.
  render(cx) {
    return inRender(() => this.draw(cx));
  }

  draw(cx) {
    const t = theme();
    const navRow = (id, title, icon, on, onClick) => h_flex().id(`sh-s-${id}`).h(30).gap(10).px(10).flex_none()
      .items_center().rounded(RADIUS.card).bg(on ? t.raised : "#00000000")
      .when(!on, (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)))
      .on_click(onClick)
      .child(svg(icon).size(15).text_color(on ? t.accent : t.dim))
      .child(div().flex_1().text_size(TEXT.body).text_color(on ? t.foreground : t.muted).child(title));
    const nav = v_flex().flex_none().w(190).h_full().p(10).gap(2).border_r(1).border_color(t.border)
      .child(div().px(10).pt(6).pb(12).text_size(TEXT.title).font_semibold().text_color(t.foreground)
        .child(this.scope ? SPACE_TITLE : TITLE))
      .children(SECTIONS.filter((s) => this.shows(s.id)).map((s) => navRow(s.id, s.title, I(s.icon), s.id === this.section, (_e, cx) => {
        this.section = s.id;
        this.listOpen = null;
        this.handle.focus();
        cx.notify();
      })));
    const body = this.section === "agents" ? this.agents(t, cx)
      : this.section === "tasks" ? this.tasks(t)
      : this.section === "secrets" ? secretsSection(this, t)
      : this.section === "window" ? layoutSection(this, t)
      : this.section === "web" ? webSection(this, t)
      : this.section === "notify" ? this.notify(t)
      : this.section === "autopilot" ? autopilotSection(this, t, cx)
      : machinesSection(this, t, cx);
    const card = h_flex().id("shepherdr-settings").track_focus(this.handle).w_full().h_full().max_h(900).min_h(0).items_start()
      .rounded(12).border_1().border_color(t.border).bg(t.popover).shadow_lg().overflow_hidden()
      // A click inside stays inside: only one beside the window closes it.
      .on_click((_e, cx) => cx.stop_propagation())
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.sec?.open) { this.sec.open = false; cx.stop_propagation(); cx.notify(); }
        else this.close();
      })
      .child(nav)
      .child(div().relative().flex_1().min_w(0).h_full()
        .child(div().id("sh-body").size_full().overflow_y_scroll()
          .child(div().px(28).py(22)
            .when(Boolean(this.scope), (el) => el.child(this.banner(t)))
            .child(body)))
        .child(Scrollbar.vertical("sh-body").absolute().inset_0()));
    return div().id("sh-root").size_full().flex().items_center().justify_center().on_click(() => this.close()).child(card);
  }
}
