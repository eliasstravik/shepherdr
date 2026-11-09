// herdr-artifact open (SHEP-99): an agent's herdr.show label, here or on another machine, opens the artifact on the
// page the person used last that's on screen; an ask set before the service started, or seen once, never shows again.
import { expect, test } from "bun:test";
import { Shows, showAsk, windowArgs, SHOW, SHOW_FRESH } from "./show.ts";
import { Live } from "./live.ts";

const NOW = 1_800_000_000_000;
const term = (address: string, ask: unknown) => ({ address, labels: { [SHOW]: JSON.stringify(ask) } });

test("an ask reads from the label; anything else is none", () => {
  expect(showAsk(term("vm/t3", { id: "a1", at: NOW, artifact: "how-to-group-tasks-fa0a" }))).toEqual({ id: "a1", at: NOW, artifact: "how-to-group-tasks-fa0a", machine: "vm" });
  expect(showAsk(term("t3", { id: "a1", at: NOW, artifact: "x-1" }))?.machine).toBeNull();
  expect(showAsk({ labels: { [SHOW]: "not json" } })).toBeNull();
  expect(showAsk({ labels: {} })).toBeNull();
  expect(showAsk(term("t1", { id: "a2", at: NOW, artifact: "../etc" }))).toBeNull();
});

test("each new, fresh ask once; one already set at start never", () => {
  const s = new Shows(() => NOW);
  const old = term("t1", { id: "old", at: NOW - 1000, artifact: "x-1" });
  expect(s.take([old])).toEqual([]);
  const next = term("vm/t3", { id: "n1", at: NOW, artifact: "y-2" });
  expect(s.take([old, next]).map((a) => a.artifact)).toEqual(["y-2"]);
  expect(s.take([old, next])).toEqual([]);
  expect(s.take([term("t4", { id: "late", at: NOW - SHOW_FRESH - 1, artifact: "z-3" })])).toEqual([]);
});

function page(seen: number, visible = true) {
  const sent: string[] = [];
  return { sent, ws: { readyState: 1, data: { who: "x", seen, visible }, send: (t: string) => sent.push(t), getBufferedAmount: () => 0 } as any };
}

test("the page on screen the person used last opens it", () => {
  const live = new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
  const laptop = page(NOW - 60_000), phone = page(NOW), hidden = page(NOW + 1000, false);
  for (const p of [laptop, phone, hidden]) (live as any).pages.add(p.ws);
  expect(live.show("how-to-group-tasks-fa0a")).toBe(true);
  expect(phone.sent.map((t) => JSON.parse(t))).toEqual([{ type: "show", artifact: "how-to-group-tasks-fa0a" }]);
  expect(laptop.sent).toEqual([]);
  expect(hidden.sent).toEqual([]);
});

test("no page on screen: nothing to show it on", () => {
  const live = new Live({ on() {} } as any, { on() {} } as any, () => null, "0");
  (live as any).pages.add(page(NOW, false).ws);
  expect(live.show("x-1")).toBe(false);
});

test("no page on screen, another machine's ask: this window opens it from there, in a tab", () => {
  expect(windowArgs({ id: "a1", at: NOW, artifact: "how-to-group-tasks-fa0a", machine: "vm" })).toEqual(["open", "how-to-group-tasks-fa0a", "--from", "vm", "--tab", "--json"]);
});
