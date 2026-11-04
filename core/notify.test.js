import { expect, test } from "bun:test";
import { spaceLevel, withSpace, withMachine, withEverywhere, notifiesBy, spaceOfTerminal } from "./notify.js";

test("the most specific level wins, and a choice equal to what it would get anyway is dropped", () => {
  let s = withEverywhere({}, "All");
  s = withMachine(s, "vm", "Off");
  expect(spaceLevel(s, "sp1")).toBe("All");
  expect(spaceLevel(s, "vm/sp2")).toBe("Off");
  s = withSpace(s, "vm/sp2", "Needs me");
  expect(spaceLevel(s, "vm/sp2")).toBe("Needs me");
  s = withSpace(s, "vm/sp2", "Off");                // what its machine says: back to following
  expect(s.spaces).toEqual({});
  s = withMachine(s, "vm", "All");                  // what Everywhere says: dropped
  expect(s.machines).toEqual({});
});

test("tasks always notify; an Assistant by its space's level", () => {
  const s = withSpace({}, "sp1", "Off");
  const asst = { address: "t1", labels: { "herdr.coordinator.space": "sp1" } };
  expect(spaceOfTerminal({ address: "vm/t1", labels: { "herdr.space": "sp9" } })).toBe("vm/sp9");
  expect(notifiesBy(s, asst, "need")).toBe(false);
  expect(notifiesBy(s, { address: "t2", labels: { "herdr.task": "x#1", "herdr.space": "sp1" } }, "need")).toBe(true);
  expect(notifiesBy({}, asst, "need")).toBe(true);
  expect(notifiesBy({}, asst, "message")).toBe(false);
  expect(notifiesBy(withEverywhere({}, "All"), asst, "message")).toBe(true);
});
