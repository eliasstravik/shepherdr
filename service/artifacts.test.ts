import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { artifactOf, artifactStore } from "./compat.ts";
import { Artifacts, artifactAction, artifactRoute, pageKey, pageParts, plainError, PAGE_PATH, SANDBOX } from "./artifacts.ts";

// a throwaway artifacts folder: one artifact with two versions (the first has its pictures), and a file outside it
const dir = mkdtempSync(join(tmpdir(), "shep-artifacts-"));
const store = join(dir, "artifacts");
const put = (rel: string, text: string) => { mkdirSync(dirname(join(store, rel)), { recursive: true }); writeFileSync(join(store, rel), text); };
put("files/plan-1a2b/v1/index.html", "<h1>one</h1>");
put("files/plan-1a2b/v1/.thumb.png", "LIGHT");
put("files/plan-1a2b/v1/.thumb-dark.png", "DARK");
put("files/plan-1a2b/v2/index.html", "<h1>two</h1><script src=app.js></script>");
put("files/plan-1a2b/v2/app.js", "let x = 1;");
put("files/plan-1a2b/v2/style.css", "body{}");
put("files/plan-1a2b/v2/img/a b.png", "PNG");
put("files/plan-1a2b/v2/sub/index.html", "<h1>sub</h1>");
put("files/plan-1a2b/v2/data.bin", "0123456789");
put("files/plan-1a2b/v2/.old/recipe.json", "{}");
put("files/plan-1a2b/v2/.thumb.png", "LIGHT2");
put("srv-shop.json", "{\"secret\": true}");
symlinkSync(join(store, "srv-shop.json"), join(store, "files/plan-1a2b/v2/out.json"));

// herdr-artifact, faked: says what it was asked and answers as the real one does
const log = join(dir, "asked.log");
const fake = join(dir, "herdr-artifact");
writeFileSync(fake, `#!/bin/sh
sep=$(printf '\\037'); line=""; for a in "$@"; do line="$line$a$sep"; done; printf '%s\\n' "$line" >> "${log}"
[ "$1" = "--on" ] && shift 2
case "$1" in
  list) echo '{"artifacts": [{"id": "plan-1a2b", "title": "Plan", "version": 2, "folder": "/srv/shop", "at": 2, "files": ["index.html"], "proof": false, "pinned": true, "thumb": true, "versions": [{"v": 1, "at": 1, "thumb": true}, {"v": 2, "at": 2, "thumb": true}]}]}';;
  note|say) case "$*" in *held*) echo '{"to": "t9", "why": "made it", "version": 2, "held": true, "said": "It waits."}';; *gone*) echo '{"error": "The agent that made this page has ended, and its space has no chat running."}'; exit 1;; *) echo '{"to": "t9", "why": "made it", "version": 2}';; esac;;
  restore) case "$*" in *"--version 9"*) echo '{"error": "v9 of plan-1a2b isn'"'"'t kept."}'; exit 1;; *) echo '{"id": "plan-1a2b", "version": 3}';; esac;;
  rm) echo '{"removed": "plan-1a2b"}';;
  *) echo '{"id": "plan-1a2b"}';;
esac
`, { mode: 0o755 });
process.env.SHEPHERDR_HERDR_ARTIFACT = fake;
// (the list is read again after each action, in its own time: not what these tests ask about)
const asked = () => readFileSync(log, "utf8").trim().split("\n").map((l) => l.split("\x1f").slice(0, -1)).filter((l) => l[0] !== "list");
const lastAsked = () => asked().pop();

const arts = new Artifacts(store);
await arts.read();

const get = (path: string, init: RequestInit = {}) => { const url = new URL(`https://box.example.test${path}`); return artifactRoute(new Request(url, init), url); };
// refused: no such file, or (a path the URL itself already folded away: "..", "%2e%2e") no artifact address at all
const refused = async (path: string) => { const r = await get(path); if (r) expect(r.headers.get("content-security-policy")).toBe(SANDBOX); return !r || r.status === 404; };
const page = (rest = "", v = 2, id = "plan-1a2b", on: string | null = null) => `/api/artifacts/${id}/v/${v}/${on ? `on/${on}/` : ""}k/${pageKey(id, on)}/page/${rest}`;

