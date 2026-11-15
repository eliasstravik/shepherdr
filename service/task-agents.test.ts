import { describe, expect, test } from "bun:test";
import { runsCommand } from "./model";

// #1022: a worker that died mid-turn leaves its plain shell, and hc keeps "working" on it: the web app's Tasks
// list counted it as the task's agent, the task Working for good. A shell that runs its agent (fish -ic, #780) stays.
describe("a task's agents leave out a dead agent's shell (as herdr-task's runs_command)", () => {
  test("a plain shell runs no command", () => {
    expect(runsCommand(["/bin/bash", "-i"])).toBe(false);
    expect(runsCommand(["zsh"])).toBe(false);
    expect(runsCommand(["-bash", "-l"])).toBe(false);
  });
  test("a shell running the agent's launch command does", () => {
    expect(runsCommand(["/bin/bash", "-ic", "\"$@\"; exec \"$0\" -i", "/bin/bash", "codex"])).toBe(true);
    expect(runsCommand(["fish", "-ic", "claude go; exec fish -i"])).toBe(true);
    expect(runsCommand(["fish", "--command=claude"])).toBe(true);
  });
  test("its argv unknown: its status decides, as before", () => {
    expect(runsCommand(undefined)).toBe(true);
  });
});
