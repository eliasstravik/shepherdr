import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputLine, sendBody, steerNow } from "./send.js";
import { LOG, Conversation, records } from "./chat-log.js";

// A Claude Code terminal as hc sees it: what its screen shows after each call.
function fakeClaude({ lost }) {
  const calls = [];
  let box = "❯ ", status = "idle";
  const screen = () => `● ok\n────\n${box}\n────\n  ⏵⏵ auto mode on`;
  const io = {
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    status: () => status,
    hc: async (args) => {
      calls.push(args[0] === "send" ? "send" : args.join(" "));
      if (args[0] === "send") {
        // the pictures turn into markers; its own Enter is lost while it reads them (lost), else it starts
        box = `❯ [Image #1] [Image #2]${args[2].split("\n")[0]}`;
        if (!lost) { box = "❯ "; status = "working"; return { code: 0, stdout: '{"started":true}' }; }
        await new Promise((r) => setTimeout(r, 120));
        return { code: 0, stdout: JSON.stringify({ started: status === "working" }) };
      }
      if (args[0] === "read") return { code: 0, stdout: screen() };
      if (args[0] === "keys" && args[2] === "enter") { box = "❯ "; status = "working"; }
      return { code: 0, stdout: "" };
    },
  };
  return { io, calls, box: () => box };
}

test("the input box is the last prompt line on Claude Code's screen", () => {
  expect(inputLine("❯ old message\n● reply\n────\n❯ [Image #1]hi\n────")).toBe("❯ [Image #1]hi");
  expect(inputLine("no prompt here")).toBe(null);
});

test("a message with pictures whose Enter Claude Code lost gets it again, once", async () => {
  const c = fakeClaude({ lost: true });
  const r = await sendBody(c.io, "t1", "claude", "look at these\n\n/var/files/t1/a.png\n\n/var/files/t1/b.png");
  expect(r.code).toBe(0);
  expect(c.box()).toBe("❯ ");
  expect(c.calls.filter((x) => x === "keys t1 enter").length).toBe(1);
});

test("one that went in presses nothing more, and words alone are never watched", async () => {
  const c = fakeClaude({ lost: false });
  await sendBody(c.io, "t1", "claude", "look\n\n/var/files/t1/a.png");
  expect(c.calls).not.toContain("keys t1 enter");
  const d = fakeClaude({ lost: false });
  await sendBody(d.io, "t1", "codex", "words only");
  expect(d.calls).toEqual(["send"]);
});

