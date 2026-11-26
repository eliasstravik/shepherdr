// Restart in a chat's menu (web/plugins/chat/restart.tsx): a running agent, even a busy or stuck one, opens again on
// the same CLI, model and conversation (Agents.revive, as Update <agent> does); an ended one is the Stopped card's.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { act } from "./actions.ts";

function world(state: string, status: string | null) {
  const hub: any = { terminals: new Map([["t1", { address: "t1", state, status: status ? { state: status } : null, labels: {} }]]), on: () => () => {} };
  const compat = new Compat() as any;
  compat.addrOf = (k: string) => (k === "p:sp1" ? "t1" : null);
  const revived: string[] = [];
  compat.agents = { revive: async (addr: string) => (revived.push(addr), "t2") };
  return { hub, compat, revived };
}

test("Restart on a working (stuck) Assistant reopens it on its own conversation", async () => {
  const { hub, compat, revived } = world("live", "working");
  expect(await act(hub, { type: "agent-restart", chat: "p:sp1" }, compat)).toEqual({ ok: true, terminal: "t2" });
  expect(revived).toEqual(["t1"]);
});

test("Restart on an agent that already ended is refused (its Stopped card restarts it)", async () => {
  const { hub, compat, revived } = world("finished", null);
  await expect(act(hub, { type: "agent-restart", chat: "p:sp1" }, compat)).rejects.toThrow("isn't running");
  expect(revived).toEqual([]);
});