test("a space's artifact store is herdr-artifact's: the repo's main folder, named as the Artifacts header", () => {
  expect(artifactStore({ folder: "/h/u" }, "/h/u")).toEqual({ folder: "/h/u", key: "|/h/u", name: "~" });
  expect(artifactStore({ folder: "/h/u/wt/x", git: { repo: "/h/u/dev/app/.git" } }, "/h/u")).toEqual({ folder: "/h/u/dev/app", key: "|/h/u/dev/app", name: "app" });
  // another machine's home reads "~" there too; its key names the machine
  expect(artifactStore({ folder: "/root", machine: "vm" }, "/h/u")).toEqual({ folder: "/root", key: "vm|/root", name: "~" });
  expect(artifactStore({ folder: "/root/dev/site", machine: "vm" }, "/h/u").name).toBe("site");
});

test("an artifact on the wire: a page, with its proof and pin marks, its picture and its versions newest first", () => {
  const a = artifactOf({ id: "x-1a2b", title: "SHOP-4: Fix · Proof", version: 2, at: 2, folder: "/h/u", task: "SHOP-4", proof: true, pinned: true, thumb: true,
    files: ["index.html"], versions: [{ v: 1, at: 1, kind: "custom", picture: 5, was: "custom" }, { v: 2, at: 2, note: "wider", thumb: true }] }, []);
  expect([a.proof, a.pinned, a.thumb, a.task, a.v]).toEqual([true, true, true, "SHOP-4", 2]);
  expect(a.versions.map((x) => [x.n, x.at, x.note])).toEqual([[2, 2, "wider"], [1, 1, undefined]]);
  // one kind only: nothing says recipe or gpui any more
  expect("kind" in a).toBe(false);
  expect(a.versions.some((x) => "kind" in x || "picture" in x)).toBe(false);
  // another machine's comes as its registry has it: the picture is its newest version's
  const b = artifactOf({ id: "y-1a2b", title: "Plan", version: 1, at: 1, folder: "/root", machine: "vm", versions: [{ v: 1, at: 1, thumb: true }] }, []);
  expect([b.proof, b.pinned, b.thumb, b.machine]).toEqual([undefined, undefined, true, "vm"]);
  expect(artifactOf({ id: "z-1a2b", title: "Plan", version: 1, at: 1, folder: "/root", versions: [{ v: 1, at: 1 }] }, []).thumb).toBeUndefined();
});

test("herdr-artifact's error is plain words, never JSON in JSON (#1213)", () => {
  const hc = JSON.stringify({ error: { hint: "typing would answer its dialog", kind: "blocked", message: "t7 is blocked (question)" } });
  expect(plainError(JSON.stringify({ error: hc }))).toBe("t7 is blocked (question)");
  expect(plainError(JSON.stringify({ error: "The agent that made this artifact has ended." }))).toBe("The agent that made this artifact has ended.");
  expect(plainError("")).toBe("");
  expect(plainError(JSON.stringify({ id: "x", title: "an error in the title" }))).toBe("");
});

