// The window's way to its service (lib/local.js, lib/bridge.js; GitHub #635): the port comes from service.json, and
// nothing is sent until the service there answers its id, so another app holding the port gets no token or state.
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeHerdr } from "./fake-herdr";

const HOME = mkdtempSync(join(tmpdir(), "shepherdr-local-"));
const DATA = join(HOME, ".herdr", "shepherdr");
const shared = new Map<string, unknown>([["notify", { on: true }]]);
mock.module("herdr", () => fakeHerdr({
  home: () => HOME,
  // the shell lib/dirs.js asks for Shepherdr's folders: no answer, so the old ~/.herdr paths (as before a move)
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  readTextFile: async (p: string) => Bun.file(p).text(),
  shared: (k: string) => shared.get(k),
  setShared: (k: string, v: unknown) => shared.set(k, v),
}));
const { localService, serviceFile } = await import("../mods/tabs-tasks/local.js");
const { startBridge } = await import("../mods/tabs-tasks/bridge.js");

const seen: { app: string; path: string; auth: string | null }[] = [];
// Shepherdr's service on a port of its own choosing, and another app that answers health too
const ours = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const u = new URL(req.url);
  seen.push({ app: "ours", path: u.pathname, auth: req.headers.get("authorization") });
  if (u.pathname === "/api/health") return Response.json({ ok: true, app: "shepherdr", id: "id-1", jobs: true });
  if (u.pathname === "/api/state") return Response.json(req.method === "GET" ? { value: {} } : { ok: true });
  return new Response("no", { status: 404 });
} });
const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const u = new URL(req.url);
  seen.push({ app: "other", path: u.pathname, auth: req.headers.get("authorization") });
  return Response.json(u.pathname === "/api/state" ? { value: {} } : { ok: true, jobs: true });
} });
const cx: any = { sleep: (ms: number) => Bun.sleep(ms) };
const say = (port: number | undefined, id = "id-1") => writeFileSync(join(DATA, "service.json"), JSON.stringify({ port, id }));

beforeAll(() => { mkdirSync(DATA, { recursive: true }); writeFileSync(join(DATA, "token"), "secret-token\n"); });
afterAll(() => { ours.stop(true); other.stop(true); rmSync(HOME, { recursive: true, force: true }); });

describe("lib/local.js", () => {
  test("never started here: no service", async () => {
    expect(await serviceFile()).toBeNull();
    expect(await localService(cx)).toBeNull();
  });
  test("the port service.json names, wherever it is", async () => {
    say(ours.port);
    expect(await localService(cx)).toMatchObject({ base: `http://127.0.0.1:${ours.port}`, health: { jobs: true } });
  });
  test("another app on that port is not the service", async () => {
    say(other.port);
    expect(await localService(cx)).toBeNull();
  });
  test("a service.json left from an older start (another id) is not trusted", async () => {
    say(ours.port, "id-0");
    expect(await localService(cx)).toBeNull();
  });
});

describe("lib/bridge.js", () => {
  test("another app on the port gets neither the token nor the shared state; the service does", async () => {
    say(other.port);
    seen.length = 0;
    let tick: (() => Promise<void>) | null = null;
    startBridge({ timer: { every: (_ms: number, f: (c: any) => void) => { tick = () => new Promise<void>((done) => f({ spawn: (g: any) => g(cx).then(done) })); } } } as any);
    await tick!();
    expect(seen.filter((x) => x.app === "other").map((x) => x.path)).toEqual(["/api/health"]);
    expect(seen.some((x) => x.auth)).toBe(false);
    say(ours.port);
    seen.length = 0;
    await tick!();
    expect(seen.filter((x) => x.app === "ours" && x.path === "/api/state").length).toBeGreaterThan(0);
    expect(seen.filter((x) => x.path === "/api/state").every((x) => x.auth === "Bearer secret-token")).toBe(true);
    expect(seen.some((x) => x.app === "other")).toBe(false);
  });
});
