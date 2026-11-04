import { expect, test } from "bun:test";
import * as A from "./agents.js";
import * as S from "./settings.js";
import { kindOf } from "./chat-reader.js";

// The kinds table (lib/kinds.json -> core/kinds.js) names every kind the window, the service and herdr-task start.
test("the kinds table names every agent", () => {
  expect(A.AGENTS).toEqual(["claude", "codex", "pi", "pii", "grok", "hermes", "amp", "cursor"]);
  expect(A.NAMES.pi).toBe("Pi");
  expect(A.NAMES.cursor).toBe("Cursor");
  expect(A.kindOf(["/usr/local/bin/cursor-agent"])).toBe("cursor");
  expect(A.kindOf(["pii"])).toBe("pii");
  expect(A.kindOf(["vim"])).toBeNull();
  expect(kindOf({ foreground: { name: "pi" } })).toBe("pi");
  expect(kindOf({ status: { app: "claude-code" } })).toBe("claude");
  expect(A.defaultsArgs("cursor")).toEqual(["defaults", "cursor", "cursor-agent"]);
});

// How each is started, as kinds.json spells its flags (herdr-task's kinds.start_argv builds the same).
test("argv for the other kinds", () => {
  const pi = A.argvFor({ agent: "pi", model: "clawrouter/claude-haiku-5-5-100k", effort: "low" }, { agent: "claude", argv: ["claude"] });
  expect(pi.argv).toEqual(["pi", "--model", "clawrouter/claude-haiku-5-5-100k", "--thinking", "low"]);
  expect(pi.resume).toBe(false);
  const again = A.argvFor({ agent: "pi", model: "clawrouter/gpt-6-luna", effort: "high" }, { agent: "pi", argv: ["pi", "--model", "x", "--no-color"], session: "abc" });
  expect(again.argv).toEqual(["pi", "--no-color", "--model", "clawrouter/gpt-6-luna", "--thinking", "high", "--session", "abc"]);
  expect(again.resume).toBe(true);
  expect(A.argvFor({ agent: "cursor", model: "gpt-5", effort: "high", perm: "plan" }, { agent: "cursor", argv: [] }).argv)
    .toEqual(["cursor-agent", "--model", "gpt-5[effort=high]", "--mode", "plan"]);
  expect(A.argvFor({ agent: "amp", effort: "ultra" }, { agent: "amp", argv: ["amp"], session: "T-1" }).argv)
    .toEqual(["amp", "threads", "continue", "T-1", "--mode", "ultra"]);
  expect(A.argvFor({ agent: "grok", model: "grok-4", perm: "full" }, { agent: "grok", argv: ["grok"] }).argv)
    .toEqual(["grok", "--model", "grok-4", "--always-approve"]);
  // Claude Code and Codex as before
  expect(A.argvFor({ agent: "codex", model: "gpt-5.1-codex", effort: "high" }, { agent: "codex", argv: ["codex", "--no-daemon"] }).argv)
    .toEqual(["codex", "--no-daemon", "-m", "gpt-5.1-codex", "-c", 'model_reasoning_effort="high"']);
  expect(A.argvFor({ agent: "claude", model: "sonnet", effort: "medium" }, { agent: "claude", argv: ["claude"] }).argv)
    .toEqual(["claude", "--model", "sonnet", "--effort", "medium", "--settings", '{"fastMode":false}']);
});