test("the link the app frames redirects to the page's own address: its version, machine and key in the path", async () => {
  // no version asked: the newest listed
  let r = (await get("/api/artifacts/plan-1a2b/page/"))!;
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe(`../v/2/k/${pageKey("plan-1a2b")}/page/`);
  expect(new URL(r.headers.get("location")!, "https://box.example.test/shepherdr/api/artifacts/plan-1a2b/page/").pathname).toBe(`/shepherdr${page()}`);
  // the version asked for, a file deeper in, another machine's, and under the app's own prefix
  r = (await get("/shepherdr/api/artifacts/plan-1a2b/page/sub/index.html?v=1"))!;
  expect(new URL(r.headers.get("location")!, "https://box.example.test/shepherdr/api/artifacts/plan-1a2b/page/sub/index.html").pathname).toBe(`/shepherdr${page("sub/index.html", 1)}`);
  r = (await get("/api/artifacts/plan-1a2b/page?v=2&on=vm-2"))!;
  expect(new URL(r.headers.get("location")!, "https://box.example.test/api/artifacts/plan-1a2b/page").pathname).toBe(page("", 2, "plan-1a2b", "vm-2"));
  expect(pageKey("plan-1a2b", "vm-2")).not.toBe(pageKey("plan-1a2b"));
  expect(PAGE_PATH.test(page("", 2, "plan-1a2b", "vm-2"))).toBe(true);
  // nothing known and nothing asked, a bad version, a bad machine, a path out
  for (const bad of ["/api/artifacts/nope-0000/page/", "/api/artifacts/plan-1a2b/page/?v=abc", "/api/artifacts/plan-1a2b/page/?v=0", "/api/artifacts/plan-1a2b/page/?on=a%20b",
    "/api/artifacts/plan-1a2b/page/%2e%2e/x", "/api/artifacts/plan-1a2b/page/.old/recipe.json"]) expect([bad, await refused(bad)]).toEqual([bad, true]);
});

test("a page and its files are served sandboxed, each with its type, from the version asked for", async () => {
  let r = (await get(page()))!;
  expect([r.status, r.headers.get("content-type"), await r.text()]).toEqual([200, "text/html; charset=utf-8", "<h1>two</h1><script src=app.js></script>"]);
  expect(SANDBOX).toBe("sandbox allow-scripts allow-forms allow-popups");
  expect(r.headers.get("content-security-policy")).toBe(SANDBOX);
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(r.headers.get("set-cookie")).toBeNull();
  // its own scripts may read its own files from inside the sandbox (an origin of its own)
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect(await (await get(page("", 1)))!.text()).toBe("<h1>one</h1>");
  for (const [rest, type, text] of [["index.html", "text/html; charset=utf-8", "<h1>two</h1><script src=app.js></script>"], ["app.js", "text/javascript; charset=utf-8", "let x = 1;"],
    ["style.css", "text/css; charset=utf-8", "body{}"], ["img/a%20b.png", "image/png", "PNG"], ["sub/", "text/html; charset=utf-8", "<h1>sub</h1>"], ["data.bin", "application/octet-stream", "0123456789"]]) {
    r = (await get(page(rest)))!;
    expect([rest, r.status, r.headers.get("content-type"), await r.text()]).toEqual([rest, 200, type, text]);
    expect(r.headers.get("content-security-policy")).toBe(SANDBOX);
  }
  // a part of a file (a clip seeks)
  r = (await get(page("data.bin"), { headers: { range: "bytes=2-4" } }))!;
  expect([r.status, r.headers.get("content-range"), await r.text()]).toEqual([206, "bytes 2-4/10", "234"]);
  expect((await get(page("app.js"), { method: "HEAD" }))!.status).toBe(200);
  r = (await get(page(), { method: "POST" }))!;
  expect([r.status, r.headers.get("content-security-policy")]).toEqual([405, SANDBOX]);
});

