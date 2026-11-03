// A machine's details (HERD-40), as Shepherdr's health and plan-limits popovers: opened from the
// meter on its header in the sidebar, this mod as a popup with props { view: "machine", machine }.
// Its CPU, memory and disk, then what is left of each agent CLI's plan there (machines.js), read
// again on opening when more than a minute old. Its header says how fresh it is ("Updated 2 min
// ago"); its last row, Machine settings, opens Settings > Machines.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, openOverlay, theme } from "herdr";
import { openSettings, TEXT, RADIUS } from "./ui.js";
import { machineDetails, pollNow, statsOf, span } from "./machines.js";
import { machineLook } from "./sections.js";

export const MACHINE_POPUP = { width: 320, height: 480 };
const HEAD = 46, FOOT = 40;

// Under the meter (its rect from rectOf), its right edge at the meter's.
export function openMachine(machine, r) {
  const at = r ? { x: Math.max(8, r.x + r.width - MACHINE_POPUP.width), y: r.y + r.height + 4 } : "pointer";
  openOverlay({ mod: "spaces-chat", kind: "popup", ...MACHINE_POPUP, at, props: { view: "machine", machine: machine ?? null } });
}

export function openMachineSettings() {
  openSettings({ section: "machines" });
}

export class MachinePopup {
  init(cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    const m = props().machine ?? null;
    const s = statsOf(m);
    this.reading = !s?.limitsAt || Date.now() - s.limitsAt > 60000;
    if (this.reading) cx.spawn(async (cx) => { await pollNow({ limitsOlder: 60000, only: m }); this.reading = false; cx.notify(); });
  }

  render() {
    const t = theme();
    const p = props();
    const m = p.machine ?? null;
    const look = machineLook(m);
    const at = statsOf(m)?.at;
    const fresh = this.reading ? "Updating\u2026" : at ? (Date.now() - at < 60000 ? "Updated just now" : `Updated ${span(Date.now() - at)} ago`) : "";
    return v_flex().id("machine-popup").track_focus(this.handle).size_full().min_h(0).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().h(HEAD).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(16).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(TEXT.body).font_semibold().text_color(t.foreground).child(look.name))
        .child(div().flex_none().text_size(TEXT.label).text_color(t.dim).child(fresh)))
      // A popup is as tall as what it draws: the body gets the rest of its height, and scrolls.
      .child(div().id("machine-popup-body").w_full().h(MACHINE_POPUP.height - HEAD - FOOT).flex_none().overflow_y_scrollbar().mode("always")
        .child(div().px(14).py(12).child(machineDetails(t, m))))
      .child(h_flex().id("machine-popup-settings").flex_none().h(FOOT - 8).mx(6).mb(6).px(8).gap(8).rounded(RADIUS.control).items_center().cursor_pointer()
        .text_size(TEXT.body).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => { closeOverlay(p.overlay); openMachineSettings(); })
        .child(svg("mods/workspace-chrome/settings.svg").size(16).flex_none())
        .child(div().flex_1().child("Machine settings"))
        .child(svg("mods/workspace-chrome/chevron-right.svg").size(12)));
  }
}
