// #1441: a task's agent at its CLI's folder-trust screen is Needs you with its own card: plain words on what waits and
// what trusting allows, the CLI's choices, and a direct link to its terminal.
// Fake data.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { glanceOf } from "./glance.ts";
import { alertsOf } from "./push.ts";

const card = { id: "scr-t7-1", addr: "t7", cli: "Claude Code", state: "open", opened: 1000, words: "Quick safety check",
  all: "/home/me/dev/shop\n\nQuick safety check: Is this a project you created or one you trust?\n\n   1. Yes, I trust this folder\n   2. No, exit",
  choices: [{ label: "Yes, I trust this folder" }, { label: "No, exit" }], at: 0 };
const snapOf = (terms: any[] = [], cards = [card], section = "needs", needs = "asks") => {
  const c = new Compat() as any;
  c.terminalsOf = (a: string) => terms.find((k) => k.address === a) ?? null;
  c.terminalsAll = () => terms;
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.watch = { openCards: () => cards, openCard: () => null, cardsOf: () => [] };
  const spaces = [{ id: "sp1", name: "shop", folder: "/home/me/dev/shop", machine: null, assistant: null }];
  const rows = [{ ref: "SHOP-1", slug: "dev-shop", id: 1, title: "Fix the cart", section, needs, sub: "Asks to trust this folder", machine: null,
    folder: "/home/me/dev/shop", list: "shop", kind: "repo", space: "sp1", worker: "t7", started: 500 }];
  return { c, snap: c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows }) };
};

test("an inferred wait stays visible while a handoff alerts for that task", () => {
  const { snap } = snapOf([], [], "needs", "reply");
  expect(snap.needs).toMatchObject([{ task: "SHOP-1", assistantFirst: true }]);
  expect(alertsOf(snap).size).toBe(0);
  expect(glanceOf(snap, alertsOf(snap), 2000).items).toMatchObject([{ task: "SHOP-1", alert: false }]);
  snap.alerts = [{ id: "handoff", task: "SHOP-1", at: 1900, place: "sp1", title: "Approve the cost?", body: "The store asks for payment.", notify: true }];
  const alerts = alertsOf(snap);
  expect(alerts.get("alert:handoff")?.url).toBe("./?place=sp1&task=SHOP-1");
  expect(glanceOf(snap, alerts, 2000).items).toMatchObject([{ task: "SHOP-1", title: "Approve the cost?", alert: true }]);
});

test("its worker's trust screen has one Needs you card with the original choices", () => {
  const { snap } = snapOf();
  expect(snap.needs).toHaveLength(1);
  const [n] = snap.needs;
  expect(n).toMatchObject({ id: "scr-t7-1", chat: "SHOP-1/worker", task: "SHOP-1", place: "sp1" });
  expect(n.question.title).toBe("Trust this folder?");
  expect(n.question.trust).toEqual({ cli: "Claude Code", folder: "/home/me/dev/shop", waits: "Claude Code won't start in /home/me/dev/shop until you trust this folder.",
    allows: "Trusting it lets the folder's project settings and hooks run." });
  expect(n.question.choices.map((x: any) => x.label)).toEqual(["Yes, I trust this folder", "No, exit"]);
});

test("its reviewer's trust screen is the task's need too and opens the reviewer's terminal", () => {
  const reviewer = { address: "t9", parent: "t7", labels: { "herdr.role": "reviewer" }, state: "live" };
  const { snap } = snapOf([reviewer], [{ ...card, id: "scr-t9-1", addr: "t9" }]);
  expect(snap.needs.map((n: any) => [n.id, n.task, n.chat])).toEqual([["scr-t9-1", "SHOP-1", "SHOP-1/worker"]]);
  expect(snap.needs[0].question.terminalChat).toBe("t:t9");
});

test("the phone and the watch show what waits and link to the card", () => {
  const { snap } = snapOf();
  const alerts = alertsOf(snap);
  const a: any = [...alerts.values()].find((x: any) => x.url?.includes("focus=scr-t7-1"));
  expect(a.actions).toBeUndefined();
  const g = glanceOf(snap, alerts, 2000);
  const it: any = g.items.find((i) => i.kind === "needs");
  expect(it.answer).toBeUndefined();
  expect(it.text).toContain("project settings and hooks");
});

test("a startup prompt replaces Working until the terminal moves on", () => {
  const hooks = { ...card, cli: "Codex", words: "Hooks need review\n1 hook is new or changed.",
    all: "Hooks need review", choices: [{ label: "Review hooks" }, { label: "Trust all and continue" }] };
  const { snap } = snapOf([], [hooks], "working");
  expect(snap.needs).toHaveLength(1);
  expect(snap.needs[0].question).toMatchObject({ title: "Hooks need review", screen: hooks.words, choices: hooks.choices });
  expect(snap.tasks[0]).toMatchObject({ status: "need", sub: "Hooks need review", needsAt: hooks.opened, agent: { status: "need" } });
  expect(snapOf([], [], "working").snap.tasks[0].status).toBe("work");
});

test("an in-session dialog makes its own terminal-only Needs you card", () => {
  const dialog = { ...card, dialog: true, all: "", words: "Claude Code can't parse this command safely.",
    choices: [{ label: "Yes" }, { label: "No" }] };
  const { snap } = snapOf([], [dialog], "working");
  expect(snap.tasks[0]).toMatchObject({ status: "need", sub: "Claude Code is waiting for an answer" });
  expect(snap.needs[0].question).toMatchObject({ press: true, screen: dialog.words, choices: dialog.choices });
});
