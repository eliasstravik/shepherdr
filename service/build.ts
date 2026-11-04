// Which build of the service this is: a digest of what it runs (its TypeScript, the shared core, the page's entry).
// The node record says it (service/host.ts), and a move (service/serve-from.ts) sends the install again when the
// other machine's differs, even at the same version.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function buildId(root = join(import.meta.dir, "..")) {
  const h = createHash("sha256");
  for (const dir of ["service", "core"]) {
    let names: string[] = [];
    try { names = readdirSync(join(root, dir)).filter((f) => /\.(ts|js|json)$/.test(f) && !/\.test\./.test(f)).sort(); } catch {}
    for (const f of names) { h.update(`${dir}/${f}\0`); try { h.update(readFileSync(join(root, dir, f))); } catch {} }
  }
  try { h.update(readFileSync(join(root, "web", "dist", "index.html"))); } catch {}
  return h.digest("hex").slice(0, 16);
}
