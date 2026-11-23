// A space's icon (kept in the sidebar's data, shared "spaces-chat".icons): an emoji, or a small square picture the
// page made from a photo (re-encoded on a canvas, kept as a data: URL so every device sees it with the rest). The
// service checks it again here: only PNG, JPEG or WebP, its bytes really that type, at most ICON_MAX characters. It
// only ever shows in an <img>, never as a page.

/** the longest picture kept, as its data: URL (about 36 KB of image) */
export const ICON_MAX = 48000;

const PICTURE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** a picture's icon (not an emoji) */
export const isPicture = (v) => typeof v === "string" && v.startsWith("data:");

/** the first bytes of base64 text */
function head(b64, n) {
  const s = atob(b64.slice(0, Math.ceil(n / 3) * 4));
  return Array.from(s.slice(0, n), (c) => c.charCodeAt(0));
}

const isType = (type, b) =>
  type === "png" ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)
  : type === "jpeg" ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  : String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";

/** The icon to keep from what the page sent: null takes it away (back to #), an emoji as given (at most 16
 *  characters), a picture only when it is a real PNG, JPEG or WebP within ICON_MAX. Throws on anything else. */
export function iconValue(v) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new Error("That icon can't be used.");
  if (isPicture(v)) {
    if (v.length > ICON_MAX) throw new Error("That picture is too big for an icon.");
    const m = PICTURE.exec(v);
    let ok = false;
    try { ok = !!m && isType(m[1], head(m[2], 12)); } catch { ok = false; }
    if (!ok) throw new Error("Only a PNG, JPEG or WebP picture can be an icon.");
    return v;
  }
  const t = v.trim();
  if (!t || /[\u0000-\u001f<>]/.test(t)) throw new Error("That icon can't be used.");
  return t.slice(0, 16);
}
