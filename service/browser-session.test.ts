// SHEP-178: the web's Browser panel looks for the session bin/herdr-browser really uses, long folder or short.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionOf } from "./browser.ts";

// a throwaway home: --name makes the browser folder's marker files
const real = (task: string) => {
  const home = mkdtempSync(join(tmpdir(), "shep-browser-"));
  try {
    const p = Bun.spawnSync(["sh", join(import.meta.dir, "..", "bin", "herdr-browser"), "--task", task, "--name"], { env: { HOME: home, PATH: process.env.PATH ?? "" } });
    return JSON.parse(p.stdout.toString()).session as string;
  } finally { rmSync(home, { recursive: true, force: true }); }
};

test("the same session name as herdr-browser", () => {
  for (const t of ["dev-shepherdr#168", ".config-herdr-app#57", "tmp-" + "very-long-folder-name-".repeat(6) + "demo#1", "home-someone-dev-a-rather-long-repo#12"])
    expect(sessionOf(t)).toBe(real(t));
  expect(sessionOf("tmp-" + "x".repeat(200) + "#3").length).toBeLessThanOrEqual(40);
});
