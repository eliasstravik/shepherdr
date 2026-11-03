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

const I = (name) => `mods/workspace-chrome/${name}.svg`;

// Host entries people can pick: named ones, not patterns.
function parseConfig(text) {
  const hosts = [];
  let cur = null;
  for (const raw of (text ?? "").split("\n")) {
    const m = raw.trim().match(/^([^\s#=]+)\s*=?\s*(.*)$/);
    if (!m) continue;
    const [key, value] = [m[1].toLowerCase(), m[2].trim()];
    if (key === "host" || key === "match") {
      const names = key === "host" ? value.split(/\s+/).filter((h) => h && !/[*?!]/.test(h)) : [];
      cur = names.length ? { alias: names[0], aliases: names.slice(1), hostname: null, user: null } : null;
      if (cur) hosts.push(cur);
    } else if (cur && key === "hostname") cur.hostname = value;
    else if (cur && key === "user") cur.user = value;
  }
  return hosts;
}

export default class MachineAdd extends View {
  init(_props, cx) {
    this.hosts = null;
    this.added = [];
    this.state = {}; // target -> "adding" | "terminal" | "manual" (no terminal opened) | error text
    this.typed = "";
    this.input = InputState.new({ placeholder: "user@host" });
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
    return this.added.some((m) => m.target === target || m.name === target || m.host === target);
  }

  add(target, cx) {
    target = target.trim();
    if (!target || this.state[target] === "adding") return;
    this.state[target] = "adding";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["machine", "add", target, "--json"]).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
      let why = null;
      try {
        why = r.code === 0 ? null : (JSON.parse(r.stdout || r.stderr).error ?? { message: (r.stderr || r.stdout).trim() });
      } catch {
        why = { message: (r.stderr || r.stdout || "It didn't answer.").trim() };
      }
      if (!why) {
        delete this.state[target];
        this.input.set_value("");
        this.typed = "";
        await this.refresh();
        await this.checkMac(target);
      } else if (["hc_missing", "incompatible", "login_needed", "auth_failed", "host_key"].includes(why.kind) || /password|passphrase|host key|permission denied|login/i.test(why.message ?? "")) {
        this.state[target] = "terminal";
        await this.inTerminal(target);
      } else this.state[target] = why.message || "It didn't work.";
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
    const r = await exec("sh", ["-c", 'uname; command -v herdr-core || echo "$HOME/.local/bin/herdr-core"'], { on: m.name }).catch(() => null);
    const [os, core] = (r?.stdout ?? "").trim().split("\n");
    if (os === "Darwin") this.macs[target] = { name: m.name, core: core ?? "~/.local/bin/herdr-core" };
  }

  // A neutral note (not an error): what the Mac will ask, and the way to allow it for good.
  macCard(t, target) {
    const mac = this.macs[target];
    return v_flex().mx(10).mb(8).p(12).gap(8).rounded(RADIUS.card).bg(t.raised).border_1().border_color(t.border)
      .child(div().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(`${mac.name} is a Mac: allow its folders once`))
      .child(div().text_size(TEXT.label).line_height("18px").text_color(t.muted)
        .child("macOS asks on the Mac's own screen before an agent reads Desktop, Documents or Downloads, and waits until someone answers. Give herdr-core Full Disk Access there and it never asks again: in the list, press + and pick this file:"))
      .child(div().px(8).py(4).rounded(RADIUS.control).bg(t.background).border_1().border_color(t.border).text_size(TEXT.label).text_color(t.foreground).child(mac.core))
      .child(h_flex().gap(8).items_center()
        .child(button(`ma-mac-${target}`, `Open the setting on ${mac.name}`, { onClick: () => {
          exec("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"], { on: mac.name }).catch(() => null);
          this.opened[target] = true;
        } }))
        .when(Boolean(this.opened[target]), (el) => el.child(div().text_size(TEXT.label).text_color(t.dim).child("It's open on the Mac's screen."))));
  }

  // The same add in a terminal, for what only the person can answer.
  async inTerminal(target) {
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--name", `add-${target.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`.slice(0, 32), "--", "hc", "machine", "add", target]).catch(() => null);
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
          .child("Herdr couldn't open a terminal for this. Copy the command, then run it in any terminal."))
        .child(button(`ma-copy-${target}`, copied ? "Copied" : "Copy command", { icon: `mods/chat/${copied ? "check" : "copy"}.svg`,
          onClick: (_e, cx) => { cx.write_to_clipboard(`hc machine add ${target}`); this.copied = target; } }));
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
      .child(div().flex_1().child(`Adding ${props().target}: answer it here`))
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
      ? h_flex().gap(5).items_center().text_size(TEXT.label).text_color(green()).child(svg(I("circle-check")).size(14)).child("Added")
      : st === "adding"
        ? h_flex().gap(6).items_center().text_size(TEXT.label).text_color(t.muted).child(svg(I("spinner")).size(14).text_color(t.working).spin(900)).child("Connecting")
        : st === "terminal"
          ? div().text_size(TEXT.label).text_color(t.muted).child("Waiting in its terminal")
          : button(`ma-add-${target}`, "Add", { onClick: (_e, cx) => this.add(target, cx) });
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
      .child(div().text_size(TEXT.title).font_semibold().child("Add machine"))
      .child(
        div()
          .pt(6)
          .text_size(TEXT.body)
          .line_height("19px")
          .text_color(t.muted)
          .child("A VPS, a Mac mini, a box at home: Herdr reaches it over ssh, and agents there keep running while your laptop sleeps."),
      )
      .child(div().pt(16).pb(6).text_size(TEXT.label).font_medium().text_color(t.dim).child(hosts.length ? "From your ssh config" : "Your ssh config lists no hosts"))
      .child(
        v_flex()
          .id("ma-hosts")
          .max_h(280)
          .min_h(0)
          .flex_shrink(1)
          .overflow_y_scroll()
          .children(
            this.hosts === null
              ? [div().px(10).py(8).text_size(TEXT.label).text_color(t.dim).child("Reading your ssh config\u2026")]
              : hosts.map((h) => this.row(t, h.alias, h.alias, [h.user, h.hostname].filter(Boolean).join("@") || (h.aliases.length ? `also ${h.aliases.join(", ")}` : ""))),
          ),
      )
      .child(div().pt(14).pb(6).text_size(TEXT.label).font_medium().text_color(t.dim).child("Or type how ssh reaches it"))
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
          .child(button("ma-add-typed", "Add", { kind: "primary", size: "lg", disabled: !this.typed.trim(), onClick: (_e, cx) => this.add(this.typed, cx) })),
      )
      .when(Boolean(this.typed.trim() && this.note(t, this.typed.trim(), 0)), (el) => el.child(this.note(t, this.typed.trim(), 0).pt(6)));
  }
}
