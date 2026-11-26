// #1509: voice reads the words of the artifact open on screen, only that one, in parts when long. Fake data only.
import { expect, test } from "bun:test";
import { lookPage, pageText, parts, PART } from "./voice-page.ts";
import { voiceTool, lookHere, type VoiceIO } from "./voice-tools.ts";
import { pageWhere } from "./voice.ts";
import { LOOKS, TOOLS } from "../core/voice.js";

const snap: any = { places: [], tasks: [], machines: [], artifacts: [
  { id: "a1", title: "Weekly board", place: "sp1", v: 3, at: 1, versions: [{ n: 3 }, { n: 2 }, { n: 1 }] },
  { id: "g1", title: "Panel", place: "sp1", v: 1, at: 1, kind: "gpui", versions: [{ n: 1 }] },
  { id: "far", title: "On the mini", place: "sp1", v: 1, at: 1, machine: "mini", versions: [{ n: 1 }] },
] };
const PAGE = `<!doctype html><html><head><title>Weekly board</title><style>body{color:red}</style><script>var x = "secret code"</script></head>
<body><h1>Sales &amp; leads</h1><p>We closed <b>three</b> deals&nbsp;this week.</p><!-- hidden -->
<table><tr><th>Lead</th><th>Stage</th></tr><tr><td>Acme Shop</td><td>Demo</td></tr></table>
<img src="x.png" alt="A rising chart"><ul><li>Call back on Monday</li></ul></body></html>`;

test("pageText keeps the words, drops scripts, styles and markup", () => {
  const t = pageText(PAGE);
  expect(t).toContain("Weekly board\nSales & leads\nWe closed three deals this week.");
  expect(t).toContain("Lead | Stage");
  expect(t).toContain("Acme Shop | Demo");
  expect(t).toContain("A rising chart");
  expect(t).toContain("Call back on Monday");
  expect(t).not.toContain("secret code");
  expect(t).not.toContain("color:red");
  expect(t).not.toContain("hidden");
  expect(t).not.toContain("<");
});

test("parts cut a long page on line ends, none longer than a part", () => {
  const text = Array.from({ length: 400 }, (_, i) => `Line ${i} ${"word ".repeat(10)}`).join("\n") + "\n" + "x".repeat(PART * 2 + 5);
  const ps = parts(text);
  expect(ps.length).toBeGreaterThan(3);
  for (const p of ps) expect(p.length).toBeLessThanOrEqual(PART);
  expect(ps.join("\n").replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
});

test("reads only the artifact open on screen, the version shown", async () => {
  const asked: any[] = [];
  const read = async (id: string, v: number, m: string | null) => (asked.push([id, v, m]), PAGE);
  expect((await lookPage(read, snap, {}, "", 1)).error).toBe(true);
  const r = await lookPage(read, snap, { artifact: "a1" }, "", 1);
  expect(r.result).toContain('The artifact "Weekly board":');
  expect(r.result).toContain("three deals");
  expect((await lookPage(read, snap, { artifact: "a1", version: 2 }, "", 1)).result).toContain("version 2 of 3");
  await lookPage(read, snap, { artifact: "far" }, "", 1);
  expect(asked).toEqual([["a1", 3, null], ["a1", 2, null], ["far", 1, "mini"]]);
  expect((await lookPage(read, snap, { artifact: "g1" }, "", 1)).error).toBe(true);
  expect((await lookPage(async () => null, snap, { artifact: "a1" }, "", 1)).error).toBe(true);
});

test("a long page comes in parts; a query gives the lines about it", async () => {
  const long = `<h1>Report</h1>${Array.from({ length: 300 }, (_, i) => `<p>Paragraph ${i} about nothing much at all, just filler words here.</p>`).join("")}<h2>Budget</h2><p>The budget is 40k.</p>`;
  const read = async () => long;
  const one = await lookPage(read, snap, { artifact: "a1" }, "", 1);
  expect(one.result.length).toBeLessThan(PART + 300);
  expect(one.result).toMatch(/part 1 of \d+: look page with part 2/);
  const last = await lookPage(read, snap, { artifact: "a1" }, "", 99);
  expect(last.result).toContain("The budget is 40k.");
  const q = await lookPage(read, snap, { artifact: "a1" }, "budget", 1);
  expect(q.result).toContain("Budget\nThe budget is 40k.");
  expect(q.result).not.toContain("Paragraph 5 ");
  expect((await lookPage(read, snap, { artifact: "a1" }, "zebra", 1)).result).toContain('nothing about "zebra"');
});

test("look page through the voice tool, and the call knows of it", async () => {
  const io = { snap: () => snap, page: async () => PAGE } as unknown as VoiceIO;
  const r = await voiceTool("look", { what: "page", query: "deals" }, { client: "web", artifact: "a1" }, io);
  expect(r.result).toContain("three deals");
  expect((await voiceTool("look", { what: "page" }, { client: "web" }, io)).error).toBe(true);
  expect(lookHere(snap, { client: "web", artifact: "a1" })).toContain("look page reads its words");
  expect(LOOKS).toContain("page");
  expect(JSON.stringify(TOOLS)).toContain('"part"');
  expect(pageWhere({ artifact: "a1", version: 2 }).version).toBe(2);
  expect(pageWhere({ artifact: "a1", version: "2" }).version).toBe(null);
});
