// The window's sidebar dragging a section by its header (window-runs/section-drag.js), in a bun of its own:
// bun keeps the first mock of a module's names for the whole run, so its stand-ins for "herdr" and GPUI can't share one
// with the other window tests'.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("the window's sidebar drags a section among its machine's, and clicks, menus and space drags still work", () => {
  const r = Bun.spawnSync([process.execPath, "test", "./core/window-runs/section-drag.js"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stderr: "pipe", stdout: "pipe" });
  const out = r.stderr.toString() + r.stdout.toString();
  expect(out).toContain(" 5 pass");
  expect(out).toContain(" 0 fail");
  expect(r.exitCode).toBe(0);
}, 30_000);