// A Claude Code log as LOG reads it, fed to a Conversation.
async function conv(lines) {
  const dir = mkdtempSync(join(tmpdir(), "queue-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}
const at = "2026-11-04T14:51:02.192Z";
const q = (operation, content, more = {}) => ({ type: "queue-operation", operation, timestamp: at, sessionId: "s", ...(content !== undefined ? { content } : {}), ...more });

test("words typed while Claude Code works show queued until it takes them", async () => {
  const typed = q("enqueue", "[Image #5]what is this");
  expect((await conv([typed])).queued()).toEqual([{ id: expect.any(String), raw: "[Image #5]what is this", at: Date.parse(at), text: "what is this", images: 1 }]);
  // taken in mid-turn, or at the end of its turn
  expect((await conv([typed, q("remove", "[Image #5]what is this", { reason: "absorbed_mid_turn" })])).queued()).toEqual([]);
  expect((await conv([typed, q("dequeue")])).queued()).toEqual([]);
  // a job's end has its place in the queue too: the oldest goes first
  const note = "<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n</task-notification>";
  const c = await conv([q("enqueue", note), typed, q("dequeue")]);
  expect(c.queued().map((x) => x.text)).toEqual(["what is this"]);
});

// A message in Claude Code's own queue: Send now presses Ctrl+Enter only while its screen offers it (#662)
test("Send now on a queued message presses Ctrl+Enter only while Claude Code offers it", async () => {
  const fake = (offers, status = "working") => {
    const calls = [];
    const io = {
      sleep: async () => {},
      status: () => status,
      hc: async (args) => {
        calls.push(args.join(" "));
        return { code: 0, stdout: args[0] === "read" ? `● working\n❯ \n${offers ? "  ctrl+enter to send now" : "  esc to interrupt"}` : "" };
      },
    };
    return { io, calls };
  };
  const on = fake(true);
  expect(await steerNow(on.io, "t1")).toBe(true);
  expect(on.calls).toContain("keys t1 ctrl+enter");
  // not offered: nothing pressed (on an empty prompt Ctrl+Enter would do something else), and it says so
  const off = fake(false);
  expect(await steerNow(off.io, "t1")).toBe(false);
  expect(off.calls.some((c) => c.startsWith("keys"))).toBe(false);
  // the agent no longer works: its queue goes in on its own
  const idle = fake(false, "idle");
  expect(await steerNow(idle.io, "t1")).toBe(false);
  expect(idle.calls.length).toBe(1);
});

// SHEP-93: eleven pictures take Claude Code long to read: the box fills marker by marker, its Enter is lost
function slowClaude({ pics = 11, takes = Infinity, startsOnEnter = 1 } = {}) {
  const calls = [];
  let box = "❯ ", shown = 0, enters = 0, status = "idle", loading = false;
  const io = {
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 2))),
    status: () => status,
    hc: async (args) => {
      calls.push(args[0] === "send" ? "send" : args.join(" "));
      if (args[0] === "send") {
        loading = true;
        // hc send answers before the pictures are read, its Enter lost
        return { code: 0, stdout: '{"started":false}' };
      }
      if (args[0] === "read") {
        // a marker more on each look while it reads them
        if (loading && shown < pics) shown++;
        if (loading) box = `❯ ${Array.from({ length: shown }, (_, i) => `[Image #${i + 1}]`).join(" ")} more images - save to repo`;
        if (shown >= pics) loading = false;
        return { code: 0, stdout: `● ok\n────\n${box}\n────\n  ⏵⏵ auto mode on` };
      }
      if (args[0] === "keys" && args[2] === "enter") {
        enters++;
        // an Enter while it still reads is lost too
        if (!loading && enters >= startsOnEnter && enters <= takes) { box = "❯ "; status = "working"; }
      }
      return { code: 0, stdout: "" };
    },
  };
  return { io, calls, box: () => box, enters: () => enters };
}
const BODY = "more images - save to repo\n\n" + Array.from({ length: 11 }, (_, i) => `/var/files/t1/web-${i}.jpeg`).join("\n\n");
const QUICK = { looks: 60, every: 1, enters: 4 };

test("eleven pictures: Enter lost while they load goes again once the box is still, and it goes in", async () => {
  const c = slowClaude();
  const r = await sendBody(c.io, "t1", "claude", BODY);
  expect(r.code).toBe(0);
  expect(c.box()).toBe("❯ ");
});

test("one that stays in the box is not sent: it fails as stuck, and sending it again presses Enter, never types it twice", async () => {
  const { sendTyped, STUCK } = await import("./send.js");
  const c = slowClaude({ takes: 0 });
  const r = await sendTyped(c.io, "t1", "claude", BODY, QUICK);
  expect(r.code).toBe(1);
  expect(r.stuck).toBe(true);
  expect(r.stderr).toBe(STUCK);
  expect(c.enters()).toBe(4);
  // Retry: the box holds it already
  const again = slowClaude({ takes: Infinity });
  again.io.hc(["send", "t1", BODY]);
  for (let i = 0; i < 12; i++) await again.io.hc(["read", "t1"]);
  again.calls.length = 0;
  const r2 = await sendTyped(again.io, "t1", "claude", BODY, QUICK, true);
  expect(r2.code).toBe(0);
  expect(again.calls).not.toContain("send");
  expect(again.box()).toBe("❯ ");
});

test("a dialog on screen (no box under its rule) is never pressed", async () => {
  const { holds, settleBox } = await import("./send.js");
  const calls = [];
  const io = { sleep: async () => {}, hc: async (args) => { calls.push(args.join(" ")); return { code: 0, stdout: "❯ more images - save to repo\n● reply\n Do you want to proceed?\n❯ 1. Yes\n  2. No" }; } };
  expect(await settleBox(io, "t1", BODY, QUICK)).toBe(true);
  expect(calls.some((c) => c.startsWith("keys"))).toBe(false);
  expect(holds("❯ ", BODY)).toBe(false);
  expect(holds("❯ [Pasted text #1 +12 lines]", "a\nb")).toBe(true);
  // sent again: only this very message counts, never another one starting the same
  expect(holds("❯ [Image #1] [Image #2] more images - save to repo", BODY, true)).toBe(true);
  expect(holds("❯ [Image #1] more images - save to repo and the old ones", BODY, true)).toBe(false);
  expect(holds("❯ [Image #1] other words", BODY, true)).toBe(false);
});

test("a screen that can't be read proves nothing: it keeps looking, and a box that then holds it is stuck", async () => {
  const { settleBox } = await import("./send.js");
  let n = 0;
  const io = { sleep: async () => {}, hc: async (args) => {
    if (args[0] !== "read") return { code: 0, stdout: "" };
    n++;
    return n <= 3 ? { code: 1, stdout: "", stderr: "unreachable" } : { code: 0, stdout: `● ok\n────\n❯ [Image #1] more images - save to repo\n────` };
  } };
  expect(await settleBox(io, "t1", BODY, { looks: 10, every: 1, enters: 0 })).toBe(false);
  // never read at all: hc send's word stands
  const blind = { sleep: async () => {}, hc: async () => ({ code: 1, stdout: "" }) };
  expect(await settleBox(blind, "t1", BODY, { looks: 3, every: 1, enters: 1 })).toBe(true);
});

test("a stuck one taken in late is not typed again by its Retry", async () => {
  const { sendTyped } = await import("./send.js");
  const c = slowClaude();
  const calls = [];
  const io = { ...c.io, hc: async (args) => { calls.push(args[0]); return args[0] === "read" ? { code: 0, stdout: "● ok\n────\n❯ \n────" } : { code: 0, stdout: "" }; } };
  const r = await sendTyped(io, "t1", "claude", BODY, QUICK, true);
  expect(r.code).toBe(0);
  expect(calls).not.toContain("send");
});

test("a file alone (no words, not a picture) still in the box is not taken as sent", async () => {
  const { holds } = await import("./send.js");
  expect(holds("❯ /var/files/t1/report.txt", "/var/files/t1/report.txt")).toBe(true);
  expect(holds("❯ /var/files/t1/report.txt", "/var/files/t1/report.txt", true)).toBe(true);
  expect(holds("❯ ", "/var/files/t1/report.txt")).toBe(false);
});
