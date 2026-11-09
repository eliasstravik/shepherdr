import { expect, test } from "bun:test";
import { CLEAN_ENV, cleanCommand } from "./clean-env.js";

// SHEP-86: an Assistant's one-off template command runs under sh -c in the holder's environment. Fake values only.
const parent = { PATH: process.env.PATH, CLAUDECODE: "1", CLAUDE_PID: "4242", CLAUDE_CODE_CHILD_SESSION: "1", CLAUDE_CODE_SESSION_ID: "fake-session",
  CLAUDE_CODE_MESSAGING_TOKEN: "fake-token", CLAUDE_CONFIG_DIR: "/tmp/fake-claude", CLAUDE_CODE_USE_BEDROCK: "1", FAKE_OTHER: "x" };

test("an Assistant's command runs without a parent Claude Code session's markers, keeping the person's config", () => {
  const r = Bun.spawnSync(["sh", "-c", cleanCommand("env")], { env: parent });
  const env = Object.fromEntries(r.stdout.toString().trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  for (const k of ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN"]) expect(env[k]).toBeUndefined();
  expect([env.CLAUDE_CONFIG_DIR, env.CLAUDE_CODE_USE_BEDROCK, env.FAKE_OTHER]).toEqual(["/tmp/fake-claude", "1", "x"]);
});

test("the agent is exec'd once, whether the template's command had exec or not", () => {
  expect(cleanCommand("claude --model opus")).toBe(`${CLEAN_ENV} exec claude --model opus`);
  expect(cleanCommand("exec claude")).toBe(`${CLEAN_ENV} exec claude`);
});
