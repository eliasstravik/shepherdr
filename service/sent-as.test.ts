import { expect, test } from "bun:test";
import { sentAs, sentParts } from "./compat.ts";

// What a page sent comes back from the agent's log with the page's id (SHEP-22: pictures made the page's own match
// fail, and its bubble stayed under everything newer).
const send = (o: Partial<{ cid: string; text: string; files: string[]; at: number }> = {}) => ({ cid: "c1", text: "thumbnails broken", files: [], at: 10_000, ...o });

test("its words, its pictures as markers Claude Code took out", () => {
  const taken = new Set<string>();
  expect(sentAs([send({ files: ["/a/chat-attach/web-1-a.png"] })], { text: "thumbnails broken", at: 10_400, images: 2 }, taken)).toBe("c1");
  // each send is one message
  expect(sentAs([send()], { text: "thumbnails broken", at: 10_900 }, taken)).toBeUndefined();
});

test("a file's path after the words, where it landed", () => {
  expect(sentAs([send({ files: ["/a/chat-attach/web-1-n.txt"] })], { text: "thumbnails broken\n\n/var/put/p1/web-1-n.txt", at: 10_400 }, new Set())).toBe("c1");
});

test("files alone", () => {
  expect(sentAs([send({ text: "", files: ["/a/web-1-a.png"] })], { text: "", at: 10_400, images: 1 }, new Set())).toBe("c1");
});

test("other words, or before it went in, are not it", () => {
  expect(sentAs([send()], { text: "something else", at: 10_400 }, new Set())).toBeUndefined();
  // (well before: another machine's clock may be up to a minute behind)
  expect(sentAs([send()], { text: "thumbnails broken", at: 10_000 - 61_000 }, new Set())).toBeUndefined();
});

// SHEP-312: a pending copy never outlives its message
test("the tag lines a send puts before the words, and another machine's clock half a minute behind", () => {
  const x = { text: '<hc reply-to="Done: the seven"/>\nthumbnails   broken', at: 10_000 - 30_000 };
  expect(sentAs([send()], x, new Set())).toBe("c1");
});

test("two identical messages sent in a row: each its own id, in order", () => {
  const sends = [send({ cid: "A", at: 10_000 }), send({ cid: "B", at: 600_000 })];
  const taken = new Set<string>();
  expect(sentAs(sends, { text: "thumbnails broken", at: 10_300 }, taken)).toBe("A");
  expect(sentAs(sends, { text: "thumbnails broken", at: 600_300 }, taken)).toBe("B");
});

test("two sent in a row that the agent got as one, glued or with a blank line, are each their own again, in order", () => {
  const a = send({ cid: "A", text: "Cut a new release and update me that the task is done then", at: 10_000 });
  const b = send({ cid: "B", text: "What's next in the artifact then?", at: 11_000 });
  for (const text of [`${a.text}${b.text}`, `${a.text}\n\n${b.text}`]) {
    const taken = new Set<string>();
    expect(sentAs([a, b], { text, at: 12_000 }, taken)).toBeUndefined();
    expect(sentParts([a, b], { text, at: 12_000 }, taken)?.map((s) => s.cid)).toEqual(["A", "B"]);
    // each send is one message: the same words again later are not them
    expect(sentParts([a, b], { text, at: 13_000 }, taken)).toBeUndefined();
  }
  // only whole sends, in the order sent, and never just one
  expect(sentParts([a, b], { text: `${b.text}${a.text}`, at: 12_000 }, new Set())).toBeUndefined();
  expect(sentParts([a, b], { text: `${a.text} and more`, at: 12_000 }, new Set())).toBeUndefined();
  expect(sentParts([a, b], { text: a.text, at: 12_000 }, new Set())).toBeUndefined();
});

test("a ! command comes back as its row, its words without the space after the !", () => {
  expect(sentAs([send({ text: "! git status" })], { text: "!git status", at: 10_400 }, new Set())).toBe("c1");
});
