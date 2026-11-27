import { expect, test } from "bun:test";
import * as AGall from "./agents.js";
import { DEFAULTS, argvFor, current, extraFlags, forkArgv, FORK_LIVE, line, liveTaskAgent, menuFor, modelSections, parseDefaults, parsePicks, pickKey, resumeArgv, rowFor, withPin, withRecent, speedFor, speedOf, codexTier, speedName, speedWordOf } from "./agents.js";

const codex = { models: Array.from({ length: 250 }, (_, i) => ({ id: `gpt-${i}`, label: `GPT ${i}`, efforts: ["low", "high"] })) };
const menus = { claude: menuFor("claude", {}), codex: menuFor("codex", codex) };

test("Codex lists every model it has, not its first five", () => {
  expect(menus.codex.models.length).toBe(250);
});

test("nothing typed: pinned, then recent, then the rest of the agent shown", () => {
  const picks = withRecent(withPin(parsePicks(""), pickKey("claude", "haiku")), pickKey("claude", "sonnet"));
  const s = modelSections(menus, "claude", picks, "");
  expect(s.map((x) => x.title)).toEqual(["Pinned", "Recent", "All models"]);
  expect(s[0].rows.map((r) => r.id)).toEqual(["haiku"]);
  expect(s[1].rows.map((r) => r.id)).toEqual(["sonnet"]);
  expect(s[2].rows.some((r) => r.id === "haiku" || r.id === "sonnet")).toBe(false);
});

test("a long list is capped and counts the rest", () => {
  const [all] = modelSections(menus, "codex", null, "");
  expect(all.rows.length).toBe(200);
  expect(all.more).toBe(50);
});

test("typed: every agent's matches, and a row to use the id typed", () => {
  const s = modelSections(menus, "codex", null, "opus 1m");
  expect(s.map((x) => x.key)).toEqual(["claude"]);
  expect(s[0].rows.map((r) => r.id)).toEqual(["opus[1m]"]);
  const t = modelSections(menus, "codex", null, "gpt-7-preview").find((x) => x.key === "typed");
  expect(t.rows.map((r) => [r.agent, r.id, r.typed])).toEqual([["codex", "gpt-7-preview", true], ["claude", "gpt-7-preview", true]]);
  expect(modelSections(menus, "codex", null, "gpt-999").map((x) => x.key)).toEqual(["typed"]);
  expect(modelSections(menus, "codex", null, "gpt-12").find((x) => x.key === "typed").rows.map((r) => r.agent)).toEqual(["claude"]);
});

test("an exact id typed needs no extra row; picks survive bad files", () => {
  expect(parsePicks("not json")).toEqual({ pinned: [], recent: [] });
  expect(withPin(withPin(parsePicks(""), "a:b"), "a:b").pinned).toEqual([]);
});

test("a running model typed by id stays in its agent's list", () => {
  expect(menuFor("claude", {}, "claude-opus-4-8").models[0]).toMatchObject({ id: "claude-opus-4-8", name: "Opus 4.8" });
});

test("a pinned or recent model typed by id stays on offer", () => {
  const picks = withRecent(withPin(parsePicks(""), "claude:claude-opus-4-8"), "codex:gpt-x");
  expect(modelSections(menus, "claude", picks, "")[0].rows[0]).toMatchObject({ id: "claude-opus-4-8", name: "Opus 4.8", pinned: true });
  expect(modelSections(menus, "codex", picks, "")[0]).toMatchObject({ title: "Recent", rows: [{ id: "gpt-x" }] });
  expect(modelSections(menus, "claude", picks, "gpt-x").map((x) => x.key)).toEqual(["codex", "typed"]);
});

