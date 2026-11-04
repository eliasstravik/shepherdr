import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdLock } from "./lock.ts";

test("one holder at a time; a left-over socket file is taken over; release frees it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-lock-"));
  const p = join(dir, "service.sock");
  const first = await holdLock(p);
  expect(first).not.toBeNull();
  expect(await holdLock(p)).toBeNull();
  first!();
  expect(existsSync(p)).toBe(false);
  writeFileSync(p, "");                     // a crashed service's file, nobody answering
  const again = await holdLock(p);
  expect(again).not.toBeNull();
  again!();
});
