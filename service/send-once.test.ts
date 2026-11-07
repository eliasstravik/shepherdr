import { expect, test } from "bun:test";
import { once } from "./send-once.ts";

// SHEP-93: a phone that lost the answer asks again with the same id: it never goes twice
test("a send asked again while on its way waits for it, and one that went in answers again without going", async () => {
  let went = 0;
  let finish!: () => void;
  const go = () => { went++; return new Promise((r) => { finish = () => r({ ok: true, at: 1 }); }); };
  const first = once("c-1", go);
  const again = once("c-1", go);
  finish();
  expect(await first).toEqual({ ok: true, at: 1 });
  expect(await again).toEqual({ ok: true, at: 1 });
  expect(await once("c-1", go)).toEqual({ ok: true, at: 1 });
  expect(went).toBe(1);
});

test("one that failed may go again (Retry)", async () => {
  let went = 0;
  const bad = () => { went++; return Promise.reject(new Error("That agent isn't running.")); };
  await expect(once("c-2", bad)).rejects.toThrow("isn't running");
  await expect(once("c-2", bad)).rejects.toThrow("isn't running");
  expect(went).toBe(2);
});
