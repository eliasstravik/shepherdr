import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webBuild } from "./webbuild.ts";

test("the web build is the hashed files index.html loads, read again when it changes (SHEP-337)", () => {
  const dir = mkdtempSync(join(tmpdir(), "webbuild-"));
  const build = webBuild(dir);
  expect(build()).toEqual({ id: "", version: "" });
  writeFileSync(join(dir, "index.html"), '<script src="./assets/index-aaa.js"></script><link href="./assets/index-aaa.css">');
  expect(build()).toEqual({ id: "assets/index-aaa.css assets/index-aaa.js", version: "" });
  writeFileSync(join(dir, "index.html"), '<meta name="shepherdr-version" content="3.2.3"><script src="./assets/index-bbbb.js"></script>');
  utimesSync(join(dir, "index.html"), new Date(), new Date(Date.now() + 5000));
  expect(build()).toEqual({ id: "assets/index-bbbb.js v3.2.3", version: "3.2.3" });
});
