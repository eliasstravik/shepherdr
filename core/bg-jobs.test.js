import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";
import { JOBS, BgJobs } from "./bg-jobs.js";

const run = async (script, args) => {
  const p = Bun.spawn(["sh", "-c", script, ...args], { stdout: "pipe", stderr: "ignore" });
  return { stdout: await new Response(p.stdout).text() };
};
const at = "2026-11-04T13:06:27.000Z";
const user = (content, extra = {}) => JSON.stringify({ parentUuid: "p", isSidechain: false, promptId: "x", type: "user", message: { role: "user", content }, uuid: "u", timestamp: at, ...extra });
const call = (id, name, input) => JSON.stringify({ parentUuid: "p", isSidechain: false, message: { model: "claude-opus-5-5", id: `m-${id}`, type: "message", role: "assistant", content: [{ type: "tool_use", id, name, input }] }, type: "assistant", uuid: `a-${id}`, timestamp: at });
const result = (id, text, more = {}) => user([{ tool_use_id: id, type: "tool_result", content: text, is_error: false }], { toolUseResult: { stdout: "", ...more } });
const note = (id, task, status) => `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<summary>Background command "x" ${status}</summary>\n</task-notification>`;
const enqueue = (text) => JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: at, sessionId: "s", content: text });

// A Claude Code log as LOG reads it, fed to a Conversation.
async function conv(lines) {
  const dir = mkdtempSync(join(tmpdir(), "bg-jobs-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.join("\n") + "\n");
  const r = await run(LOG, ["log", "tail", f, "0"]);
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(r.stdout).records);
  return c;
}

test("a shell run in the background is a job until its end is queued for the agent", async () => {
  const start = [
    call("t1", "Bash", { command: "npm run dev", description: "Start the dev server", run_in_background: true }),
    result("t1", "Command running in background with ID: b111. Output is being written to: /tmp/x/tasks/b111.output.", { backgroundTaskId: "b111" }),
  ];
  const c = await conv(start);
  expect(c.bg).toEqual([{ id: "t1", task: "b111", kind: "shell", label: "Start the dev server", cmd: "npm run dev", at: Date.parse(at) }]);
  expect((await conv([...start, enqueue(note("t1", "b111", "completed"))])).bg).toEqual([]);
  // read later by the agent (mid-turn, or as its own turn): ends it too
  expect((await conv([...start, JSON.stringify({ parentUuid: "p", isSidechain: false, attachment: { type: "queued_command", prompt: note("t1", "b111", "killed"), commandMode: "task-notification" }, type: "attachment", uuid: "q", timestamp: at })])).bg).toEqual([]);
  expect((await conv([...start, user(note("t1", "b111", "failed"), { origin: { kind: "task-notification" } })])).bg).toEqual([]);
});

test("a background call that never started (cancelled, denied, failed) is no job", async () => {
  // SHEP-20: the person cancelled it; its result is an error with no task id, and it showed for hours
  const c = await conv([
    call("t5", "Bash", { command: "./watch.sh", description: "Keep watching SHEP-10", run_in_background: true }),
    user([{ type: "tool_result", content: "The user doesn't want to take this action right now.", is_error: true, tool_use_id: "t5" }], { toolUseResult: "The user doesn't want to take this action right now." }),
  ]);
  expect(c.bg).toEqual([]);
});

test("a command moved to the background mid-run, and a watcher, are jobs; the agent's TaskStop ends one", async () => {
  const c = await conv([
    call("t2", "Bash", { command: "bun test", description: "Run the tests" }),
    result("t2", "Command was moved to the background (ID: b222) so that a message that arrived while it was running can reach you.", { backgroundTaskId: "b222", backgroundedToDeliverMessage: true }),
    call("t3", "Monitor", { command: "tail -f log", description: "watch the build" }),
    result("t3", "Monitor started (task b333, expires in 1m 10s).", { taskId: "b333", timeoutMs: 70000 }),
    // a watcher's line it printed is no end
    enqueue("<task-notification>\n<task-id>b333</task-id>\n<summary>Monitor event: \"watch the build\"</summary>\n<event>built</event>\n</task-notification>"),
  ]);
  expect(c.bg.map((j) => [j.id, j.task, j.kind, j.label])).toEqual([["t2", "b222", "shell", "Run the tests"], ["t3", "b333", "monitor", "watch the build"]]);
  const d = await conv([
    call("t2", "Bash", { command: "bun test", description: "Run the tests", run_in_background: true }),
    result("t2", "Command running in background with ID: b222.", { backgroundTaskId: "b222" }),
    call("t4", "TaskStop", { task_id: "b222" }),
    result("t4", '{"message":"Successfully stopped task: b222"}'),
  ]);
  expect(d.bg).toEqual([]);
});

test("the processes have the last say: a job no process holds open is gone", () => {
  const c = { bg: [{ id: "t1", task: "b111", kind: "shell", label: "a", cmd: "a", at: 1000 }, { id: "t2", task: "b222", kind: "shell", label: "b", cmd: "b", at: 1000 }, { id: "t3", kind: "shell", label: "c", cmd: "c", at: 1000 }] };
  const b = new BgJobs();
  // no look yet: the log says
  expect(b.list("claude", c).map((j) => j.id)).toEqual(["t1", "t2", "t3"]);
  b.read("claude", 1, "ok\nF /tmp/claude-1/p/s/tasks/b111.output\n", 60000);
  // t2's file is closed: stopped in its terminal, or a watcher that timed out; t3 has no task id yet
  expect(b.list("claude", c).map((j) => [j.id, j.path ?? null])).toEqual([["t1", "/tmp/claude-1/p/s/tasks/b111.output"], ["t3", null]]);
  // a minute on, still no task id: no file vouches for it, so it goes
  b.read("claude", 1, "ok\nF /tmp/claude-1/p/s/tasks/b111.output\n", 62000)
  expect(b.list("claude", c).map((j) => j.id)).toEqual(["t1"]);
  // a look that didn't work (the machine out of reach): the log says again
  b.read("claude", 1, "", 61000);
  expect(b.list("claude", c).length).toBe(3);
  expect(b.due("claude", { bg: [] })).toBe(false);
});

test("Codex: a shell of its own that outlives two looks is a job; its hooks and a shell's own shells aren't", () => {
  const b = new BgJobs();
  const tree = "ok\n  100     1 codex\n  200   100 /bin/bash -lc npm run dev\n  201   200 node server.js\n  202   200 /bin/sh -c inner\n  300   100 sh -c ~/.codex/herdr-agent-state.sh working\n  400   100 node mcp-server.js\n";
  b.read("codex", 100, tree, 1000);
  expect(b.list("codex", null)).toEqual([]);
  b.read("codex", 100, tree, 6000);
  expect(b.list("codex", null)).toEqual([{ id: "p200", kind: "shell", label: "npm run dev", cmd: "npm run dev", at: 1000, pid: "200" }]);
});

test("JOBS sees the output file a job's process holds open, stops it, and reads its last lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bg-jobs-"));
  mkdirSync(join(dir, "tasks"));
  const out = join(dir, "tasks", "b999.output");
  // the agent: a shell whose child runs a job writing to its task's output file
  const agent = Bun.spawn(["sh", "-c", `(echo hello; exec sleep 30) > "${out}" 2>&1 & wait`], { stdout: "ignore", stderr: "ignore" });
  try {
    let seen = "";
    for (let i = 0; i < 40 && !seen.includes("b999"); i++) { await Bun.sleep(50); seen = (await run(JOBS, ["jobs", "alive", "claude", String(agent.pid)])).stdout; }
    expect(seen).toContain(`F ${out}`);
    const b = new BgJobs();
    const c = { bg: [{ id: "t9", task: "b999", kind: "shell", label: "sleep", cmd: "sleep 30", at: 0 }] };
    await b.look(run, "claude", agent.pid, c);
    const [job] = b.list("claude", c);
    expect(job.path).toBe(out);
    expect(await b.output(run, job)).toBe("hello");
    await b.stop(run, "claude", agent.pid, job);
    await agent.exited;
    expect((await run(JOBS, ["jobs", "alive", "claude", String(agent.pid)])).stdout.trim()).toBe("ok");
  } finally {
    agent.kill();
    rmSync(dir, { recursive: true });
  }
});
