import { expect, test } from "bun:test";

// A task acted on from the page (Mark as done, Restart, Archive) on another machine: its list is read again at once,
// so its card changes with the answer instead of at the next 10 s read (SHEP-450). This machine's lists are watched.

test("reread reads that machine's lists and builds the snapshot again", async () => {
  const { Model } = await import("./model.ts");
  const hub: any = { terminals: new Map(), on: () => () => {}, call: async () => ({}) };
  const m = new Model(hub, { put: () => {} } as any);
  const read: (string | null)[] = [];
  let built = 0;
  (m as any).readLists = async (machine: string | null) => { read.push(machine); };
  (m as any).build = () => { built++; };
  await m.reread("vm-b");
  expect(read).toEqual(["vm-b"]);
  expect(built).toBe(1);
  // this machine: its watcher already does it
  await m.reread(null);
  expect(read).toEqual(["vm-b"]);
  expect(built).toBe(1);
});