test("nothing outside the page's folder, no dot files, no other artifact's key", async () => {
  for (const rest of ["../v1/index.html", "%2e%2e/%2e%2e/%2e%2e/srv-shop.json", "..%2f..%2f..%2fsrv-shop.json", "img/../../v1/index.html", "img%2f..%2f..%2fx", ".thumb.png", ".old/recipe.json",
    "sub/.hidden", "out.json", "nope.css", "sub", "a//b", "%00", "%zz", "img\\..\\x"]) {
    expect([rest, await refused(page(rest))]).toEqual([rest, true]);
    // and it never comes back with the file outside
    const r = await get(page(rest));
    if (r) expect(await r.text()).not.toContain("secret");
  }
  expect((await get(page("", 7)))!.status).toBe(404);
  // the key is the artifact's own (and its machine's): another's, a cut one or none opens nothing
  const key = pageKey("plan-1a2b");
  expect((await get(`/api/artifacts/plan-1a2b/v/2/k/${pageKey("other-0000")}/page/`))!.status).toBe(404);
  expect((await get(`/api/artifacts/plan-1a2b/v/2/k/${pageKey("plan-1a2b", "vm")}/page/`))!.status).toBe(404);
  expect((await get(`/api/artifacts/plan-1a2b/v/2/k/${"x".repeat(key.length)}/page/`))!.status).toBe(404);
  expect(await get("/api/artifacts/plan-1a2b/v/2/page/")).toBeNull();
  expect(await get("/api/artifacts/../plan-1a2b/v/2/k/" + key + "/page/x")).toBeNull();
  expect(pageParts("a/b.png")).toEqual(["a", "b.png"]);
  expect(pageParts("a/../b")).toBeNull();
  expect(pageParts(".env")).toBeNull();
});

test("a version's picture, light and dark; 404 when it has none", async () => {
  let r = (await get("/api/artifacts/plan-1a2b/thumb?v=1"))!;
  expect([r.status, r.headers.get("content-type"), await r.text()]).toEqual([200, "image/png", "LIGHT"]);
  expect(await (await get("/api/artifacts/plan-1a2b/thumb?v=1&dark=1"))!.text()).toBe("DARK");
  // the newest when no version is asked; no dark one taken: the light one
  expect(await (await get("/api/artifacts/plan-1a2b/thumb"))!.text()).toBe("LIGHT2");
  expect(await (await get("/api/artifacts/plan-1a2b/thumb?dark=1"))!.text()).toBe("LIGHT2");
  r = (await get("/api/artifacts/plan-1a2b/thumb?v=5"))!;
  expect(r.status).toBe(404);
  expect((await get("/api/artifacts/nope-0000/thumb"))!.status).toBe(404);
});

test("other addresses aren't an artifact's", async () => {
  for (const p of ["/api/artifacts", "/api/artifacts/plan-1a2b", "/api/artifacts/plan-1a2b/recipe", "/api/artifacts/plan-1a2b/file/x.png", "/api/file", "/"]) expect(await get(p)).toBeNull();
});

test("another machine's page is read there, inside its version's folder", async () => {
  const calls: any[] = [];
  arts.hub = { call: async (_m: string, p: any) => { calls.push(p); return p.argv.at(-1) === "index.html" ? { code: 0, stdout: Buffer.from("<h1>there</h1>").toString("base64"), stderr: "" } : { code: 1, stdout: "", stderr: "" }; } } as any;
  const r = (await get(page("", 3, "far-9f9f", "vm-2")))!;
  expect([r.status, r.headers.get("content-type"), r.headers.get("content-security-policy"), await r.text()]).toEqual([200, "text/html; charset=utf-8", SANDBOX, "<h1>there</h1>"]);
  expect(calls[0].on).toBe("vm-2");
  expect(calls[0].argv.slice(-4)).toEqual(["file", "far-9f9f", "3", "index.html"]);
  expect((await get(page("nope.css", 3, "far-9f9f", "vm-2")))!.status).toBe(404);
  expect(await refused(page("../x", 3, "far-9f9f", "vm-2"))).toBe(true);
  expect(await refused(page(".old/recipe.json", 3, "far-9f9f", "vm-2"))).toBe(true);
  expect(calls.length).toBe(2);
  arts.hub = null;
});

