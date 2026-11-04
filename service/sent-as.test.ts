import { expect, test } from "bun:test";
import { sentAs } from "./compat.ts";

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
  expect(sentAs([send()], { text: "thumbnails broken", at: 1_000 }, new Set())).toBeUndefined();
});
