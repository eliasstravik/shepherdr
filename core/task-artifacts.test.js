import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { GREP, publishedIds, taskArtifacts, titleInTask } from "./task-artifacts.js";

const F = "/srv/dev/shop";
const art = (id, more = {}) => ({ id, folder: F, at: 100, versions: [{ v: 1, at: 100, publisher: "t9" }], ...more });
const task = { ref: "SHOP-4", folder: F, machine: null, agents: [{ address: "t5", at: 1000, ended: 5000 }], proof: null };

test("by the task it names, its proof first, then newest first", () => {
  const arts = [art("a-0001", { task: "SHOP-4", at: 10 }), art("b-0002", { task: "shop-4", at: 30 }), art("c-0003", { task: "SHOP-5", at: 40 }), art("p-0004", { task: "SHOP-4", at: 5 })];
  expect(taskArtifacts(arts, { ...task, proof: "p-0004" })).toEqual(["p-0004", "b-0002", "a-0001"]);
});

test("an older one with no task: published by one of its agents while it ran", () => {
  const arts = [
    art("in-0001", { at: 2000, versions: [{ v: 1, at: 2000, publisher: "t5" }] }),
    // the same address, long after that agent ended: another program
    art("late-0002", { at: 90000, versions: [{ v: 1, at: 90000, publisher: "t5" }] }),
    // updated by it: counts too
    art("upd-0003", { at: 3000, versions: [{ v: 1, at: 10, publisher: "t1" }, { v: 2, at: 3000, publisher: "t5" }] }),
    art("other-0004", { at: 2000, versions: [{ v: 1, at: 2000, publisher: "t6" }] }),
  ];
  expect(taskArtifacts(arts, task)).toEqual(["upd-0003", "in-0001"]);
});

test("the chat log's published ids, a fallback for one with no task nor known publisher", () => {
  const arts = [art("log-0001"), art("named-0002", { task: "SHOP-9" })];
  expect(taskArtifacts(arts, task, ["log-0001", "named-0002"])).toEqual(["log-0001"]);
});

test("only its folder's and its machine's", () => {
  const arts = [art("x-0001", { task: "SHOP-4", folder: "/elsewhere" }), art("y-0002", { task: "SHOP-4", machine: "mini" }), art("z-0003", { task: "SHOP-4" })];
  expect(taskArtifacts(arts, task)).toEqual(["z-0003"]);
  expect(taskArtifacts(arts, { ...task, machine: "mini" })).toEqual(["y-0002"]);
  expect(taskArtifacts(undefined, task)).toEqual([]);
});

test("publish's words in a chat log, plain and inside JSON", () => {
  const log = [
    JSON.stringify({ type: "tool_result", content: "Published coverage-by-pack-1a2b v1: SHOP-4: Coverage\nThe person sees it" }),
    JSON.stringify({ content: JSON.stringify({ id: "x", mod: "art-proof-9f9f", installed: true }) }),
    "Published coverage-by-pack-1a2b v2: again",
    "herdr-artifact list shows nope-zz",
  ].join("\n");
  expect(publishedIds(log)).toEqual(["coverage-by-pack-1a2b", "proof-9f9f"]);
  expect(publishedIds("")).toEqual([]);
  // the window greps the log where it is, then reads what grep found the same way
  const found = spawnSync("grep", ["-ohE", GREP], { input: log, encoding: "utf8" }).stdout;
  expect(publishedIds(found)).toEqual(["coverage-by-pack-1a2b", "proof-9f9f"]);
});

test("its title without the task's id in front", () => {
  expect(titleInTask("SHOP-4: Coverage by package", "SHOP-4")).toBe("Coverage by package");
  expect(titleInTask("shop-4 Coverage · Proof", "SHOP-4")).toBe("Coverage · Proof");
  expect(titleInTask("Coverage", "SHOP-4")).toBe("Coverage");
  expect(titleInTask("SHOP-4", "SHOP-4")).toBe("SHOP-4");
  expect(titleInTask("SHOP-40: Other", "SHOP-4")).toBe("SHOP-40: Other");
  expect(titleInTask("SHOP-4: Checkout · Proof", "SHOP-4", true)).toBe("Checkout");
  expect(titleInTask("SHOP-4: Checkout · Proof", "SHOP-4")).toBe("Checkout · Proof");
});
