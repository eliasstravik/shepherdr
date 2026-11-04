import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// a throwaway app home: never the real data/chat-asks
const home = mkdtempSync(join(tmpdir(), "shep-asks-"));
process.env.HERDR_APP_HOME = home;
const dir = join(home, "data", "chat-asks");
for (const d of ["req", "ans", "end", "open"]) mkdirSync(join(dir, d), { recursive: true });
const { Asks } = await import("./asks.ts");
const { Compat } = await import("./compat.ts");

const put = (id: string, req: unknown) => writeFileSync(join(dir, "req", `${id}.json`), JSON.stringify(req));

test("a permission becomes a card, and Allow answers the hook as the window's card does", () => {
  put("t5.100.1", { tool_name: "Bash", tool_input: { command: "npm test", description: "Run the tests" }, cwd: "/x" });
  const asks = new Asks();
  asks.start();
  expect(asks.of("t5").length).toBe(1);
  const q = new Compat().question(asks.of("t5")[0], "p:sp1");
  expect(q).toMatchObject({ title: "Run: npm test", kind: "Question", choices: [{ label: "Allow" }, { label: "Deny" }] });
  asks.answer("t5.100.1", { choice: 0 });
  expect(JSON.parse(readFileSync(join(dir, "ans", "t5.100.1.json"), "utf8")).hookSpecificOutput.decision.behavior).toBe("allow");
  expect(readFileSync(join(dir, "end", "t5.100.1"), "utf8")).toBe("Allowed on the web\n");
  expect(asks.of("t5").length).toBe(0);
});

test("a question's pick goes back as its answer; a plan sent back says why", () => {
  put("t6.100.1", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which color?", header: "Color", options: [{ label: "Red (Recommended)" }, { label: "Blue" }] }] } });
  put("t7.100.1", { tool_name: "ExitPlanMode", tool_input: { plan: "1. Do it" } });
  const asks = new Asks();
  asks.start();
  const q = new Compat().question(asks.of("t6")[0], "x/worker");
  expect(q.choices.map((c) => c.label)).toEqual(["Red", "Blue"]);
  asks.answer("t6.100.1", { choice: 1 });
  const a = JSON.parse(readFileSync(join(dir, "ans", "t6.100.1.json"), "utf8"));
  expect(a.hookSpecificOutput.decision.updatedInput.answers).toEqual({ "Which color?": "Blue" });
  asks.answer("t7.100.1", { choice: 1 });
  const p = JSON.parse(readFileSync(join(dir, "ans", "t7.100.1.json"), "utf8"));
  expect(p.hookSpecificOutput.decision).toMatchObject({ behavior: "deny" });
  expect(() => asks.answer("t7.100.1", { choice: 0 })).toThrow();
  expect(existsSync(join(dir, "end", "t7.100.1"))).toBe(true);
});
