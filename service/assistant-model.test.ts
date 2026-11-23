// SHEP-298: the chat's model button said Settings' Assistant (Opus 5.5) for a space created with Fable 5.2 picked, while
// its Assistant ran Fable: before the chat itself came, the page had only Settings to go by. Now every space in the
// snapshot says what its Assistant runs (its CLI's arguments, its log, its resume label once it ended), and a space
// with no Assistant yet says what its first message starts it on (the choice kept for it, else Settings'). Fake data.
import { expect, test } from "bun:test";
import { Compat } from "./compat.ts";

const FABLE = ["claude", "--model", "claude-fable-5-2", "--effort", "low", "--settings", "{\"fastMode\":false}"];
const SH = ["sh", "-c", "…; exec claude --model claude-fable-5-2 --effort low --settings '{\"fastMode\":false}'"];
const label = (space: string) => ({ "herdr.role": "coordinator", "herdr.coordinator.space": space });

function world(terms: Record<string, any>, picks: Record<string, any> = {}) {
  const c = new Compat() as any;
  c.terminalsOf = (a: string) => terms[a] ?? null;
  c.terminalsAll = () => Object.values(terms);
  // its CLI's own settings: Opus 5.5 · 1M, what the label wrongly said
  c.agents = {
    cached: () => ({ model: "opus[1m]", effort: "medium" }),
    fresh: (_m: string | null, pick: any) => {
      const sel = pick ?? { agent: "claude", model: "opus[1m]", effort: "medium" };
      return { sel, words: sel.model, label: sel.model === "claude-fable-5-2" ? "Fable 5.2" : "Opus 5.5 · 1M", effort: sel.effort };
    },
  };
  c.assistantPick = (space: string) => picks[space] ?? null;
  return c;
}
const snap = (c: any, spaces: any[]) => c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows: [] });

test("a space's place names the model its running Assistant runs, not Settings'", () => {
  const c = world({ t1: { address: "t1", state: "live", argv: SH, foreground: { argv: FABLE, name: "claude" }, labels: label("sp1"), created_ms: 1 } });
  const p = snap(c, [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null, assistant: "t1" }]).places[0];
  expect(p.agent).toMatchObject({ kind: "claude", model: "claude-fable-5-2", modelLabel: "Fable 5.2", effort: "low", speed: "normal" });
});

test("an Assistant that ended still names what it ran, from its resume label", () => {
  const ended = { address: "t1", state: "finished", argv: SH, labels: { ...label("sp1"), "herdr.resume": JSON.stringify({ kind: "claude", argv: FABLE }) }, created_ms: 1 };
  const p = snap(world({ t1: ended }), [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null, assistant: "t1" }]).places[0];
  expect(p.agent).toMatchObject({ kind: "claude", model: "claude-fable-5-2", modelLabel: "Fable 5.2" });
});

test("no Assistant yet: what its first message starts it on, the space's own pick before Settings'", () => {
  const fable = { agent: "claude", model: "claude-fable-5-2", effort: "low", fast: false, perm: null };
  const c = world({}, { sp1: fable });
  const [own, other] = snap(c, [{ id: "sp1", name: "demo", folder: "/srv/demo", machine: null, assistant: null }, { id: "sp2", name: "two", folder: "/srv/two", machine: null, assistant: null }]).places;
  expect(own.agent).toMatchObject({ kind: "claude", planned: { model: "claude-fable-5-2", modelLabel: "Fable 5.2", effort: "low" } });
  expect(other.agent).toMatchObject({ kind: "claude", planned: { model: "opus[1m]", modelLabel: "Opus 5.5 · 1M" } });
});
