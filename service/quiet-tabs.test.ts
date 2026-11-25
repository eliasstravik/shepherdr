// #1468: a page gets the snapshot whole once, then only what changed; a page off screen gets only the count of what
// needs the person until it shows again, then catches up in one patch.
import { expect, test } from "bun:test";
import { Live } from "./live.ts";
import { apply } from "../web/shared/patch.ts";

const live = () => new Live({ on() {} } as any, { on() {}, load: async () => ({}) } as any, () => null, "0");
const page = () => {
  const got: any[] = [];
  return { got, ws: { readyState: 1, data: { who: "x" }, send: (t: string) => got.push(JSON.parse(t)), getBufferedAmount: () => 0 } as any };
};
const snap = (n: number, status = "work") => ({ name: "demo", places: [{ id: "p1", chat: "p:p1" }],
  tasks: Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, status: i === 0 ? status : "work", said: i === 1 ? `step ${n}` : "", prompt: "x".repeat(1000) })) });
const watch = (l: Live, ws: any, visible: boolean) => l.message(ws, JSON.stringify({ type: "watch", chats: [], visible }));

test("a page on screen gets the snapshot once, then patches that build it", () => {
  const l = live(), p = page();
  l.setSnapshot(snap(0));
  l.join(p.ws);
  watch(l, p.ws, true);
  for (let n = 1; n <= 5; n++) l.setSnapshot(snap(n));
  const types = p.got.map((m) => m.type).filter((t) => t === "snapshot" || t === "patch");
  expect(types).toEqual(["snapshot", "patch", "patch", "patch", "patch", "patch"]);
  let have = p.got.find((m) => m.type === "snapshot").snapshot;
  for (const m of p.got.filter((m) => m.type === "patch")) have = apply(have, m.patch);
  expect(have).toEqual(snap(5));
  // each patch is the changed task, not the list
  const sizes = p.got.filter((m) => m.type === "patch").map((m) => JSON.stringify(m).length);
  expect(Math.max(...sizes)).toBeLessThan(JSON.stringify(snap(5)).length / 50);
});

test("off screen: only the needs count when it changes; back on screen: one patch to now", () => {
  const l = live(), p = page();
  l.setSnapshot(snap(0));
  l.join(p.ws);
  watch(l, p.ws, false);
  p.got.length = 0;
  for (let n = 1; n <= 20; n++) l.setSnapshot(snap(n));
  expect(p.got).toEqual([]);
  l.setSnapshot(snap(21, "ready"));
  expect(p.got).toEqual([{ type: "needs", n: 1 }]);
  l.setSnapshot(snap(22, "ready"));
  expect(p.got.length).toBe(1);
  p.got.length = 0;
  watch(l, p.ws, true);
  expect(p.got.map((m) => m.type)).toEqual(["patch"]);
  expect(apply(snap(0), p.got[0].patch)).toEqual(snap(22, "ready"));
});

test("a page that can't apply a patch asks again and gets the snapshot whole", () => {
  const l = live(), p = page();
  l.setSnapshot(snap(0));
  l.join(p.ws);
  p.got.length = 0;
  l.message(p.ws, JSON.stringify({ type: "resync" }));
  expect(p.got.map((m) => m.type)).toEqual(["snapshot"]);
});
