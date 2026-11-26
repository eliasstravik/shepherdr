// Files (the files plugin, off by default): a space's folder as a tree, on the machine the space lives on. List a
// folder, read a file, download a file or a folder (as a zip), put a dropped file in a folder, move one by dragging.
// Every step runs one small Python program there (python3 is on every machine herdr-task runs on) through herdr-core,
// so another machine works the same way. Only inside the space's folder: a path is relative, never "..", and a link
// that leads out of the folder is never followed. Size limits, said plainly: here, uploads up to 100 MB; another
// machine, up to 8 MB either way (what herdr-core carries in one call).
import type { Hub } from "./hub.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

export const LIMITS = { here: 100 * 1024 * 1024, remote: 8 * 1024 * 1024 - 64 * 1024, text: 400_000, entries: 2000 };
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

// op root rel [arg]: prints one JSON line, except "raw" (the file's bytes). Exit 3: refused (its words on stderr).
export const HELPER = String.raw`
import os, sys, json, stat, zipfile, tempfile, shutil
op, root, rel = sys.argv[1], sys.argv[2], sys.argv[3]
arg = sys.argv[4] if len(sys.argv) > 4 else ""
R = os.path.realpath(os.path.expanduser(root))
def out(o):
    sys.stdout.write(json.dumps(o)); sys.exit(0)
def no(m):
    sys.stderr.write(m); sys.exit(3)
def within(p): return p == R or p.startswith(R + os.sep)
def place(rel):
    # the path itself (a link stays a link), under a real folder inside the space's
    if rel in ("", "."): return R
    parts = rel.split("/")
    if any(x in ("", ".", "..") for x in parts) or "\0" in rel or len(rel) > 4096: no("That isn't in this space's folder.")
    parent = os.path.realpath(os.path.join(R, *parts[:-1]))
    if not within(parent): no("That isn't in this space's folder.")
    return os.path.join(parent, parts[-1])
def real(rel):
    # what it is: a link that leads out of the folder is refused
    p = place(rel); r = os.path.realpath(p)
    if not within(r): no("That link leads out of this space's folder.")
    if not os.path.exists(r): no("It isn't there any more.")
    return r
if not os.path.isdir(R): no("This space's folder isn't there.")
if op == "ls":
    d = real(rel)
    if not os.path.isdir(d): no("That isn't a folder.")
    es = []
    with os.scandir(d) as it:
        for e in it:
            if e.name == ".git": continue
            k = "f"
            try:
                if e.is_symlink():
                    t = os.path.realpath(e.path)
                    k = ("d" if os.path.isdir(t) else "f") if within(t) and os.path.exists(t) else "l"
                elif e.is_dir(): k = "d"
                s = e.stat().st_size if k == "f" else 0
            except OSError: s = 0
            es.append([k, e.name, s])
            if len(es) > LIMIT: break
    es.sort(key=lambda x: (x[0] != "d", x[1].lower()))
    out({"entries": es[:LIMIT], "more": len(es) > LIMIT})
if op == "read":
    f = real(rel)
    if not os.path.isfile(f): no("That isn't a file.")
    size = os.path.getsize(f)
    with open(f, "rb") as h: b = h.read(TEXT)
    try:
        if b"\0" in b: raise ValueError
        t = b.decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        out({"size": size, "binary": True})
    out({"size": size, "text": t, "cut": size > TEXT})
if op == "where":
    # here: the real path, for the service to send itself
    f = real(rel)
    if not os.path.isfile(f): no("That isn't a file.")
    out({"path": f, "size": os.path.getsize(f)})
if op == "raw":
    f = real(rel)
    if not os.path.isfile(f): no("That isn't a file.")
    if os.path.getsize(f) > int(arg): no("too big")
    with open(f, "rb") as h: shutil.copyfileobj(h, sys.stdout.buffer)
    sys.exit(0)
if op == "zip":
    # a folder as a zip in the temp folder, links left out; given up past the limit
    d = real(rel)
    if not os.path.isdir(d): no("That isn't a folder.")
    cap, total = int(arg), 0
    import glob, time
    for old in glob.glob(os.path.join(tempfile.gettempdir(), "shepherdr-files-*.zip")):
        try:
            if time.time() - os.path.getmtime(old) > 3600: os.unlink(old)
        except OSError: pass
    fd, z = tempfile.mkstemp(prefix="shepherdr-files-", suffix=".zip"); os.close(fd)
    top = os.path.basename(d) if d != R else os.path.basename(R) or "folder"
    try:
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            for at, dirs, files in os.walk(d):
                dirs[:] = [x for x in dirs if x != ".git" and not os.path.islink(os.path.join(at, x))]
                for n in files:
                    p = os.path.join(at, n)
                    if os.path.islink(p) or not os.path.isfile(p): continue
                    total += os.path.getsize(p)
                    if total > cap: raise OverflowError
                    zf.write(p, os.path.join(top, os.path.relpath(p, d)))
    except OverflowError:
        os.unlink(z); no("too big")
    out({"path": z, "size": os.path.getsize(z)})
if op == "rmzip":
    if os.path.basename(arg).startswith("shepherdr-files-") and arg.endswith(".zip") and os.path.dirname(arg) == tempfile.gettempdir(): os.unlink(arg)
    out({})
if op == "put":
    # a dropped file: stdin, or (here) a file the service kept; arg is its name, "!" in front to replace one there
    d = real(rel)
    if not os.path.isdir(d): no("That isn't a folder.")
    replace = arg.startswith("!"); name = arg[1:] if replace else arg
    src = sys.argv[5] if len(sys.argv) > 5 else ""
    if not name or "/" in name or name in (".", "..") or "\0" in name or len(name) > 255: no("That name can't be used.")
    to = os.path.join(d, name)
    if os.path.lexists(to) and (not replace or os.path.islink(to) or not os.path.isfile(to)): out({"exists": True})
    fd, tmp = tempfile.mkstemp(prefix=".shepherdr-", dir=d)
    with os.fdopen(fd, "wb") as h:
        if src:
            with open(src, "rb") as s: shutil.copyfileobj(s, h)
        else: shutil.copyfileobj(sys.stdin.buffer, h)
    os.chmod(tmp, 0o644 & ~os.umask(os.umask(0)))
    os.replace(tmp, to)
    out({"ok": True})
if op == "mv":
    # a file or folder dragged onto a folder: the thing itself (a link stays a link), never into itself
    src = place(rel)
    if src == R or not os.path.lexists(src): no("It isn't there any more.")
    d = real(arg)
    if not os.path.isdir(d): no("That isn't a folder.")
    rs = os.path.realpath(src)
    if not os.path.islink(src) and (d == rs or d.startswith(rs + os.sep)): no("A folder can't go inside itself.")
    to = os.path.join(d, os.path.basename(src))
    if os.path.lexists(to):
        if os.path.realpath(os.path.dirname(src)) == d: out({"ok": True})
        no("Something named " + os.path.basename(src) + " is already there.")
    shutil.move(src, to)
    out({"ok": True})
no("Ask for ls, read, raw, zip, put or mv.")
`.replace(/\bLIMIT\b/g, String(LIMITS.entries)).replace(/\bTEXT\b/g, String(LIMITS.text));

