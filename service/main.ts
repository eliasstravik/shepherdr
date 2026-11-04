// The Shepherdr service: one per machine, always on (user systemd / launchd). It does Shepherdr's background work
// and serves the web app with its live updates, on 127.0.0.1 only; the tailnet reaches it through
// tailscale serve --set-path /shepherdr (never funnel).
//
//   bun service/main.ts            run it (systemd and launchd run exactly this)
//   SHEPHERDR_PORT=7788            the port on 127.0.0.1
//   SHEPHERDR_WEB=on|off           serve the web app and share it on the tailnet (default on)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, SOCK, TOKEN, PORT, ensureData } from "./paths.ts";
import { holdLock } from "./lock.ts";
import { gate, type Gate } from "./auth.ts";
import { trustedPeer } from "./peer.ts";
import { whoami, share, served, type Me } from "./tailscale.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";
import { Live } from "./live.ts";
import { Model } from "./model.ts";
import { Chats } from "./chats.ts";
import { act } from "./actions.ts";
import { Compat, activity } from "./compat.ts";
import { Asks } from "./asks.ts";
import { Jobs } from "./jobs.ts";
import { terminalBridge } from "./terminal.ts";
import { worktree } from "./worktree.ts";
import { browserRelay } from "./browser.ts";
import { Artifacts } from "./artifacts.ts";
import { Settings } from "./settings.ts";

const ROOT = join(import.meta.dir, "..");
const WEB = process.env.SHEPHERDR_WEB_DIR || join(ROOT, "web", "dist");
export const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;

ensureData();
const release = await holdLock(SOCK);
if (!release) {
  console.log("Shepherdr's service is already running.");
  process.exit(0);
}

if (!existsSync(TOKEN)) writeFileSync(TOKEN, randomBytes(24).toString("hex") + "\n", { mode: 0o600 });
const token = readFileSync(TOKEN, "utf8").trim();

const hub = new Hub();
const store = new Store(hub);
let me: Me | null = await whoami();
const g: Gate = { owner: me?.login ?? null, dns: me?.dns ?? null, port: PORT, token };
const live = new Live(hub, store, () => me, VERSION);
const compat = new Compat();
const model = new Model(hub, live);
live.chats = new Chats(hub);
live.compat = compat;
const settings = new Settings();
settings.on(() => model.rebuild());
settings.start();
const artifacts = new Artifacts();
compat.artifacts = artifacts;
artifacts.on(() => model.rebuild());
artifacts.start();
const asks = new Asks();
compat.asks = asks;
asks.on(() => { model.rebuild(); live.chats?.refreshAll(); });
asks.start();
const jobs = new Jobs(hub);
jobs.watched = () => live.watched();
jobs.start();
model.onBuild = (b) => live.setSnapshot(compat.snapshot({
  host: me?.host ?? "this machine", user: me?.name ?? "You", spaces: b.spaces, sections: b.sections, rows: b.rows, artifacts: artifacts.list,
  settings: settings.sections(me ? `https://${me.dns}/shepherdr/` : null),
  machines: [{ name: me?.host ?? "this machine", here: true, state: "connected" }, ...b.machines.map((name) => ({ name, here: false, state: "connected" }))],
}));
model.start();

// Tailscale can come up after the service: look again now and then, and keep /shepherdr shared while web is on.
const webOn = process.env.SHEPHERDR_WEB !== "off";
async function tailnet() {
  me = await whoami();
  g.owner = me?.login ?? null;
  g.dns = me?.dns ?? null;
  if (!me || !webOn) return;
  const s = await served(me.dns);
  if (s.funnel) { console.error("Funnel is on where /shepherdr is served: refusing the tailnet until it's off"); g.owner = null; return; }
  const err = await share(me.dns, PORT);
  if (err) console.error(err);
}
await tailnet();
setInterval(tailnet, 60_000);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

function file(path: string): Response {
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  let p = join(WEB, rel);
  if (!p.startsWith(WEB) || !existsSync(p) || rel === "") p = join(WEB, "index.html");
  if (!existsSync(p)) return new Response("The web app isn't built: run bun run build.", { status: 503 });
  const immutable = rel.startsWith("assets/");
  return new Response(Bun.file(p), { headers: {
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  } });
}

