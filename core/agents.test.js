import { expect, test } from "bun:test";
import { argvFor, freshArgv, current, line, menuFor, permissionOptions, permissionHelp, mapPermission, modelSections, parseDefaults, parsePicks, pickKey, withPin, withRecent } from "./agents.js";

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


test("Claude model changes and missing-session recovery retain background instruction files", () => {
  const file = "/fixture/.config/herdr-core/assistant-context/role.txt";
  const flags = ["--append-system-prompt-file", file, "--system-prompt-snapshot", "refresh"];
  const old = { agent: "claude", argv: ["claude", ...flags, "--resume", "gone", "old request"] };
  expect(freshArgv("claude", old.argv)).toEqual(["claude", ...flags]);
  const next = argvFor({ agent: "claude", model: "sonnet" }, old).argv;
  expect(next.slice(next.indexOf("--append-system-prompt-file"), next.indexOf("--append-system-prompt-file") + 2)).toEqual(flags.slice(0, 2));
  expect(next).not.toContain("old request");
});


test("shared permissions keep distinct approval reviewers and survive an agent switch", () => {
  const expected = { claude: ["manual", "auto", "bypassPermissions"], codex: ["ask", "approve", "full"], cursor: ["ask", "auto", "full"] };
  for (const [agent, ids] of Object.entries(expected)) {
    const choices = permissionOptions(menuFor(agent, {}).perms, null);
    expect(choices.map((p) => p.label)).toEqual(["Ask for approval", "Approve for me", "Full access"]);
    expect(choices.map((p) => p.id)).toEqual(ids);
    expect(choices.every((p) => p.icon)).toBe(true);
    expect(permissionHelp(agent, null).every((p) => p.about)).toBe(true);
    for (const [other, mapped] of Object.entries(expected)) {
      ids.forEach((id, i) => expect(mapPermission(agent, id, other)).toBe(mapped[i]));
      expect(mapPermission(agent, agent === "claude" ? "plan" : "read-only", other)).toBe(other === "claude" ? "plan" : "read-only");
    }
  }
});

test("shared permission launches actually select manual or automatic review", () => {
  const launch = (agent, perm, argv = []) => argvFor({ agent, perm }, { agent, argv, session: "existing" }).argv;
  for (const perm of ["ask", "approve"]) {
    const argv = launch("codex", perm, ["codex", "-c", 'approvals_reviewer="auto_review"']);
    expect(argv).toContain(`approvals_reviewer="${perm === "approve" ? "auto_review" : "user"}"`);
    expect(argv).toContain("workspace-write");
    expect(argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(current("codex", argv, {}, {}).perm).toBe(perm);
  }
  expect(launch("claude", "manual")).toContain("default");
  expect(launch("claude", "auto")).toContain("auto");
  const ask = launch("cursor", "ask", ["cursor-agent", "--force", "--auto-review"]);
  expect(ask).not.toContain("--force");
  expect(ask).not.toContain("--auto-review");
  expect(current("cursor", ask, {}, {}).perm).toBe("ask");
  expect(launch("cursor", "auto")).toContain("--auto-review");
});

test("saved special permissions remain valid without changing their launch behavior", () => {
  const claude = permissionOptions(menuFor("claude", {}).perms, "acceptEdits");
  expect(claude.find((p) => p.id === "acceptEdits").label).toBe("Custom");
  expect(argvFor({ agent: "claude", perm: "acceptEdits" }, {}).argv).toContain("acceptEdits");
  const codex = argvFor({ agent: "codex", perm: "auto" }, {}).argv;
  expect(codex).toContain("workspace-write");
  expect(codex.some((arg) => arg.startsWith("approvals_reviewer="))).toBe(false);
});
