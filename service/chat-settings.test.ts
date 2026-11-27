import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Agents } from "./agents.ts";

test.each([
  { kind: "codex", model: "gpt-6.2-sol", speed: "ultrafast", file: ".codex/config.toml",
    original: '[tui]\nscreen_reader_detection_done = true\n',
    saved: 'service_tier = "ultrafast"\n',
    response: "• Service tier set to ultrafast\n" },
  { kind: "claude", model: "opus", speed: "fast", file: ".claude/settings.json",
    original: '{"theme":"dark","fastMode":false}\n',
    saved: '{"theme":"dark","fastMode":true}\n',
    response: "  ⎿  Fast mode ON\n" },
])("$kind picker leaves the agent's default alone even if it can't be read", async (c) => {
  const home = mkdtempSync(join(tmpdir(), "picker-home-"));
  const config = join(home, c.file);
  const hc = join(home, "hc");
  const prevHc = process.env.SHEPHERDR_HC;
  process.env.SHEPHERDR_HC = hc;
  try {
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, c.original);
    const old = { state: "live", status: { state: "idle" }, foreground: { name: c.kind,
      argv: [c.kind, c.kind === "codex" ? "-m" : "--model", c.model,
        ...(c.kind === "codex" ? ["-c", 'model_reasoning_effort="high"'] : ["--effort", "high"])] } };
    const answer = join(home, "answer");
    const oldPrompt = c.kind === "codex" ? "› Ask Codex to do anything\n" : "❯\n";
    writeFileSync(hc, `#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";
const [cmd, addr, key] = process.argv.slice(2);
if (cmd === "get") console.log(${JSON.stringify(JSON.stringify(old))});
if (cmd === "read") process.stdout.write(${JSON.stringify(oldPrompt)} +
  (existsSync(${JSON.stringify(answer)}) ? ${JSON.stringify(c.response)} : ""));
// The old picker types a command in t1. The CLI saves it even when the snapshot read failed.
if (cmd === "keys" && addr === "t1" && key === "enter") {
  writeFileSync(${JSON.stringify(config)}, ${JSON.stringify(c.saved)});
  writeFileSync(${JSON.stringify(answer)}, "");
}
`, { mode: 0o700 });
    const hub: any = {
      terminals: new Map([["t1", old]]),
      call: async () => ({ code: 1, stdout: "", stderr: "" }),
    };
    const agents = new Agents(hub, join(home, "settings-events"));
    const launches: { addr: string; pick: Parameters<Agents["restart"]>[2] }[] = [];
    agents.restart = async (addr, _reader, pick) => { launches.push({ addr, pick }); return "t2"; };
    const result = await agents.change("t1", { kind: c.kind }, { kind: c.kind, model: c.model, effort: "high", speed: c.speed });
    expect(readFileSync(config, "utf8")).toBe(c.original);
    expect(result).toMatchObject({ terminal: "t2", current: { model: c.model, fast: c.speed === "fast" ? true : "ultrafast" } });
    expect(result.error).toBeUndefined();
    expect(launches).toEqual([{ addr: "t1", pick: { kind: c.kind, model: c.model, effort: "high", speed: c.speed } }]);
  } finally {
    if (prevHc === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = prevHc;
    rmSync(home, { recursive: true, force: true });
  }
});
