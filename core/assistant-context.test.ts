import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { assistantContext, hasAssistantContext } from "./assistant-context.js";

test("only straightforward Claude Assistant commands use background role context", () => {
  expect(assistantContext("claude --model opus", "assistant")).toEndWith(" -- claude --model opus");
  expect(assistantContext("exec '/Applications/Claude Tools/claude' --model sonnet", "coordinator")).toEndWith(" -- '/Applications/Claude Tools/claude' --model sonnet");
  for (const command of ["codex", "cursor-agent", "env MODE=1 claude", "claude && echo hi", "claude | cat", "claude; echo hi", "./claude"]) {
    expect(assistantContext(command, "assistant")).toBeNull();
  }
  expect(assistantContext("claude", "worker")).toBeNull();
  expect(assistantContext("claude", "reviewer")).toBeNull();
});

test("the shell wrapper preserves quoted arguments and resolves paths on the launching machine", () => {
  const dir = mkdtempSync(join(tmpdir(), "assistant-context-"));
  try {
    const fake = join(dir, "python3");
    writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(fake, 0o700);
    const command = assistantContext('exec "/opt/Claude Tools/claude" --append-system-prompt \'User says: "$HOME"; keep this.\' --settings \'{"fastMode":false}\'', "assistant")!;
    const r = Bun.spawnSync(["/bin/sh", "-c", command], { env: { ...process.env, PATH: dir } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trimEnd().split("\n")).toEqual([
      join(homedir(), ".local/share/shepherdr/bin/herdr-assistant-context"),
      join(homedir(), ".config/herdr-core/templates/assistant.md"), "--", "/opt/Claude Tools/claude",
      "--append-system-prompt", 'User says: "$HOME"; keep this.', "--settings", '{"fastMode":false}',
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("recognizes managed context on fresh and resumed argv without treating custom files as hidden roles", () => {
  const file = "/some home/.config/herdr-core/assistant-context/abc123.txt";
  expect(hasAssistantContext(["claude", "--append-system-prompt-file", file, "--resume", "id"])).toBe(true);
  expect(hasAssistantContext(["claude", `--append-system-prompt-file=${file}`])).toBe(true);
  expect(hasAssistantContext(["claude", "--append-system-prompt-file", "/custom/role.txt"])).toBe(false);
  expect(hasAssistantContext(["claude", "--append-system-prompt", file])).toBe(false);
  expect(hasAssistantContext(["claude", "--append-system-prompt-file"])).toBe(false);
  expect(hasAssistantContext(null)).toBe(false);
});
