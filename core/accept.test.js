import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCEPT, acceptLabel, docOpen, docsMore, words, readable, whereNow, commitsLine, filesLine, moreLine, proofTitle } from "./accept.js";

const root = join(import.meta.dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

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
  const mod = read("mods/accept-card/main.js"), web = read("web/src/screens/Accept.tsx");
  expect(mod).toContain("acceptLabel(e)");
  expect(web).toContain("A.acceptLabel(e)");
});

test("the window's card and the web's read their words from here, not their own", () => {
  const mod = read("mods/accept-card/main.js"), web = read("web/src/screens/Accept.tsx");
  expect(mod).toContain('from "./core/accept.js"');
  expect(web).toContain("@core/accept.js");
  for (const w of ["Reading the task", "No summary.", "No proof artifact.", "Already accepted.", "Not ready right now"]) {
    expect(mod).not.toContain(w);
    expect(web).not.toContain(w);
  }
});

test("its documents: a Markdown-only task opens its first, both cards draw them, more says how many more", () => {
  const list = [{ path: "a.md" }, { path: "b.md" }];
  expect([docOpen({ only: true, list }, 0), docOpen({ only: true, list }, 1)]).toEqual([true, false]);
  expect(docOpen({ only: false, list }, 0)).toBe(false); // a code task's notes stay folded
  expect(docOpen(null, 0)).toBe(false);
  expect(docsMore({ count: 7, list })).toBe(5);
  expect(docsMore(undefined)).toBe(0);
  const mod = read("mods/accept-card/main.js"), web = read("web/src/screens/Accept.tsx");
  expect(mod).toContain("ACCEPT.documents");
  expect(web).toContain("A.ACCEPT.documents");
});

test("the window draws a document's tables and quotes, and its words as written", () => {
  const src = read("mods/accept-card/main.js");
  const mdBlocks = new Function(`${src.slice(src.indexOf("function mdBlocks"), src.indexOf("const capital"))}; return mdBlocks;`)();
  expect(mdBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> keep it\n> short\n\n<script>x</script>")).toEqual([
    { kind: "code", text: "| A | B |\n| 1 | 2 |", table: true },
    { kind: "quote", text: "keep it short" },
    { kind: "para", text: "<script>x</script>" }, // text, never markup: the window has no HTML
  ]);
});
