import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pilotFor, everywhereOf, headerDetail, presetOf, levelOf, blankBeat, STARTER, EVENTS, PRESETS } from "./autopilot.js";
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
  expect([blankBeat(""), blankBeat(STARTER), blankBeat("Ship.")]).toEqual([true, true, false]);
});

test("the starter heartbeat, events and default schedule are herdr-task's", () => {
  const py = readFileSync(new URL("../mods/tasks/bin/herdr_task/autopilot.py", import.meta.url), "utf8");
  expect(py).toContain(`STARTER = """${STARTER}"""`);
  const auto = readFileSync(new URL("../mods/tasks/bin/herdr_task/automations.py", import.meta.url), "utf8");
  expect(auto).toContain(`EVENTS = [${EVENTS.map(([v]) => `"${v}"`).join(", ")}]`);
  expect(py).toContain(`DEFAULT_EVERY = "${PRESETS[2][0]}"`);
});
