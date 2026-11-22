import { describe, expect, test } from "bun:test";
import { VIEW_WORDS, CHECK_WORDS, PR_STATES, dirEntries, markOf, noChanges, againstLine, filesCount } from "./worktree.js";

// A task's Files, Changes and Pull request, in these words.
const PR_WORDS = ["askingGitHub", "noPr", "noBranch", "openOnGitHub", "copyLink", "copied", "checks", "noChecks"];

describe("the task views' words", () => {
  test("every word of Pull request is there", () => {
    const said = Object.entries({ ...Object.fromEntries(PR_WORDS.map((k) => [k, VIEW_WORDS[k]])), ...CHECK_WORDS, ...PR_STATES });
    for (const [k, w] of said) expect([k, typeof w === "string" && w.length > 0]).toEqual([k, true]);
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
