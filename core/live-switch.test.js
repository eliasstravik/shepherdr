import { expect, test } from "bun:test";
import { claudeCommands, claudeRestore, codexEffortRow, codexModelRow, codexPicker, codexRestore, codexRows, liveChanges, liveOK, moveTo, switchLive } from "./live-switch.js";
import { claudeSwitch, Conversation, LOG, records } from "./chat-log.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { current, rowFor } from "./agents.js";

test("only another CLI or permission mode needs a restart", () => {
  const from = { agent: "claude", model: "opus", effort: "high", fast: false, perm: "bypassPermissions" };
  expect(liveOK(from, { ...from, model: "sonnet", effort: "low", fast: true })).toBe(true);
  expect(liveOK(from, { ...from, agent: "codex" })).toBe(false);
  expect(liveOK(from, { ...from, perm: "plan" })).toBe(false);
});

test("a new model says its level again; nothing else that stays", () => {
  const from = { model: "opus", effort: "high", fast: false };
  expect(liveChanges(from, { model: "opus", effort: "medium", fast: false })).toEqual({ effort: "medium" });
  expect(liveChanges(from, { model: "sonnet", effort: "high", fast: false })).toEqual({ model: "sonnet", effort: "high" });
  expect(liveChanges(from, { model: "opus", effort: "high", fast: true })).toEqual({ fast: true });
  expect(claudeCommands({ model: "", effort: "", fast: false }).map((c) => c.text)).toEqual(["/model default", "/effort auto", "/fast off"]);
});

test("Claude Code's saved defaults go back, only the keys it touched", () => {
  const before = JSON.stringify({ theme: "dark", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } }, null, 2);
  const now = JSON.stringify({ theme: "light", model: "haiku", modelSettings: { "claude-opus-5-5": {}, "claude-haiku-5-5": { effortLevel: "low" } } }, null, 2);
  expect(JSON.parse(claudeRestore(before, now))).toEqual({ theme: "light", modelSettings: { "claude-opus-5-5": { effortLevel: "medium" } } });
  expect(claudeRestore(before, before)).toBe(null);
});

test("Codex's config.toml gets its model, level and tier lines back, tables untouched", () => {
  const before = 'approval_policy = "never"\nservice_tier = "fast"\n\n[tui]\nx = 1\n';
  const now = 'approval_policy = "never"\nmodel = "gpt-6-sol"\nmodel_reasoning_effort = "high"\nservice_tier = "default"\n\n[tui]\nx = 1\n[projects."/tmp/a"]\ntrust_level = "trusted"\n';
  expect(codexRestore(before, now)).toBe('approval_policy = "never"\nservice_tier = "fast"\n\n[tui]\nx = 1\n[projects."/tmp/a"]\ntrust_level = "trusted"\n');
  expect(codexRestore(before, before)).toBe(null);
  // a line it removed comes back
  expect(codexRestore(before, 'approval_policy = "never"\n\n[tui]\nx = 1\n')).toBe('approval_policy = "never"\nservice_tier = "fast"\n\n[tui]\nx = 1\n');
});

// Codex 0.163's pickers, as its screen shows them
const MODELS = `  Select Model and Effort
  1. GPT-6.1-Sol           Latest workhorse model for coding and everyday work.
  2. GPT-6-Astra           Frontier intelligence for the most demanding work.
  3. GPT-6.1 Terra         GPT-6.1 Terra Codex model.
› 5. GPT-6-Luna (current)  Fast and affordable model for easier tasks.
  enter select · esc back`;
const LEVELS = `  Select Reasoning Level for GPT-6.1-Sol
  1. Low (default)         Fast responses with lighter reasoning
  2. Medium                Balances speed and reasoning depth for everyday tasks
› 4. Extra high (current)  Extra high reasoning depth for complex problems
  5. More reasoning…       Max and Ultra consume usage limits faster
  enter default · s session · esc back`;

test("Codex's pickers read off its screen", () => {
  expect(codexPicker(MODELS)).toBe("model");
  const rows = codexRows(MODELS);
  expect(rows.find((r) => r.sel)).toMatchObject({ n: 5, label: "GPT-6-Luna", current: true });
  expect(codexModelRow(rows, "gpt-6.1-terra", "GPT-6.1 Terra")?.n).toBe(3);
  expect(codexModelRow(rows, "gpt-6.1-sol")?.n).toBe(1);
  expect(moveTo(rows, 3)).toEqual(["up", "up"]);
  const levels = codexRows(LEVELS);
  expect(codexPicker(LEVELS)).toBe("effort");
  expect(codexEffortRow(levels, "medium")?.n).toBe(2);
  expect(codexEffortRow(levels, "")?.n).toBe(1);
  expect(codexEffortRow(levels, "ultra")).toBe("more");
});

