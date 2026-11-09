// An artifact's recipe (Shepherdr 3.1): what an agent shows the person, written once as data (recipe.json beside its
// pictures) and drawn natively by each side: the window in GPUI (mods/artifacts/recipe-view.js), the web app in HTML
// (web/src/screens/Recipe.tsx). One file, one version history, the same answers on both.
//
//   { "recipe": 1, "blocks": [ { "type": "heading", "text": "Coverage" }, { "type": "text", "md": "**92%** of lines" } ] }
//
// Blocks (each may carry an "id", which markup notes and answers point at; one is given when it has none):
//   heading  { text, level: 1-3 }                       text     { md }  (Markdown)
//   list     { items: [md], ordered }                   table    { columns: [label | { label, align }], rows: [[cell]] }
//   chart    { kind: bar | line | pie, labels: [], series: [{ name, values: [] }] }
//   stats    { items: [{ label, value, note }] }        image    { src, caption, w, h }  (src: a file beside it)
//   pair     { before: { src, caption }, after: { src, caption } }
//   code     { text, lang }                             callout  { tone: info | good | warn | bad, title, md }
//   columns  { columns: [[blocks]] }                    tabs     { tabs: [{ label, blocks }] }
//   details  { summary, blocks }                        divider  {}
//   choice   { question, options: [{ label, description }] }   one pick, sent to the agent as a reply
//   form     { fields: [{ name, label, kind: text | textarea | select | checkbox, options }], submit }
//   button   { label, reply, href, quiet }              a press sends `reply` to the agent; with href (https only) it
//                                                       opens that page in the person's browser too; quiet: the softer look
//   buttons  { items: [button] }                        buttons side by side (the first not quiet is the one to press)
// "cover" (optional, beside "blocks"): the picture beside it that its card in the chat shows first (preview()).
// Shared core: the source is core/recipe.js; bin/sync-shared copies it into the mods in lib/COPIES.

export const RECIPE = 1;
export const TYPES = ["heading", "text", "list", "table", "chart", "stats", "image", "pair", "code", "callout", "columns", "tabs", "details", "divider", "choice", "form", "button", "buttons"];
export const TONES = ["info", "good", "warn", "bad"];
export const CHARTS = ["bar", "line", "pie"];
export const FIELDS = ["text", "textarea", "select", "checkbox"];
const MAX_BLOCKS = 400;

const str = (v) => typeof v === "string";
const arr = (v) => Array.isArray(v);

