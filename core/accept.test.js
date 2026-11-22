import { expect, test } from "bun:test";
import { ACCEPT, acceptLabel, docOpen, docsMore, words, readable, whereNow, commitsLine, filesLine, moreLine, proofTitle } from "./accept.js";

test("a long old summary keeps its first sentence; the whole goes under Details", () => {
  const long = `Fixed the login. ${"More words here. ".repeat(12)}`;
  const w = words({ summary: long });
  expect(w.summary).toBe("Fixed the login. More words here. More words here. More words here. More words here. More words here. More words here. More words here. More words here.");
  expect(w.details).toBe(long.trim());
  expect(words({ summary: "Short.", details: "x" })).toEqual({ summary: "Short.", details: "x" });
});

test("plain details become bullets, clear paths as code; markdown stays", () => {
  expect(readable("Changed web/src/App.tsx. The tests pass now; all good")).toBe("- Changed `web/src/App.tsx`\n- The tests pass now; all good");
  expect(readable("- one\n- two")).toBe("- one\n- two");
});

test("the card's words", () => {
  expect(ACCEPT.title("HERD-4")).toBe("Accept HERD-4?");
  expect(whereNow({ state: "done", accepted_at: 1 })).toBe("Already accepted.");
  expect(whereNow({ state: "done" })).toBe("Already done.");
  expect(whereNow({ state: "work", status_text: "Working" })).toBe("Not ready right now: it's in Working.");
  expect([commitsLine(1), filesLine(3), moreLine(2)]).toEqual(["1 commit", "3 files changed", "And 2 more"]);
  expect(proofTitle("HERD-4: Login works")).toBe("Login works");
});

// SHEP-225 (#1046): the button says what pressing it does
test("Accept says whether it merges", () => {
  expect(acceptLabel({ merges: true })).toBe("Accept and merge");
  expect(acceptLabel({ merges: false })).toBe("Accept");
  expect(acceptLabel(undefined)).toBe("Accept"); // still being read
});

test("its documents: a Markdown-only task opens its first, more says how many more", () => {
  const list = [{ path: "a.md" }, { path: "b.md" }];
  expect([docOpen({ only: true, list }, 0), docOpen({ only: true, list }, 1)]).toEqual([true, false]);
  expect(docOpen({ only: false, list }, 0)).toBe(false); // a code task's notes stay folded
  expect(docOpen(null, 0)).toBe(false);
  expect(docsMore({ count: 7, list })).toBe(5);
  expect(docsMore(undefined)).toBe(0);
  expect(typeof ACCEPT.documents).toBe("string");
});
