// SHEP-321: a task's % done reaches the app's model from both sources, in step: herdr-task status --done (its task
// list's progress) and the % its agent's terminal reports itself (hc's OSC 7501 record: status.progress); the newer
// one wins, and the time left is the agent's own.
import { expect, test } from "bun:test";
import { Model } from "./model.ts";

const NOW = Date.now();
const list = (progress: any) => ({ slug: "shop", name: "shop", prefix: "SHOP", folder: "/srv/shop", machine: null,
  tasks: [{ id: 1, title: "Faster search", state: "running", started: NOW - 600_000, progress }] });
const term = (status: any, status_ms: number) => ({ address: "t9", state: "live", labels: { "herdr.task": "shop#1", "herdr.role": "worker" },
  foreground: { name: "claude", argv: ["claude"] }, turn: 1, status, status_ms });

function rowOf(progress: any, terminal: any) {
  const hub: any = { terminals: new Map(terminal ? [["t9", terminal]] : []), on: () => () => {} };
  const live: any = { put: () => {} };
  const m = new Model(hub, live) as any;
  m.lists = new Map([[null, [list(progress)]]]);
  m.value = () => undefined;
  let rows: any[] = [];
  m.onBuild = (b: any) => { rows = b.rows; };
  try { m.build(); } catch { /* the spaces half needs more of the service; the rows are made first */ }
  rows = rows.length ? rows : m.rows;
  if (m.settleTimer) clearTimeout(m.settleTimer);
  return rows[0];
}

test("herdr-task status --done reaches the model, with its own time left", () => {
  const r = rowOf({ text: "Writing tests", done: 40, left: 13 * 60_000, at: NOW }, term({ app: "claude-code", state: "working" }, NOW));
  expect(r.said).toMatchObject({ text: "Writing tests", done: 40, left: 13 });
});

test("the terminal's own % (OSC 7501 progress, as hc keeps it) reaches the model", () => {
  const r = rowOf(null, term({ app: "claude-code", state: "working", progress: 62, msg: "Running the build" }, NOW));
  expect(r.said).toMatchObject({ text: "Running the build", done: 62 });
});

test("both in step: the newer report gives the %", () => {
  const said = { text: "Writing tests", done: 40, left: 600_000, at: NOW - 60_000 };
  expect(rowOf(said, term({ state: "working", progress: 70 }, NOW)).said.done).toBe(70);
  expect(rowOf({ ...said, at: NOW }, term({ state: "working", progress: 70 }, NOW - 60_000)).said.done).toBe(40);
});
