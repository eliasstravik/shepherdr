// SHEP-79: a button may carry a plain https link (href), alone or with a reply; buttons sit side by side
import { expect, test } from "bun:test";
import { problems, blockName, preview, mediaKind } from "./recipe.js";

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
