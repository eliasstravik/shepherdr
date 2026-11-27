import { expect, test } from "bun:test";
import { codexChoice, codexQuestions, words, howAnswered, allow, dismiss } from "./asks.js";
import * as A from "./asks.js";

// request_user_input's arguments as Codex 0.163 logs them (a made-up question)
const ARGS = JSON.stringify({ questions: [
  { header: "Color", id: "color", question: "Which color?", options: [{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }] },
  { header: "Size", id: "size", question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
] });
// Codex's picker on its screen, as `hc read` shows it
const SCREEN = [
  "› Ask me two things",
  "",
  "  Question 1/2 (2 unanswered)",
  "  Which color?",
  "",
  "  › 1. Red                Choose red.",
  "    2. Blue               Choose blue.",
  "    3. None of the above  Optionally, add details in notes (tab)",
  "",
  "  tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt",
].join("\n");

test("Codex's questions: each with its header and choices", () => {
  const qs = codexQuestions(ARGS);
  expect(qs).toEqual([
    { text: "Which color?", header: "Color", choices: [{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }] },
    { text: "Which size?", header: "Size", choices: [{ label: "Small" }, { label: "Large" }] },
  ]);
  expect(codexQuestions("not json")).toEqual([]);
});

test("a Codex approval reads as Claude's: its command, allowed or dismissed in the chat", () => {
  // Codex's PermissionRequest hook input (0.163): Bash with the command and Codex's reason
  const w = words({ tool_name: "Bash", tool_input: { command: "touch made.txt", description: "Allow creating made.txt?" }, cwd: "/tmp/x", turn_id: "t1" });
  expect(w).toMatchObject({ kind: "permission", title: "Run: touch made.txt", detail: "Allow creating made.txt?\ntouch made.txt" });
  expect(howAnswered({ words: w }, allow(), "on the web")).toBe("Allowed on the web");
  expect(howAnswered({ words: w }, dismiss("permission"), "on the web")).toBe("Dismissed on the web");
  // Codex refuses an answer that rewrites its input: a permission's allow has none
  expect(JSON.parse(allow()).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
});

// GitHub #1428: one question's answer as words, whatever shape the card sent it in
test("stepWords: a pick, several picks, own words, a plain string; nothing else", () => {
  const names = ["Red", "Blue", "Green"];
  expect(A.stepWords({ choice: 1 }, names)).toBe("Blue");
  expect(A.stepWords({ choices: [0, 2] }, names)).toBe("Red, Green");
  expect(A.stepWords({ other: "  Teal " }, names)).toBe("Teal");
  expect(A.stepWords(" Red ", names)).toBe("Red");
  for (const x of [{ choice: 7 }, { choices: [] }, {}, null, undefined, 3, { other: " " }]) expect(A.stepWords(x, names)).toBe("");
  expect(A.steps([{ choice: 1 }, { choices: [0, "x"] }, { other: "hi" }, "Blue", 5, { nope: 1 }])).toEqual([{ choice: 1 }, { choices: [0] }, { other: "hi" }, "Blue", "", ""]);
});