/** A terminal that answers as the CLI would, and its home's files */
function fakeTerm(answer, files) {
  let screen = "› \n";
  const sent = [], keys = [];
  return {
    sent, keys, files,
    io: {
      send: async (t) => { sent.push(t); screen += answer.send(t, files) ?? ""; },
      keys: async (...k) => { keys.push(...k); screen += answer.keys?.(k, files) ?? ""; },
      screen: async () => screen,
      readFile: async (p) => { if (!(p in files)) throw new Error("none"); return files[p]; },
      writeFile: async (p, t) => { files[p] = t; },
      sleep: async () => {},
    },
  };
}

test("Claude Code: /model then /effort, typed and confirmed; its default left as it was", async () => {
  const settings = JSON.stringify({ theme: "dark" }, null, 2);
  const t = fakeTerm({
    send: (text, f) => {
      if (text.startsWith("/model")) f[".claude/settings.json"] = JSON.stringify({ theme: "dark", model: "sonnet" });
      return text.startsWith("/model") ? `❯ ${text}\n  ⎿  Set model to Sonnet 5.5 and saved as your default for new sessions\n`
        : `❯ ${text}\n  ⎿  Set effort level to low (saved as your default for new sessions)\n`;
    },
  }, { ".claude/settings.json": settings });
  const ch = await switchLive(t.io, "claude", { model: "opus", effort: "high", fast: false }, { model: "sonnet", effort: "low", fast: false });
  expect(ch).toEqual({ model: "sonnet", effort: "low" });
  expect(t.sent).toEqual(["/model sonnet", "/effort low"]);
  expect(JSON.parse(t.files[".claude/settings.json"])).toEqual({ theme: "dark" });
});

test("Claude Code: its Switch model? question is answered Yes; a failure says why", async () => {
  let asked = false;
  const t = fakeTerm({
    send: (text) => text.startsWith("/model") ? `❯ ${text}\n   Switch model?\n   ❯ 1. Yes, switch to Haiku 5.5\n     2. No, go back\n`
      : text.startsWith("/effort") ? `❯ ${text}\n  ⎿  Set effort level to high\n` : `❯ ${text}\n  ⎿  Fast mode unavailable: Fast mode requires usage credits\n`,
    keys: (k) => { asked = k[0] === "enter"; return "  ⎿  Set model to Haiku 5.5 and saved as your default for new sessions\n"; },
  }, {});
  await switchLive(t.io, "claude", { model: "opus", effort: "high" }, { model: "haiku", effort: "high" });
  expect(asked).toBe(true);
  await expect(switchLive(t.io, "claude", { model: "haiku", effort: "high", fast: false }, { model: "haiku", effort: "high", fast: true }))
    .rejects.toThrow("Fast mode unavailable: Fast mode requires usage credits");
});

test("Claude Code: the same command again waits for its own answer, not the last one's", async () => {
  let n = 0;
  const t = fakeTerm({ send: (text) => (++n === 1 ? `❯ ${text}\n  ⎿  Effort level set to low\n` : `❯ ${text}\n`) }, {});
  await switchLive(t.io, "claude", { model: "opus", effort: "high" }, { model: "opus", effort: "low" });
  await expect(switchLive(t.io, "claude", { model: "opus", effort: "high" }, { model: "opus", effort: "low" })).rejects.toThrow("didn't answer");
});

test("Codex: its model picked, then its level for this session only (s, never Enter)", async () => {
  const config = 'service_tier = "fast"\n';
  const t = fakeTerm({
    send: (text) => (text === "/model" ? `${MODELS}\n` : ""),
    keys: (k) => (k[0] === "enter" ? `${LEVELS}\n` : k[0] === "s" ? "• Model changed to gpt-6.1-sol medium for this session only\n› Ask Codex to do anything\n" : ""),
  }, { ".codex/config.toml": config });
  await switchLive(t.io, "codex", { model: "gpt-6-luna", effort: "low", fast: true }, { model: "gpt-6.1-sol", effort: "medium", fast: true },
    { names: { "gpt-6.1-sol": "GPT-6.1-Sol" } });
  expect(t.sent).toEqual(["/model"]);
  // up four rows to GPT-6.1-Sol, Enter; then from Extra high up two to Medium, s
  expect(t.keys).toEqual(["up", "up", "up", "up", "enter", "up", "up", "s"]);
  expect(t.files[".codex/config.toml"]).toBe(config);
});

