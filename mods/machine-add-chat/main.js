// Add a machine: the hosts in ~/.ssh/config to pick from (or type one),
// each added with one click (`hc machine add`). When the machine needs
// something first (herdr-core installed there, a password, a new host
// key), the same command opens in a small terminal window where you answer
// it; the list sees the machine once it's added. Opened as a dialog
// (`mod.open machine-add-chat`); the sidebar's Add machine opens it.
// Ours (cloned from Herdr's machine-add): one name ("Add machine"), one solid primary (the typed
// host's Add), a neutral card for a Mac, and hover only on rows a click still adds.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { hc, exec, home, readTextFile, theme, props, closeOverlay, openOverlay } from "herdr";
import { button, TEXT, RADIUS, H, red, green } from "./ui.js";

// The words, the ssh config's hosts and when an add needs a terminal: core/machine-add.js, shared with
// the web app's Add machine.
import { WORDS as W, parseConfig, hostSub, failure, needsTerminal, isAdded, terminalName, command, MAC_CHECK, MAC_SETTING } from "./core/machine-add.js";

const I = (name) => `mods/workspace-chrome/${name}.svg`;

export default class MachineAdd extends View {
  init(_props, cx) {
    this.hosts = null;
    this.added = [];
    this.state = {}; // target -> "adding" | "terminal" | "manual" (no terminal opened) | error text
    this.typed = "";
    this.input = InputState.new({ placeholder: W.placeholder });
    this.input.on("change", (_e, cx) => { this.typed = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => this.add(this.typed, cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    if (props()?.part !== "bar") {
      this.input.focus();
      cx.timer.after(600, () => this.input.focus());
    }
    this.macs = {}; // target -> { name, core } for an added Mac
    this.opened = {};
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      this.hosts = parseConfig(await readTextFile(`${home()}/.ssh/config`).catch(() => null));
      await this.refresh();
      cx.notify();
    });
    // While a terminal finishes an add, the list catches up.
    cx.timer.every(3000, (cx) => {
      if (!Object.values(this.state).includes("terminal")) return;
      cx.spawn(async (cx) => {
        await this.refresh();
        cx.notify();
      });
    });
  }

  async refresh() {
    const r = await hc(["machine", "ls", "--json"]).catch(() => null);
    try {
      this.added = r?.code === 0 ? (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary) : [];
    } catch {
      this.added = [];
    }
    for (const m of this.added) {
      if (this.state[m.target] !== "terminal") continue;
      delete this.state[m.target];
      await this.checkMac(m.target);
    }
  }

  isAdded(target) {
    return isAdded(this.added, target);
  }

  add(target, cx) {
    target = target.trim();
    if (!target || this.state[target] === "adding") return;
    this.state[target] = "adding";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "add", target, "--json"]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
      const why = failure(r);
      if (!why) {
        delete this.state[target];
        this.input.set_value("");
        this.typed = "";
        await this.refresh();
        await this.checkMac(target);
      } else if (needsTerminal(why)) {
        this.state[target] = "terminal";
        await this.inTerminal(target);
      } else this.state[target] = why.message || W.failed;
      await this.refresh();
      cx.notify();
    });
  }

  // macOS asks on its own screen before anything reads Desktop, Documents
  // or Downloads, and the asking program waits: say so once, with the way
  // to allow it for good.
  async checkMac(target) {
    const m = this.added.find((x) => x.target === target || x.name === target);
    if (!m) return;
    const r = await exec("sh", ["-c", MAC_CHECK], { on: m.name }).catch(() => null);
    const [os, core] = (r?.stdout ?? "").trim().split("\n");
    if (os === "Darwin") this.macs[target] = { name: m.name, core: core ?? "~/.local/bin/herdr-core" };
  }

  // A neutral note (not an error): what the Mac will ask, and the way to allow it for good.
  macCard(t, target) {
    const mac = this.macs[target];
    return v_flex().mx(10).mb(8).p(12).gap(8).rounded(RADIUS.card).bg(t.raised).border_1().border_color(t.border)
      .child(div().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(W.macTitle(mac.name)))
      .child(div().text_size(TEXT.label).line_height("18px").text_color(t.muted)
        .child(W.macAbout))
      .child(div().px(8).py(4).rounded(RADIUS.control).bg(t.background).border_1().border_color(t.border).text_size(TEXT.label).text_color(t.foreground).child(mac.core))
      .child(h_flex().gap(8).items_center()
        .child(button(`ma-mac-${target}`, W.macOpen(mac.name), { onClick: () => {
          exec("open", [MAC_SETTING], { on: mac.name }).catch(() => null);
          this.opened[target] = true;
        } }))
        .when(Boolean(this.opened[target]), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim).child(W.macOpened))));
  }

  // The same add in a terminal, for what only the person can answer.
  async inTerminal(target) {
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--name", terminalName(target), "--", "hc", "machine", "add", target]).catch(() => null);
    let address = null;
    try {
      address = r?.code === 0 ? JSON.parse(r.stdout).address : null;
    } catch {}
    if (!address) {
      this.state[target] = "manual";
      return;
    }
    openOverlay({
      kind: "dialog",
      key: `machine-add-${target}`,
      width: 640,
      height: 300,
      layout: {
        type: "column",
        children: [
          { type: "block", size: { px: 30 }, content: { mod: "machine-add-chat", props: { part: "bar", target } } },
          { type: "block", content: { terminal: address } },
        ],
      },
    });
  }

  // What a host's state says under it: an error in red, or, when no terminal could open, a
  // plain sentence and the command to run behind a Copy button. Nothing while it works.
  note(t, target, pad) {
    const st = this.state[target];
    if (st === "manual") {
      const copied = this.copied === target;
      return h_flex().pl(pad).pb(6).gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(TEXT.label).line_height("17px").text_color(t.muted)
          .child(W.manual))
        .child(button(`ma-copy-${target}`, copied ? W.copied : W.copy, { icon: `mods/chat/${copied ? "check" : "copy"}.svg`,
          onClick: (_e, cx) => { cx.write_to_clipboard(command(target)); this.copied = target; } }));
    }
    if (typeof st !== "string" || ["adding", "terminal"].includes(st)) return null;
    return div().pl(pad).pb(6).text_size(TEXT.label).text_color(red()).child(st);
  }

  close() {
    closeOverlay(props().overlay);
  }

  key(e, cx) {
    if (e.key === "escape") { this.close(); cx.stop_propagation(); }
  }

  // The terminal window's title bar.
  bar(t) {
    return h_flex()
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12.5)
      .text_color(t.muted)
      .child(svg(I("server")).size(14))
      .child(div().flex_1().child(W.bar(props().target)))
      .child(
        div()
          .id("ma-bar-close")
          .w(22)
          .h(22)
          .rounded(6)
          .flex()
          .items_center()
          .justify_center()
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click(() => closeOverlay(props().overlay))
          .child(svg(I("x")).size(12)),
      );
  }

  row(t, target, label, sub) {
    const st = this.state[target];
    const done = this.isAdded(target);
    const right = done
      ? h_flex().gap(5).items_center().text_size(TEXT.label).text_color(green()).child(svg(I("circle-check")).size(14)).child(W.added)
      : st === "adding"
        ? h_flex().gap(6).items_center().text_size(TEXT.label).text_color(t.muted).child(svg(I("spinner")).size(14).text_color(t.working).spin(900)).child(W.connecting)
        : st === "terminal"
          ? div().text_size(TEXT.label).text_color(t.muted).child(W.waiting)
          : button(`ma-add-${target}`, W.add, { onClick: (_e, cx) => this.add(target, cx) });
    const idle = !done && !st;
    return v_flex()
      .flex_none()
      .child(
        h_flex()
          .id(`ma-row-${target}`)
          .h(40)
          .px(10)
          .gap(10)
          .items_center()
          .rounded(RADIUS.card)
          .when(idle, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.add(target, cx)))
          .child(svg(I("server")).size(15).text_color(t.muted))
          .child(div().flex_none().text_size(13).text_color(t.foreground).child(label))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(sub ?? ""))
          .child(right),
      )
      .when(Boolean(this.note(t, target, 35)), (el) => el.child(this.note(t, target, 35).pr(10)))
      .when(Boolean(this.macs[target]), (el) => el.child(this.macCard(t, target)));
  }

  render() {
    const t = theme();
    if (props()?.part === "bar") return this.bar(t);
    const hosts = this.hosts ?? [];
    return v_flex()
      .id("machine-add")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .min_h(0)
      .p(18)
      .bg(t.popover)
      .text_color(t.foreground)
      .child(div().text_size(TEXT.title).font_semibold().child(W.title))
      .child(
        div()
          .pt(6)
          .text_size(TEXT.body)
          .line_height("19px")
          .text_color(t.muted)
          .child(W.about),
      )
      .child(div().pt(16).pb(6).text_size(TEXT.label).font_medium().text_color(t.dim).child(hosts.length ? W.fromConfig : W.noHosts))
      .child(
        v_flex()
          .id("ma-hosts")
          .max_h(280)
          .min_h(0)
          .flex_shrink(1)
          .overflow_y_scroll()
          .children(
            this.hosts === null
              ? [div().px(10).py(8).text_size(TEXT.label).text_color(t.dim).child(W.reading)]
              : hosts.map((h) => this.row(t, h.alias, h.alias, hostSub(h))),
          ),
      )
      .child(div().pt(14).pb(6).text_size(TEXT.label).font_medium().text_color(t.dim).child(W.orType))
      .child(
        h_flex()
          .gap(8)
          .child(
            Input.new(this.input)
              .flex_1()
              .h(H.lg)
              .px(10)
              .gap(6)
              .items_center()
              .rounded(RADIUS.control)
              .border_1()
              .border_color(this.inputFocused ? t.accent : t.input)
              .bg(t.background)
              .text_size(TEXT.body)
              .text_color(t.foreground),
          )
          // The dialog's one primary.
          .child(button("ma-add-typed", W.add, { kind: "primary", size: "lg", disabled: !this.typed.trim(), onClick: (_e, cx) => this.add(this.typed, cx) })),
      )
      .when(Boolean(this.typed.trim() && this.note(t, this.typed.trim(), 0)), (el) => el.child(this.note(t, this.typed.trim(), 0).pt(6)));
  }
}
