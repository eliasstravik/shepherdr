// A chat's pictures and videos as /api/file serves them (SHEP-142): a part of a video at a time (Range, so a player can
// seek without loading it all), a small copy of a big picture for its thumbnail and a still for a video's poster
// (made once with ffmpeg or ImageMagick where the machine has one, kept in data/thumbs; else the file itself), and
// headers that never let a served file run as a page of this app.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import * as CV from "../core/chat-view.js";

/** no file served here runs as this app's page (an SVG or HTML opened in a tab of its own), nor is sniffed as one */
export const SAFE = { "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" };

/** a Range header's one span of a file `size` bytes long: [start, end] (end included), "bad" when it can't be met, or
 *  null for none (the whole file) */
export function span(range: string | null, size: number): [number, number] | "bad" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((range ?? "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  return start > end || start >= size ? "bad" : [start, end];
}

/** a file's bytes (a Blob) as a response: a part when asked for one, its type, cached a while, sandboxed */
export function served(body: Blob, type: string, range: string | null, extra: Record<string, string> = {}): Response {
  const size = body.size;
  const head = { "content-type": type || "application/octet-stream", "accept-ranges": "bytes", "cache-control": "private, max-age=3600", ...SAFE, ...extra };
  const s = span(range, size);
  if (s === "bad") return new Response(null, { status: 416, headers: { ...head, "content-range": `bytes */${size}` } });
  if (!s) return new Response(body, { headers: { ...head, "content-length": String(size) } });
  return new Response(body.slice(s[0], s[1] + 1), { status: 206, headers: { ...head, "content-range": `bytes ${s[0]}-${s[1]}/${size}`, "content-length": String(s[1] - s[0] + 1) } });
}

/** smaller than this, a picture is its own thumbnail */
export const THUMB_FROM = 200 * 1024;
/** a thumbnail's longest side: twice the chat's biggest box (320), for sharp screens */
export const THUMB_SIDE = 640;

const tools = new Map<string, boolean>();
function has(tool: string) {
  if (!tools.has(tool)) tools.set(tool, !!Bun.which(tool));
  return tools.get(tool)!;
}

async function run(argv: string[], ms = 20_000) {
  const p = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  const timer = setTimeout(() => p.kill(), ms);
  const code = await p.exited;
  clearTimeout(timer);
  return code === 0;
}

/** the small copy of a picture on this machine (want "thumb") or a video's still (want "poster"), made once and kept by
 *  its path, size and time; null when it isn't worth one (a small picture, a GIF that moves) or none can be made */
export async function smaller(path: string, want: "thumb" | "poster", dir = join(DATA, "thumbs")): Promise<string | null> {
  const st = statSync(path, { throwIfNoEntry: false });
  if (!st?.isFile()) return null;
  const kind = CV.mediaKind(path);
  if (want === "thumb" && (kind !== "image" || st.size < THUMB_FROM || /\.(gif|svg)$/i.test(path))) return null;
  if (want === "poster" && kind !== "video") return null;
  const out = join(dir, `${createHash("sha1").update(`${path}\0${st.size}\0${st.mtimeMs}`).digest("hex").slice(0, 20)}-${want}.jpg`);
  if (existsSync(out)) return out;
  mkdirSync(dir, { recursive: true });
  const scale = `scale='min(${THUMB_SIDE},iw)':'min(${THUMB_SIDE},ih)':force_original_aspect_ratio=decrease`;
  const tmp = `${out}.${process.pid}.tmp.jpg`;
  let ok = false;
  if (has("ffmpeg")) {
    ok = want === "poster"
      ? await run(["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", path, "-frames:v", "1", "-vf", scale, "-q:v", "4", tmp])
        || await run(["ffmpeg", "-v", "error", "-y", "-i", path, "-frames:v", "1", "-vf", scale, "-q:v", "4", tmp])
      : await run(["ffmpeg", "-v", "error", "-y", "-i", path, "-frames:v", "1", "-vf", scale, "-q:v", "4", tmp]);
  }
  if (!ok && want === "thumb") {
    const im = has("magick") ? ["magick"] : has("convert") ? ["convert"] : null;
    if (im) ok = await run([...im, `${path}[0]`, "-auto-orient", "-thumbnail", `${THUMB_SIDE}x${THUMB_SIDE}>`, "-quality", "80", tmp]);
  }
  if (!ok || !existsSync(tmp)) return null;
  const { renameSync } = await import("node:fs");
  renameSync(tmp, out);
  return out;
}

/** another machine's file, kept a little while: a player asks for its parts one by one, and each would read it there
 *  again. At most a few, 64 MB in all */
const kept = new Map<string, { at: number; bytes: Uint8Array }>();
export function keep(key: string, bytes?: Uint8Array): Uint8Array | null {
  const now = Date.now();
  for (const [k, v] of kept) if (now - v.at > 120_000) kept.delete(k);
  if (!bytes) return kept.get(key)?.bytes ?? null;
  kept.delete(key);
  kept.set(key, { at: now, bytes });
  let total = 0;
  for (const [k, v] of [...kept].reverse()) { total += v.bytes.length; if (total > 64 * 1024 * 1024) kept.delete(k); }
  return bytes;
}