test("what one runs on, its session, its fork", () => {
  const c = A.current("pi", ["pi", "--model", "clawrouter/claude-haiku-5-5-100k", "--thinking", "low"], {}, {});
  expect([c.agent, c.model, c.effort, c.fast, c.perm]).toEqual(["pi", "clawrouter/claude-haiku-5-5-100k", "low", false, null]);
  const cu = A.current("cursor", ["cursor-agent", "--model", "gpt-5[effort=high]"], {}, {});
  expect([cu.model, cu.effort]).toEqual(["gpt-5", "high"]);
  expect(A.sessionOf("pi", "/s/--x--/2026-11-04T10-00-00_01a1a698-4f02-7475-a76f-678b2b1a1306.jsonl")).toBe("01a1a698-4f02-7475-a76f-678b2b1a1306");
  expect(A.sessionOf("codex", "/s/rollout-2026-11-04T10-00-00-01a1a698-4f02-7475-a76f-678b2b1a1306.jsonl")).toBe("01a1a698-4f02-7475-a76f-678b2b1a1306");
  expect(A.freshArgv("pi", ["pi", "--model", "m", "--session", "abc"])).toEqual(["pi", "--model", "m"]);
  expect(A.freshArgv("pi", ["pi", "--model", "m"])).toBeNull();
  expect(A.forkArgv("pi", ["pi", "--model", "m", "--thinking", "low"], "abc")).toEqual(["pi", "--model", "m", "--thinking", "low", "--fork", "abc"]);
  expect(A.forkArgv("amp", ["amp"], "T-1")).toBeNull();
  expect(A.forkArgv("grok", ["grok", "--model", "grok-4", "--resume", "old"], "abc")).toEqual(["grok", "--model", "grok-4", "--resume", "abc", "--fork-session"]);
  expect(A.freshArgv("grok", ["grok", "--resume", "abc", "--fork-session"])).toEqual(["grok"]);
});

test("the menus offer the kinds that are installed", () => {
  const dflts = { claude: { mode: "acceptEdits" }, codex: { models: [] }, pi: { installed: true, effort: "medium" }, grok: { installed: false } };
  const installed = A.installedOf([], dflts);
  expect(installed).toEqual({ claude: true, codex: false, pi: true, pii: false, grok: false, hermes: false, amp: false, cursor: false });
  expect(A.installedOf([{ key: "codex", run: ["codex"] }], dflts).codex).toBe(true);
  expect(A.installedOf([{ key: "claude", run: ["claude"], installed: false }], dflts).claude).toBe(false);
  const ch = S.choicesFrom(dflts, installed);
  expect(Object.keys(ch.menus)).toEqual(["claude", "pi"]);
  expect(ch.menus.pi.models.map((m) => m.id)).toContain("clawrouter/claude-haiku-5-5-100k");
  expect(ch.menus.pi.models[0].efforts).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
  expect(ch.permDefault).toEqual({ claude: "acceptEdits", codex: "auto", pi: null, pii: null, grok: "manual", hermes: "manual", amp: null, cursor: "manual" });
  // the other CLI for an unset Reviewer: Claude Code and Codex first, then what the menus offer
  expect(S.otherCli("claude", ch.menus)).toBe("pi");
  expect(S.otherCli("pi", ch.menus)).toBe("claude");
  expect(S.otherCli("codex")).toBe("claude");
  expect(S.otherCli("claude")).toBe("codex");
  const two = S.choicesFrom({ ...dflts, grok: { installed: true } }, { claude: false, codex: false, pi: true, grok: true }).menus;
  expect(S.otherCli("pi", two)).toBe("grok");
  expect(S.otherCli("grok", two)).toBe("pi");
  expect(S.otherCli("pi", { pi: two.pi })).toBe("codex");
  // full access doesn't carry over to a kind with no such mode; Fast stays off
  const next = S.chooseModel(ch.menus, ch.permDefault, { agent: "claude", model: "opus", perm: "bypassPermissions", effort: "high", fast: true }, "pi", "clawrouter/gpt-6-luna");
  expect([next.agent, next.model, next.perm, next.effort, next.fast]).toEqual(["pi", "clawrouter/gpt-6-luna", null, "high", false]);
  expect(S.chooseModel(ch.menus, ch.permDefault, { agent: "claude", model: "opus", perm: "bypassPermissions" }, "codex", "x")).toEqual({ agent: "claude", model: "opus", perm: "bypassPermissions" });
});
