// #1509: voice reads the artifact open on screen. Its page (index.html of the version shown) as plain words, read in
// parts so a long page stays within what a voice agent can take in one tool answer; a query gives only the paragraphs
// about it. Only the open page: the call never reads an artifact the person isn't looking at.
import type { Snapshot } from "../web/shared/types.ts";

/** a part of a page, in characters: a voice tool answer stays well inside what the agent takes in */
export const PART = 6000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", copy: "©", times: "×", rarr: "→", larr: "←" };
const entity = (_: string, e: string) => {
  if (e[0] === "#") {
    const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
  }
  return ENTITIES[e.toLowerCase()] ?? `&${e};`;
};

const BLOCK = "p|div|section|article|header|footer|main|nav|aside|h[1-6]|li|ul|ol|tr|table|thead|tbody|blockquote|pre|figure|figcaption|details|summary|dt|dd|dl|form|fieldset|hr|br|title";

/** A page's HTML as its words: no scripts, styles or markup; one paragraph a line; images by their alt text. */
export function pageText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, (m, tag) => (tag.toLowerCase() === "head" ? (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(m)?.[1] ?? "") + "\n" : " "))
    .replace(/<img\b[^>]*\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, a, b) => ` ${a ?? b ?? ""} `)
    .replace(/<(td|th)\b[^>]*>/gi, " | ")
    .replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, entity);
  s = s.split("\n").map((l) => l.replace(/[ \t\r\f\v ]+/g, " ").replace(/^[ |]+|[ |]+$/g, "").trim()).filter(Boolean).join("\n");
  return s;
}

/** The page's lines cut into parts of about PART characters, on line ends where it can. */
export function parts(text: string, size = PART): string[] {
  const out: string[] = [];
  let cur = "";
  for (let line of text.split("\n")) {
    while (line.length > size) { if (cur) { out.push(cur); cur = ""; } out.push(line.slice(0, size)); line = line.slice(size); }
    if (cur && cur.length + 1 + line.length > size) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

export type PageRead = (id: string, v: number, machine: string | null) => Promise<string | null>;

/** look page: the open artifact's words (part n of a long one), or the lines about a query. */
export async function lookPage(read: PageRead | undefined, snap: Snapshot, open: { artifact?: string | null; version?: number | null }, query: string, part: number):
  Promise<{ result: string; error?: true }> {
  const fail = (result: string) => ({ result, error: true as const });
  const a = open.artifact ? (snap.artifacts ?? []).find((x) => x.id === open.artifact) : null;
  if (!a) return fail("No artifact is open on screen. Open one first (open artifact), then look page.");
  if (!read) return fail("I can't read pages from here.");
  if (a.kind === "gpui") return fail(`"${a.title}" is a panel only the Herdr window draws: its words can't be read, only its picture shows here.`);
  const v = open.version && a.versions?.some((x) => x.n === open.version) ? open.version : a.v;
  const html = await read(a.id, v, a.machine ?? null);
  if (html == null) return fail(`I can't read "${a.title}" right now: its page didn't load.`);
  const text = pageText(html);
  const head = `The artifact "${a.title}"${v !== a.v ? `, version ${v} of ${a.v}` : ""}`;
  if (!text) return { result: `${head} has no words to read: it is all pictures or drawn by its scripts. Describe what is open with screen look instead.` };
  const ws = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (ws.length) {
    const lines = text.split("\n");
    const hit = lines.map((l, i) => [i, ws.filter((w) => l.toLowerCase().includes(w)).length] as const).filter(([, n]) => n > 0);
    if (!hit.length) return { result: `${head}: nothing about "${query.slice(0, 60)}" on it.` };
    // the lines with the most of the words first, each with the line before it (often its heading), in page order
    const best = Math.max(...hit.map(([, n]) => n));
    const keep = new Set<number>();
    for (const [i, n] of hit) if (n === best) { if (i > 0) keep.add(i - 1); keep.add(i); }
    const picked = parts([...keep].sort((x, y) => x - y).map((i) => lines[i]!).join("\n"))[0]!;
    return { result: `${head}, the parts about "${query.slice(0, 60)}":\n${picked}` };
  }
  const all = parts(text);
  const n = Math.min(Math.max(1, part), all.length);
  const more = all.length > 1 ? ` (part ${n} of ${all.length}${n < all.length ? `: look page with part ${n + 1} for more, or a query to find something` : ""})` : "";
  return { result: `${head}${more}:\n${all[n - 1]}` };
}
