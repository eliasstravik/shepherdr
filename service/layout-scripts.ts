// The coordinator mod's shell scripts the service runs (restart.sh): the window layout's copy when it is installed,
// else the one shipped beside the service (a web-only install has no window layout, bin/shepherdr service_items), so
// restarting an agent from the web works with or without the window (SHEP-181).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appHome } from "./paths.ts";

export function layoutScript(name: string): string | null {
  for (const dir of [join(appHome(), "mods", "coordinator"), join(import.meta.dir, "..", "mods", "coordinator")]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}
