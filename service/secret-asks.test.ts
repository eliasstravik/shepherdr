// A secret ask nobody needs any more closes by itself (Secrets.sweep): its agent withdrew it (herdr-secret cancel), its
// terminal is gone, or its task finished. It then shows as "No longer needed" where it was asked, never as a box that
// still waits. One the person kept or declined closes without that line. A fake hub; hc is a stand-in that logs.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_LONGER, Secrets } from "./secrets.ts";

const dir = mkdtempSync(join(tmpdir(), "secret-asks-"));
const log = join(dir, "hc.log");
let was: string | undefined;
beforeAll(() => {
  const fake = join(dir, "hc");
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`);
  chmodSync(fake, 0o755);
  was = process.env.SHEPHERDR_HC;
  process.env.SHEPHERDR_HC = fake;
});
afterAll(() => {
  if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was;
  rmSync(dir, { recursive: true, force: true });
});

const term = (address: string, labels: Record<string, string>, state = "live") => ({ address, state, labels });
function world(file = join(dir, `${Math.random()}.json`)) {
  const hub: any = { terminals: new Map<string, any>(), sent: [] as string[], async send(a: string, t: string) { hub.sent.push(`${a}: ${t}`); } };
  hub.terminals.set("t1", term("t1", { "herdr.secret.ask.SLACK_CLIENT_SECRET": "for the Slack app" }));
  hub.terminals.set("t2", term("t2", { "herdr.secret.ask.API_KEY": "-" }));
  return { hub, file, s: new Secrets(hub, () => ({ count: 0, remote: false }), file) };
}
const hcCalls = () => { try { return readFileSync(log, "utf8"); } catch { return ""; } };

test("an ask the agent withdrew ends as No longer needed, at the moment it was asked", async () => {
  const { hub, s } = world();
  const [a] = s.asks().filter((x) => x.name === "SLACK_CLIENT_SECRET");
  await s.sweep();
  expect(s.endsOf("t1")).toEqual([]);
  // herdr-secret cancel clears the label
  hub.terminals.set("t1", term("t1", { "herdr.secret.ask.SLACK_CLIENT_SECRET": "" }));
  expect(await s.sweep()).toBe(true);
  expect(s.asks().map((x) => x.name)).toEqual(["API_KEY"]);
  expect(s.endsOf("t1")).toEqual([{ id: "secret:t1:SLACK_CLIENT_SECRET", address: "t1", name: "SLACK_CLIENT_SECRET", why: "for the Slack app", at: a!.at, how: NO_LONGER }]);
  // nothing changes after
  expect(await s.sweep()).toBe(false);
});

test("its agent's terminal ended or went away: No longer needed", async () => {
  const { hub, s } = world();
  await s.sweep();
  hub.terminals.set("t1", term("t1", { "herdr.secret.ask.SLACK_CLIENT_SECRET": "x" }, "finished"));
  hub.terminals.delete("t2");
  await s.sweep();
  expect(s.endsOf("t1").map((e) => e.how)).toEqual([NO_LONGER]);
  expect(s.endsOf("t2").map((e) => e.how)).toEqual([NO_LONGER]);
  expect(s.asks()).toEqual([]);
});

test("its task finished: the label is cleared and the ask ends", async () => {
  const { s } = world();
  await s.sweep();
  const before = hcCalls();
  await s.sweep((addr) => addr === "t2");
  expect(hcCalls().slice(before.length)).toContain("label t2 herdr.secret.ask.API_KEY=");
  expect(s.endsOf("t2").map((e) => e.how)).toEqual([NO_LONGER]);
  expect(s.endsOf("t1")).toEqual([]);
});

test("kept or declined by the person: it closes without a No longer needed line", async () => {
  const { hub, s } = world();
  await s.sweep();
  await s.keep("all", "SLACK_CLIENT_SECRET", null, { address: "t1" });
  expect(hub.sent[0]).toContain("Declined: SLACK_CLIENT_SECRET");
  hub.terminals.set("t1", term("t1", {}));
  await s.sweep();
  expect(s.endsOf("t1")).toEqual([]);
});

test("an ask that comes back (a link that dropped) opens again; nothing closes while no terminal is known", async () => {
  const { hub, s } = world();
  await s.sweep();
  const all = new Map(hub.terminals);
  hub.terminals.clear();
  expect(await s.sweep()).toBeUndefined();
  expect(s.endsOf("t1")).toEqual([]);
  hub.terminals.set("t2", all.get("t2"));
  await s.sweep();
  expect(s.endsOf("t1").length).toBe(1);
  hub.terminals.set("t1", all.get("t1"));
  await s.sweep();
  expect(s.endsOf("t1")).toEqual([]);
  expect(s.asks().map((x) => x.name).sort()).toEqual(["API_KEY", "SLACK_CLIENT_SECRET"]);
});

test("the moments and the ended asks outlive a restart of the service", async () => {
  const { hub, s, file } = world();
  const at = s.asks().find((x) => x.name === "API_KEY")!.at;
  await s.sweep();
  expect(new Secrets(hub, () => ({ count: 0, remote: false }), file).asks().find((x) => x.name === "API_KEY")!.at).toBe(at);
  hub.terminals.set("t1", term("t1", {}));
  await s.sweep();
  const again = new Secrets(hub, () => ({ count: 0, remote: false }), file);
  expect(again.asks().find((x) => x.name === "API_KEY")!.at).toBe(at);
  expect(again.endsOf("t1").map((e) => e.name)).toEqual(["SLACK_CLIENT_SECRET"]);
});
