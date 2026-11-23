import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webBuild } from "./webbuild.ts";

test("the web build is the hashed files index.html loads, read again when it changes (SHEP-337)", () => {
  const dir = mkdtempSync(join(tmpdir(), "webbuild-"));
  const build = webBuild(dir);
  expect(build()).toBe("");
  writeFileSync(join(dir, "index.html"), '<script src="./assets/index-aaa.js"></script><link href="./assets/index-aaa.css">');
  expect(build()).toBe("assets/index-aaa.css assets/index-aaa.js");
  writeFileSync(join(dir, "index.html"), '<script src="./assets/index-bbbb.js"></script>');
  utimesSync(join(dir, "index.html"), new Date(), new Date(Date.now() + 5000));
  expect(build()).toBe("assets/index-bbbb.js");
});
