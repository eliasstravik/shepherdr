// SHEP-142: media an agent puts in its message shows in the chat (core/chat-view.js mediaIn), and an artifact's card
// previews it (core/recipe.js preview)
import { expect, test } from "bun:test";
import { mediaIn, mediaKind } from "./chat-view.js";
import { preview, problems } from "./recipe.js";

test("a Markdown picture of a local file leaves the words and shows under them", () => {
  const r = mediaIn("Here is the new card:\n\n![after](/tmp/shots/after.png)\n\nLooks right?");
  expect(r.text).toBe("Here is the new card:\n\nLooks right?");
  expect(r.media).toEqual([{ path: "/tmp/shots/after.png", name: "after.png", alt: "after", kind: "image" }]);
});

test("a short label on a picture's line becomes its caption", () => {
  const r = mediaIn("The card now previews it.\n\nBefore: ![before](/s/before.png)\n\n**After:** ![](/s/after.png)\n\n- ![x](/s/x.png) see how the long words on this line stay as they are");
  expect(r.text).toBe("The card now previews it.\n\n- see how the long words on this line stay as they are");
  expect(r.media.map((m) => m.alt)).toEqual(["Before", "After", "x"]);
});

test("a link to a video keeps its words; the video shows", () => {
  const r = mediaIn("See [the recording](/tmp/rec.mp4) of it.");
  expect(r.text).toBe("See the recording of it.");
  expect(r.media[0]).toMatchObject({ path: "/tmp/rec.mp4", kind: "video" });
});

test("relative, home and file:// paths; each once", () => {
  const r = mediaIn("![a](shots/a.png) ![b](./b.gif) ![c](~/c.webp) ![d](file:///x/d%20e.jpg) ![a again](shots/a.png)", { cwd: "/repo", home: "/h/me" });
  expect(r.media.map((m) => m.path)).toEqual(["/repo/shots/a.png", "/repo/b.gif", "/h/me/c.webp", "/x/d e.jpg"]);
  expect(r.text).toBe("");
});

test("web pictures, other links, code and paths up are left alone", () => {
  for (const s of [
    "![logo](https://example.com/a.png)",
    "[docs](docs/readme.md)",
    "`![a](/tmp/a.png)`",
    "```md\n![a](/tmp/a.png)\n```",
    "![a](../secret.png)",
    "![a](shots/a.png)", // relative with no folder known
    "[x](#top)",
  ]) {
    const r = mediaIn(s);
    expect(r.media).toEqual([]);
    expect(r.text).toBe(s);
  }
});

test("at most 12, and its kind by name", () => {
  const many = Array.from({ length: 15 }, (_, i) => `![s](/t/${i}.png)`).join("\n");
  expect(mediaIn(many).media.length).toBe(12);
  expect(mediaKind("a.MOV")).toBe("video");
  expect(mediaKind("a.svg")).toBe("image");
  expect(mediaKind("a.pdf")).toBe(null);
});

test("an artifact's preview: its cover, then its first pictures, then its first words", () => {
  const recipe = {
    recipe: 1,
    cover: "cover.png",
    blocks: [
      { type: "heading", text: "Coverage" },
      { type: "text", md: "**92%** of lines are covered.\n\nMore below." },
      { type: "pair", before: { src: "before.png" }, after: { src: "after.png" } },
      { type: "image", src: "chart.png" },
      { type: "list", items: ["one", "two", "three", "four"] },
    ],
  };
  expect(preview(recipe)).toEqual({ images: ["cover.png", "before.png", "after.png"], lines: ["Coverage", "**92%** of lines are covered.", "one · two · three"] });
  expect(preview(recipe, { chars: 16 }).lines).toEqual(["Coverage", "**92%**…"]);
  expect(preview({ blocks: [] })).toEqual({ images: [], lines: [] });
});

test("a cover must be a picture beside it", () => {
  const r = { recipe: 1, cover: "c.png", blocks: [{ type: "text", md: "x" }] };
  expect(problems(r, ["c.png"])).toEqual([]);
  expect(problems({ ...r, cover: "../c.png" }, ["c.png"]).length).toBe(1);
  expect(problems(r, ["d.png"]).length).toBe(1);
});
