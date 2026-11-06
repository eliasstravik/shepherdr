import { expect, test } from "bun:test";
import { act } from "./actions.ts";

test("web restart accepts Cursor's parameterized model and keeps read-only permissions", async () => {
  let launched: any;
  const compat: any = { addrOf: () => "cursor-test", reader: () => null, agents: {
    restart: async (_addr: string, _reader: unknown, pick: unknown) => { launched = pick; return "cursor-next"; },
  } };
  const result = await act({} as any, { type: "restart", chat: "test", kind: "cursor", model: "claude-opus-5-5[effort=high,fast=false]", perm: "read-only" }, compat);
  expect(result).toEqual({ ok: true, terminal: "cursor-next" });
  expect(launched).toMatchObject({ kind: "cursor", model: "claude-opus-5-5[effort=high,fast=false]", perm: "read-only" });
});

test("web fork refuses Cursor before starting a second agent in the same conversation", async () => {
  const hub: any = { terminals: new Map([["cursor-test", { status: { app: "cursor" } }]]) };
  const compat: any = { addrOf: () => "cursor-test", reader: () => ({ path: "/log/12345678-1234-1234-1234-123456789abc.jsonl" }) };
  await expect(act(hub, { type: "fork", chat: "test" }, compat)).rejects.toThrow("Cursor CLI does not support copying");
});
