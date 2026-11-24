import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { artifactOf, artifactStore } from "./compat.ts";
import { Artifacts, artifactAction, artifactRoute, LINKS_JS, pageKey, pageParts, plainError, PAGE_PATH, SANDBOX, withLinks } from "./artifacts.ts";
import { runInNewContext } from "node:vm";

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

// a long page with four real pictures beside its index.html, like a list of the best matches (SHEP-340)
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c63f8cfc0f01f0005000201" + "ff8e5a3f0000000049454e44ae426082", "hex");
put("files/picks-3c4d/v1/index.html", `<h2>The best matches</h2>${[1, 2, 3, 4].map((n) => `<section><h3>Pick ${n}</h3><img src="pic${n}.png"><p>${"More words. ".repeat(80)}</p></section>`).join("")}<p id="end">The end.</p>`);
for (const n of [1, 2, 3, 4]) { mkdirSync(join(store, "files/picks-3c4d/v1"), { recursive: true }); writeFileSync(join(store, `files/picks-3c4d/v1/pic${n}.png`), PNG); }

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
  expect([r.status, r.headers.get("content-type"), await r.text()]).toEqual([200, "text/html; charset=utf-8", withLinks("<h1>two</h1><script src=app.js></script>")]);
  expect(SANDBOX).toBe("sandbox allow-scripts allow-forms allow-popups");
  expect(r.headers.get("content-security-policy")).toBe(SANDBOX);
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(r.headers.get("set-cookie")).toBeNull();
  // its own scripts may read its own files from inside the sandbox (an origin of its own)
  expect(r.headers.get("access-control-allow-origin")).toBe("*");
  expect(await (await get(page("", 1)))!.text()).toBe(withLinks("<h1>one</h1>"));
  for (const [rest, type, text] of [["index.html", "text/html; charset=utf-8", withLinks("<h1>two</h1><script src=app.js></script>")], ["app.js", "text/javascript; charset=utf-8", "let x = 1;"],
    ["style.css", "text/css; charset=utf-8", "body{}"], ["img/a%20b.png", "image/png", "PNG"], ["sub/", "text/html; charset=utf-8", withLinks("<h1>sub</h1>")], ["data.bin", "application/octet-stream", "0123456789"]]) {
    r = (await get(page(rest)))!;
    expect([rest, r.status, r.headers.get("content-type"), await r.text()]).toEqual([rest, 200, type, text]);
    expect(r.headers.get("content-security-policy")).toBe(SANDBOX);
  }
  // a long page's pictures beside its index.html load through the same route, whole (SHEP-340)
  const long = (rest = "") => page(rest, 1, "picks-3c4d");
  r = (await get(long()))!;
  const html = await r.text();
  expect([r.status, html.includes('<p id="end">The end.</p>'), [...html.matchAll(/src="(pic\d\.png)"/g)].length]).toEqual([200, true, 4]);
  for (const [, src] of html.matchAll(/src="(pic\d\.png)"/g)) {
    r = (await get(new URL(src!, `https://box.example.test${long()}`).pathname))!;
    expect([src, r.status, r.headers.get("content-type"), Buffer.from(await r.arrayBuffer()).equals(PNG)]).toEqual([src, 200, "image/png", true]);
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
  expect([r.status, r.headers.get("content-type"), r.headers.get("content-security-policy"), await r.text()]).toEqual([200, "text/html; charset=utf-8", SANDBOX, withLinks("<h1>there</h1>")]);
  expect(calls[0].on).toBe("vm-2");
  expect(calls[0].argv.slice(-4)).toEqual(["file", "far-9f9f", "3", "index.html"]);
  expect((await get(page("nope.css", 3, "far-9f9f", "vm-2")))!.status).toBe(404);
  expect(await refused(page("../x", 3, "far-9f9f", "vm-2"))).toBe(true);
  expect(await refused(page(".old/recipe.json", 3, "far-9f9f", "vm-2"))).toBe(true);
  expect(calls.length).toBe(2);
  arts.hub = null;
});

