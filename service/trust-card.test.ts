// #1441: a task's agent at its CLI's folder-trust screen is Needs you with its own card: plain words on what waits and
// what trusting allows, "Trust this folder and start" and a No that stops the task; the same on the phone and watch.
// Fake data.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { glanceOf } from "./glance.ts";
import { alertsOf } from "./push.ts";

const card = { id: "scr-t7-1", addr: "t7", cli: "Claude Code", state: "open", opened: 1000, words: "Quick safety check",
  all: "/home/me/dev/shop\n\nQuick safety check: Is this a project you created or one you trust?\n\n   1. Yes, I trust this folder\n   2. No, exit",
  choices: [{ label: "Yes, I trust this folder" }, { label: "No, exit" }], at: 0 };
const snapOf = (terms: any[] = [], cards = [card]) => {
  const c = new Compat() as any;
  c.terminalsOf = (a: string) => terms.find((k) => k.address === a) ?? null;
  c.terminalsAll = () => terms;
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.watch = { trustCards: () => cards.map((x) => ({ card: x })), openCard: () => null, cardsOf: () => [] };
  const spaces = [{ id: "sp1", name: "shop", folder: "/home/me/dev/shop", machine: null, assistant: null }];
  const rows = [{ ref: "SHOP-1", slug: "dev-shop", id: 1, title: "Fix the cart", section: "needs", sub: "Asks to trust this folder", machine: null,
    folder: "/home/me/dev/shop", list: "shop", kind: "repo", space: "sp1", worker: "t7", started: 500 }];
  return { c, snap: c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows }) };
};

test("its worker's trust screen: one need, its own card, the task stops on No", () => {
  const { snap } = snapOf();
  expect(snap.needs).toHaveLength(1);
  const [n] = snap.needs;
  expect(n).toMatchObject({ id: "scr-t7-1", chat: "SHOP-1/worker", task: "SHOP-1", place: "sp1" });
  expect(n.question.title).toBe("Trust this folder?");
  expect(n.question.trust).toEqual({ cli: "Claude Code", folder: "/home/me/dev/shop", waits: "Claude Code won't start in /home/me/dev/shop until you trust this folder.",
    allows: "Trusting it lets the folder's project settings and hooks run." });
  expect(n.question.choices.map((x: any) => x.label)).toEqual(["Trust this folder and start", "No, stop the task"]);
});

test("its reviewer's trust screen is the task's need too, and its No only closes the reviewer", () => {
  const reviewer = { address: "t9", parent: "t7", labels: { "herdr.role": "reviewer" }, state: "live" };
  const { snap } = snapOf([reviewer], [{ ...card, id: "scr-t9-1", addr: "t9" }]);
  expect(snap.needs.map((n: any) => [n.id, n.task, n.chat])).toEqual([["scr-t9-1", "SHOP-1", "SHOP-1/worker"]]);
  expect(snap.needs[0].question.choices[1].label).toBe("No, close it");
});

test("the phone and the watch: its words, both buttons short enough, Trust on the notification", () => {
  const { snap } = snapOf();
  const alerts = alertsOf(snap);
  const a: any = [...alerts.values()].find((x: any) => x.answer?.question === "scr-t7-1");
  expect(a.actions).toEqual([{ action: "0", title: "Trust and start" }]);
  const g = glanceOf(snap, alerts, 2000);
  const it: any = g.items.find((i) => i.kind === "needs");
  expect(it.answer).toEqual({ chat: "SHOP-1/worker", question: "scr-t7-1", choices: [{ i: 0, label: "Trust and start" }, { i: 1, label: "No, stop it" }] });
  expect(it.text).toContain("project settings and hooks");
});
