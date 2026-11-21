// SHEP-79: a button may carry a plain https link (href), alone or with a reply; buttons sit side by side
import { expect, test } from "bun:test";
import { problems, blockName, preview, mediaKind, mdParts, cellMd, fieldStart, formReply, chartLabels } from "./recipe.js";
import { marked } from "marked";

const one = (b) => problems({ recipe: 1, blocks: [b] });

test("a button needs a label and a reply, an https link or both", () => {
  expect(one({ type: "button", label: "Ship", reply: "ship" })).toEqual([]);
  expect(one({ type: "button", label: "Open", href: "https://github.com/x/y" })).toEqual([]);
  expect(one({ type: "button", label: "Open", href: "https://github.com/x/y", reply: "opened", quiet: true })).toEqual([]);
  expect(one({ type: "button", label: "Open" }).length).toBe(1);
  expect(one({ type: "button", label: "Open", href: "http://github.com" }).length).toBe(1);
  expect(one({ type: "button", label: "Open", href: "javascript:alert(1)" }).length).toBe(1);
});

test("buttons: one to four, each a button", () => {
  const b = { type: "buttons", items: [{ label: "Open Shepherdr on GitHub", href: "https://github.com/x/y" }, { label: "No thanks", reply: "no", quiet: true }] };
  expect(one(b)).toEqual([]);
  expect(blockName(b)).toBe("the buttons “Open Shepherdr on GitHub”");
  expect(one({ type: "buttons", items: [] }).length).toBe(1);
  expect(one({ type: "buttons", items: [{ label: "x" }] }).length).toBe(1);
});

// Shepherdr 3.2 (SHEP-209): a clip, a sound and a PDF are blocks of their own; a pair's sides may be clips
const files = ["clip.mp4", "clip.jpg", "a.webm", "b.mov", "song.ogg", "doc.pdf", "shot.png"];
const check = (b) => problems({ recipe: 1, blocks: [b] }, files);

test("mediaKind reads a file's kind from its name", () => {
  expect(mediaKind("x.MP4")).toBe("video");
  expect(mediaKind("x.webm")).toBe("video");
  expect(mediaKind("x.mov")).toBe("video");
  expect(mediaKind("x.m4a")).toBe("audio");
  expect(mediaKind("x.wav")).toBe("audio");
  expect(mediaKind("x.pdf")).toBe("pdf");
  expect(mediaKind("x.png")).toBe("image");
  expect(mediaKind("x.txt")).toBe(null);
});

test("a video, a sound and a PDF are blocks beside recipe.json", () => {
  expect(check({ type: "video", src: "clip.mp4", poster: "clip.jpg", caption: "After", loop: true, muted: true, autoplay: true })).toEqual([]);
  expect(check({ type: "video", src: "b.mov" })).toEqual([]);
  expect(check({ type: "audio", src: "song.ogg", caption: "Voice note" })).toEqual([]);
  expect(check({ type: "pdf", src: "doc.pdf", caption: "Spec" })).toEqual([]);
});

test("each block takes only its kind of file, and a file beside it", () => {
  expect(check({ type: "video", src: "shot.png" }).length).toBe(1);
  expect(check({ type: "video", src: "missing.mp4" }).length).toBe(1);
  expect(check({ type: "video", src: "clip.mp4", poster: "clip.mp4" }).length).toBe(1);
  expect(check({ type: "audio", src: "clip.mp4" }).length).toBe(1);
  expect(check({ type: "pdf", src: "song.ogg" }).length).toBe(1);
  expect(check({ type: "image", src: "clip.mp4" }).length).toBe(1);
  expect(check({ type: "video" }).length).toBeGreaterThan(0);
});

test("a pair's sides may be pictures or clips, not sounds", () => {
  expect(check({ type: "pair", before: { src: "shot.png", caption: "Before" }, after: { src: "a.webm", caption: "After" } })).toEqual([]);
  expect(check({ type: "pair", before: { src: "shot.png" }, after: { src: "song.ogg" } }).length).toBe(1);
});

test("preview: a clip's poster is its still; a clip with none is shown at its first frame", () => {
  const withPoster = preview({ recipe: 1, blocks: [{ type: "video", src: "clip.mp4", poster: "clip.jpg" }] });
  expect(withPoster.images).toEqual(["clip.jpg"]);
  expect(withPoster.videos).toEqual([]);
  const bare = preview({ recipe: 1, blocks: [{ type: "video", src: "a.webm" }, { type: "audio", src: "song.ogg" }] });
  expect(bare.images).toEqual([]);
  expect(bare.videos).toEqual(["a.webm"]);
  const pair = preview({ recipe: 1, blocks: [{ type: "pair", before: { src: "shot.png" }, after: { src: "a.webm" } }] });
  expect(pair.images).toEqual(["shot.png"]);
  expect(pair.videos).toEqual(["a.webm"]);
});