test("another machine's version 2 picture is read there, its bytes whole; none taken there: 404 (SHEP-344)", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xc3, 0x28]);
  const calls: any[] = [];
  // v2 of far-9f9f has its picture there; v3 was published where no browser was
  arts.hub = { call: async (_m: string, p: any) => { calls.push(p); const [, id, v, name] = p.argv.slice(-4);
    return id === "far-9f9f" && v === "2" && name === ".thumb.png" ? { code: 0, stdout: png.toString("base64"), stderr: "" } : { code: 1, stdout: "", stderr: "" }; } } as any;
  const r = (await get("/api/artifacts/far-9f9f/thumb?v=2&on=vm-2"))!;
  expect([r.status, r.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect(Buffer.from(await r.arrayBuffer()).equals(png)).toBe(true);
  expect(calls[0].on).toBe("vm-2");
  expect(calls[0].argv.slice(-4)).toEqual(["file", "far-9f9f", "2", ".thumb.png"]);
  expect((await get("/api/artifacts/far-9f9f/thumb?v=3&on=vm-2"))!.status).toBe(404);
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

// A link to another site in an artifact took over its frame and left a dead grey panel: every page runs a link catcher
// first, which sends other sites (and the app's own links) to the app instead of moving the frame.
test("every page of an artifact starts with its link catcher, in its head and never before its doctype", async () => {
  const tag = `<script>${LINKS_JS}</script>`;
  expect(withLinks("<!doctype html><html lang=en><head><title>x</title></head><body>b</body></html>")).toBe(`<!doctype html><html lang=en><head>${tag}<title>x</title></head><body>b</body></html>`);
  expect(withLinks("<!DOCTYPE html>\n<html><body>b</body></html>")).toBe(`<!DOCTYPE html>\n<html>${tag}<body>b</body></html>`);
  expect(withLinks("<!doctype html><p>b")).toBe(`<!doctype html>${tag}<p>b`);
  expect(withLinks("<h1>one</h1>")).toBe(`${tag}<h1>one</h1>`);
  // a <header> is no <head>
  expect(withLinks("<header>h</header>")).toBe(`${tag}<header>h</header>`);
  // a part asked of a page still gets the whole page, with its catcher; its other files are untouched
  const r = (await get(page(), { headers: { range: "bytes=0-3" } }))!;
  expect([r.status, r.headers.get("content-range"), await r.text()]).toEqual([200, null, withLinks("<h1>two</h1><script src=app.js></script>")]);
  expect(await (await get(page("app.js")))!.text()).toBe("let x = 1;");
});

/** LINKS_JS run on a fake page at `at`: what it told the app, and whether each click was stopped */
function catcher(at: string) {
  const said: any[] = [];
  let onClick: (e: any) => void = () => {};
  const on: Record<string, (e?: any) => void> = {};
  const added: any[] = [];
  const el = () => { const x: any = { style: {}, setAttribute() {}, remove() { added.splice(added.indexOf(x), 1); } }; return x; };
  const doc: any = { baseURI: at, addEventListener: (_: string, f: any) => { onClick = f; }, createElement: el,
    documentElement: { scrollWidth: 400, scrollHeight: 2000, appendChild: (x: any) => added.push(x) } };
  const win: any = { location: new URL(at), URL, addEventListener: (n: string, f: any) => { on[n] = f; }, document: doc };
  win.parent = { postMessage: (m: any) => said.push(m) };
  win.window = win;
  runInNewContext(LINKS_JS, win);
  const onLoad = () => on.load!();
  const click = (href: string, more: { target?: string; button?: number; ctrlKey?: boolean } = {}) => {
    const a = { getAttribute: (n: string) => (n === "href" ? href : null), hasAttribute: () => false, target: more.target ?? "" };
    const e = { defaultPrevented: false, button: more.button ?? 0, metaKey: false, ctrlKey: !!more.ctrlKey, shiftKey: false, altKey: false,
      target: { closest: () => a }, preventDefault() { this.defaultPrevented = true; } };
    said.length = 0;
    onClick(e);
    return { stopped: e.defaultPrevented, said: [...said] };
  };
  /** the app turns Mark up on or off, as the frame's parent (or another window pretends to) */
  const markup = (v: boolean, from: any = win.parent) => on.message!({ source: from, data: { shepherdr: "markup", on: v } });
  /** a tap on the page at (x, y) of the whole page: whether it was stopped from doing what it would */
  const tap = (x: number, y: number) => {
    const e = { pageX: x, pageY: y, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    said.length = 0;
    on.click!(e);
    return { stopped: e.defaultPrevented && e.stopped, said: [...said] };
  };
  /** a form sent: whether it was kept from moving the frame */
  const submit = (action: string | null, target: string | null = null, prevented = false) => {
    const e = { defaultPrevented: prevented, target: { getAttribute: (n: string) => (n === "action" ? action : n === "target" ? target : null) }, preventDefault() { this.defaultPrevented = true; } };
    on.submit!(e);
    return e.defaultPrevented;
  };
  return { said, click, load: () => onLoad(), markup, tap, submit, added };
}

test("in an artifact, another site's link goes to the app (a new tab), never into the frame; its own links stay", () => {
  const at = `https://box.example.test/shepherdr${page("index.html")}`;
  const c = catcher(at);
  // it says it shows a page of the artifact as it starts and again on its load (the app looks for that word near a load)
  expect(c.said).toEqual([{ shepherdr: "page" }]);
  c.load();
  expect(c.said).toEqual([{ shepherdr: "page" }, { shepherdr: "page" }]);
  // another site, with or without a target of its own: the app opens it, the frame stays
  expect(c.click("https://www.youtube.com/watch?v=abc")).toEqual({ stopped: true, said: [{ shepherdr: "link", href: "https://www.youtube.com/watch?v=abc" }] });
  expect(c.click("//example.com/x", { target: "_blank" })).toEqual({ stopped: true, said: [{ shepherdr: "link", href: "https://example.com/x" }] });
  // this app's own links (another artifact, a task): to the app, which opens them in place
  expect(c.click("https://box.example.test/shepherdr/?artifact=plan-9z9z")).toEqual({ stopped: true, said: [{ shepherdr: "link", href: "https://box.example.test/shepherdr/?artifact=plan-9z9z" }] });
  // an anchor, and the artifact's own pages and files: left to the frame
  expect(c.click("#end")).toEqual({ stopped: false, said: [] });
  expect(c.click("sub/")).toEqual({ stopped: false, said: [{ shepherdr: "inside" }] });
  expect(c.click("img/a%20b.png")).toEqual({ stopped: false, said: [{ shepherdr: "inside" }] });
  // mail, a ctrl-click or a middle click: as the browser does them
  expect(c.click("mailto:someone@example.test")).toEqual({ stopped: false, said: [] });
  expect(c.click("https://example.com/", { ctrlKey: true })).toEqual({ stopped: false, said: [] });
  expect(c.click("https://example.com/", { button: 1 })).toEqual({ stopped: false, said: [] });
});

// SHEP-464: Mark up laid a layer over the frame, so the page could not scroll while its box was open: the page's own
// catcher takes the tap now, draws the pin in the page and says where, and the page scrolls as ever.
test("marking up, a tap on the page drops a pin there and says where on the whole page; off again, taps are the page's", () => {
  const c = catcher(`https://box.example.test/shepherdr${page("index.html")}`);
  expect(c.tap(100, 500)).toEqual({ stopped: false, said: [] });
  // only the app (the frame's parent) turns it on
  c.markup(true, {});
  expect(c.tap(100, 500)).toEqual({ stopped: false, said: [] });
  c.markup(true);
  // a style (the crosshair) and, on the tap, the pin
  expect(c.added.length).toBe(1);
  expect(c.tap(100, 500)).toEqual({ stopped: true, said: [{ shepherdr: "spot", x: 0.25, y: 0.25 }] });
  expect(c.added.length).toBe(2);
  expect(c.added[1].style.left).toBe("100px");
  expect(c.added[1].style.top).toBe("500px");
  // a second tap moves the same pin
  expect(c.tap(200, 1500).said).toEqual([{ shepherdr: "spot", x: 0.5, y: 0.75 }]);
  expect(c.added.length).toBe(2);
  // off: the pin and the crosshair go, and a tap is the page's again
  c.markup(false);
  expect(c.added.length).toBe(0);
  expect(c.tap(100, 500)).toEqual({ stopped: false, said: [] });
});

// SHEP-464: a proof's Reply box (a form whose script sends the answer) went on to send the form too, and the frame
// ended on the service's "read only" answer: "Couldn't show this page". A form sent to the artifact never moves it.
test("a form sent to the artifact itself never moves the frame; one to another site, or one its page handles, is left alone", () => {
  const c = catcher(`https://box.example.test/shepherdr${page("index.html")}`);
  expect(c.submit(null)).toBe(true);
  expect(c.submit("")).toBe(true);
  expect(c.submit("sub/send.html")).toBe(true);
  expect(c.submit(null, "_self")).toBe(true);
  // another site, a new tab: as the browser does them
  expect(c.submit("https://example.com/search")).toBe(false);
  expect(c.submit(null, "_blank")).toBe(false);
  // one the page stopped itself stays stopped
  expect(c.submit(null, null, true)).toBe(true);
});
