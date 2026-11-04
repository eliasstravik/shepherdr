import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WORDS, clock, bandActs, bandOrder, senderName, briefLabel, newsWords, newsTimeline, resolveArtifacts, fitThumbs, dayLabel, imagesLine, questionsBelow, notSent, unsigned, elapsed, reportMsg, doingWords } from "./chat-view.js";

const ROOT = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("one set of words for the window's chat and the web's", () => {
  // the window's chat (mods/chat) and the web app's (web/plugins/chat, web/src/restart.tsx) read every fixed word
  // from WORDS: none is typed out again as a string in either, so they can't drift apart
  const window = ["mods/chat/main.js"];
  const web = readdirSync(join(ROOT, "web/plugins/chat")).filter((f) => /\.tsx?$/.test(f)).map((f) => `web/plugins/chat/${f}`);
  for (const file of [...window, ...web]) {
    test(file, () => {
      // code only: a comment may quote a word; a toast's title is core/toasts.test.js's to check
      const src = read(file).split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && !/title: `\$\{toastWho/.test(l)).map((l) => l.replace(/\s\/\/ .*$/, "")).join("\n");
      for (const w of Object.values(WORDS)) for (const q of [`"${w}"`, `'${w}'`, `>${w}<`, `\`${w}\``]) expect(src.includes(q) ? `${q} in ${file}` : "").toBe("");
    });
  }
  test("both sides import them", () => {
    expect(read("mods/chat/main.js")).toContain('from "./core/chat-view.js"');
    expect(read("web/plugins/chat/rows.tsx")).toContain("from '@core/chat-view.js'");
  });
});

