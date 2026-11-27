import { expect, test } from "bun:test";
import { answerQueued, CodexQueue, questionScreen, type QueuedQuestion } from "./codex-queue.ts";

const first: QueuedQuestion = { id: "colour", text: "Which colour?", choices: ["Red", "Blue"], at: 10 };
const second: QueuedQuestion = { id: "nickname", text: "What nickname?", choices: [], at: 11 };
const third: QueuedQuestion = { id: "size", text: "Which size?", choices: ["Small", "Large"], at: 12 };
const heading = "• Working (15s • esc to interrupt)\n\n• Queued follow-up inputs\n";
const prompt = "\n› Ask Codex to do anything\n\n  ← for agents · ? for shortcuts";
const collapsed = (count: number) => heading + `  ? ${count} questions\n    shift+← to answer\n` + prompt;
const editor = (q: QueuedQuestion, at: number, count: number, choice = 0) =>
  heading + `\n\n  ${count > 1 ? `${at + 1} of ${count}\n  ` : ""}${q.text}\n\n` +
  (q.choices.length ? [...q.choices, "Other"].map((c, i) => `  ${i === choice ? "›" : " "} ${i + 1}. ${c}`).join("\n") : "  Type your answer")
  + "\n\n  enter submit   ^] skip   shift+→ main prompt";

test("Codex picker count is distinct from an unrelated terminal view", () => {
  expect(questionScreen(collapsed(3))).toEqual({ count: 3 });
  expect(questionScreen("  ? 3 questions\n Run this command?")).toBeNull();
  expect(questionScreen(prompt)).toEqual({ count: 0 });
});

test("a local skip removes only the question that was showing", () => {
  const q = new CodexQueue();
  const r = { path: "rollout", conv: { asyncQuestions: new Map([first, second, third].map((x) => [x.id, x])) } };
  q.observe(q.pending(r), editor(second, 1, 3));
  q.observe(q.pending(r), editor(third, 1, 2));
  expect(q.pending(r)).toEqual([first, third]);
  q.observe(q.pending(r), editor(first, 0, 1));
  expect(q.pending(r)).toEqual([first]);
  q.observe(q.pending(r), prompt);
  expect(q.pending(r)).toEqual([]);
  expect(q.pending({ ...r, path: "new-rollout" })).toEqual([first, second, third]);
});

test("the app navigates to a later question and verifies the selected option before submitting", async () => {
  const screens = [collapsed(3), editor(first, 0, 3), editor(third, 2, 3), editor(third, 2, 3, 1), editor(first, 0, 2), editor(first, 0, 2)];
  const keys: string[][] = [];
  expect(await answerQueued({
    read: async () => screens.shift() ?? null, keys: async (...key) => { keys.push(key); return true; }, paste: async () => false,
  }, [first, second, third], third, { choice: 1 })).toBeNull();
  expect(keys).toEqual([["shift+left"], ["shift+left", "shift+left"], ["down"], ["enter"], ["shift+right"]]);
});

test("an old card cannot submit a choice after the terminal changes questions", async () => {
  const keys: string[][] = [];
  const similar = { ...first, text: "Which colour? For the header", choices: ["Red", "Blue"] };
  expect(await answerQueued({
    read: async () => editor(similar, 0, 1), keys: async (...key) => { keys.push(key); return true; }, paste: async () => false,
  }, [first], first, { choice: 0 })).toMatch(/picker changed/);
  expect(keys).toEqual([]);
});