test("Codex: Fast toggled, and its saved tier put back", async () => {
  const t = fakeTerm({
    send: (text, f) => { f[".codex/config.toml"] = 'service_tier = "default"\n'; return "• Service tier set to default\n"; },
  }, { ".codex/config.toml": 'service_tier = "fast"\n' });
  await switchLive(t.io, "codex", { model: "gpt-6-sol", effort: "high", fast: true }, { model: "gpt-6-sol", effort: "high", fast: false });
  expect(t.sent).toEqual(["/fast"]);
  expect(t.files[".codex/config.toml"]).toBe('service_tier = "fast"\n');
});

test("the log says what it runs on as soon as the switch is made", () => {
  expect(claudeSwitch("<local-command-stdout>Set model to `Opus 5.5 (1M context)` and saved as your default</local-command-stdout>"))
    .toEqual({ model: "claude-opus-5-5", alias: "claude-opus-5-5[1m]" });
  expect(claudeSwitch("<local-command-stdout>Set model to Fable 5.1 and saved</local-command-stdout>")).toEqual({ model: "claude-fable-5-1", alias: "claude-fable-5-1" });
  expect(claudeSwitch("<local-command-stdout>Set effort level to low (saved as your default)</local-command-stdout>")).toEqual({ effort: "low" });
  expect(claudeSwitch("<local-command-stdout>Fast mode OFF</local-command-stdout>")).toEqual({ speed: "standard" });
  const c = new Conversation("claude");
  c.claude({ type: "user", message: { content: "<local-command-stdout>Set model to `Opus 5.5 (1M context)` and saved</local-command-stdout>" }, timestamp: "2026-11-10T11:00:00Z" }, 0);
  c.claude({ type: "user", message: { content: "<local-command-stdout>Set effort level to max (saved)</local-command-stdout>" }, timestamp: "2026-11-10T11:00:01Z" }, 1);
  const now = current("claude", ["claude", "--model", "haiku", "--effort", "low"], c.meta, {});
  expect([rowFor("claude", now), now.effort]).toEqual(["opus[1m]", "max"]);
  // its next turn names the model without 1M: the row stays
  c.claude({ type: "assistant", message: { model: "claude-opus-5-5", content: [] }, perTurnEffort: "max", timestamp: "2026-11-10T11:00:02Z" }, 2);
  expect(rowFor("claude", current("claude", ["claude", "--model", "haiku"], c.meta, {}))).toBe("opus[1m]");
  const x = new Conversation("codex");
  x.codex({ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-6-sol", reasoning_effort: "ultra", service_tier: "default" } }, timestamp: "2026-11-10T11:00:00Z" }, 0);
  const cx = current("codex", ["codex", "-m", "gpt-6-luna", "-c", 'service_tier="fast"'], x.meta, {});
  expect([cx.model, cx.effort, cx.fast]).toEqual(["gpt-6-sol", "ultra", false]);
});

/** A log as LOG reads it (its filter keeps only the lines the chat uses), fed to a Conversation */
async function viaLog(kind, lines) {
  const dir = mkdtempSync(join(tmpdir(), "live-switch-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation(kind);
  c.feed(records(out).records);
  return c;
}

test("the log reader keeps the lines a switch writes (Claude Code 2.1.308, Codex 0.163, their keys in order)", async () => {
  const at = "2026-11-10T11:27:28.013Z";
  const c = await viaLog("claude", [
    { parentUuid: "a", isSidechain: false, promptId: "p", type: "user", message: { role: "user", content: "<local-command-stdout>Set model to `Sonnet 5.5` and saved as your default for new sessions</local-command-stdout>" }, uuid: "b", timestamp: at },
    { parentUuid: "b", isSidechain: false, type: "system", subtype: "local_command", content: "<local-command-stdout>Fast mode ON</local-command-stdout>", level: "info", timestamp: at, uuid: "c" },
  ]);
  expect(c.meta).toMatchObject({ model: "claude-sonnet-5-5", speed: "fast" });
  // and the chat shows no message for them
  expect(c.items.filter((x) => x.kind === "user" || x.kind === "agent")).toEqual([]);
  const x = await viaLog("codex", [
    { timestamp: at, ordinal: 16, type: "event_msg", payload: { type: "thread_settings_applied", thread_id: "t", thread_settings: { model: "gpt-6-sol", model_provider_id: "openai", service_tier: "priority", reasoning_effort: "medium" } } },
  ]);
  expect(x.meta).toMatchObject({ model: "gpt-6-sol", effort: "medium", speed: "fast" });
});
