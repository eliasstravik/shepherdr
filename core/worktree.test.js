import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VIEW_WORDS, CHANGE_WORDS, CHECK_WORDS, PR_STATES, LIST_DIR, dirEntries, markOf, noChanges, againstLine, filesCount } from "./worktree.js";

// The window's task views say what the web app's Files, Changes and Pull request say: the words live here, and the
// mods must still show each of them (word for word), so the two can't drift apart.
const mod = (name) => readFileSync(new URL(`../mods/${name}/main.js`, import.meta.url), "utf8");
const window = ["task-files", "task-changes", "task-pr"].map(mod).join("\n");

describe("the task views' words are the window's", () => {
  test("every word of Files, Changes and Pull request is in the window's mods", () => {
    // All files: the web's back button's label; the window's back chevron says nothing (no tooltips, SHEP-25)
    const said = Object.entries({ ...VIEW_WORDS, ...CHANGE_WORDS, ...CHECK_WORDS, ...PR_STATES }).filter(([k]) => k !== "allFiles");
    for (const [k, w] of said) expect([k, window.includes(w)]).toEqual([k, true]);
  });
  test("the templated lines read as the window's", () => {
    expect(noChanges("main")).toBe("No changes against main");
    expect(noChanges(null)).toBe("No uncommitted changes");
    expect(againstLine("main")).toBe("Against main");
    expect(againstLine(null)).toBe("Uncommitted");
    expect(filesCount(1)).toBe("1 file");
    expect(filesCount(1200)).toBe("1,200 files");
    expect(window).toContain("No changes against ${this.vs.label}");
    expect(window).toContain("`Against ${this.vs.label}`");
  });
});

describe("Files lists a folder as the window's", () => {
  test("the same listing script as mods/task-files", () => {
    expect(mod("task-files")).toContain(LIST_DIR.replaceAll("\\0", "\\\\0"));
  });
  test("folders first, then by name", () => {
    expect(dirEntries("f\0b.txt\0d\0src\0f\0a.txt\0")).toEqual([{ name: "src", dir: true }, { name: "a.txt", dir: false }, { name: "b.txt", dir: false }]);
  });
  test("a change's letter", () => {
    expect(["??", "A ", "UU", " D", " M"].map(markOf)).toEqual(["A", "A", "U", "D", "M"]);
  });
});
