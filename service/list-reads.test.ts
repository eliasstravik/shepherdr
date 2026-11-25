// #1468: on a slow link a machine's task lists were read again before the last read came back, each whole; reads of
// one machine never overlap now: however many ask meanwhile, one more read follows the running one.
import { expect, test } from "bun:test";
import { Model } from "./model.ts";

test("reads of one machine's lists never overlap", async () => {
  const waiting: (() => void)[] = [];
  let calls = 0, open = 0, most = 0;
  const hub = {
    on() {}, terminals: new Map(),
    call: async (method: string) => {
      if (method !== "machine.exec") return {};
      calls++; open++; most = Math.max(most, open);
      await new Promise<void>((r) => waiting.push(r));
      open--;
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const model = new Model(hub as any, { anyone: () => true, onFirstPage() {} } as any);
  const read = (m: string | null) => (model as any).readLists(m);
  const all = [read("far"), read("far"), read("far"), read("far"), read(null)];
  await Bun.sleep(0);
  expect(calls).toBe(2);              // one for "far", one for this machine
  while (waiting.length) { waiting.shift()!(); await Bun.sleep(0); }
  await Promise.all(all);
  expect(calls).toBe(3);              // the three asks while "far" was read: one more read, after it
  expect(most).toBe(2);
});
