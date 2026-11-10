import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argvFor, current, freshArgv, forkArgv, menuFor, parseDefaults, sessionOf } from "./agents.js";
import { choicesFrom, chooseModel, modelLabel } from "./settings.js";
import { kindOf } from "./chat-reader.js";
import { cliOf } from "./screens.js";
import { FIND, LOG, Conversation, records } from "./chat-log.js";

const sid = "12345678-1234-1234-1234-123456789abc";

test("Cursor lists account models and Auto without inventing separate effort controls", () => {
  const d = parseDefaults("cursor", "installed\ttrue\nmodel\tauto\ncursor-model\tauto - Auto (current, default)\ncursor-model\topus-high - Opus High\n");
  expect(d.installed).toBe(true);
  expect(menuFor("cursor", d).models.map((m) => m.id)).toEqual(["auto", "opus-high"]);
  expect(menuFor("cursor", d).models.every((m) => m.efforts.length === 0 && !m.fast)).toBe(true);
  expect(parseDefaults("cursor", "").installed).toBe(false);
  expect(choicesFrom({ cursor: d }, { cursor: true }).defaults).toMatchObject({ agent: "cursor", model: "auto", perm: "auto" });
});

test("Cursor launches and resumes with its own flags and explicit permissions", () => {
  const old = { agent: "cursor", argv: ["cursor-agent", "--force", "--model", "old", "--resume", sid, "old prompt", "--add-dir", "/project/docs"], session: sid };
  const pick = { agent: "cursor", model: "auto", perm: "read-only" };
  const r = argvFor(pick, old);
  expect(r.base).toEqual(["cursor-agent", "--add-dir", "/project/docs", "--model", "auto", "--mode", "ask"]);
  expect(r.argv).toEqual([...r.base, "--resume", sid]);
  expect(r.resume).toBe(true);
  expect(argvFor({ ...pick, perm: "auto" }, { agent: "codex", argv: ["codex", "-c", "x=y"], session: sid }).argv)
    .toEqual(["cursor-agent", "--model", "auto", "--auto-review"]);
  expect(current("cursor", r.argv, {}, { mode: "unrestricted" }).perm).toBe("read-only");
  expect(current("cursor", ["cursor-agent", "--auto-review"], {}, { mode: "unrestricted" }).perm).toBe("auto");
  expect(() => argvFor({ ...pick, effort: "high" }, old)).toThrow("model ID");
  expect(() => argvFor({ agent: "unknown" }, old)).toThrow("Unknown agent");
});

test("switching to Cursor clears unsupported effort and keeps permission intent", () => {
  const menus = { cursor: menuFor("cursor", {}) };
  expect(chooseModel(menus, { cursor: "auto" }, { agent: "claude", effort: "high", fast: true, perm: "manual" }, "cursor", "auto"))
    .toMatchObject({ agent: "cursor", model: "auto", effort: null, fast: false, perm: "auto" });
});

test("Cursor recovery keeps flags without replaying old prompts or pretending it can fork", () => {
  expect(freshArgv("cursor", ["cursor-agent", "--model", "auto", `--resume=${sid}`, "old prompt", "--mode", "ask"]))
    .toEqual(["cursor-agent", "--model", "auto", "--mode", "ask"]);
  expect(forkArgv("cursor", ["cursor-agent"], sid)).toBeNull();
  expect(sessionOf("cursor", `/logs/${sid}/${sid}.jsonl`)).toBe(sid);
  for (const app of ["cursor", "cursor-agent", "agent"]) {
    expect(kindOf({ status: { app } })).toBe("cursor");
    expect(cliOf({ status: { app } })).toBe("cursor");
  }
});

test("native Cursor transcripts retain separate replies and distinct tool requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-log-"));
  try {
    const f = join(dir, "log.jsonl");
    const lines = [
      { role: "user", message: { content: [{ type: "text", text: "Please inspect the project" }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Reading the project" }, { type: "tool_use", name: "Read", input: { path: "README.md" } }] } },
      { role: "assistant", message: { content: [{ type: "tool_use", name: "Shell", input: { command: "git status" } }] } },
      { role: "assistant", message: { content: [{ type: "text", text: "Inspection complete" }] } },
    ];
    writeFileSync(f, lines.map(JSON.stringify).join("\n") + "\n");
    const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe" });
    const c = new Conversation("cursor"); c.feed(records(await new Response(p.stdout).text()).records);
    expect(await p.exited).toBe(0);
    expect(c.items.filter((x) => x.kind === "user").length).toBe(1);
    expect(c.items.filter((x) => x.kind === "agent").map((x) => x.text)).toEqual(["Reading the project", "Inspection complete"]);
    const steps = c.items.filter((x) => x.kind === "tools").flatMap((x) => x.steps);
    expect(new Set(steps.map((x) => x.id)).size).toBe(2);
    expect(steps.every((x) => x.out == null)).toBe(true);
    expect(c.open.size).toBe(0);
    expect(c.doing).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Cursor log discovery uses its open database's ID, never the newest chat in the folder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-find-"));
  try {
    const bin = join(dir, "bin"), logs = join(dir, ".cursor/projects/project/agent-transcripts", sid);
    mkdirSync(bin); mkdirSync(logs, { recursive: true });
    const path = join(logs, `${sid}.jsonl`); writeFileSync(path, "");
    writeFileSync(join(bin, "pgrep"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(join(bin, "lsof"), `#!/bin/sh\nprintf '%s\\n' 'n${dir}/.cursor/chats/project/${sid}/store.db'\n`, { mode: 0o755 });
    const p = Bun.spawn(["sh", "-c", FIND, "find", "cursor", "99999999"], { env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` }, stdout: "pipe" });
    expect((await new Response(p.stdout).text()).trim()).toBe(path);
    expect(await p.exited).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("Cursor Auto is identifiable in menus and selected labels without changing its model ID", () => {
  const old = { models: [{ id: "auto", label: "Auto" }] };
  for (const d of [{}, old, parseDefaults("cursor", "installed\ttrue")]) {
    const menu = menuFor("cursor", d);
    expect(menu.models.find((m) => m.id === "auto").name).toBe("Cursor Auto");
    expect(modelLabel({ cursor: menu }, { agent: "cursor", model: "auto" })).toBe("Cursor Auto");
    expect(current("cursor", ["cursor-agent", "--model", "auto"], {}, d)).toMatchObject({ model: "auto", label: "Cursor Auto" });
  }
});

test("a live Node-hosted Cursor is recognized before hooks, without reviving an exited agent", () => {
  const cursor = { state: "live", agent: "sh", status: null, foreground: {
    name: "node", argv: ["/tools/cursor-agent", "--use-system-ca", "/tools/cursor-agent/versions/current/index.js", "--model", "auto"], pid: 123,
  } };
  for (const identify of [kindOf, cliOf]) {
    expect(identify(cursor)).toBe("cursor");
    expect(identify({ ...cursor, foreground: { name: "zsh", argv: ["zsh"] }, argv: ["cursor-agent"] })).toBeNull();
    expect(identify({ foreground: { name: "node", argv: ["node", "server.js", "cursor-agent"] } })).toBeNull();
    expect(identify({ foreground: { name: "sh", argv: ["sh", "-c", "cursor-agent"] } })).toBeNull();
    expect(identify({ ...cursor, status: { app: "codex", state: "idle" } })).toBe("codex");
  }
});