describe("rows", () => {
  test("a message's time: today's as 14:05, an older one with its day", () => {
    const now = new Date(2026, 10, 4, 18, 0);
    expect(clock(new Date(2026, 10, 4, 14, 5).getTime(), now)).toBe("14:05");
    expect(clock(new Date(2026, 10, 3, 9, 7).getTime(), now)).toBe("3 Nov 09:07");
    expect(clock(0)).toBe("");
  });
  test("the band's actions: rewind on yours (not a /command), fork on the agent's", () => {
    expect(bandActs("user", "hi")).toEqual(["reply", "copy", "rewind"]);
    expect(bandActs("user", "/compact")).toEqual(["reply", "copy"]);
    expect(bandActs("agent", "done")).toEqual(["reply", "copy", "fork"]);
    expect(bandActs("agent", "done", { fork: false })).toEqual(["reply", "copy"]);
  });
  test("who sent a message, never its address", () => {
    const terms = { t1: { labels: { "herdr.role": "reviewer" } }, t2: { labels: { "herdr.role": "coordinator" } }, "vm/t3": { name: "herd-12-fix" } };
    const find = (a) => terms[a] ?? null;
    expect(senderName("t1", "", { find })).toBe("Reviewer");
    expect(senderName("t2", "", { find })).toBe("Assistant");
    expect(senderName("vm/t3", "", { find })).toBe("HERD-12 on vm");
    expect(senderName("t9 shep-7-web", "", { find, taskOf: () => null })).toBe("SHEP-7");
    expect(senderName("box/ppid:12", "From Coverage: hi")).toBe("Coverage");
    expect(senderName("person")).toBe("You");
    expect(unsigned("From HERD-76 (t12u): the words")).toBe("the words");
  });
  test("the band: each side the other's mirror, pills at the bubble's outer edge", () => {
    expect(bandOrder("user", ["reply", "copy", "rewind"])).toEqual(["time", "reply", "copy", "rewind", "react", "pills"]);
    expect(bandOrder("agent", ["reply", "copy", "fork"])).toEqual(["pills", "react", "fork", "copy", "reply", "time"]);
    expect(bandOrder("agent", ["reply", "copy"], { time: false, react: false })).toEqual(["pills", "copy", "reply"]);
    expect(bandOrder("user", ["reply", "copy"], { react: false })).toEqual(["time", "reply", "copy", "pills"]);
  });
  test("a brief's label", () => {
    expect(briefLabel({ from: "t1", text: "x" }, 4, { sender: () => "Reviewer" })).toBe("Message from Reviewer");
    expect(briefLabel({ text: "brief" }, 0, { start: 0, task: true })).toBe("Task brief");
    expect(briefLabel({ text: "brief" }, 0, { start: 0, template: "assistant" })).toBe("New session");
    expect(briefLabel({ text: "<restart>x</restart>" }, 0, { start: 0 })).toBe("New session");
    expect(briefLabel({ text: "hi" }, 0, { start: 0 })).toBe(null);
    expect(briefLabel({ text: "brief" }, 0, { start: 900, task: true })).toBe(null);
  });
  test("a task's news line: what happened and the rest, without its id and title", () => {
    expect(newsWords({ ref: "HERD-4", event: "needs-you", text: "HERD-4 needs you: Needs a go (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "needs", what: "needs you", text: "Needs a go" });
    expect(newsWords({ ref: "HERD-4", event: "ready", text: "HERD-4 is ready: Fix login · It works" }, { title: "Fix login" })).toEqual({ mark: "ready", what: "ready", text: "It works" });
    expect(newsWords({ ref: "HERD-4", event: "working-again", text: "HERD-4 is working again: resumed (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "started", what: "working again", text: "resumed" });
    expect(newsWords({ ref: "HERD-4", event: "done", text: "HERD-4 is done (Fix login)" }, { title: "Fix login" })).toEqual({ mark: "done", what: "done", text: "Fix login" });
    expect(newsWords({ ref: "HERD-4", event: "started", made: true }, { title: "Fix login" })).toEqual({ mark: "started", what: "started", text: "Fix login" });
  });
  test("news lines: Herdr's in place, a start it never said from the task, Accept on the newest ready line", () => {
    const tasks = new Map([["H-1", { title: "A", status: "ready", started: 100, ready_at: 300 }]]);
    const items = [{ kind: "agent", at: 50 }, { kind: "news", id: "n1", at: 300, ref: "H-1", event: "ready", text: "H-1 is ready: A · ok" }];
    const out = newsTimeline(items, tasks, { start: 0 });
    expect(out.map((e) => [e.event, e.made ?? false, e.accept])).toEqual([["started", true, false], ["ready", false, true]]);
  });
  test("which artifact a publish made", () => {
    const arts = [{ id: "a", title: "Plan", version: 2, versions: [{ v: 1, at: 1000, publisher: "t7" }, { v: 2, at: 9000, publisher: "t7" }] }];
    const r = resolveArtifacts([{ kind: "artifact", id: "x1", at: 900 }, { kind: "artifact", id: "x2", at: 8000 }], arts, "t7");
    expect(r.get("x1")).toMatchObject({ id: "a", v: 1, latest: false });
    expect(r.get("x2")).toMatchObject({ id: "a", v: 2, latest: true, title: "Plan", version: 2 });
  });
  test("images under a message keep their shape, fitted, shrunk together to the column", () => {
    expect(fitThumbs([{ w: 1600, h: 1100 }]).boxes[0]).toEqual({ w: 320, h: 220 });
    expect(fitThumbs([{ w: 100, h: 50 }]).boxes[0]).toEqual({ w: 100, h: 50 });
    expect(fitThumbs([null, null]).boxes).toEqual([{ w: 187, h: 140 }, { w: 187, h: 140 }]);
    expect(fitThumbs([{ w: 2000, h: 1000 }, { w: 2000, h: 1000 }], 206).boxes).toEqual([{ w: 101, h: 50 }, { w: 101, h: 50 }]);
  });
  test("day lines and small words", () => {
    const now = new Date(2026, 10, 4, 12);
    expect(dayLabel(now.getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 3).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 20).getTime(), now)).toBe("Tue 20 Oct");
    expect(dayLabel(new Date(2025, 9, 20).getTime(), now)).toBe("Mon 20 Oct 2025");
    expect(imagesLine(1)).toBe("1 image");
    expect(imagesLine(3)).toBe("3 images");
    expect(questionsBelow(0)).toBe("Latest");
    expect(questionsBelow(2)).toBe("2 questions below");
    expect(notSent("Busy.")).toBe("Not sent: Busy. Click to try again.");
    expect(elapsed(75)).toBe("1:15");
  });
});

describe("the working line says what the agent does, in the window and on the web", () => {
  test("its CLI's status report, from either side's terminal", () => {
    // the window's terminals(): a plain status word and the report; the service's herdr-core record: the report in status
    expect(reportMsg({ status: "working", report: { app: "claude-code", msg: "Computing build times", state: "working" } })).toBe("Computing build times");
    expect(reportMsg({ status: { app: "claude-code", msg: " Computing build times ", state: "working" } })).toBe("Computing build times");
    expect(reportMsg({ status: { app: "claude-code", state: "working" } })).toBe("");
    expect(reportMsg({ status: "working", report: null })).toBe("");
    expect(reportMsg(undefined)).toBe("");
  });
  test("its log's open call first, then the report, never a question", () => {
    expect(doingWords({ doing: "Editing main.js" }, "Computing build times")).toBe("Editing main.js");
    expect(doingWords({ doing: null }, "Computing build times")).toBe("Computing build times");
    expect(doingWords(null, "answer: Tea or coffee?")).toBe(null);
    expect(doingWords(null, "")).toBe(null);
  });
  test("both sides read it from here", () => {
    for (const f of ["mods/chat/main.js", "service/compat.ts"]) for (const fn of ["reportMsg(", "doingWords("]) expect(read(f).includes(fn) ? "" : `${fn} not in ${f}`).toBe("");
  });
});
