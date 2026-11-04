// bun test (bunfig.toml): the service's data (paths.ts DATA) in a throwaway folder before any test imports it, so no
// test writes the real ~/.herdr/shepherdr (ask-ends.json and the rest).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SHEPHERDR_DATA ||= mkdtempSync(join(tmpdir(), "shep-data-"));
