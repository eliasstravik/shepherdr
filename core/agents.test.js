import { expect, test } from "bun:test";
import { argvFor, current, forkArgv, FORK_LIVE, line, liveTaskAgent, menuFor, modelSections, parseDefaults, parsePicks, pickKey, resumeArgv, rowFor, withPin, withRecent } from "./agents.js";

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
  const cache = JSON.stringify({ models: [{ slug: "gpt-x", display_name: "GPT-X", supported_reasoning_levels: [{ effort: "high" }], service_tiers: [{ id: "priority" }] },
    { slug: "gpt-slow", display_name: "GPT-Slow", service_tiers: [] }] });
  const dflt = parseDefaults("codex", `model\tgpt-x\nservice_tier\tfast\nmodels\t${cache}\n`);
  const codexMenu = menuFor("codex", dflt);
  expect(codexMenu.models.find((m) => m.id === "gpt-x").fast).toBe(true);
  expect(codexMenu.models.find((m) => m.id === "gpt-slow").fast).toBe(false);
  expect(codexMenu.fastLocked).toBeUndefined();
  expect(menuFor("claude", {}).models.find((m) => m.id === "opus").fast).toBe(true);
  // off: said on the command line, so config.toml's fast loses, and the label reads it back
  const off = argvFor({ agent: "codex", model: "gpt-x", effort: "high", fast: false }, { agent: "codex", argv: ["codex", "-c", 'service_tier="fast"'] }).argv;
  expect(off.filter((a) => a.startsWith("service_tier"))).toEqual(['service_tier="default"']);
  expect(current("codex", off, {}, dflt).fast).toBe(false);
  expect(line(current("codex", off, {}, dflt))).toBe("Codex · GPT-X · High");
  const on = argvFor({ agent: "codex", model: "gpt-x", fast: true }, { agent: "codex", argv: off }).argv;
  expect(current("codex", on, {}, dflt).fast).toBe(true);
  const claudeOff = argvFor({ agent: "claude", model: "opus", fast: false }, { agent: "claude", argv: ["claude"] }).argv;
  expect(current("claude", claudeOff, {}, { fast: true }).fast).toBe(false);
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
