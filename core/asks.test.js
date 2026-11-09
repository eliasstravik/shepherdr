import { expect, test } from "bun:test";
import { codexChoice, codexQuestions, codexOnScreen, codexSteps, words, howAnswered, allow, dismiss } from "./asks.js";

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

test("its screen counts only at the first question, none answered, with every choice shown", () => {
  const qs = codexQuestions(ARGS);
  expect(codexOnScreen(SCREEN, qs)).toBe(true);
  expect(codexOnScreen(SCREEN.replace("Question 1/2 (2 unanswered)", "Question 2/2 (1 unanswered)"), qs)).toBe(false);
  expect(codexOnScreen(SCREEN.replace("Which color?", "Which colour?"), qs)).toBe(false);
  expect(codexOnScreen("› Ask Codex to do anything", qs)).toBe(false);
});

test("a pick is its number key; words of one's own go in None of the above's notes", () => {
  const qs = codexQuestions(ARGS);
  expect(codexSteps(qs, ["Blue", "Small"])).toEqual([{ keys: ["2"] }, { keys: ["1"] }]);
  expect(codexSteps(qs, ["Red", "Medium, please"])).toEqual([{ keys: ["1"] }, { keys: ["down", "down", "tab"] }, { paste: "Medium, please" }]);
  expect(codexSteps(qs, ["Red"])).toBeNull();
  // the card shows "SQLite (Recommended)" as "SQLite" with its tag: either is that choice
  const rec = [{ text: "Which?", header: "", choices: [{ label: "SQLite (Recommended)" }, { label: "Postgres" }] }];
  expect(codexSteps(rec, ["SQLite"])).toEqual([{ keys: ["1"] }]);
  expect(codexChoice(rec[0].choices[0])).toEqual({ label: "SQLite", recommended: true });
  expect(codexSteps(qs, ["Red", " "])).toBeNull();
  // a tenth choice has no number key: down to it and Enter
  const many = [{ text: "Which?", header: "", choices: Array.from({ length: 11 }, (_, i) => ({ label: `C${i}` })) }];
  expect(codexSteps(many, ["C10"])).toEqual([{ keys: [...Array(10).fill("down"), "enter"] }]);
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
