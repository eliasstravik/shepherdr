import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputLine, sendBody, steerNow, QUEUED, STEER } from "./send.js";
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

// SHEP-306: Claude Code 2.1.330's real screen right after a message went in mid-turn (hc read, 45 columns, as a phone)
const QUEUED_2_1_330 = `● Counting 1 to 90 with 2-second pauses · 17s
  ⎿  $ for i in $(seq 1 90); do echo $i;
     sleep 2; done (18s · 10 lines)
     (ctrl+b to run in background)
❯ what number now?
  ⎿  Queued · ctrl+enter to send now
✻ Skedaddling… (19s · ↓ 162 tokens)
  ⎿  Tip: Hit shift+tab to cycle between
     manual mode, auto-accept edit mode, and
     plan mode
─────────────────────────────────────────────
❯ Press up to edit queued messages
─────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 3 shells · es…`;
// the same agent working with nothing queued, a draft typed in its box
const DRAFT = `✻ Skedaddling… (19s · ↓ 162 tokens)
─────────────────────────────────────────────
❯ half a thought
─────────────────────────────────────────────
  ⏵⏵ bypass permissions on · esc to interrupt`;

function screens(list, status = () => "working") {
  const calls = [];
  let n = 0;
  const io = {
    sleep: async () => {},
    status,
    hc: async (args) => {
      calls.push(args.join(" "));
      return { code: 0, stdout: args[0] === "read" ? list[Math.min(n++, list.length - 1)] : "" };
    },
  };
  return { io, calls };
}