export type Place = { folder: string; machine: string | null };
type Run = { code: number; out: Uint8Array; err: string; truncated?: boolean };

/** One step of the helper on the space's machine (null: here). */
async function run(hub: Hub, p: Place, args: string[], input?: Uint8Array, timeout = 120): Promise<Run> {
  const r = await hub.call<{ code: number; stdout: string; stderr: string; truncated?: boolean }>("machine.exec",
    { argv: ["python3", "-c", HELPER, ...args], ...(p.machine ? { on: p.machine } : {}), timeout, ...(input ? { input: Buffer.from(input).toString("base64") } : {}) }, (timeout + 5) * 1000);
  return { code: r.code, out: new Uint8Array(Buffer.from(r.stdout ?? "", "base64")), err: Buffer.from(r.stderr ?? "", "base64").toString("utf8").trim(), truncated: r.truncated };
}
const words = (r: Run) => (r.code === 3 && r.err ? r.err : "That didn't work on the machine the space is on.");
const parsed = (r: Run) => JSON.parse(Buffer.from(r.out).toString("utf8"));

/** A path a page names: relative to the space's folder; the helper checks it again where it runs. */
export function relPath(v: unknown): string {
  const p = String(v ?? "");
  if (p === "") return "";
  if (p.length > 4096 || p.startsWith("/") || p.includes("\0") || p.split("/").some((x) => x === "" || x === "." || x === "..")) throw new Error("That isn't in this space's folder.");
  return p;
}

export async function list(hub: Hub, p: Place, rel: string) {
  const r = await run(hub, p, ["ls", p.folder, relPath(rel)], undefined, 30);
  if (r.code !== 0) return { error: words(r) };
  const o = parsed(r);
  return { entries: (o.entries as [string, string, number][]).map(([k, name, size]) => ({ name, kind: k === "d" ? "dir" : k === "l" ? "link" : "file", ...(k === "f" ? { size } : {}) })), ...(o.more ? { more: true } : {}) };
}

export async function read(hub: Hub, p: Place, rel: string) {
  const r = await run(hub, p, ["read", p.folder, relPath(rel)], undefined, 30);
  return r.code === 0 ? parsed(r) : { error: words(r) };
}

