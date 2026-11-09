// A task chat opened after its agent ended draws its messages (GitHub #779): locate() stops before loadTasks() for an
// ended agent, so the chat has no task list, and mentioned() (the tasks a message names) must still work.
import { expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const none = async () => ({ code: 1, stdout: "", stderr: "" });
mock.module("herdr", () => fakeHerdr({ exec: none, hc: none, agents: () => [], panes: () => [], terminals: () => [], spaces: () => [], machines: () => [] }));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Chat } = await import("../mods/chat/main.js");

test("an ended task's chat, with no task list loaded, still reads its messages' mentions", () => {
  const chat: any = Object.create(Chat.prototype);
  expect(chat.tasks).toBeUndefined();
  expect(chat.mentioned("Done with SHOP-2, see #4")).toEqual([]);
  expect(chat.taskTags("plain words")).toBe("");
});

test("once the task list loads, mentions find its tasks", () => {
  const chat: any = Object.create(Chat.prototype);
  chat.mentioned("SHOP-2");
  chat.tasks = [{ id: 2, ref: "SHOP-2", title: "Shop", folder: "/tmp/shop" }];
  expect(chat.mentioned("SHOP-2").map((x: any) => x.ref)).toEqual(["SHOP-2"]);
});
