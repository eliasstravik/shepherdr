// #1468: another machine's artifacts were read whole every 15 s; unchanged, they come back as one stamp line.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READ_ARTS, STAMP_PY, artsRead } from "./artifacts.ts";

const home = () => {
  const h = mkdtempSync(join(tmpdir(), "shep-arts-"));
  mkdirSync(join(h, ".herdr", "artifacts"), { recursive: true });
  return { h, dir: join(h, ".herdr", "artifacts") };
};
const read = (h: string, last: string | null, path = process.env.PATH!) =>
  Bun.spawnSync(["sh", "-c", READ_ARTS, "sh", STAMP_PY, last ?? "-"], { env: { HOME: h, PATH: path } }).stdout.toString();

test("unchanged registries come back as their stamp only; a change sends them again", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", artifacts: [{ id: "x-1", title: "One", note: "n".repeat(5000) }] }));
  const first = artsRead(read(h, null), null);
  expect(first.same).toBe(false);
  expect(first.body).toContain("x-1");
  const again = read(h, first.stamp);
  expect(again.length).toBeLessThan(40);
  expect(artsRead(again, first.stamp).same).toBe(true);
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", artifacts: [{ id: "x-2", title: "Two" }] }));
  utimesSync(join(dir, "a.json"), new Date(), new Date(Date.now() + 5000));
  const changed = artsRead(read(h, first.stamp), first.stamp);
  expect(changed.same).toBe(false);
  expect(changed.body).toContain("x-2");
});

test("without python3 there, every registry whole as before", () => {
  const { h, dir } = home();
  writeFileSync(join(dir, "a.json"), JSON.stringify({ folder: "/a", artifacts: [{ id: "x-1" }] }));
  const bin = mkdtempSync(join(tmpdir(), "shep-bin-"));
  for (const t of ["sh", "cat", "printf"]) { const w = Bun.which(t); if (w) symlinkSync(w, join(bin, t)); }
  const got = artsRead(read(h, "s0000000000000000", bin), "s0000000000000000");
  expect(got.same).toBe(false);
  expect(got.stamp).toBeNull();
  expect(got.body).toContain("x-1");
});
