import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputLine, sendBody } from "./send.js";
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