// What's wrong with a recipe, in words (empty: nothing). files: the names beside it, to check pictures exist.
export function problems(recipe, files = null) {
  const out = [];
  if (!recipe || typeof recipe !== "object") return ["recipe.json isn't a JSON object."];
  if (recipe.recipe !== RECIPE) out.push(`"recipe" must be ${RECIPE}.`);
  if (!arr(recipe.blocks) || !recipe.blocks.length) return [...out, '"blocks" must be a list with at least one block.'];
  let n = 0;
  const ids = new Set();
  const walk = (blocks, at) => blocks.forEach((b, i) => {
    const where = `${at}${i + 1}`;
    if (++n > MAX_BLOCKS) return;
    if (!b || typeof b !== "object" || !TYPES.includes(b.type)) { out.push(`block ${where}: type must be one of ${TYPES.join(", ")}.`); return; }
    if (b.id != null) { if (!str(b.id) || ids.has(b.id)) out.push(`block ${where}: id must be a word used once.`); ids.add(b.id); }
    const need = (cond, what) => { if (!cond) out.push(`block ${where} (${b.type}): ${what}.`); };
    const pic = (src) => { need(str(src) && !src.includes("..") && !src.startsWith("/"), "src must be a file beside recipe.json"); if (files && str(src)) need(files.includes(src), `${src} isn't beside recipe.json`); };
    switch (b.type) {
      case "heading": need(str(b.text), "needs text"); break;
      case "text": need(str(b.md), "needs md"); break;
      case "list": need(arr(b.items) && b.items.every(str), "items must be a list of words"); break;
      case "table": need(arr(b.columns) && arr(b.rows) && b.rows.every(arr), "needs columns and rows (lists)"); break;
      case "chart": need(CHARTS.includes(b.kind), `kind must be ${CHARTS.join(", ")}`); need(arr(b.labels) && arr(b.series) && b.series.every((s) => arr(s?.values) && s.values.every((v) => typeof v === "number")), "needs labels and series of numbers"); break;
      case "stats": need(arr(b.items) && b.items.every((x) => x && "label" in x && "value" in x), "items need a label and a value"); break;
      case "image": pic(b.src); break;
      case "pair": pic(b.before?.src); pic(b.after?.src); break;
      case "code": need(str(b.text), "needs text"); break;
      case "callout": need(!b.tone || TONES.includes(b.tone), `tone must be ${TONES.join(", ")}`); need(str(b.md) || str(b.title), "needs md or a title"); break;
      case "columns": need(arr(b.columns) && b.columns.every(arr), "columns must be lists of blocks"); if (arr(b.columns)) b.columns.forEach((c, j) => arr(c) && walk(c, `${where}.${j + 1}.`)); break;
      case "tabs": need(arr(b.tabs) && b.tabs.every((t) => str(t?.label) && arr(t?.blocks)), "tabs need a label and blocks"); if (arr(b.tabs)) b.tabs.forEach((t, j) => arr(t?.blocks) && walk(t.blocks, `${where}.${j + 1}.`)); break;
      case "details": need(str(b.summary) && arr(b.blocks), "needs a summary and blocks"); if (arr(b.blocks)) walk(b.blocks, `${where}.`); break;
      case "choice": need(str(b.question) && arr(b.options) && b.options.every((o) => str(o?.label)), "needs a question and options with labels"); break;
      case "form": need(arr(b.fields) && b.fields.every((f) => str(f?.name) && FIELDS.includes(f.kind ?? "text")), `fields need a name and a kind (${FIELDS.join(", ")})`); break;
      case "button": buttonProblem(b, need); break;
      case "buttons": need(arr(b.items) && b.items.length > 0 && b.items.length <= 4, "items must be 1 to 4 buttons"); if (arr(b.items)) b.items.forEach((x) => buttonProblem(x ?? {}, need)); break;
    }
  });
  walk(recipe.blocks, "");
  // the picture its card in the chat shows first (preview()): a file beside it, as a block's
  if (recipe.cover != null && (!str(recipe.cover) || recipe.cover.includes("..") || recipe.cover.startsWith("/") || (files && !files.includes(recipe.cover)))) out.push('"cover" must be a picture beside recipe.json.');
  if (n > MAX_BLOCKS) out.push(`at most ${MAX_BLOCKS} blocks.`);
  return out;
}

