// The QR code of the web app's private link, for Shepherdr settings > Web in the window (scanned with a phone).
// Drawn with Kazuhiko Arase's QR Code Generator (MIT, service/vendor/qrcode.cjs, its license in its header), as an SVG
// file under the app's data/ folder: a new file name for each link (the window caches a picture by its path).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore: a CommonJS file with no types
import qrcode from "./vendor/qrcode.cjs";

/** Writes the link's QR code into dir; returns its path. Older ones there go. */
export function qrFile(dir: string, link: string): string {
  const name = `web-qr-${createHash("sha1").update(link).digest("hex").slice(0, 10)}.svg`;
  const q = qrcode(0, "M");
  q.addData(link);
  q.make();
  const n = q.getModuleCount(), m = 4, size = n + m * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>\n`;
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.startsWith("web-qr-") && f !== name) rmSync(join(dir, f), { force: true });
  writeFileSync(join(dir, name), svg);
  return join(dir, name);
}
