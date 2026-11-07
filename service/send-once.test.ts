import { afterAll, expect, test, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedOf, forgetAll, noteFailed, once } from "./send-once.ts";

const was = process.env.SHEPHERDR_DATA;
beforeAll(() => { process.env.SHEPHERDR_DATA = mkdtempSync(join(tmpdir(), "send-once-")); forgetAll(); });
afterAll(() => { if (was === undefined) delete process.env.SHEPHERDR_DATA; else process.env.SHEPHERDR_DATA = was; forgetAll(); });

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
  // the service restarted between the send and the page asking again
  forgetAll();
  expect(await once("c-1", go)).toEqual({ ok: true, at: 1 });
  expect(went).toBe(1);
});

test("one that failed may go again (Retry); one that stayed in the box goes again as only its Enter", async () => {
  const tries: boolean[] = [];
  const bad = (again: boolean) => { tries.push(again); return Promise.reject(Object.assign(new Error("It's still in the agent's message box"), { stuck: tries.length === 1 })); };
  await expect(once("c-2", bad)).rejects.toThrow("message box");
  await expect(once("c-2", bad)).rejects.toThrow("message box");
  expect(tries).toEqual([false, true]);
});

test("a held one that couldn't go is told to its page, and its Retry goes again", async () => {
  let went = 0;
  const hold = async () => { went++; return { ok: true, waiting: true, waitsFor: "turn" }; };
  await once("c-3", hold);
  noteFailed("t9", "c-3", "That agent isn't running.");
  expect(failedOf("t9")).toEqual([{ cid: "c-3", error: "That agent isn't running." }]);
  await once("c-3", hold);
  expect(went).toBe(2);
  // held, then the service restarted (the held queue is in memory only): its Retry goes again
  forgetAll();
  await once("c-3", hold);
  expect(went).toBe(3);
});
