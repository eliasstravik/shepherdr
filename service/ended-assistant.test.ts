// SHEP-297: a space whose Assistant was killed (or crashed, or exited) kept its finished terminal as "the" Assistant,
// so every message failed "That agent isn't running." and nothing started a new one until its record was removed by
// hand (hc rm). Now a message to it starts it again on its own conversation (the Stopped card's Restart) and goes to
// the new one once, however often the page asks; one that can't start again gives way to a fresh Assistant.
import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "./agents.ts";
import { Compat } from "./compat.ts";
import { act, REVIVE_WAIT } from "./actions.ts";
import { forgetAll } from "./send-once.ts";

REVIVE_WAIT.ms = 3000;
REVIVE_WAIT.every = 10;

const SPACE = { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1", "herdr.space": "sp1" };
const ended = () => ({ address: "t1", state: "finished", argv: ["claude", "--model", "haiku"], status: null, labels: { ...SPACE } });

/** a hub whose old Assistant t1 finished; what went to each agent (hub.send) is kept */
function world() {
  const sent: { addr: string; text: string }[] = [];
  const hub: any = {
    terminals: new Map<string, any>([["t1", ended()]]),
    on: () => () => {},
    call: async () => { throw new Error("no machine.exec here"); },
    send: async (addr: string, text: string) => {
      if (hub.terminals.get(addr)?.state !== "live") return { code: 1, stdout: "", stderr: "That agent isn't running." };
      sent.push({ addr, text });
      return { code: 0, stdout: "{}", stderr: "" };
    },
  };
  const compat = new Compat() as any;
  compat.spaceList = [{ id: "sp1", machine: null, folder: "/srv/shop", assistant: "t1" }];
  compat.addrOf = (k: string) => (k === "p:sp1" ? "t1" : null);
  let revives = 0;
  // the Stopped card's Restart (Agents.revive): t2 comes up a moment later, as herdr-core reports it
  compat.agents = {
    revive: async (addr: string) => {
      expect(addr).toBe("t1");
      revives++;
      await Bun.sleep(30);
      hub.terminals.set("t2", { address: "t2", state: "live", status: null, labels: { ...SPACE } });
      setTimeout(() => { hub.terminals.get("t2").status = { state: "idle" }; }, 40);
      return "t2";
    },
  };
  return { hub, compat, sent, revives: () => revives };
}

beforeEach(() => forgetAll());

test("a message to a space whose Assistant was killed starts it again and goes to the new one, once", async () => {
  const { hub, compat, sent, revives } = world();
  // the page asks, loses the answer, asks again with the same id (send-once.ts); a second device sends meanwhile
  const first = act(hub, { type: "send", chat: "p:sp1", text: "hello", cid: "c1" }, compat);
  const again = act(hub, { type: "send", chat: "p:sp1", text: "hello", cid: "c1" }, compat);
  const other = act(hub, { type: "send", chat: "p:sp1", text: "and this", cid: "c2" }, compat);
  const [a, b, c]: any[] = await Promise.all([first, again, other]);
  expect(a).toMatchObject({ ok: true });
  expect(b).toEqual(a);
  expect(c).toMatchObject({ ok: true });
  // one restart for both messages, each message in once, both to the new Assistant, never to the finished one
  expect(revives()).toBe(1);
  expect(sent.map((s) => s.addr)).toEqual(["t2", "t2"]);
  expect(sent.map((s) => s.text).sort()).toEqual(["and this", "hello"]);
  // the page knows its message again in the new chat by its id
  expect(compat.sends.get("t2").map((s: any) => s.cid).sort()).toEqual(["c1", "c2"]);
  // asked again after it went in: the same answer, nothing sent again
  expect(await act(hub, { type: "send", chat: "p:sp1", text: "hello", cid: "c1" }, compat)).toEqual(a);
  expect(sent.length).toBe(2);
});

test("one that started meanwhile (the Restart card, another device) gets the message: no second start", async () => {
  const { hub, compat, sent, revives } = world();
  hub.terminals.set("t5", { address: "t5", state: "live", status: { state: "idle" }, labels: { ...SPACE } });
  // the snapshot still names the finished one
  await act(hub, { type: "send", chat: "p:sp1", text: "hi", cid: "c3" }, compat);
  expect(revives()).toBe(0);
  expect(sent).toEqual([{ addr: "t5", text: "hi" }]);
});

test("a busy restarted Assistant gets the message at its turn, not typed over its work", async () => {
  const { hub, compat, sent } = world();
  compat.agents.revive = async () => {
    hub.terminals.set("t2", { address: "t2", state: "live", status: { state: "working" }, labels: { ...SPACE } });
    return "t2";
  };
  const r: any = await act(hub, { type: "send", chat: "p:sp1", text: "later", cid: "c4" }, compat);
  expect(r).toMatchObject({ ok: true, waiting: true });
  expect(sent).toEqual([]);
  hub.terminals.get("t2").status = { state: "idle" };
  for (let i = 0; i < 40 && !sent.length; i++) await Bun.sleep(100);
  expect(sent).toEqual([{ addr: "t2", text: "later" }]);
});

// hc for the fresh start: records what it was asked to run, answers as herdr-core does
const dir = mkdtempSync(join(tmpdir(), "shep-ended-")), ran = join(dir, "ran.txt"), hcFile = join(dir, "hc");
writeFileSync(hcFile, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${ran}"\n[ "$1" = run ] && echo '{"address":"t7","first_message":{"sent":true}}'\nexit 0\n`, { mode: 0o755 });
const hcWas = process.env.SHEPHERDR_HC;
afterAll(() => { if (hcWas === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = hcWas; });

test("one that can't start again (its record gone) gives way to a fresh Assistant, the message its task, once", async () => {
  process.env.SHEPHERDR_HC = hcFile;
  writeFileSync(ran, "");
  const { hub, compat, sent } = world();
  compat.agents.revive = async () => { throw new Error("t1 isn't running here any more."); };
  const [a, b]: any[] = await Promise.all([
    act(hub, { type: "send", chat: "p:sp1", text: "start over", cid: "c5" }, compat),
    act(hub, { type: "send", chat: "p:sp1", text: "start over", cid: "c5" }, compat),
  ]);
  expect(a).toMatchObject({ ok: true, started: true, addr: "t7" });
  expect(b).toEqual(a);
  const runs = readFileSync(ran, "utf8").split("\n").filter((l) => l.startsWith("run "));
  expect(runs.length).toBe(1);
  expect(runs[0]).toContain("herdr.coordinator.space=sp1");
  expect(runs[0]).toMatch(/start over$/);
  expect(sent).toEqual([]);
});

test("Agents.revive restarts a finished Assistant from its record: its CLI, flags and conversation", async () => {
  // what herdr-task's tick recorded while it ran (revive.py record_of); the terminal itself has no foreground left
  const rec = { kind: "codex", session: "019a0000-0000-7000-8000-000000000001", log: "/home/me/.codex/sessions/rollout-019a0000-0000-7000-8000-000000000001.jsonl",
    argv: ["codex", "--no-daemon", "-m", "gpt-6.2-sol", "-c", 'model_reasoning_effort="high"'] };
  const t = { ...ended(), argv: ["sh", "-c", "exec codex --no-daemon -m gpt-6.2-sol"], labels: { ...SPACE, "herdr.resume": JSON.stringify(rec) } };
  const hub: any = { terminals: new Map([["t1", t]]), call: async () => { throw new Error("offline"); } };
  const agents = new Agents(hub);
  const restart = spyOn(agents, "restart").mockImplementation((async () => "t2") as any);
  expect(await agents.revive("t1", null)).toBe("t2");
  const [addr, reader, pick] = restart.mock.calls[0] as any[];
  expect(addr).toBe("t1");
  expect(reader).toEqual({ kind: "codex", path: rec.log, argv: rec.argv });
  expect(pick).toMatchObject({ kind: "codex", model: "gpt-6.2-sol", effort: "high" });
});

// SHEP-324: herdr-core lost the Assistant's program and kept its terminal as a plain shell (still "live"): the message
// was typed into that shell as a command. Now it counts as ended: it starts again and the message goes to the new one.
test("an Assistant whose terminal is left a plain shell starts again; nothing is typed into the shell", async () => {
  const { hub, compat, sent, revives } = world();
  const shell = { address: "t1", state: "live", status: { state: "idle", app: "claude-code" }, labels: { ...SPACE, "herdr.agent": "claude" },
    foreground: { name: "bash", argv: ["/bin/bash"], pid: 7 } };
  hub.terminals.set("t1", shell);
  hub.front = async (a: string) => (a === "t1" ? "shell" : "agent");
  const r: any = await act(hub, { type: "send", chat: "p:sp1", text: "ls -la; hello", cid: "c9" }, compat);
  expect(r).toMatchObject({ ok: true });
  expect(revives()).toBe(1);
  expect(sent).toEqual([{ addr: "t2", text: "ls -la; hello" }]);
});
