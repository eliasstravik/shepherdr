// SHEP-19: a space read on a page stayed bold after its next reply. The page marks a chat read once per "last" it saw;
// last must move with each new reply, or the page never marks it again and the row stays bold.
import { expect, test } from "bun:test";
import { placeKey, unreadMarks } from "./compat.ts";
import { toMark, unread } from "../web/src/read-marks.ts";

// what the snapshot says of one space, its Assistant at turn and read up to readAt (core label herdr.chat.read)
const snapOf = (turn: number, readAt: number) => unreadMarks([{ id: "mini/s1", turn, unread: turn > readAt }], placeKey) as any;
const key = placeKey("mini/s1");

test("viewing a space's chat to its end clears it, every reply, on the same page", () => {
  const asked = new Map<string, number>();
  let readAt = 0;
  // the page's MarkRead: on screen and unread, it sends a mark; the service labels the Assistant read at its turn
  const view = (turn: number) => {
    const snap = snapOf(turn, readAt);
    if (toMark(snap, [key], asked)[key]) readAt = turn;
    return unread(snapOf(turn, readAt), key);
  };
  expect(unread(snapOf(1, 0), key)).toBe(true);
  expect(view(1)).toBe(false);
  // a new reply while the page stays open: bold, then read again on view
  expect(unread(snapOf(2, readAt), key)).toBe(true);
  expect(view(2)).toBe(false);
  expect(view(3)).toBe(false);
});

test("read stays read, and a space with no Assistant turn yet is never bold", () => {
  expect(unread(snapOf(4, 4), key)).toBe(false);
  expect(unread(snapOf(0, 0), key)).toBe(false);
});

test("a mark already sent for this reply isn't sent again", () => {
  const asked = new Map<string, number>();
  expect(toMark(snapOf(5, 4), [key], asked)).toEqual({ [key]: 5 });
  expect(toMark(snapOf(5, 4), [key], asked)).toEqual({});
});
