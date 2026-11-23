import { expect, test } from "bun:test";
import { briefPrompt, briefSettings, taskBrief } from "./chat-view.js";

// SHEP-330: a task's brief as its chat's first message. The launch text is herdr-task's brief() (launch.py): the
// worker's instructions, "Your task, <ref>:\n<prompt>", where it works, notes, how to finish, the Settings block.
const PROMPT = "Make the card bigger.\n\nDo:\n- full width on phones\n- tests";
const launch = (extra = []) => [
  "You work on one Herdr task. Stay within the task's scope and folder.\n- Your brief ends with a Settings block.",
  ...extra,
  `Your task, SHOP-3:\n${PROMPT}`,
  "You work in /work/shop on branch task/3-x, from main, which it merges into.",
  "Before you say ready:\n- run the checks",
  "When the work is finished and committed, run `herdr-task ready SHOP-3 --folder /work/shop --summary \"…\"`.",
  "Settings: (from herdr-task show; where the brief above says otherwise, it wins)\n- Review: off\n- Merge: after checks: Herdr merges it",
  "Your space's instructions:\nBe kind.",
].join("\n\n");

test("the prompt is what the Assistant wrote: from 'Your task' to where it works", () => {
  expect(briefPrompt(launch())).toBe(PROMPT);
  expect(briefPrompt(launch(["Before you start:\n- read the docs"]))).toBe(PROMPT);
  // a task in its folder (no worktree line): up to its notes or how to finish
  expect(briefPrompt(launch().replace(/\n\nYou work in [^\n]*/, ""))).toBe(PROMPT);
  expect(briefPrompt("Hello")).toBe("");
  // SHEP-322: the header names the task by its title in quotes (a colon in it too)
  expect(briefPrompt(launch().replace("Your task, SHOP-3:", 'Your task, "Card: bigger on phones":'))).toBe(PROMPT);
});

test("the Settings block's lines, apart", () => {
  expect(briefSettings(launch())).toEqual(["Review: off", "Merge: after checks: Herdr merges it"]);
  expect(briefSettings("no settings here")).toEqual([]);
});

test("the brief: the task's own prompt first, else cut from the launch text, else its title", () => {
  expect(taskBrief({ title: "Bigger card", prompt: "As written.", launch: launch(), state: "read" }))
    .toEqual({ title: "Bigger card", text: "As written.", settings: ["Review: off", "Merge: after checks: Herdr merges it"], from: "Assistant", state: "read" });
  expect(taskBrief({ title: "Bigger card", launch: launch(), state: "read" }).text).toBe(PROMPT);
  expect(taskBrief({ title: "Bigger card" })).toEqual({ title: "Bigger card", text: "Bigger card", from: "Assistant", state: "waiting" });
});