// SHEP-41: Fast was hidden (and stuck on) for a Codex whose config.toml set service_tier.
test("every agent with a fast mode shows the Fast switch, and turning it off sticks", () => {
  const dflt = parseDefaults("codex", `model\tgpt-6.1-terra\nservice_tier\tfast\n`);
  const codexMenu = menuFor("codex", dflt);
  expect(codexMenu.models.find((m) => m.id === "gpt-6.1-terra").fast).toBe(true);
  expect(codexMenu.models.find((m) => m.id === "gpt-6.1-terra").ultrafast).toBeUndefined();
  expect(codexMenu.fastLocked).toBeUndefined();
  expect(menuFor("claude", {}).models.find((m) => m.id === "opus").fast).toBe(true);
  // off: said on the command line, so config.toml's fast loses, and the label reads it back
  const off = argvFor({ agent: "codex", model: "gpt-6.1-terra", effort: "high", fast: false }, { agent: "codex", argv: ["codex", "-c", 'service_tier="fast"'] }).argv;
  expect(off.filter((a) => a.startsWith("service_tier"))).toEqual(['service_tier="default"']);
  expect(current("codex", off, {}, dflt).fast).toBe(false);
  expect(line(current("codex", off, {}, dflt))).toBe("Codex · GPT-6.1 Terra · High");
  const on = argvFor({ agent: "codex", model: "gpt-6.1-terra", fast: true }, { agent: "codex", argv: off }).argv;
  expect(current("codex", on, {}, dflt).fast).toBe(true);
  const claudeOff = argvFor({ agent: "claude", model: "opus", fast: false }, { agent: "claude", argv: ["claude"] }).argv;
  expect(current("claude", claudeOff, {}, { fast: true }).fast).toBe(false);
});

