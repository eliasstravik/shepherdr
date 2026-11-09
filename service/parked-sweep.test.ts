// Two Herdr windows, on two machines linked both ways, watch the same Assistants (GitHub #761). Each window's sweep
// (lib/parked.js) ends an agent parked behind a chat pane that's gone; a window names another machine's pane
// "<machine>/<pane>", its own machine's as just "<pane>". Neither window may take the other's naming for a pane
// that's gone and end an Assistant whose chat is open.
import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";

type View = { machines: any[]; panes: any[]; terminals: any[]; spaces: any[] };
let view: View;
let killed: string[];
// bun keeps one "herdr" module for the whole run, and a later file's mock.module can only change the names it has:
// so this mock has every name (fake-herdr.ts).
mock.module("herdr", () => fakeHerdr({
  home: () => "/nonexistent",
  readTextFile: async () => "",
  setShared: () => {},
  machines: () => view.machines,
  panes: () => view.panes,
  terminals: () => view.terminals,
  spaces: () => view.spaces,
  agents: () => [],
  focused: () => null,
  shared: () => null,
  run: (name: string, args: any) => { if (name === "terminal.kill") killed.push(args.terminal); },
  exec: async () => ({ code: 0, stdout: "", stderr: "" }),
  hc: async () => ({ code: 0, stdout: JSON.stringify({ keep: true }), stderr: "" }),
  appHome: () => "/nonexistent",
}));
const { sweep, chatAgents } = await import("../mods/tabs-tasks/parked.js");
const { chatPane, chatLabel } = await import("../core/spaces.js");

// Mac A's window: its own machine, plus vmb's spaces through the link. vmb's window: its own, plus "maca".
const windowA = (label: string, pane = "vmb/p7"): View => ({
  machines: [{ name: null, layout: "ready" }, { name: "vmb", layout: "ready" }],
  panes: pane ? [{ pane, mod: "chat", tab: "vmb/tb1" }] : [],
  terminals: [{ address: "vmb/t1", state: "live", status: "idle", labels: { "herdr.chat": label } }],
  spaces: [{ id: "vmb/sp1", tabs: [{ id: "vmb/tb1", index: 0 }] }],
});
const windowB = (label: string, pane = "p7"): View => ({
  machines: [{ name: null, layout: "ready" }, { name: "maca", layout: "ready" }],
  panes: pane ? [{ pane, mod: "chat", tab: "tb1" }] : [],
  terminals: [{ address: "t1", state: "live", status: "idle", labels: { "herdr.chat": label } }],
  spaces: [{ id: "sp1", tabs: [{ id: "tb1", index: 0 }] }],
});
// The sweep ends an agent once its pane is missing twice in a row: two looks.
const sweeps = (v: View) => { view = v; for (let i = 0; i < 2; i++) sweep(); return killed; };

beforeEach(() => { killed = []; });

test("another machine's window leaves an Assistant alone that this machine's window opened in chat view", () => {
  // vmb's window wrote the label as vmb names the pane ("p7"); Mac A's window sees that pane as "vmb/p7"
  expect(sweeps(windowA("p7"))).toEqual([]);
});

test("this machine's window leaves an Assistant alone that another machine's window opened in chat view", () => {
  // an earlier Mac A window wrote its own name for the pane ("vmb/p7") on vmb's terminal
  expect(sweeps(windowB("vmb/p7"))).toEqual([]);
});

test("an agent whose chat pane really closed still ends, in every window", () => {
  expect(sweeps(windowA("p7", ""))).toEqual(["vmb/t1"]);
  killed = [];
  expect(sweeps(windowB("p7", ""))).toEqual(["t1"]);
});

test("each window lists the other's parked Assistant as its chat pane's agent", () => {
  view = windowA("p7");
  expect(chatAgents().map((a: any) => [a.address, a.pane, a.space])).toEqual([["vmb/t1", "vmb/p7", "vmb/sp1"]]);
  view = windowB("vmb/p7");
  expect(chatAgents().map((a: any) => [a.address, a.pane, a.space])).toEqual([["t1", "p7", "sp1"]]);
});

test("the label holds the pane as its own machine names it, read back as each window names it", () => {
  expect(chatLabel("vmb/p7")).toBe("p7");
  expect(chatLabel("p7")).toBe("p7");
  expect(chatLabel(null)).toBe("");
  expect(chatPane({ address: "vmb/t1", labels: { "herdr.chat": "p7" } })).toBe("vmb/p7");
  expect(chatPane({ address: "t1", labels: { "herdr.chat": "vmb/p7" } })).toBe("p7");
  expect(chatPane({ address: "t1", labels: {} })).toBe(null);
  expect(chatPane(undefined)).toBe(null);
});
