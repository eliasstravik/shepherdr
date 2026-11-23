import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configOf, setConfig } from "./next.ts";

// SHEP-319: Settings › Instructions is gone. A settings file that still holds the key (this machine before its update,
// or another machine's copy) shows no Instructions, breaks nothing, and the key can't be set any more.
test("an old settings file's instructions are ignored, and the setting can't be changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-319-"));
  const was = process.env.HERDR_TASK_SETTINGS;
  const path = join(dir, "settings.json");
  process.env.HERDR_TASK_SETTINGS = path;
  try {
    const old = { everywhere: { instructions: "Write British English.", tasks: { merge: "checks" } },
      spaces: { sp1: { folder: "/x", name: "shop", instructions: "This shop sells tea." } } };
    writeFileSync(path, JSON.stringify(old));
    const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
    const c = configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick } as any, spaces: ["sp1"], secrets: [], plans: [] });
    expect(JSON.stringify(c)).not.toContain("nstructions");
    expect(c.all.merge).toBe("checks");
    expect(c.spaces.sp1).toBeUndefined();  // nothing of its own that the app shows
    expect(() => setConfig("all", "instructions", "New words")).toThrow("can't be changed here");
    expect(() => setConfig("sp1", "instructions", "x", { id: "sp1", name: "shop", machine: null, folder: "/x" })).toThrow("can't be changed here");
    setConfig("all", "proof", false);  // another change keeps what it doesn't know (the update moves it out)
    const now = JSON.parse(readFileSync(path, "utf8"));
    expect(now.everywhere).toEqual({ instructions: "Write British English.", tasks: { merge: "checks", proof: false } });
  } finally {
    process.env.HERDR_TASK_SETTINGS = was;
    rmSync(dir, { recursive: true, force: true });
  }
});
