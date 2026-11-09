// SHEP-141 review: the service's socket stays under the 104/108-byte limit however long the home is, and never in a
// folder another user could have made.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sockPath } from "./paths.ts";

const base = mkdtempSync(join(tmpdir(), "s-"));
afterAll(() => { rmSync(base, { recursive: true, force: true }); rmSync("/tmp/shepherdr-999999", { recursive: true, force: true }); });
const uid = process.getuid!();
const long = `/h/${"x".repeat(64)}/.local/state/shepherdr/service`;

test("a short state folder keeps the socket there", () => {
  expect(sockPath("/h/u/.local/state/shepherdr/service", uid, {})).toBe("/h/u/.local/state/shepherdr/service/service.sock");
});

test("a long one uses the user's runtime folder first", () => {
  expect(sockPath(long, uid, { XDG_RUNTIME_DIR: `/run/user/${uid}` })).toBe(`/run/user/${uid}/shepherdr-service.sock`);
});

test("then the old short path, when it still leads to the same folder", () => {
  const home = join(base, "h"), data = join(base, "d", "x".repeat(70), "service");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(home, ".herdr"), { recursive: true });
  symlinkSync(data, join(home, ".herdr", "shepherdr"));
  expect(sockPath(data, uid, {}, home)).toBe(join(home, ".herdr", "shepherdr", "service.sock"));
});

test("/tmp only when the folder is this user's own, never a link or someone else's", () => {
  const p = sockPath(long, 999_999, {}, "/nonexistent");   // a uid this test can't own: its /tmp folder is refused
  expect(p).toBe(join(long, "service.sock"));
  const mineP = sockPath(long, uid, {}, "/nonexistent");
  expect(Buffer.byteLength(mineP)).toBeLessThan(104);
});