// A button's own fields: words, and a reply, a link or both (a link is a plain https page, opened by the person's press).
function buttonProblem(b, need) {
  need(str(b.label) && (str(b.reply) || str(b.href)), "a button needs a label and a reply or an href");
  if (b.href != null) need(isLink(b.href), "href must be an https:// link");
}
export const isLink = (v) => typeof v === "string" && /^https:\/\/[^\s"<>]+$/.test(v);

// The recipe with an id on every block (b1, b2... in order where it had none): what markup and answers point at.
export function withIds(recipe) {
  let n = 0;
  const walk = (blocks) => blocks.map((b) => {
    const x = { ...b, id: b.id ?? `b${++n}` };
    if (x.type === "columns") x.columns = x.columns.map(walk);
    if (x.type === "tabs") x.tabs = x.tabs.map((t) => ({ ...t, blocks: walk(t.blocks) }));
    if (x.type === "details") x.blocks = walk(x.blocks);
    return x;
  });
  return { ...recipe, blocks: walk(recipe.blocks ?? []) };
}

// A block's words for a note or a reply ("the table “Coverage”"), so the agent knows what was pointed at.
export function blockName(b) {
  const what = { heading: "heading", text: "text", list: "list", table: "table", chart: "chart", stats: "numbers", image: "picture",
    pair: "before and after", code: "code", callout: "callout", columns: "columns", tabs: "tabs", details: "folded section",
    divider: "line", choice: "choice", form: "form", button: "button", buttons: "buttons" }[b?.type] ?? "block";
  const name = b?.text ?? b?.title ?? b?.question ?? b?.summary ?? b?.caption ?? b?.label ?? b?.items?.[0]?.label ?? null;
  return name ? `the ${what} “${String(name).slice(0, 60)}”` : `the ${what} ${b?.id ?? ""}`.trim();
}

// The reply a choice or a form sends to its agent: plain words, as the person would write them.
export function choiceReply(b, label) { return `${b.question}: ${label}`; }
export function formReply(b, values) {
  const lines = (b.fields ?? []).map((f) => `${f.label ?? f.name}: ${f.kind === "checkbox" ? (values[f.name] ? "yes" : "no") : String(values[f.name] ?? "").trim() || "(empty)"}`);
  return [b.title ?? b.submit ?? "Form", ...lines].join("\n");
}

// A chart's numbers as shapes, for both renderers: bars (x, y, w, h as 0-1 of the plot), a line's points, or a pie's
// slices (start and end angles, 0 at twelve o'clock, clockwise, in radians).
export function chartShapes(b) {
  const series = b.series ?? [], labels = b.labels ?? [];
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values.map((v) => Math.max(0, v))));
  if (b.kind === "pie") {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v)), sum = vals.reduce((a, v) => a + v, 0) || 1;
    let at = 0;
    return { slices: vals.map((v, i) => { const a = at; at += (v / sum) * Math.PI * 2; return { label: labels[i] ?? "", value: v, a0: a, a1: at, share: v / sum }; }) };
  }
  if (b.kind === "line") return { max, lines: series.map((s) => ({ name: s.name ?? "", points: s.values.map((v, i) => ({ x: s.values.length > 1 ? i / (s.values.length - 1) : 0.5, y: Math.max(0, v) / max })) })) };
  const groups = labels.length || Math.max(0, ...series.map((s) => s.values.length));
  const per = series.length || 1, slot = 1 / Math.max(1, groups), bw = (slot * 0.7) / per;
  return { max, bars: series.flatMap((s, si) => s.values.map((v, i) => ({ series: si, label: labels[i] ?? "", value: v, x: i * slot + slot * 0.15 + si * bw, w: bw, h: Math.max(0, v) / max }))) };
}

// What an artifact's card in the chat shows of it before it opens (SHEP-142): its key pictures (the cover it names,
// else the first pictures in it, at most `max`) and its first words (headings and text, in order, up to `chars`).
// { images: [src], lines: [words] }; Markdown marks are kept for the reader to draw.
export function preview(recipe, { max = 3, chars = 280 } = {}) {
  const images = [], lines = [];
  let used = 0;
  const pic = (src) => { if (str(src) && !images.includes(src) && images.length < max) images.push(src); };
  if (str(recipe?.cover)) pic(recipe.cover);
  const say = (s) => {
    if (!str(s) || used >= chars) return;
    const first = s.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, " ").trim();
    if (!first) return;
    const cut = first.length > chars - used ? `${first.slice(0, Math.max(0, chars - used)).replace(/\s+\S*$/, "")}…` : first;
    lines.push(cut);
    used += cut.length;
  };
  const walk = (blocks) => (arr(blocks) ? blocks : []).forEach((b) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "image") pic(b.src);
    else if (b.type === "pair") { pic(b.before?.src); pic(b.after?.src); }
    else if (b.type === "heading") say(b.text);
    else if (b.type === "text") say(b.md);
    else if (b.type === "callout") say(b.title ? `**${b.title}** ${b.md ?? ""}` : b.md);
    else if (b.type === "list" && arr(b.items)) say(b.items.slice(0, 3).join(" · "));
    else if (b.type === "columns" && arr(b.columns)) b.columns.forEach(walk);
    else if (b.type === "tabs" && arr(b.tabs)) walk(b.tabs[0]?.blocks);
  });
  walk(recipe?.blocks);
  return { images, lines };
}
