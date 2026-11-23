import { expect, test } from "bun:test";
import { placeByTime } from "./compat.ts";
import type { Message } from "../web/shared/types.ts";

// A task's question card sits where it was asked, never held at the end of the chat: newer messages come under it,
// and once it is answered its line stays in the same place (SHEP-419).

const msg = (id: string, at: number): Message => ({ id, who: "agent", at, text: id } as Message);
const ask = (id: string, at: number): Message => ({ id, who: "agent", at, question: { id, title: "Turn it on?", choices: [] } } as unknown as Message);
const ids = (list: Message[]) => list.map((m) => m.id);

test("a card keeps its place by time; newer messages render under it", () => {
  const log = [msg("hello", 100), msg("asked-after", 300), msg("you-said", 400), msg("reply", 500)];
  expect(ids(placeByTime(log, [ask("ask:q1", 200)]))).toEqual(["hello", "ask:q1", "asked-after", "you-said", "reply"]);
});

test("a card newer than everything is last, and several keep their own order", () => {
  const log = [msg("a", 100), msg("b", 200)];
  expect(ids(placeByTime(log, [ask("ask:late", 900), ask("ask:early", 150)]))).toEqual(["a", "ask:early", "b", "ask:late"]);
});

test("an answered card's line stays where the card was", () => {
  const ended = { id: "ae:q1", who: "agent", at: 200, ended: "Watch · Turn it on? · Answered" } as Message;
  expect(ids(placeByTime([msg("hello", 100), msg("later", 300)], [ended]))).toEqual(["hello", "ae:q1", "later"]);
});

test("messages without a time stay put, and the list given is not changed", () => {
  const log = [msg("a", 100), { id: "untimed", who: "agent", text: "x" } as Message, msg("b", 300)];
  const out = placeByTime(log, [ask("ask:q", 200)]);
  expect(ids(out)).toEqual(["a", "untimed", "ask:q", "b"]);
  expect(ids(log)).toEqual(["a", "untimed", "b"]);
});
