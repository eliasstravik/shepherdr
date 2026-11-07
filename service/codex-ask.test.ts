// Codex's own questions (request_user_input) on a chat card (SHEP-91): Codex gives no hook for them, so the card's
// answer is pressed on its screen, only while that shows the questions the card was drawn from. A fake hc logs what
// it was asked to press and shows a made-up picker.
import { expect, test } from "bun:test";
import { codexQuestions } from "../core/asks.js";
import { codexQuestion } from "./compat.ts";
import { answerCodex } from "./codex-ask.ts";

const PICKER = [
  "  Question 1/2 (2 unanswered)",
  "  Which color?",
  "  › 1. Red                Choose red.",
  "    2. Blue               Choose blue.",
  "    3. None of the above  Optionally, add details in notes (tab)",
  "  tab to add notes | enter to submit answer | esc to interrupt",
].join("\n");
const QS = codexQuestions({ questions: [
  { question: "Which color?", header: "Color", options: [{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }] },
  { question: "Which size?", header: "Size", options: [{ label: "Small" }, { label: "Large" }] },
] });
// a fake hc: `read` shows the screen, anything else is logged as pressed
let screen = "", log: string[] = [];
const hc = async (args: string[]) => {
  if (args[0] === "read") return { code: 0, stdout: screen };
  log.push(args.join(" "));
  return { code: 0, stdout: "" };
};
const A = { answerCodex: (addr: string, qs: any[], b: any) => answerCodex(hc, addr, qs, b) };
const pressed = () => log;
const fresh = (s: string) => { screen = s; log = []; };

test("the card: a step for each question, its choices and Other", () => {
  const q = codexQuestion({ id: "q12", questions: QS }, "p:sp1");
  expect(q).toMatchObject({ id: "cq:q12", title: "2 questions", other: true, parts: [{ title: "Which color?", header: "Color" }, { title: "Which size?" }] });
  expect(q.parts![0].choices).toEqual([{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }]);
  const one = codexQuestion({ id: "q3", questions: QS.slice(0, 1) }, "p:sp1");
  expect(one).toMatchObject({ id: "cq:q3", title: "Which color?", other: true, choices: [{ label: "Red" }, { label: "Blue" }] });
});

test("picks are number keys; words of one's own go in the last choice's notes", async () => {
  fresh(PICKER);
  expect(await A.answerCodex("t7", QS, { answers: ["Blue", "Medium, please"] })).toBeNull();
  expect(pressed()).toEqual(["keys t7 2", "keys t7 down down tab", "send --force t7 Medium, please"]);
});

test("a single question: its pick or Other", async () => {
  const one = [QS[0]];
  fresh(PICKER.replace("1/2 (2 unanswered)", "1/1 (1 unanswered)"));
  expect(await A.answerCodex("t7", one, { choice: 0 })).toBeNull();
  expect(pressed()).toEqual(["keys t7 1"]);
  fresh(PICKER.replace("1/2 (2 unanswered)", "1/1 (1 unanswered)"));
  expect(await A.answerCodex("t7", one, { other: "Green" })).toBeNull();
  expect(pressed()).toEqual(["keys t7 down down tab", "send --force t7 Green"]);
});

test("nothing is pressed once the screen shows something else", async () => {
  fresh("› Ask Codex to do anything");
  expect(await A.answerCodex("t7", QS, { answers: ["Red", "Small"] })).toMatch(/answer it in the terminal/);
  expect(pressed()).toEqual([]);
});

test("Dismiss is Esc; Answer in terminal presses nothing", async () => {
  fresh(PICKER);
  expect(await A.answerCodex("t7", QS, { dismiss: true })).toBeNull();
  expect(await A.answerCodex("t7", QS, { terminal: true })).toBeNull();
  expect(pressed()).toEqual(["keys t7 esc"]);
});
