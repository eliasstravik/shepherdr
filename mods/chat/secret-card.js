// The card for a secret an agent asked for (herdr-secret ask NAME --why …: a label on its
// terminal, secrets.js asksOf()): "Secret: NAME", the reason, a masked box, where to keep it
// (its space, its machine, Everywhere; the most specific first), Save and Decline. Save writes
// the vault here directly (secrets.js keep()); the agent is told by name only. The value never
// goes through hc send, the conversation, a log or an artifact. For a few seconds after, the
// card says "Kept: NAME". Shown in the agent's own chat where it asked, and in its Assistant's
// chat for a task's worker (main.js workerAsks()), as strips of the timeline (strips.js).

import { InputState } from "gpui-base";
import * as secrets from "./secrets.js";
import { terminals } from "./live.js";
import { headStrip } from "./cards.js";
import { green } from "./ui.js";

const KEPT_FOR = 6000;
const key = (address, name) => `${address}|${name}`;

export class SecretCards {
  constructor() {
    // Per ask: { box, level (scope key), err, busy }; and asks kept a moment ago: { name, why, where, at }.
    this.states = new Map();
    this.kept = new Map();
    // Told when an ask is kept or declined here: (ask, how), for its quiet line (main.js).
    this.onEnd = null;
  }

  // What to show for a terminal: its asks, then those just kept.
  items(address) {
    const now = Date.now(), out = secrets.asksOf(address, terminals()).map((a) => ({ address, ...a }));
    for (const [k, v] of this.kept) {
      if (now - v.at > KEPT_FOR) { this.kept.delete(k); continue; }
      if (v.address === address && !out.some((a) => a.name === v.name)) out.push({ address, name: v.name, why: v.why, kept: v.where });
    }
    return out;
  }

  // From render: boxes for asks that have none yet (made right after, never in render), and
  // those of asks gone let go.
  prepare(list, cx) {
    const want = new Set(list.filter((a) => !a.kept).map((a) => key(a.address, a.name)));
    for (const [k, st] of this.states) if (!want.has(k) && !st.busy) { st.box?.release(); this.states.delete(k); }
    const missing = [...want].filter((k) => !this.states.has(k));
    for (const k of missing) this.states.set(k, { box: null, level: null, err: "", busy: false });
    if (missing.length) cx.timer.after(0, (cx) => {
      for (const k of missing) {
        const st = this.states.get(k);
        if (!st || st.box) continue;
        st.box = InputState.new({ placeholder: "Paste the value" });
        st.box.set_masked(true);
        st.box.on("change", (_e, cx) => { st.err = ""; cx.notify(); });
        st.box.on("submit", (_e, cx) => { const [address, name] = k.split("|"); this.save({ address, name }, cx); });
      }
      cx.notify();
    });
    if (this.kept.size && !this.keptTimer) {
      this.keptTimer = true;
      cx.timer.after(KEPT_FOR + 50, (cx) => { this.keptTimer = false; cx.notify(); });
    }
  }

  save(ask, cx) {
    const st = this.states.get(key(ask.address, ask.name));
    const value = st?.box?.value() ?? "";
    if (!st || st.busy) return;
    if (!value) { st.err = "Paste the value first."; cx.notify(); return; }
    const lv = this.level(ask, st);
    st.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await secrets.keep(ask.name, lv, value);
        st.box?.set_value("");
        this.kept.set(key(ask.address, ask.name), { address: ask.address, name: ask.name, why: ask.why, where: lv.label, at: Date.now() });
        this.onEnd?.(ask, `Kept for ${lv.label}`);
      } catch (e) { st.err = String(e?.message ?? e); }
      st.busy = false;
      cx.notify();
    });
  }

  // Whether an ask's masked box is made yet; focus() puts the keyboard in it.
  ready(ask) {
    return Boolean(this.states.get(key(ask.address, ask.name))?.box);
  }

  focus(ask) {
    this.states.get(key(ask.address, ask.name))?.box?.focus();
  }

  decline(ask, cx) {
    const st = this.states.get(key(ask.address, ask.name));
    if (st) st.busy = true;
    cx.spawn(async (cx) => { await secrets.decline(ask.address, ask.name); if (st) st.busy = false; this.onEnd?.(ask, "Declined"); cx.notify(); });
  }

  level(ask, st) {
    const lv = secrets.levels(ask.address);
    return lv.find((l) => secrets.scopeKey(l) === st?.level) ?? lv[0];
  }

  // The card's strips. opts: { who (whose ask: "Claude", "HERD-12"), links ([ctl] at the
  // header's right) }.
  strips(ask, opts = {}) {
    const id = `${ask.address}-${ask.name}`.replace(/[^\w-]/g, "_");
    const st = this.states.get(key(ask.address, ask.name));
    if (ask.kept) return [headStrip({ who: "Kept", asks: false, dot: green(), links: opts.links }),
      { key: "title", kind: "title", text: `Secret: ${ask.name}` },
      { key: "kept", kind: "text", tone: "dim", text: `For ${ask.kept}. The agent was told its name, never the value.` }];
    const lv = secrets.levels(ask.address), cur = this.level(ask, st);
    const has = Boolean(st?.box?.value());
    const out = [headStrip({ who: opts.who, links: opts.links }), { key: "title", kind: "title", text: `Secret: ${ask.name}` }];
    if (ask.why) out.push({ key: "why", kind: "text", tone: "muted", text: ask.why });
    out.push({ key: "box", kind: "input", state: st?.box ?? null, placeholder: "Paste the value", focus: () => st?.box?.focus() });
    if (lv.length > 1) out.push({ key: "for", kind: "controls", align: "start", lead: "For", ctls: lv.map((l) => ({ id: `slevel-${id}-${l.scope}`, label: l.label, look: "pill",
      on: secrets.scopeKey(l) === secrets.scopeKey(cur), fn: () => { if (st) st.level = secrets.scopeKey(l); } })) });
    out.push({ key: "note", kind: "text", tone: st?.err ? "red" : "dim", text: st?.err || "Agents use it by name, never seeing it." });
    const live = has && !st?.busy;
    out.push({ key: "actions", kind: "controls", align: "end", ctls: [
      { id: `sdecline-${id}`, label: "Decline", look: "plain", fn: (cx) => this.decline(ask, cx) },
      { id: `ssave-${id}`, label: st?.busy ? "Saving…" : "Save", look: "primary", disabled: !live, fn: live ? (cx) => this.save(ask, cx) : null }] });
    return out;
  }
}