test("what the person does with an artifact runs herdr-artifact", async () => {
  expect(await artifactAction({ type: "artifact-rename", place: "p1", artifact: "plan-1a2b", name: " -The plan " })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["rename", "--json", "--", "plan-1a2b", "-The plan"]);
  expect(await artifactAction({ type: "artifact-pin", artifact: "plan-1a2b", on: true })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["pin", "--json", "--", "plan-1a2b"]);
  await artifactAction({ type: "artifact-pin", artifact: "plan-1a2b", on: false });
  expect(lastAsked()).toEqual(["unpin", "--json", "--", "plan-1a2b"]);
  expect(await artifactAction({ type: "artifact-restore", artifact: "plan-1a2b", v: 1 })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["restore", "--json", "--version", "1", "--", "plan-1a2b"]);
  expect(await artifactAction({ type: "artifact-keep", artifact: "plan-1a2b" })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["keep", "--json", "--", "plan-1a2b"]);
  expect(await artifactAction({ type: "artifact-delete", artifact: "plan-1a2b" })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["rm", "--json", "--", "plan-1a2b"]);
});

test("a note with its pin and an answer from the page go to the agent that keeps it", async () => {
  expect(await artifactAction({ type: "artifact-note", place: "p1", artifact: "plan-1a2b", v: 2, note: "-wider table", spot: { x: 0.4204, y: 7 } })).toEqual({ ok: true, to: "t9" });
  expect(lastAsked()).toEqual(["note", "--json", "--text=-wider table", "--version", "2", "--spot=0.420,1.000", "--", "plan-1a2b"]);
  await artifactAction({ type: "artifact-note", artifact: "plan-1a2b", v: 1, note: "all of it" });
  expect(lastAsked()).toEqual(["note", "--json", "--text=all of it", "--version", "1", "--", "plan-1a2b"]);
  expect(await artifactAction({ type: "artifact-say", artifact: "plan-1a2b", v: 2, text: "Ship it" })).toEqual({ ok: true, to: "t9" });
  expect(lastAsked()).toEqual(["say", "--json", "--text=Ship it", "--version", "2", "--", "plan-1a2b"]);
  // its agent waits on a question: kept for it, and the app can say so
  expect(await artifactAction({ type: "artifact-say", artifact: "plan-1a2b", v: 2, text: "held" })).toEqual({ ok: true, to: "t9", held: true, said: "It waits." });
});

test("an action that fails says why in plain words; one on another machine goes there", async () => {
  expect(await artifactAction({ type: "artifact-say", artifact: "plan-1a2b", v: 2, text: "gone" })).toEqual({ ok: false, error: "The agent that made this page has ended, and its space has no chat running." });
  expect(await artifactAction({ type: "artifact-restore", artifact: "plan-1a2b", v: 9 })).toEqual({ ok: false, error: "v9 of plan-1a2b isn't kept." });
  const n = asked().length;
  expect(await artifactAction({ type: "artifact-rename", artifact: "../x", name: "y" })).toEqual({ ok: false, error: "Not an artifact." });
  expect(await artifactAction({ type: "artifact-rename", artifact: "plan-1a2b", name: "  " })).toEqual({ ok: false, error: "Give it a name." });
  expect(await artifactAction({ type: "artifact-note", artifact: "plan-1a2b", v: 2, note: "" })).toEqual({ ok: false, error: "Write the note first." });
  expect(await artifactAction({ type: "artifact-say", artifact: "plan-1a2b", text: "x" })).toEqual({ ok: false, error: "Which version?" });
  expect(await artifactAction({ type: "artifact-pin", artifact: "plan-1a2b", machine: "a b" })).toEqual({ ok: false, error: "Not a machine." });
  expect(asked().length).toBe(n);
  expect(await artifactAction({ type: "artifact-keep", artifact: "far-9f9f", machine: "vm-2" })).toEqual({ ok: true });
  expect(lastAsked()).toEqual(["--on", "vm-2", "keep", "--json", "--", "far-9f9f"]);
  expect(await artifactAction({ type: "task-accept" })).toBeNull();
  expect(await artifactAction(null)).toBeNull();
});