const name = (rel: string, fallback: string) => rel.split("/").pop() || fallback;
const disposition = (n: string, attach: boolean) => `${attach ? "attachment" : "inline"}; filename="${n.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(n)}`;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

/** A file's bytes: shown (an image) or downloaded. Here it streams; another machine's comes in one piece. */
export async function file(hub: Hub, p: Place, rel: string, download: boolean): Promise<Response> {
  rel = relPath(rel);
  const n = name(rel, "file"), type = Bun.file(n).type || "application/octet-stream";
  const head = { "content-disposition": disposition(n, download), "cache-control": "no-store", "x-content-type-options": "nosniff",
    // a file is the person's own, but never a page that runs inside the app's origin
    "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'" };
  if (!p.machine) {
    const r = await run(hub, p, ["where", p.folder, rel], undefined, 30);
    if (r.code !== 0) return fail(words(r), 404);
    return new Response(Bun.file(parsed(r).path), { headers: { ...head, "content-type": type } });
  }
  const r = await run(hub, p, ["raw", p.folder, rel, String(LIMITS.remote)], undefined, 120);
  if (r.code === 3 && r.err === "too big") return fail(`Files from another machine can be at most ${mb(LIMITS.remote)}.`, 413);
  if (r.code !== 0 || r.truncated) return fail(words(r), 404);
  return new Response(r.out as Uint8Array<ArrayBuffer>, { headers: { ...head, "content-type": type } });
}

/** A folder as a zip (links and .git left out). */
export async function zip(hub: Hub, p: Place, rel: string): Promise<Response> {
  rel = relPath(rel);
  const n = `${name(rel, p.folder.split("/").filter(Boolean).pop() ?? "folder")}.zip`;
  const cap = p.machine ? LIMITS.remote : 4 * 1024 * 1024 * 1024;
  const r = await run(hub, p, ["zip", p.folder, rel, String(cap)], undefined, 300);
  if (r.code === 3 && r.err === "too big") return fail(p.machine ? `A folder from another machine can be at most ${mb(LIMITS.remote)}.` : "That folder is over 4 GB.", 413);
  if (r.code !== 0) return fail(words(r), 404);
  const at: string = parsed(r).path;
  const head = { "content-disposition": disposition(n, true), "content-type": "application/zip", "cache-control": "no-store" };
  const gone = () => run(hub, p, ["rmzip", p.folder, "", at], undefined, 30).catch(() => null);
  if (!p.machine) {
    // sent as it is read, then removed (one left by a download cut short goes with the next zip, after an hour)
    const body = Bun.file(at).stream().pipeThrough(new TransformStream({ flush: () => { void gone(); } }));
    return new Response(body, { headers: head });
  }
  const c = await hub.call<{ code: number; stdout: string; truncated?: boolean }>("machine.exec", { on: p.machine, argv: ["cat", "--", at], timeout: 120 }, 125_000).catch(() => null);
  void gone();
  if (!c || c.code !== 0 || c.truncated) return fail(`A folder from another machine can be at most ${mb(LIMITS.remote)} zipped.`, 413);
  return new Response(new Uint8Array(Buffer.from(c.stdout, "base64")), { headers: head });
}

/** A file dropped on a folder. { exists } when one by that name is there (the page asks, then sends replace). */
export async function put(hub: Hub, p: Place, rel: string, f: File, replace: boolean) {
  rel = relPath(rel);
  const n = (f.name || "").split(/[\\/]/).pop() ?? "";
  if (!n || n === "." || n === ".." || n.includes("\0")) return { error: "That name can't be used." };
  const cap = p.machine ? LIMITS.remote : LIMITS.here;
  if (f.size > cap) return { error: p.machine ? `Files to another machine can be at most ${mb(cap)}.` : `Files can be at most ${mb(cap)}.` };
  const arg = (replace ? "!" : "") + n;
  let r: Run;
  if (!p.machine) {
    // here: kept in the temp folder first, then copied in by the helper (which checks where it goes)
    const dir = join(tmpdir(), "shepherdr-files");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    await Bun.write(tmp, f);
    try { r = await run(hub, p, ["put", p.folder, rel, arg, tmp], undefined, 300); }
    finally { rmSync(tmp, { force: true }); }
  } else r = await run(hub, p, ["put", p.folder, rel, arg], new Uint8Array(await f.arrayBuffer()), 300);
  return r.code === 0 ? parsed(r) : { error: words(r) };
}

/** A file or folder dragged onto a folder (to: "" is the space's folder itself). */
export async function move(hub: Hub, p: Place, from: string, to: string) {
  const r = await run(hub, p, ["mv", p.folder, relPath(from), relPath(to)], undefined, 120);
  return r.code === 0 ? parsed(r) : { error: words(r) };
}