test("a message sent to a working Claude Code 2.1.330 steers at once (its real screen)", async () => {
  const s = screens([QUEUED_2_1_330, DRAFT.replace("half a thought", "")]);
  expect(await steerNow(s.io, "t1")).toBe(true);
  expect(s.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter"]);
  // sendBody presses it after the send, once
  const sent = screens([DRAFT.replace("half a thought", ""), QUEUED_2_1_330]);
  sent.io.hc = ((hc) => async (args) => (args[0] === "send" ? { code: 0, stdout: '{"started":true}', stderr: "" } : hc(args)))(sent.io.hc);
  expect((await sendBody(sent.io, "t1", "claude", "what number now?")).code).toBe(0);
  expect(sent.calls.filter((c) => c === "keys t1 ctrl+enter").length).toBe(1);
});

test("its box's queued placeholder alone is enough (the hint's words cut or moved)", async () => {
  const s = screens([QUEUED_2_1_330.replace("Queued · ctrl+enter to send now", "Queued")]);
  expect(await steerNow(s.io, "t1")).toBe(true);
  const box = screens(["● working\n────\n❯ Press up to edit queued messages\n────"]);
  expect(await steerNow(box.io, "t1")).toBe(true);
});

test("a queued sign that shows late still steers, within its bound", async () => {
  const late = screens([...Array(STEER.looks - 1).fill(DRAFT.replace("half a thought", "")), QUEUED_2_1_330]);
  expect(await steerNow(late.io, "t1")).toBe(true);
  // never: it gives up after its looks
  const never = screens([DRAFT]);
  expect(await steerNow(never.io, "t1")).toBe(false);
  expect(never.calls.filter((c) => c.startsWith("read")).length).toBe(STEER.looks);
});

test("Ctrl+Enter is never pressed on a draft, a dialog or an idle agent", async () => {
  const draft = screens([DRAFT]);
  expect(await steerNow(draft.io, "t1")).toBe(false);
  expect(draft.calls.some((c) => c.startsWith("keys"))).toBe(false);
  // a dialog of its own open (blocked), even with a message in its queue: Ctrl+Enter could answer it
  const asking = screens([QUEUED_2_1_330], () => "blocked");
  expect(await steerNow(asking.io, "t1")).toBe(false);
  expect(asking.calls.some((c) => c.startsWith("keys"))).toBe(false);
  // a past message that once said "Queued" is not a queued sign: only a ⎿ line under a message is
  expect(QUEUED.test("● I said Queued earlier")).toBe(false);
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


// SHEP-329: the person's message must be in within seconds, always. Claude Code 2.1.330 after Esc with a message queued
// behind a running build (hc read): the build cut off, the message sent at once.
const AFTER_ESC = `● Running project build with python3 build.py
  ⎿  $ python3 build.py
  ⎿  Interrupted · What should Claude do instead?
❯ Quick: what is 9+9?
✽ Cultivating… (1s · ↓ 38 tokens · thinking)
─────────────────────────────────────────────
❯ 
─────────────────────────────────────────────
  ⏵⏵ bypass permissions on · esc to interrupt`;

test("a message still queued after Ctrl+Enter's grace goes in by Esc, once", async () => {
  const stuck = screens([...Array(1 + STEER.grace).fill(QUEUED_2_1_330), AFTER_ESC]);
  expect(await steerNow(stuck.io, "t1")).toBe(true);
  expect(stuck.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter", "keys t1 esc"]);
  // its grace: the screen is looked at that many times between the two keys
  const keys = stuck.calls.map((c, i) => [c, i]).filter(([c]) => c.startsWith("keys")).map(([, i]) => i);
  expect(keys[1] - keys[0] - 1).toBe(STEER.grace);
  // in before the grace ends: no Esc
  const took = screens([QUEUED_2_1_330, QUEUED_2_1_330, AFTER_ESC]);
  await steerNow(took.io, "t1");
  expect(took.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter"]);
});

test("Esc never lands on a dialog or an agent that stopped working meanwhile", async () => {
  let n = 0;
  const asking = screens([QUEUED_2_1_330], () => (n++ < 2 ? "working" : "blocked"));
  await steerNow(asking.io, "t1");
  expect(asking.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter"]);
  let m = 0;
  const done = screens([QUEUED_2_1_330], () => (m++ < 2 ? "working" : "idle"));
  await steerNow(done.io, "t1");
  expect(done.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter"]);
});

test("a Claude Code that puts the message back in its box on Esc gets its Enter", async () => {
  const back = AFTER_ESC.replace(/❯ \n/, "❯ Quick: what is 9+9?\n");
  const s = screens([...Array(1 + STEER.grace).fill(QUEUED_2_1_330), back]);
  await steerNow(s.io, "t1", STEER, "Quick: what is 9+9?");
  expect(s.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter", "keys t1 esc", "keys t1 enter"]);
  // a draft of the person's own in it is never sent
  const draft = screens([...Array(1 + STEER.grace).fill(QUEUED_2_1_330), AFTER_ESC.replace(/❯ \n/, "❯ something else\n")]);
  await steerNow(draft.io, "t1", STEER, "Quick: what is 9+9?");
  expect(draft.calls.filter((c) => c.startsWith("keys"))).toEqual(["keys t1 ctrl+enter", "keys t1 esc"]);
});

test("an unknown status still steers while the screen shows it at work", async () => {
  const wide = QUEUED_2_1_330.replace("es…", "esc to interrupt");
  const s = screens([wide, DRAFT.replace("half a thought", "")], () => null);
  expect(await steerNow(s.io, "t1")).toBe(true);
  const quiet = screens([QUEUED_2_1_330], () => null);
  expect(await steerNow(quiet.io, "t1")).toBe(false);
});

// SHEP-324: what is in front of an agent's terminal before anything is typed into it (herdr-task's agents.front too).
test("inFront: a plain shell, a shell running the agent, the agent, another program, none", async () => {
  const { inFront, NOT_TYPED } = await import("./send.js");
  const live = (fg, labels = {}) => ({ state: "live", foreground: fg, labels });
  expect(inFront(live({ name: "bash", argv: ["/bin/bash"] }))).toBe("shell");
  expect(inFront(live({ name: "/usr/bin/zsh", argv: ["-zsh"] }))).toBe("shell");
  expect(inFront(live({ name: "bash", argv: ["/bin/bash", "-ic", '"$@"; exec "$0" -i', "/bin/bash", "claude"] }))).toBe("agent");
  expect(inFront(live({ name: "fish", argv: ["fish", "-ic", "claude; exec fish -i"] }))).toBe("agent");
  expect(inFront(live({ name: "claude", argv: ["claude"] }, { "herdr.agent": "claude" }))).toBe("agent");
  expect(inFront(live({ name: "node", argv: ["node", "codex"] }, { "herdr.agent": "codex" }))).toBe("agent");
  expect(inFront(live({ name: "vim", argv: ["vim"] }, { "herdr.agent": "claude" }))).toBe("other");
  expect(inFront({ state: "finished" })).toBe("gone");
  expect(inFront(null)).toBe("gone");
  expect(inFront({ state: "live" })).toBeNull();
  expect(NOT_TYPED.shell).toContain("nothing was typed");
});
