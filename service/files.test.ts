import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as files from "./files.ts";

// the helper as herdr-core runs it, here (machine.exec: argv, stdin in base64, output in base64)
const hub: any = { call: async (_m: string, p: any) => {
  const pr = Bun.spawn(p.argv, { stdin: p.input ? Buffer.from(p.input, "base64") : "ignore", stdout: "pipe", stderr: "pipe" });
  const [o, e] = [await new Response(pr.stdout).arrayBuffer(), await new Response(pr.stderr).arrayBuffer()];
  return { code: await pr.exited, stdout: Buffer.from(o).toString("base64"), stderr: Buffer.from(e).toString("base64") };
} };
const top = mkdtempSync(join(tmpdir(), "shep-files-")), root = join(top, "space");
mkdirSync(join(root, "src", "lib"), { recursive: true });
mkdirSync(join(root, ".git"));
mkdirSync(join(top, "private"));
writeFileSync(join(top, "private", "key.txt"), "secret");
writeFileSync(join(root, "src", "a.ts"), "export const a = 1\n");
symlinkSync("../private", join(root, "out"));
symlinkSync("src", join(root, "in"));
const at = { folder: root, machine: null };

test("a folder lists folders first, .git left out, a link out of the folder marked and never followed", async () => {
  expect(await files.list(hub, at, "")).toEqual({ entries: [{ name: "in", kind: "dir" }, { name: "src", kind: "dir" }, { name: "out", kind: "link" }] });
  expect((await files.list(hub, at, "out")).error).toContain("leads out");
  expect((await files.read(hub, at, "out/key.txt")).error).toBeDefined();
  expect((await files.read(hub, at, "in/a.ts")).text).toBe("export const a = 1\n");
  expect(() => files.relPath("../private/key.txt")).toThrow();
  expect(() => files.relPath("/etc/passwd")).toThrow();
  const r = await files.file(hub, at, "out/key.txt", true);
  expect(r.status).toBe(404);
});

test("a dropped file goes in its folder, asks before replacing, and a drag moves it", async () => {
  expect(await files.put(hub, at, "src", new File(["hi"], "note.txt"), false)).toEqual({ ok: true });
  expect(await files.put(hub, at, "src", new File(["again"], "note.txt"), false)).toEqual({ exists: true });
  expect(await files.put(hub, at, "src", new File(["again"], "note.txt"), true)).toEqual({ ok: true });
  expect(readFileSync(join(root, "src", "note.txt"), "utf8")).toBe("again");
  expect((await files.put(hub, at, "out", new File(["x"], "x.txt"), false)).error).toBeDefined();
  expect(existsSync(join(top, "private", "x.txt"))).toBe(false);
  expect(await files.move(hub, at, "src/note.txt", "src/lib")).toEqual({ ok: true });
  expect(existsSync(join(root, "src", "lib", "note.txt"))).toBe(true);
  expect((await files.move(hub, at, "src", "src/lib")).error).toContain("inside itself");
  expect((await files.move(hub, at, "src/a.ts", "out")).error).toBeDefined();
});

test("a file downloads as it is, a folder as a zip", async () => {
  const f = await files.file(hub, at, "src/a.ts", true);
  expect(f.headers.get("content-disposition")).toContain('attachment; filename="a.ts"');
  expect(await f.text()).toBe("export const a = 1\n");
  const z = await files.zip(hub, at, "src");
  expect(z.headers.get("content-type")).toBe("application/zip");
  const bytes = new Uint8Array(await z.arrayBuffer());
  expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
});
