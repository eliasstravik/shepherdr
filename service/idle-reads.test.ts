// #1325: with no page open, what only pages show isn't read every few seconds (each read starts processes on a
// linked machine); the first page to open reads it again at once.
import { expect, test } from "bun:test";
import { Live, readDue, IDLE_READ_MS } from "./live.ts";
import { Artifacts } from "./artifacts.ts";

test("a read is due always while a page is open, else once every two minutes", () => {
  expect(readDue(true, Date.now())).toBe(true);
  expect(readDue(false, 1_000, 1_000 + 10_000)).toBe(false);
  expect(readDue(false, 1_000, 1_000 + IDLE_READ_MS)).toBe(true);
  expect(readDue(false, 0)).toBe(true);           // never read yet
});

test("Live says whether a page is open and tells when the first one opens", () => {
  const live = new Live({ on: () => {} } as any, { on: () => {}, load: async () => ({}) } as any, () => null, "test");
  let firsts = 0;
  live.onFirstPage(() => { firsts++; });
  expect(live.anyone()).toBe(false);
  const page = () => ({ data: {}, readyState: 1, send: () => {}, getBufferedAmount: () => 0 }) as any;
  const a = page(), b = page();
  live.join(a);
  expect(live.anyone()).toBe(true);
  expect(firsts).toBe(1);
  live.join(b);
  expect(firsts).toBe(1);                         // a second page reads nothing more
  live.leave(a); live.leave(b);
  expect(live.anyone()).toBe(false);
  live.join(page());
  expect(firsts).toBe(2);
});

test("artifacts aren't read on their timer while no page is open", async () => {
  const intervals: (() => void)[] = [];
  const real = globalThis.setInterval;
  (globalThis as any).setInterval = (fn: () => void) => { intervals.push(fn); return 0; };
  try {
    const arts = new Artifacts("/nonexistent-store-for-test");
    let reads = 0, there = 0, open = false;
    arts.read = async () => { reads++; };
    arts.readThere = async () => { there++; };
    arts.watched = () => open;
    arts.start();
    reads = 0;
    for (const fn of intervals) fn();
    expect([reads, there]).toEqual([0, 0]);
    open = true;
    for (const fn of intervals) fn();
    expect([reads, there]).toEqual([1, 1]);
  } finally { globalThis.setInterval = real; }
});
