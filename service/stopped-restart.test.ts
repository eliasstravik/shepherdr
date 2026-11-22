import { expect, spyOn, test } from "bun:test";
import { Agents } from "./agents.ts";

test("a stopped assistant can restart from its recorded session", async () => {
  const record = { address: "t1", state: "finished", argv: ["codex"], cwd: "/tmp", labels: { "herdr.role": "coordinator" } };
  const hub: any = { terminals: new Map([["t1", record]]) };
  const spawn = spyOn(Bun, "spawn").mockImplementation(((argv: any) => {
    expect(argv[0]).toBe("bash");
    return { stdout: new Blob(["t2\n"]).stream(), stderr: new Blob([]).stream(), exited: Promise.resolve(0) } as any;
  }) as any);
  try {
    expect(await new Agents(hub).restart("t1", { kind: "codex", path: null }, { kind: "codex" })).toBe("t2");
  } finally { spawn.mockRestore(); }
});