test("only published Claude and Codex models get faster tiers, and nothing asks Codex's App Server", () => {
  const claude = menuFor("claude", parseDefaults("claude", ""));
  expect(claude.models.filter((m) => m.fast).map((m) => m.id)).toEqual(["opus", "opus[1m]", "claude-fable-5-2"]);
  const dflt = parseDefaults("codex", "");
  expect(dflt.model).toBeNull();
  const menu = menuFor("codex", dflt);
  expect(menu.models.map((m) => m.id)).toEqual(["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
  expect(menu.models.filter((m) => m.ultrafast).map((m) => m.id)).toEqual(["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-sol", "gpt-6-astra"]);
  expect(menu.models.every((m) => m.fast)).toBe(true);
  expect(DEFAULTS).not.toMatch(/app-server|model\/list|models_cache/);
});

// A terminal's own argv as herdr-task runs a worker: nice, sh -c, env and the person's `bash -ic` before the agent.
const wrapped = (...agent) => ["sh", "-c", "exec nice -n 10 \"$@\"", "herdr-low", "sh", "-c", "for v in ...; exec \"$@\"", "herdr-clean",
  "env", "HERDR_BROWSER_TASK=demo#1", "/bin/bash", "-ic", "\"$@\"; exec \"$0\" -i", "/bin/bash", ...agent];

test("#1001: a restart keeps only the agent's own flags, never its launcher's (bash -ic was Codex's -i c, an image)", () => {
  const old = { agent: "codex", argv: wrapped("codex", "-c", "hooks.state={}", "--no-daemon", "-m", "gpt-6-sol", "Do the task"), session: "S1" };
  const { argv, base } = argvFor({ agent: "codex", model: "gpt-6-sol", perm: "auto" }, old);
  expect(argv.some((a) => /^-i/.test(a))).toBe(false);
  expect(argv).not.toContain("herdr-clean");
  expect(argv.filter((a, i) => argv[i - 1] === "-c")).toEqual(["hooks.state={}", 'service_tier="default"']);
  expect(base[0]).toBe("codex");
  expect(argv.slice(0, 2)).toEqual(["codex", "resume"]);
  const c = argvFor({ agent: "claude", model: "opus" }, { agent: "claude", argv: wrapped("claude", "--add-dir", "/x", "hi"), session: "S2" }).argv;
  expect(c).toEqual(["claude", "--add-dir", "/x", "--model", "opus", "--settings", '{"fastMode":false}', "--resume", "S2"]);
  expect(forkArgv("codex", wrapped("codex", "-m", "gpt-6-sol"), "S3")).toEqual(["codex", "fork", "-m", "gpt-6-sol", "--no-daemon", "S3"]);
});

test("#973: Fable 5.2 is in Claude's model menu, the fable alias its row", () => {
  const ids = menuFor("claude", {}).models.map((m) => m.id);
  expect(ids).toContain("claude-fable-5-2");
  expect(menuFor("claude", {}).models.find((m) => m.id === "claude-fable-5-2").name).toBe("Fable 5.2");
  expect(rowFor("claude", { alias: "fable", model: "claude-fable-5-2" })).toBe("claude-fable-5-2");
});

test("#1050: forking a task's chat while its agent runs asks first; a plain chat or an ended task doesn't", () => {
  const agent = (address, labels, extra = {}) => ({ address, state: "live", labels, status: { app: "claude-code" }, ...extra });
  const worker = agent("t1", { "herdr.task": "repo#7" });
  const all = [worker, agent("t2", { "herdr.task": "repo#7", "herdr.role": "reviewer" }), agent("t3", { "herdr.task": "repo#8" })];
  expect(liveTaskAgent(worker, all)?.address).toBe("t1");
  // an older session of the task, its agent now t1
  expect(liveTaskAgent({ address: "t0", state: "finished", labels: { "herdr.task": "repo#7" } }, all)?.address).toBe("t1");
  expect(liveTaskAgent(agent("t4", {}), all)).toBe(null);
  // the agent quit, its shell stays
  expect(liveTaskAgent(worker, [{ ...worker, status: { app: null }, foreground: { name: "bash" } }])).toBe(null);
  // only the reviewer left
  expect(liveTaskAgent(worker, [all[1]])).toBe(null);
  // #1410: a Nix-wrapped agent, its status not told
  const nix = { ...worker, status: {}, foreground: { name: ".claude-wrapped" } };
  expect(liveTaskAgent(worker, [nix])?.address).toBe("t1");
  expect(liveTaskAgent(worker, [{ ...nix, foreground: { name: ".bash-wrapped" } }])).toBe(null);
  expect(FORK_LIVE.verb).toBe("Fork anyway");
});

// Restart Assistant after an /exit (GitHub #1039): the same conversation, with the flags it ran with.
test("an ended Claude Assistant resumes its own session with its own flags", () => {
  const argv = ["claude", "--model", "opus", "--effort", "high", "--dangerously-skip-permissions"];
  expect(resumeArgv("claude", argv, "11111111-2222-3333-4444-555555555555"))
    .toEqual(["claude", "--model", "opus", "--effort", "high", "--dangerously-skip-permissions", "--resume", "11111111-2222-3333-4444-555555555555"]);
});

test("an ended Codex Assistant resumes with codex resume <session>", () => {
  const out = resumeArgv("codex", ["codex", "--no-daemon", "-m", "gpt-5"], "abc");
  expect(out[0]).toBe("codex");
  expect(out[1]).toBe("resume");
  expect(out.at(-1)).toBe("abc");
  expect(out).toContain("--no-daemon");
  expect(out).not.toContain("fork");
});

test("an Assistant that was itself resumed resumes the session it ran last, once", () => {
  expect(resumeArgv("claude", ["claude", "--resume", "old-id", "--model", "opus"], "new-id")).toEqual(["claude", "--model", "opus", "--resume", "new-id"]);
});

// SHEP-258: Codex's Ultrafast tier (service_tier="ultrafast"), beside Fast, on the models OpenAI publishes it for.
test("Ultrafast shows where OpenAI publishes it, and starts Codex on that tier", () => {
  const dflt = parseDefaults("codex", `model\tgpt-6.2-sol\nservice_tier\tultrafast\n`);
  expect(dflt.fast).toBe("ultrafast");
  const menu = menuFor("codex", dflt);
  expect(menu.models.slice(0, 4).map((m) => [m.id, m.name, m.fast, !!m.ultrafast])).toEqual([["gpt-6.2-sol", "GPT-6.2 Sol", true, true],
    ["gpt-6.2-astra", "GPT-6.2 Astra", true, true], ["gpt-6.1-sol", "GPT-6.1 Sol", true, true], ["gpt-6.1-terra", "GPT-6.1 Terra", true, false]]);
  expect(menu.models[0].efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  // started on it: said on the command line, read back, and in words
  const { argv } = argvFor({ agent: "codex", model: "gpt-6.2-sol", effort: "high", fast: "ultrafast" }, { agent: "codex", argv: ["codex", "-c", 'service_tier="fast"'] });
  expect(argv).toEqual(["codex", "--no-daemon", "-m", "gpt-6.2-sol", "-c", 'model_reasoning_effort="high"', "-c", 'service_tier="ultrafast"']);
  expect(current("codex", argv, {}, dflt).fast).toBe("ultrafast");
  expect(line(current("codex", argv, {}, dflt))).toBe("Codex · GPT-6.2 Sol · High · Ultrafast");
  // the log's word wins, and Fast stays Fast
  expect(current("codex", argv, { speed: "fast" }, dflt).fast).toBe(true);
  expect(current("codex", ["codex"], { speed: "ultrafast" }, {}).fast).toBe("ultrafast");
  // a fork keeps it
  expect(forkArgv("codex", argv, "S")).toContain('service_tier="ultrafast"');
  // Claude Code has no Ultrafast: it reads as Fast
  expect(argvFor({ agent: "claude", model: "opus", fast: "ultrafast" }, { agent: "claude", argv: ["claude"] }).argv).toContain('{"fastMode":true}');
});

test("a model without Ultrafast falls back to Fast, one without Fast to standard", () => {
  expect(speedFor({ fast: true, ultrafast: true }, "ultrafast")).toBe("ultrafast");
  expect(speedFor({ fast: true }, "ultrafast")).toBe(true);
  expect(speedFor({ fast: false }, "ultrafast")).toBe(false);
  expect(speedFor({ fast: true }, true)).toBe(true);
  expect(speedFor({}, true)).toBe(false);
  expect([speedOf("priority"), speedOf("ultrafast"), speedOf("default"), speedOf("standard")]).toEqual([true, "ultrafast", false, false]);
  expect([codexTier("ultrafast"), codexTier(true), codexTier(false)]).toEqual(["ultrafast", "fast", "default"]);
  expect([speedName("ultrafast"), speedName(true), speedName(false)]).toEqual(["Ultrafast", "Fast", null]);
  expect([speedWordOf("ultrafast"), speedWordOf(true), speedWordOf(false)]).toEqual(["ultrafast", "fast", "normal"]);
});

// SHEP-263: what a space's Assistant starts on, chosen before its first message, kept where the window's chat, the
// web's model menu and the service's start all read it
test("a space's choice before the first message: kept whole (Ultrafast too), compared by what it starts, forgotten", () => {
  const { CHOICE_KEY, choiceOf, sameChoice, withChoice } = AGall;
  expect(CHOICE_KEY).toBe("coordinator.choice");
  let all = withChoice(undefined, "sp1", { agent: "codex", model: "gpt-6.2-sol", fast: "ultrafast", perm: "full", extra: 1 }, 10);
  expect(all).toEqual({ sp1: { agent: "codex", model: "gpt-6.2-sol", effort: null, fast: "ultrafast", perm: "full", at: 10 } });
  expect(choiceOf(all, "sp1")).toEqual({ agent: "codex", model: "gpt-6.2-sol", effort: null, fast: "ultrafast", perm: "full" });
  expect(argvFor(choiceOf(all, "sp1"), { agent: null, argv: [] }).argv).toContain('service_tier="ultrafast"');
  expect(choiceOf(all, "sp2")).toBeNull();
  expect(choiceOf({ sp1: { agent: "vim" } }, "sp1")).toBeNull();
  expect(sameChoice(all.sp1, { agent: "codex", model: "gpt-6.2-sol", effort: null, fast: "ultrafast", perm: "full" })).toBe(true);
  expect(sameChoice(all.sp1, { ...all.sp1, fast: true })).toBe(false);
  // another machine's space beside it; only the newest 40 stay; a start forgets its own
  all = withChoice(all, "vm/sp2", { agent: "claude", model: "opus", fast: 1 }, 20);
  expect(Object.keys(all)).toEqual(["vm/sp2", "sp1"]);
  expect(all["vm/sp2"].fast).toBe(true);
  for (let i = 0; i < 60; i++) all = withChoice(all, `s${i}`, { agent: "claude" }, 100 + i);
  expect(Object.keys(all).length).toBe(40);
  expect(choiceOf(all, "sp1")).toBeNull();
  expect(withChoice({ a: { agent: "claude", at: 1 } }, "a", null)).toEqual({});
});

test("#1222: a task's extra flags show under the box and stay through a restart, a resume and a fork", () => {
  const argv = ["claude", "--advisor=opus", "--verbose", "--settings", '{"fastMode":false}', "--model", "sonnet", "--effort", "high",
    "--dangerously-skip-permissions", "--add-dir", "/x", "--resume", "11111111-2222-3333-4444-555555555555", "the brief"];
  expect(extraFlags("claude", argv)).toEqual(["--advisor=opus", "--verbose"]);
  expect(extraFlags("claude", ["sh", "-ic", "claude --x", "claude", "--advisor=opus"])).toEqual(["--advisor=opus"]);
  const codex = ["codex", "-c", "hooks.x=1", "--no-daemon", "--search", "--config=model_verbosity=high", "-m", "gpt-x", "-c", 'service_tier="fast"', "--dangerously-bypass-approvals-and-sandbox"];
  expect(extraFlags("codex", codex)).toEqual(["--search", "--config=model_verbosity=high"]);
  // the web's restart on the same CLI keeps them; another CLI drops them
  expect(argvFor({ agent: "claude", model: "opus" }, { agent: "claude", argv }).argv).toContain("--advisor=opus");
  expect(argvFor({ agent: "codex" }, { agent: "claude", argv }).argv).not.toContain("--advisor=opus");
  expect(resumeArgv("claude", argv, "s1")).toContain("--advisor=opus");
  expect(resumeArgv("claude", argv, "s1").slice(-2)).toEqual(["--resume", "s1"]);
  expect(forkArgv("claude", argv, "s1")).toContain("--advisor=opus");
});

test("#1219: a switch carries the old agent's permission in the new CLI's words", () => {
  // the window's restart passes the Claude agent's mode when the person picked none: Codex gets full access, never its sandbox
  const codex = argvFor({ agent: "codex", perm: "bypassPermissions" }, { agent: "claude", argv: ["claude", "--dangerously-skip-permissions"] }).argv;
  expect(codex).toContain("--dangerously-bypass-approvals-and-sandbox");
  expect(codex).not.toContain("workspace-write");
  expect(argvFor({ agent: "codex", perm: "plan" }, { agent: "claude", argv: [] }).argv.join(" ")).toContain("-s read-only");
  const claude = argvFor({ agent: "claude", perm: "full" }, { agent: "codex", argv: [] }).argv;
  expect(claude).toContain("--dangerously-skip-permissions");
  expect(argvFor({ agent: "claude", perm: "acceptEdits" }, { agent: "claude", argv: [] }).argv.join(" ")).toContain("--permission-mode acceptEdits");
});

test("#1464: Codex's Approve for me starts with --approve-for-me, reads back, resumes with it and carries to Claude's auto", () => {
  const { argv } = argvFor({ agent: "codex", perm: "approve" }, { agent: "codex", argv: [] });
  expect(argv).toContain("--approve-for-me");
  // it sets the sandbox and approvals itself (Codex refuses -s or -a beside it)
  expect(argv).not.toContain("-s");
  expect(argv).not.toContain("-a");
  expect(current("codex", argv, {}, {}).perm).toBe("approve");
  expect(current("codex", ["codex", "-s", "workspace-write"], {}, {}).perm).toBe("auto");
  // a restart on Codex with the same session resumes with it, and it isn't an extra flag of the person's
  const again = argvFor({ agent: "codex", perm: "approve" }, { agent: "codex", argv, session: "s1" });
  expect(again.argv.filter((a) => a === "--approve-for-me")).toHaveLength(1);
  expect(extraFlags("codex", argv)).toEqual([]);
  expect(AGall.permAcross("approve", "claude")).toBe("auto");
});

// SHEP-298: what an Assistant really runs, never Settings: its CLI's arguments, its log, its resume label once it ended
test("liveAgent names the model the terminal runs, from its CLI's arguments, else its resume label, and a /model from its log", () => {
  const { liveAgent, argvOf } = AGall;
  const sh = ["sh", "-c", "…; exec claude --model claude-fable-5-2 --effort low --settings '{\"fastMode\":false}'"];
  const own = ["claude", "--model", "claude-fable-5-2", "--effort", "low", "--settings", "{\"fastMode\":false}"];
  const dflt = { model: "opus[1m]", effort: "high" };
  // running: its CLI's own arguments (the template's sh -c is only the terminal's)
  const live = { argv: sh, foreground: { argv: own, name: "claude" }, created_ms: 1000 };
  expect(liveAgent("claude", live, {}, dflt)).toMatchObject({ kind: "claude", model: "claude-fable-5-2", modelLabel: "Fable 5.2", effort: "low", speed: "normal", words: "Fable 5.2 · Low" });
  // ended: no foreground, the sh -c names nothing; its resume label kept the arguments
  const ended = { argv: sh, labels: { "herdr.resume": JSON.stringify({ kind: "claude", argv: own }) }, created_ms: 1000 };
  expect(argvOf(ended)).toEqual(own);
  expect(liveAgent("claude", ended, {}, dflt)).toMatchObject({ model: "claude-fable-5-2", modelLabel: "Fable 5.2" });
  // neither: its CLI's own default, not a guess
  expect(liveAgent("claude", { argv: sh }, {}, dflt)).toMatchObject({ model: "opus[1m]", modelLabel: "Opus 5.5 · 1M", effort: "high" });
  // a /model in place, as its log says it, wins over the arguments it started with
  expect(liveAgent("claude", live, { model: "claude-sonnet-5-5", alias: "sonnet", at: 2000 }, dflt)).toMatchObject({ model: "claude-sonnet-5-5", modelLabel: "Sonnet 5.5" });
  // a resumed log's older turn doesn't count until this process writes
  expect(liveAgent("claude", live, { model: "claude-sonnet-5-5", at: 500 }, dflt)).toMatchObject({ model: "claude-fable-5-2" });
  // Fast and the permission mode come with it
  const fast = { foreground: { argv: ["claude", "--model", "opus", "--settings", "{\"fastMode\":true}", "--dangerously-skip-permissions"] } };
  expect(liveAgent("claude", fast, {}, {})).toMatchObject({ modelLabel: "Opus 5.5", speed: "fast", perm: "bypassPermissions" });
  // Codex: its model's own name from its CLI's list, its tier
  const codexDflt = { models: [{ id: "gpt-6.2-sol", label: "GPT-6.2 Sol" }] };
  const cx = { foreground: { argv: ["codex", "--no-daemon", "-m", "gpt-6.2-sol", "-c", "service_tier=\"ultrafast\""] } };
  expect(liveAgent("codex", cx, {}, codexDflt)).toMatchObject({ kind: "codex", model: "gpt-6.2-sol", modelLabel: "GPT-6.2 Sol", speed: "ultrafast" });
});
