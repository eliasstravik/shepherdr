import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
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

test("a question's pick goes back as its answer; a plan sent back says why", async () => {
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
  await expect(asks.answer("t7.100.1", { choice: 0 })).rejects.toThrow();
  expect(existsSync(join(dir, "end", "t7.100.1"))).toBe(true);
});

test("several questions: one card with a part for each, answered all at once in order", async () => {
  put("t9.100.1", { tool_name: "AskUserQuestion", tool_input: { questions: [
    { question: "Which color?", header: "Color", options: [{ label: "Red (Recommended)" }, { label: "Blue" }] },
    { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "M" }] }] } });
  const asks = new Asks();
  asks.start();
  const q = new Compat().question(asks.of("t9")[0], "p:sp1");
  expect(q).toMatchObject({ title: "2 questions", parts: [{ title: "Which color?", header: "Color", choices: [{ label: "Red", recommended: true }, { label: "Blue" }] }, { title: "Which sizes?", multi: true }] });
  await expect(asks.answer("t9.100.1", { answers: ["Red"] })).rejects.toThrow();
  asks.answer("t9.100.1", { answers: ["Red", "S, M"] });
  const out = JSON.parse(readFileSync(join(dir, "ans", "t9.100.1.json"), "utf8")).hookSpecificOutput.decision;
  expect(out.updatedInput.answers).toEqual({ "Which color?": "Red", "Which sizes?": "S, M" });
});

// The web served from another machine than the agent's: its asks wait in its own machine's data/chat-asks, read and
// answered through herdr-core's link (machine.exec there; here a sh on a second throwaway home).
test("another machine's ask: a card here, answered there", async () => {
  const there = mkdtempSync(join(tmpdir(), "shep-asks-m3-"));
  const td = join(there, "data", "chat-asks");
  for (const d of ["req", "ans", "end"]) mkdirSync(join(td, d), { recursive: true });
  writeFileSync(join(td, "req", "t12.1700000000.7.json"), JSON.stringify({ tool_name: "Bash", tool_input: { command: "npm\ttest", description: "Run\nthe tests" } }));
  const calls: any[] = [];
  const hub: any = {
    async call(method: string, p: any) {
      calls.push({ method, ...p });
      const r = Bun.spawnSync(p.argv, { env: { ...process.env, HERDR_APP_HOME: there }, stdin: p.input ? Buffer.from(p.input, "base64") : "ignore" });
      return { code: r.exitCode, stdout: Buffer.from(r.stdout).toString("base64") };
    },
  };
  const asks = new Asks();
  asks.remote(hub, () => ["m3/t12"]);
  await (asks as any).poll();
  const [a] = asks.of("m3/t12");
  expect(a).toMatchObject({ id: "m3/t12.1700000000.7", machine: "m3", local: "t12.1700000000.7" });
  expect(a.req.tool_input.command).toBe("npm\ttest");
  expect(calls[0]).toMatchObject({ method: "machine.exec", on: "m3" });
  // what is open here stays across a read of this machine's own
  (asks as any).read();
  expect(asks.of("m3/t12").length).toBe(1);
  await asks.answer(a.id, { choice: 0 });
  expect(JSON.parse(readFileSync(join(td, "ans", "t12.1700000000.7.json"), "utf8")).hookSpecificOutput.decision.behavior).toBe("allow");
  expect(readFileSync(join(td, "end", "t12.1700000000.7"), "utf8")).toBe("Allowed on the web\n");
  expect(asks.of("m3/t12").length).toBe(0);
  expect(asks.endsOf("m3/t12")[0]).toMatchObject({ how: "Allowed on the web" });
});

test("another machine's ask answered there first: it closes here with how", async () => {
  const there = mkdtempSync(join(tmpdir(), "shep-asks-m4-"));
  const td = join(there, "data", "chat-asks");
  for (const d of ["req", "ans", "end"]) mkdirSync(join(td, d), { recursive: true });
  writeFileSync(join(td, "req", "t13.1700000000.8.json"), JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
  const hub: any = { async call(_m: string, p: any) {
    const r = Bun.spawnSync(p.argv, { env: { ...process.env, HERDR_APP_HOME: there }, stdin: "ignore" });
    return { code: r.exitCode, stdout: Buffer.from(r.stdout).toString("base64") };
  } };
  const asks = new Asks();
  asks.remote(hub, () => ["m4/t13"]);
  await (asks as any).poll();
  expect(asks.of("m4/t13").length).toBe(1);
  writeFileSync(join(td, "end", "t13.1700000000.8"), "Answered in the terminal\n");
  rmSync(join(td, "req", "t13.1700000000.8.json"));
  await (asks as any).poll();
  expect(asks.of("m4/t13").length).toBe(0);
  expect(asks.endsOf("m4/t13")[0]).toMatchObject({ how: "Answered in the terminal" });
  // once answered there, a card here says so
  writeFileSync(join(td, "req", "t13.1700000001.9.json"), JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
  await (asks as any).poll();
  rmSync(join(td, "req", "t13.1700000001.9.json"));
  await expect(asks.answer("m4/t13.1700000001.9", { choice: 0 })).rejects.toThrow("answered already");
});

test("an agent asking with a card needs you once: its card, not a second need for its waiting too", () => {
  put("t21.100.1", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Can I take the window?", header: "Go", options: [{ label: "Yes" }, { label: "No" }] }] } });
  const asks = new Asks();
  asks.start();
  const c = new Compat() as any;
  c.asks = asks;
  const row = { section: "needs", worker: "t21", ref: "SHEP-17", machine: "m3", folder: "/x", slug: "x", id: 17, title: "Reactions", sub: "Question for you" };
  const snap = c.snapshot({ host: "mini", user: "me", machines: [], spaces: [], sections: [], rows: [row, { ...row, worker: "t22", ref: "SHEP-18", id: 18 }] });
  // SHEP-17's card is its one need; SHEP-18 waits with no card
  expect(snap.needs.map((n: any) => [n.chat, n.id === "attention"])).toEqual([["m3:SHEP-18/worker", true], ["m3:SHEP-17/worker", false]]);
});
