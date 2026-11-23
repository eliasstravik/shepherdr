// Which build of the web app this service serves (SHEP-337): the hashed files its index.html loads, as a page works
// out its own (web/shared/build.ts). A page on another build learns of it (live.ts) and updates itself. Read again
// when index.html changes, so a new web app put in place without a restart is news too.
import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildId } from "../web/shared/build.ts";

export function webBuild(dir: string) {
  let seen = "";
  let id = "";
  return () => {
    const p = join(dir, "index.html");
    let stamp = "";
    try { const s = statSync(p); stamp = `${s.mtimeMs}:${s.size}`; } catch { return ""; }
    if (stamp !== seen) {
      try { id = buildId(readFileSync(p, "utf8")); seen = stamp; } catch { id = ""; }
    }
    return id;
  };
}
