import { expect, spyOn, test } from "bun:test";
import { Updates } from "./agent-update.ts";
import { channelOf, doneWords, newer, runningVersion, updateTo, versionOf } from "../core/agent-update.js";
import { Conversation } from "../core/chat-log.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");

/** a hub whose machine has `claude` at `ver`; an update moves it to `to` (or fails) */
function fakeHub(o: { ver: string; to?: string; fail?: boolean; state?: string; others?: number }) {
  let ver = o.ver;
  const calls: string[][] = [];
  const t = { address: "m1/t1", state: "live", created_ms: 1000, status: { app: "claude", state: o.state ?? "idle" }, foreground: { name: "claude" } };
  const terminals = new Map<string, any>([["m1/t1", t]]);
  for (let i = 0; i < (o.others ?? 0); i++) terminals.set(`m1/o${i}`, { ...t, address: `m1/o${i}` });
  terminals.set("m2/x", { ...t, address: "m2/x" });
  const hub: any = {
    terminals,
    call: async (_m: string, p: any) => {
      calls.push(p.argv);
      const words = p.argv.slice(4).join(" ");
      if (words === "claude update") {
        if (o.fail) return { code: 1, stdout: b64("network down\n"), stderr: "" };
        ver = o.to ?? ver;
        return { code: 0, stdout: b64("Updated\n"), stderr: "" };
      }
      return { code: 0, stdout: b64(`${ver} (Claude Code)\n{"autoUpdatesChannel":"latest"}`), stderr: "" };
    },
  };
  return { hub, calls };
}

test("versions: read, compared, the running one", () => {
  expect(versionOf("2.1.332 (Claude Code)")).toBe("2.1.332");
  expect(versionOf("codex-cli 0.163.0")).toBe("0.163.0");
  expect(versionOf("nope")).toBeNull();
  expect(newer("2.1.10", "2.1.9")).toBe(true);
  expect(newer("2.1.9", "2.1.10")).toBe(false);
  expect(newer("1.0.0", "1.0.0-beta")).toBe(true);
  expect(newer("1.0.0", "1.0.0")).toBe(false);
  expect(channelOf("claude", '{"autoUpdatesChannel":"stable"}')).toBe("stable");
  expect(channelOf("codex", '{"autoUpdatesChannel":"stable"}')).toBe("latest");
  // the log's version counts only once this process wrote it
  expect(runningVersion({ version: "1.0.0", versionAt: 500 }, 1000, "1.2.0")).toBe("1.2.0");
  expect(runningVersion({ version: "1.0.0", versionAt: 2000 }, 1000, "1.2.0")).toBe("1.0.0");
  expect(updateTo("1.0.0", "1.2.0")).toBe("1.2.0");
  expect(updateTo("1.2.0", "1.2.0")).toBeNull();
  expect(doneWords("Codex", "1.2.0", 0)).toBe("Codex is now 1.2.0.");
  expect(doneWords("Codex", "1.2.0", 2)).toBe("Codex is now 1.2.0. 2 other chats on this machine get it when they restart.");
});

test("the chat log says which version wrote it (Claude Code and Codex)", () => {
  const c = new Conversation("claude");
  c.claude({ type: "user", version: "2.1.300", timestamp: "2026-11-26T10:00:00Z", message: { content: "hi" } }, 0);
  expect((c.meta as any).version).toBe("2.1.300");
  const x = new Conversation("codex");
  x.codex({ type: "session_meta", timestamp: "2026-11-26T10:00:00Z", payload: { cli_version: "0.160.0" } }, 0);
  expect((x.meta as any).version).toBe("0.160.0");
});

test("a chat on an older version is offered the newest, read in the background", async () => {
  const { hub } = fakeHub({ ver: "2.1.1" });
  const f = spyOn(globalThis, "fetch").mockImplementation((async () => new Response(JSON.stringify({ latest: "2.1.5", stable: "2.1.3" }))) as any);
  try {
    const u = new Updates(hub, async () => "m1/t2");
    let told = 0;
    u.onChange = () => told++;
    const t = hub.terminals.get("m1/t1");
    expect(u.available("claude", t, {}, "m1")).toBeNull();
    await Bun.sleep(10);
    expect(u.available("claude", t, {}, "m1")).toBeNull();
    await Bun.sleep(10);
    expect(u.available("claude", t, {}, "m1")).toBe("2.1.5");
    expect(told).toBeGreaterThan(0);
    // an agent with no updater shows nothing
    expect(u.available("opencode", t, {}, "m1")).toBeNull();
  } finally { f.mockRestore(); }
});

test("update: the CLI's own update on its machine, then the same conversation reopens", async () => {
  const { hub, calls } = fakeHub({ ver: "2.1.1", to: "2.1.5", others: 2 });
  let revived = "";
  const u = new Updates(hub, async (addr) => { revived = addr; return "m1/t2"; });
  const r = await u.update("m1/t1", { kind: "claude", conv: { meta: {} } });
  expect(calls.some((a) => a.slice(4).join(" ") === "claude update" )).toBe(true);
  expect(revived).toBe("m1/t1");
  expect(r).toEqual({ terminal: "m1/t2", version: "2.1.5", words: "Claude Code is now 2.1.5. 2 other chats on this machine get it when they restart." });
});

test("a failed update leaves the chat running as it was", async () => {
  const { hub } = fakeHub({ ver: "2.1.1", fail: true });
  let revived = false;
  const u = new Updates(hub, async () => { revived = true; return "x"; });
  await expect(u.update("m1/t1", { kind: "claude" })).rejects.toThrow("Claude Code couldn't update: network down It keeps running as it was.");
  expect(revived).toBe(false);
});

test("an update that installs nothing newer restarts nothing", async () => {
  const { hub } = fakeHub({ ver: "2.1.1" });
  let revived = false;
  const u = new Updates(hub, async () => { revived = true; return "x"; });
  await expect(u.update("m1/t1", { kind: "claude" })).rejects.toThrow("found no newer version");
  expect(revived).toBe(false);
});

test("a chat already on disk's version but running an old one restarts without a new install", async () => {
  // Claude Code updated itself on disk; this process still runs the old one
  const { hub } = fakeHub({ ver: "2.1.5" });
  let revived = false;
  const u = new Updates(hub, async () => { revived = true; return "m1/t2"; });
  const r = await u.update("m1/t1", { kind: "claude", conv: { meta: { version: "2.1.1", versionAt: 5000 } } });
  expect(revived).toBe(true);
  expect(r.version).toBe("2.1.5");
});

test("a busy agent is asked to finish first", async () => {
  const { hub, calls } = fakeHub({ ver: "2.1.1", to: "2.1.5", state: "working" });
  const u = new Updates(hub, async () => "x");
  await expect(u.update("m1/t1", { kind: "claude" })).rejects.toThrow("busy");
  expect(calls.length).toBe(0);
});