// SHEP-228: the window gives each fenced code block in Markdown its own box with a Copy button.
test("mdParts cuts Markdown at its fenced code blocks", () => {
  expect(mdParts("Just words, with `inline code`.")).toEqual([{ md: "Just words, with `inline code`." }]);
  expect(mdParts("Run:\n\n```sh\nbun i\nbun run build\n```\n\nDone.")).toEqual([
    { md: "Run:\n" }, { code: "bun i\nbun run build", lang: "sh" }, { md: "\nDone." }]);
  // a fence in a list item: its indent comes off the lines; ~~~ fences too
  expect(mdParts("1. Then:\n   ```\n   git pull\n     --rebase\n   ```")).toEqual([{ md: "1. Then:" }, { code: "git pull\n  --rebase", lang: "" }]);
  expect(mdParts("~~~\na ``` b\n~~~")).toEqual([{ code: "a ``` b", lang: "" }]);
  // a closing fence is at least as long as the opening; an unclosed one runs to the end
  expect(mdParts("````\n```\n````")).toEqual([{ code: "```", lang: "" }]);
  expect(mdParts("```\nnever closed")).toEqual([{ code: "never closed", lang: "" }]);
  // inline triple backticks aren't a fence
  expect(mdParts("``` not a fence ```")).toEqual([{ md: "``` not a fence ```" }]);
  expect(mdParts(undefined)).toEqual([]);
});

// SHEP-268: a table cell's links, bold and code show as such on both sides, but a cell never becomes a block, nor HTML
test("cellMd: a table cell is inline Markdown", () => {
  const html = (c) => marked.parse(cellMd(c), { async: false, gfm: true }).trim();
  expect(html("[PR #12](https://github.com/x/y/pull/12) is **merged**")).toBe('<p><a href="https://github.com/x/y/pull/12">PR #12</a> is <strong>merged</strong></p>');
  expect(html("run `a<b`")).toBe("<p>run <code>a&lt;b</code></p>");
  // block marks at the start stay words
  expect(html("1. Fix")).toBe("<p>1. Fix</p>");
  expect(html("- a")).toBe("<p>- a</p>");
  expect(html("# h")).toBe("<p># h</p>");
  expect(html("> q")).toBe("<p>&gt; q</p>");
  expect(html("---")).toBe("<p>---</p>");
  expect(html("```js")).toBe("<p>```js</p>");
  expect(html("    four spaces")).toBe("<p>four spaces</p>");
  expect(html("two\nlines")).toBe("<p>two lines</p>");
  // raw HTML is shown as text, an escaped one too
  expect(html("<b>x</b><img src=x onerror=alert(1)>")).not.toContain("<b>");
  expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
  expect(html("\\<b>x")).not.toContain("<b>");
  // plain values stay as they were
  expect(cellMd(42)).toBe("42");
  expect(cellMd(null)).toBe("");
  expect(cellMd("1.5")).toBe("1.5");
  expect(cellMd("-5")).toBe("-5");
  expect(cellMd("**bold** start")).toBe("**bold** start");
});

// GitHub #1212: a form field may start on a chosen value; untouched, it replies with it
test("a form field's value: its start and its untouched reply", () => {
  const form = { type: "form", title: "Review", fields: [
    { name: "a", label: "A", kind: "select", options: ["x", "y"], value: "y" },
    { name: "b", label: "B", kind: "checkbox", value: true },
    { name: "c", label: "C", kind: "text", value: "keep" },
    { name: "d", label: "D", kind: "select", options: ["x", "y"] }] };
  expect(one(form)).toEqual([]);
  expect(form.fields.map(fieldStart)).toEqual(["y", true, "keep", ""]);
  expect(formReply(form, {})).toBe("Review\nA: y\nB: yes\nC: keep\nD: (empty)");
  // what the person changed wins
  expect(formReply(form, { a: "x", b: false, c: "" })).toBe("Review\nA: x\nB: no\nC: (empty)\nD: (empty)");
  // a value that doesn't fit is refused
  expect(one({ type: "form", fields: [{ name: "a", kind: "select", options: ["x"], value: "z" }] })[0]).toContain("one of its options");
  expect(one({ type: "form", fields: [{ name: "b", kind: "checkbox", value: "yes" }] })[0]).toContain("true or false");
});

test("a line chart's labels sit under their points; the ends anchor inward so they aren't cut off (GitHub #1148)", () => {
  const l = chartLabels({ kind: "line", labels: ["09:00", "10:00", "11:00"], series: [{ values: [1, 2, 3] }] });
  expect(l.map((x) => [x.x, x.anchor])).toEqual([[0, "start"], [0.5, "middle"], [1, "end"]]);
  expect(chartLabels({ kind: "line", labels: ["only"] })).toEqual([{ text: "only", x: 0.5, anchor: "middle" }]);
  expect(chartLabels({ kind: "bar", labels: ["a", "b"] }).map((x) => [x.x, x.anchor])).toEqual([[0.25, "middle"], [0.75, "middle"]]);
});
