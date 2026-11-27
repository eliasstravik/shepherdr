// The Recap ask (service/recap.ts): only an idle agent, only when something happened since the last recap, never twice.
import { beforeEach, expect, test } from "bun:test";
import { askRecap, forgetAsks, newSinceRecap, RECAP_ASK, RECAP_WORDS } from "./recap.ts";

const hubWith = (state: string | undefined, live = true) => {
  const sent: string[] = [];
  const hub: any = { terminals: new Map([["t1", { state: live ? "live" : "gone", status: { state } }]]), send: async (_a: string, text: string) => { sent.push(text); return { code: 0, stdout: "", stderr: "" }; } };
  return { hub, sent };
};
const work = [{ kind: "user" }, { kind: "agent" }];
beforeEach(forgetAsks);

test("asks an idle agent once, and not again while its answer comes", async () => {
  const { hub, sent } = hubWith("idle");
  expect(await askRecap(hub, "t1", work, { now: 1000 })).toEqual({ ok: true, asked: true });
  expect(sent).toEqual([RECAP_ASK]);
  await expect(askRecap(hub, "t1", work, { now: 2000 })).rejects.toThrow(RECAP_WORDS.asked);
  expect(sent.length).toBe(1);
});

test("never asks one at work; the Recap action says why", async () => {
  const { hub, sent } = hubWith("working");
  await expect(askRecap(hub, "t1", work)).rejects.toThrow(RECAP_WORDS.busy);
  expect(sent).toEqual([]);
});

test("nothing new since the last recap: no ask", async () => {
  const { hub, sent } = hubWith("idle");
  expect(newSinceRecap([...work, { kind: "recap" }])).toBe(false);
  expect(newSinceRecap([...work, { kind: "recap" }, { kind: "tools" }])).toBe(true);
  await expect(askRecap(hub, "t1", [...work, { kind: "recap" }])).rejects.toThrow(RECAP_WORDS.nothing);
  expect(sent).toEqual([]);
});
