import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pilotFor, everywhereOf, headerDetail, presetOf, levelOf, blankBeat, currentBeat, OLD_STARTERS, STARTER, EVENTS, PRESETS } from "./autopilot.js";
import { SECTIONS } from "./settings.js";

const { cases } = JSON.parse(readFileSync(new URL("./autopilot.cases.json", import.meta.url), "utf8"));

for (const c of cases) {
  test(`what applies in a space: ${c.name}`, () => {
    const a = pilotFor(c.file, c.space, c.settings ?? null);
    expect({ on: a.on, every: a.every, events: a.events, own: a.own }).toEqual(c.expect);
  });
}

test("herdr-task's list of views is read as the file's map is", () => {
  const view = { space: "sp1", on: true, every: "weekdays 9:00", events: ["ready"], next_run: 5, trigger: "Weekdays at 9:00" };
  expect(pilotFor({ everywhere: { every: "weekdays 9:00", events: ["ready"] }, spaces: [view] }, "sp1")).toEqual(view);
});

test("Everywhere's defaults until set", () => {
  expect(everywhereOf(null)).toEqual({ every: "every 60 minutes", events: [] });
  expect(everywhereOf({ everywhere: { every: null, events: ["stalled", "added"] } })).toEqual({ every: null, events: ["added", "stalled"] });
});

test("the header's words", () => {
  expect(headerDetail({ on: false, next_run: 1 })).toBe("");
  expect(headerDetail({ on: true, pending: {} })).toBe("Queued");
  expect(headerDetail({ on: true, inflight: {}, pending: {} })).toBe("Waking");
  expect(headerDetail({ on: true, events: ["ready"] })).toBe("On events");
  expect(headerDetail({ on: true, events: [] })).toBe("Run now only");
  // SHEP-5: the next heartbeat, near as minutes, further as its time
  const now = new Date(2026, 10, 5, 9, 0, 0).getTime();
  expect(headerDetail({ on: true, next_run: now + 7 * 60000 - 5000 }, now)).toBe("Next in 7 min");
  expect(headerDetail({ on: true, next_run: now + 20000 }, now)).toBe("Next in 1 min");
  expect(headerDetail({ on: true, next_run: now - 5000 }, now)).toBe("Next in 1 min");
  expect(headerDetail({ on: true, next_run: now + 90 * 60000 }, now)).toBe("Next 10:30");
  expect(headerDetail({ on: true, next_run: now + 3 * 86400000 }, now)).toBe("Next Sun");
  expect(presetOf(" Every 60 Minutes ")).toBe("every 60 minutes");
  expect(presetOf("every 2 hours")).toBe(null);
});

test("a space's own settings have Autopilot", () => {
  expect(SECTIONS.find((s) => s.id === "autopilot").space).toBeTruthy();
});

test("a level holds only what it sets", () => {
  const settings = { everywhere: { autopilot: { every: "", events: null } }, spaces: { sp1: { autopilot: { heartbeat: "Go." } } } };
  expect(levelOf(settings)).toEqual({ every: "" });
  expect(levelOf(settings, "sp1")).toEqual({ heartbeat: "Go." });
  expect(levelOf(settings, "sp2")).toEqual({});
  // the starter is a real heartbeat; an earlier version's, never edited, stands for it
  expect([blankBeat(""), blankBeat(STARTER), blankBeat("Ship."), blankBeat(OLD_STARTERS[0])]).toEqual([true, false, false, false]);
  expect([currentBeat(OLD_STARTERS[0]), currentBeat(` ${OLD_STARTERS[0].trim()}\n\n`), currentBeat("Ship.")]).toEqual([STARTER, STARTER, "Ship."]);
  // every earlier starter (the one that said "Don't invent work" too) stands for today's, which drives the project
  expect(OLD_STARTERS.map(currentBeat)).toEqual(OLD_STARTERS.map(() => STARTER));
  expect(STARTER).toContain("Push the project forward");
  expect(STARTER).not.toContain("Don't invent work");
  // 3.1.5's asked; today's decides, and only a take-over alerts the person
  expect(OLD_STARTERS.some((x) => x.includes("ask me once"))).toBe(true);
  expect(STARTER).not.toMatch(/ask me once|Ask before/);
  expect(STARTER).toContain("Never ask me a question on a wake");
  expect(STARTER).toContain("herdr-task alert");
  // SHEP-40: 3.1.7's parked behind an Accept with a bare no-reply; today's works around it, says what waits, and gives a why
  expect(OLD_STARTERS[0]).toContain("Reply only <hc no-reply/>");
  expect(currentBeat(OLD_STARTERS[0])).toBe(STARTER);
  expect(STARTER).toContain("Never park on a task waiting for my Accept");
  expect(STARTER).toContain("never a limit of your own");
  expect(STARTER).toContain('<hc no-reply why="');
  expect(STARTER).not.toContain("Reply only <hc no-reply/>");
});

test("the starter heartbeat, events and default schedule are herdr-task's", () => {
  const py = readFileSync(new URL("../mods/tasks/bin/herdr_task/autopilot.py", import.meta.url), "utf8");
  expect(py).toContain(`STARTER = """${STARTER}"""`);
  expect(py).toContain(`OLD_STARTERS = (${OLD_STARTERS.map((x) => `"""${x}"""`).join(", ")},)`);
  const auto = readFileSync(new URL("../mods/tasks/bin/herdr_task/automations.py", import.meta.url), "utf8");
  expect(auto).toContain(`EVENTS = [${EVENTS.map(([v]) => `"${v}"`).join(", ")}]`);
  expect(py).toContain(`DEFAULT_EVERY = "${PRESETS[2][0]}"`);
});

test("another machine's space: its file read with its lists, its own settings here by its full id", async () => {
  const { READ_LISTS, fileIn, taskLists } = await import("./tasklists.js");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "shep-ap-"));
  mkdirSync(join(home, ".herdr", "tasks"), { recursive: true });
  writeFileSync(join(home, ".herdr", "tasks", ".autopilot.json"), JSON.stringify({ version: 2, spaces: { sp9: { on: true, next_run: 5 } } }));
  writeFileSync(join(home, ".herdr", "tasks", "repo.json"), JSON.stringify({ folder: "/x", tasks: [] }));
  const out = Bun.spawnSync(["sh", "-c", READ_LISTS], { env: { HOME: home, PATH: process.env.PATH } }).stdout.toString();
  const file = fileIn(out, ".autopilot.json");
  expect(file.spaces.sp9.on).toBe(true);
  expect(fileIn(out, ".nothing.json")).toBe(null);
  expect(taskLists(out).map((l) => l.slug)).toEqual(["repo"]);
  // as the service and the window's header read it: named "vm/sp9" here, so its own settings here apply
  const settings = { spaces: { "vm/sp9": { autopilot: { every: "every 2 hours" } } } };
  const a = pilotFor({ ...file, spaces: { "vm/sp9": file.spaces.sp9 } }, "vm/sp9", settings);
  expect([a.on, a.next_run, a.every, a.own]).toEqual([true, 5, "every 2 hours", ["every"]]);
});
