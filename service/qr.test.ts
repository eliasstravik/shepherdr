import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qrFile } from "./qr.ts";

test("a link's QR code is an SVG under its own name; a new link replaces it", () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-qr-"));
  const a = qrFile(dir, "https://box.tailnet.example/shepherdr/");
  expect(readFileSync(a, "utf8")).toStartWith("<svg");
  const b = qrFile(dir, "https://other.tailnet.example/shepherdr/");
  expect(b).not.toBe(a);
  expect(() => readFileSync(a)).toThrow();
});
