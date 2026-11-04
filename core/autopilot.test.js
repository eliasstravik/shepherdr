import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pilotFor, everywhereOf, headerDetail, ownWords, summary, presetOf, STARTER, EVENTS, PRESETS } from "./autopilot.js";

const { cases } = JSON.parse(readFileSync(new URL("./autopilot.cases.json", import.meta.url), "utf8"));

for (const c of cases) {
  test(`what applies in a space: ${c.name}`, () => {
    const a = pilotFor(c.file, c.space);
    expect({ on: a.on, every: a.every, events: a.events }).toEqual({ on: c.expect.on, every: c.expect.every, events: c.expect.events });
    expect({ on: a.own.on, every: a.own.every, events: a.own.events }).toEqual(c.expect.own);
  });
}

test("herdr-task's resolved view is taken as it is", () => {
  const view = { space: "sp1", on: true, every: "weekdays 9:00", events: ["ready"], own: { on: true, every: false, events: false, heartbeat: true }, next_run: 5 };
  expect(pilotFor({ everywhere: { on: false }, spaces: [view] }, "sp1")).toEqual({ ...view });
});

test("Everywhere's defaults until set", () => {
  expect(everywhereOf(null)).toEqual({ on: false, every: "every 60 minutes", events: [] });
  expect(everywhereOf({ everywhere: { on: true, every: null, events: ["stalled", "added"] } })).toEqual({ on: true, every: null, events: ["added", "stalled"] });
});

test("the words a space's line and its header say", () => {
  expect(ownWords({ own: { on: false, every: true, events: true, heartbeat: false } })).toBe("Its own: Schedule, Events");
  expect(ownWords({ own: {} })).toBe("Same as everywhere");
  expect(summary({ on: false })).toBe("Off");
  expect(summary({ on: true, trigger: "Every hour" })).toBe("On · Every hour");
  expect(headerDetail({ on: false, next_run: 1 })).toBe("");
  expect(headerDetail({ on: true, pending: {} })).toBe("Queued");
  expect(headerDetail({ on: true, inflight: {}, pending: {} })).toBe("Waking");
  expect(headerDetail({ on: true, events: ["ready"] })).toBe("On events");
  expect(headerDetail({ on: true, events: [] })).toBe("Run now only");
  expect(presetOf(" Every 60 Minutes ")).toBe("every 60 minutes");
  expect(presetOf("every 2 hours")).toBe(null);
});

test("the starter heartbeat, events and picks are herdr-task's", () => {
  const py = readFileSync(new URL("../mods/tasks/bin/herdr_task/autopilot.py", import.meta.url), "utf8");
  expect(py).toContain(`STARTER = """${STARTER}"""`);
  const auto = readFileSync(new URL("../mods/tasks/bin/herdr_task/automations.py", import.meta.url), "utf8");
  expect(auto).toContain(`EVENTS = [${EVENTS.map(([v]) => `"${v}"`).join(", ")}]`);
  expect(py).toContain(`DEFAULT_EVERY = "${PRESETS[2][0]}"`);
});