const server = Bun.serve<{ who: string }>({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.startsWith("/shepherdr/") ? url.pathname.slice(10) : url.pathname;
    // the window asks this (lib/service.js): while jobs is true it leaves its background work to the service
    if (path === "/api/health") return json({ ok: true, version: VERSION, core: hub.up, jobs: jobs.on && hub.up });
    const socket = path === "/api/ws" || path === "/api/terminal" || path === "/api/browser";
    const viaTailnet = req.headers.has("tailscale-user-login");
    const pass = gate(req, g, socket, viaTailnet && trustedPeer(srv.requestIP(req)?.port, PORT));
    if (!pass.ok) return new Response(pass.why, { status: pass.status });
    if (path === "/api/browser") {
      // a task's browser (2.1's Browser panel): this machine's tasks
      const t = compat.taskOf(url.searchParams.get("task") ?? "");
      if (!t || t.machine) return new Response("no such browser here", { status: 404 });
      return srv.upgrade(req, { data: { who: pass.who, browser: t.key } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (path === "/api/terminal") {
      // a live terminal (2.1's terminal plugin): only a running one a chat names
      const term = compat.addrOf(url.searchParams.get("chat") ?? "");
      if (!term || term.startsWith("log:") || hub.terminals.get(term)?.state !== "live") return new Response("no such terminal", { status: 404 });
      return srv.upgrade(req, { data: { who: pass.who, term } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (socket) return srv.upgrade(req, { data: { who: pass.who } }) ? undefined : new Response("upgrade failed", { status: 400 });
    if (path === "/api/me") return json({ login: pass.who, via: pass.via, machine: me?.host ?? null, link: me ? `https://${me.dns}/shepherdr/` : null, version: VERSION });
    if (path === "/api/state" && req.method === "GET") return json(store.doc.version ? store.doc : await store.load());
    if (path === "/api/state" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.key !== "string" || !/^[a-z][\w.-]{0,63}$/.test(body.key)) return json({ error: "bad key" }, 400);
      return json(await store.set(body.key, body.value ?? null));
    }
    // a recipe artifact's files (the web's recipe view asks api/artifacts/<id>/recipe?v=, /file/<path>?v=)
    const art = /^\/api\/artifacts\/([\w.-]+)\/(recipe|file\/(.+))$/.exec(path);
    if (art) {
      const v = Number(url.searchParams.get("v"));
      if (art[2] === "recipe") { const r = artifacts.recipe(art[1], v); return r ? json(r) : json({ error: "No recipe here." }, 404); }
      return artifacts.file(art[1], v, decodeURIComponent(art[3]));
    }
    if (path === "/api/worktree") {
      const t = compat.taskOf(url.searchParams.get("task") ?? "");
      if (!t) return json({ error: "No such task." }, 404);
      try { return json(await worktree(hub, t.where, url.searchParams.get("what") ?? "", url.searchParams.get("path") ?? undefined)); }
      catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/activity") {
      const addr = compat.addrOf(url.searchParams.get("chat") ?? "");
      const r = addr ? live.chats?.reader(addr) : null;
      return json(activity(r, url.searchParams.get("id") ?? ""));
    }
    if (path === "/api/action" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body?.type === "setting" && typeof body.key === "string") {
        try { settings.set(body.key, typeof body.value === "string" ? body.value : null); return json({ ok: true }); }
        catch (err) { return new Response((err as Error).message, { status: 400 }); }
      }
      try { return json(await act(hub, body, compat)); } catch (err) { return new Response((err as Error).message, { status: 400 }); }
    }
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (!webOn) return new Response("Shepherdr's web app is off (Shepherdr settings › Web).", { status: 404 });
    return file(path);
  },
  websocket: {
    open(ws) {
      const d: any = ws.data;
      const page = { send: (x: any) => { ws.send(x); }, close: () => ws.close(), buffered: () => ws.getBufferedAmount() };
      if (d.term) d.bridge = terminalBridge(hub, d.term, page);
      else if (d.browser) d.bridge = browserRelay(d.browser, page);
      else live.join(ws);
    },
    message(ws, msg) { const d: any = ws.data; if (d.bridge) d.bridge.message(String(msg)); else live.message(ws, String(msg)); },
    close(ws) { const d: any = ws.data; if (d.bridge) d.bridge.end(); else live.leave(ws); },
  },
});

console.log(`Shepherdr ${VERSION} on http://127.0.0.1:${server.port} (data ${DATA})${me && webOn ? `, https://${me.dns}/shepherdr/` : ""}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.stop(true); release(); process.exit(0); });
