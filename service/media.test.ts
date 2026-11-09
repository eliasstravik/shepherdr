// SHEP-142: a chat's pictures and videos as /api/file serves them
import { expect, test } from "bun:test";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keep, served, smaller, span, THUMB_FROM } from "./media.ts";

test("a Range header's span", () => {
  expect(span(null, 100)).toBe(null);
  expect(span("bytes=0-9", 100)).toEqual([0, 9]);
  expect(span("bytes=90-", 100)).toEqual([90, 99]);
  expect(span("bytes=-10", 100)).toEqual([90, 99]);
  expect(span("bytes=50-500", 100)).toEqual([50, 99]);
  expect(span("bytes=100-", 100)).toBe("bad");
  expect(span("items=0-1", 100)).toBe(null);
});

test("a part of a file, or all of it, never runnable as a page", async () => {
  const body = new Blob([new Uint8Array(100).map((_, i) => i)]);
  const all = served(body, "video/mp4", null);
  expect(all.status).toBe(200);
  expect(all.headers.get("accept-ranges")).toBe("bytes");
  expect(all.headers.get("content-security-policy")).toContain("sandbox");
  const part = served(body, "video/mp4", "bytes=10-19");
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe("bytes 10-19/100");
  expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  expect(served(body, "video/mp4", "bytes=200-").status).toBe(416);
});

test("another machine's file is kept a while for its next part", () => {
  expect(keep("m\0/a")).toBe(null);
  keep("m\0/a", new Uint8Array([1, 2]));
  expect([...keep("m\0/a")!]).toEqual([1, 2]);
});

test("a small picture is its own thumbnail; a big one gets a small copy where ffmpeg is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "media-"));
  const small = join(dir, "s.png");
  writeFileSync(small, Buffer.alloc(10));
  expect(await smaller(small, "thumb", join(dir, "t"))).toBe(null);
  expect(await smaller(join(dir, "none.png"), "thumb", join(dir, "t"))).toBe(null);
  expect(await smaller(small, "poster", join(dir, "t"))).toBe(null);
  if (!Bun.which("ffmpeg")) return;
  const big = join(dir, "big.png");
  const p = Bun.spawnSync(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=2400x1600", "-frames:v", "1", "-pix_fmt", "rgb48be", big]);
  expect(p.exitCode).toBe(0);
  expect(statSync(big).size).toBeGreaterThan(THUMB_FROM);
  const t = await smaller(big, "thumb", join(dir, "t"));
  expect(t).not.toBe(null);
  expect(statSync(t!).size).toBeLessThan(statSync(big).size / 4);
  // made once
  expect(await smaller(big, "thumb", join(dir, "t"))).toBe(t);
});
