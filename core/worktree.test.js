import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { VIEW_WORDS, CHECK_WORDS, PR_STATES, dirEntries, markOf, noChanges, againstLine, filesCount } from "./worktree.js";

// The window's Pull request tab says what the web app's says: the words live here, and mods/task-pr must still show
// each of them (word for word), so the two can't drift apart. Files and Changes are Herdr's own side panels in the
// window (no task tab since SHEP-143), so only the web's views read their words.
const mod = (name) => readFileSync(new URL(`../mods/${name}/main.js`, import.meta.url), "utf8");
const PR_WORDS = ["askingGitHub", "noPr", "noBranch", "openOnGitHub", "copyLink", "copied", "checks", "noChecks"];

describe("the task views' words are the window's", () => {
  test("every word of Pull request is in the window's mod", () => {
    const window = mod("task-pr");
    const said = Object.entries({ ...Object.fromEntries(PR_WORDS.map((k) => [k, VIEW_WORDS[k]])), ...CHECK_WORDS, ...PR_STATES });
    for (const [k, w] of said) expect([k, typeof w === "string" && window.includes(w)]).toEqual([k, true]);
  });
  test("the templated lines", () => {
    expect(noChanges("main")).toBe("No changes against main");
    expect(noChanges(null)).toBe("No uncommitted changes");
    expect(againstLine("main")).toBe("Against main");
    expect(againstLine(null)).toBe("Uncommitted");
    expect(filesCount(1)).toBe("1 file");
    expect(filesCount(1200)).toBe("1,200 files");
  });
});

describe("Files lists a folder", () => {
  test("folders first, then by name", () => {
    expect(dirEntries("f\0b.txt\0d\0src\0f\0a.txt\0")).toEqual([{ name: "src", dir: true }, { name: "a.txt", dir: false }, { name: "b.txt", dir: false }]);
  });
  test("a change's letter", () => {
    expect(["??", "A ", "UU", " D", " M"].map(markOf)).toEqual(["A", "A", "U", "D", "M"]);
  });
});
