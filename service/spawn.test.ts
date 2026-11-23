import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnv } from "./spawn.ts";

// SHEP-294: the service sets its session in process.env at runtime (session.ts useSession), and Bun.spawn without an
// env gave children the environment the process started with: every hc and herdr-task it ran landed in herdr-core's
// default session. A fresh bun, started with no HC_SESSION and a throwaway SHEPHERDR_SESSION as the service is, runs
// a child the service's ways and says what each child saw. Fake names only; no real hc is run.
const DIR = mkdtempSync(join(tmpdir(), "shep-spawn-"));
const FAKE = join(DIR, "herdr-task");
// a herdr-task flags stand-in: answers with the session it was given as its one flag
writeFileSync(FAKE, `#!/bin/sh\nprintf '{"flags":["--session=%s"]}' "$HC_SESSION"\n`, { mode: 0o755 });
const SCRIPT = join(DIR, "child.ts");
const here = import.meta.dir;
writeFileSync(SCRIPT, `
import { useSession } from ${JSON.stringify(join(here, "session.ts"))};
import { spawn, spawnSync } from ${JSON.stringify(join(here, "spawn.ts"))};
import { checkFlags } from ${JSON.stringify(join(here, "flags.ts"))};
useSession();
const say = ["sh", "-c", 'printf %s "$HC_SESSION"'];
const p = spawn(say, { stdout: "pipe" });
const nodeCp = await import("node:child_process");
console.log(JSON.stringify({
  raw: Bun.spawnSync(say).stdout.toString(),
  spawn: await new Response(p.stdout).text(),
  spawnSync: spawnSync(say).stdout.toString(),
  flags: (await checkFlags("claude", "x", ${JSON.stringify(FAKE)}))[0],
  node: nodeCp.execFileSync(say[0], say.slice(1)).toString(),
}));
`);

function run(session: string) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), SHEPHERDR_SESSION: session };
  delete env.HC_SESSION;
  const r = Bun.spawnSync([process.execPath, SCRIPT], { env, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  return JSON.parse(r.stdout.toString());
}

test("a child the service spawns gets Shepherdr's session, set after the service started", () => {
  const seen = run("shep-test-x");
  // the helper and a real service call (checkFlags) carry it; node's child_process reads process.env as it is now
  expect(seen).toMatchObject({ spawn: "shep-test-x", spawnSync: "shep-test-x", flags: "--session=shep-test-x", node: "shep-test-x" });
  // the bug itself, on this Bun (1.4.x: a plain Bun.spawn sees the start environment's, none): said, not required
  if (seen.raw !== "shep-test-x") console.log(`Bun ${Bun.version}: a plain Bun.spawn child saw HC_SESSION=${JSON.stringify(seen.raw)} (SHEP-294 reproduced)`);
});

test("SHEPHERDR_SESSION empty: the children get no HC_SESSION (herdr-core's default session)", () => {
  expect(run("")).toMatchObject({ spawn: "", spawnSync: "", flags: "--session=" });
});

test("childEnv: the session wins over the environment given, and none leaves it unset", () => {
  expect(childEnv({ A: "1", HC_SESSION: "other", B: undefined }, "shep")).toEqual({ A: "1", HC_SESSION: "shep" });
  expect(childEnv({ A: "1", HC_SESSION: "other" }, "")).toEqual({ A: "1" });
});
