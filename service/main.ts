// The Shepherdr service: one per machine, always on (user systemd / launchd). It does Shepherdr's background work
// and serves the web app with its live updates, on 127.0.0.1 only; the tailnet reaches it through
// tailscale serve --set-path /shepherdr (never funnel).
//
//   bun service/main.ts            run it (systemd and launchd run exactly this)
//   SHEPHERDR_PORT=7788            the port on 127.0.0.1
//   SHEPHERDR_WEB=on|off           serve the web app and share it on the tailnet (default on)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, SOCK, TOKEN, PORT, HOME, ensureData } from "./paths.ts";
import { holdLock } from "./lock.ts";
import { gate, type Gate } from "./auth.ts";
import { trustedPeer } from "./peer.ts";
import { whoami, share, served, unshare, type Me } from "./tailscale.ts";
import { qrFile } from "./qr.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";
import { Live } from "./live.ts";
import { Model } from "./model.ts";
import { setPilot, runPilot } from "./autopilot.ts";
import { windowSection, setWindow, offList, offPlugins } from "./window.ts";
import { Chats } from "./chats.ts";
import { act } from "./actions.ts";
import { Compat, activity } from "./compat.ts";
import { Asks } from "./asks.ts";
import { Jobs } from "./jobs.ts";
import { terminalBridge } from "./terminal.ts";
import { worktree } from "./worktree.ts";
import { browserRelay } from "./browser.ts";
import { voiceCall, type ChatView } from "./voice.ts";
import { Artifacts } from "./artifacts.ts";
import { Settings, onWritten, PUSH, pushBody } from "./settings.ts";
import { Secrets } from "./secrets.ts";
import { Agents } from "./agents.ts";
import { Machines } from "./machines.ts";
import { Push } from "./push.ts";
import { dictate } from "./dictate.ts";
import { sh, exec } from "./model.ts";
import { folders, newSpace } from "./spaces.ts";
import { kindOf } from "../core/chat-reader.js";
import * as SL from "../core/slash.js";
const { SCAN, scanned, commandList, MENU } = SL as any;
import * as NF from "../core/notify.js";
const { withEverywhere, withSpace } = NF as any;

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
compat.reader = (a) => live.chats?.reader(a) ?? null;
const push = new Push(() => (me ? `https://${me.dns}` : "https://herdr.dev"));
live.onVisible = (v) => { push.visible = v; };
// what was already waiting or ready when the service started: no alert for it
let alerted: Set<string> | null = null;
const alertNewAnd = (snap: any) => { try { alertNew(snap); } catch {} return snap; };
function alertNew(snap: any) {
  const now = new Map<string, any>();
  for (const n of snap.needs ?? []) now.set(`need:${n.chat}:${n.id}`, { title: `${n.task ?? snap.places.find((p: any) => p.id === n.place)?.name ?? "An agent"} · Needs you`, body: n.text ?? n.question?.title ?? (n.secret ? `Asks for ${n.secret.name}` : ""), tag: n.task ?? n.chat, waits: true });
  for (const t of snap.tasks ?? []) if (t.status === "ready" && !t.archived) now.set(`ready:${t.id}`, { title: `${t.id} · Ready`, body: t.name, tag: t.id, url: `./#accept=${encodeURIComponent(t.id)}` });
  if (alerted) for (const [k, a] of now) if (!alerted.has(k)) void push.send({ ...a, badge: (snap.needs?.length ?? 0) + (snap.tasks ?? []).filter((t: any) => t.status === "ready" && !t.archived).length, open: [...now.values()].filter((x) => x.waits).map((x) => x.tag) });
  alerted = new Set(now.keys());
}
compat.agents = new Agents(hub);
const machines = new Machines(hub, () => model.machineNames());
machines.onChange = () => model.rebuild();
compat.machineStats = (m) => machines.of(m);
machines.start();
const secrets = new Secrets(hub);
compat.secrets = secrets;
(compat as any).terminalsOf = (a: string) => hub.terminals.get(a);
let secretNames: { name: string; at: number; space: string | null }[] = [];
const refreshSecrets = async () => { secretNames = await secrets.names(); model.rebuild(); };
void refreshSecrets();
setInterval(() => void refreshSecrets(), 30_000);
const settings = new Settings();
// a change made on the web goes to the other machines' herdr-task as the window's does (one push at a time)
let pushing: Promise<unknown> = Promise.resolve();
onWritten((file) => { pushing = pushing.then(() => Promise.all(model.machineNames().map((m) => exec(hub, ["sh", "-c", PUSH, "sh", pushBody(file, m)], m).catch(() => null)))); });
settings.on(() => { model.rebuild(); void tailnet(); });
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
model.doc = () => store.doc.value;
compat.shared = { value: (k) => model.value(k), set: (k, v) => store.set(k, v) };
store.on(() => model.rebuild());
void store.load().catch(() => {});
model.onBuild = (b) => live.setSnapshot(alertNewAnd(compat.snapshot({
  host: me?.host ?? "this machine", user: me?.name ?? "You", spaces: b.spaces, sections: b.sections, rows: b.rows, artifacts: artifacts.list, automations: b.automations,
  settings: [...settings.sections(me ? `https://${me.dns}/shepherdr/` : null, b.spaces.map((s: any) => ({ id: s.id, name: s.name, machine: s.machine ?? null })), b.machines, me?.host ?? "this machine"),
    { name: "Secrets", level: "all", rows: [], secrets: secretNames.filter((x) => !x.space) },
    // each space's own, as 3.0's Space settings › Secrets
    ...b.spaces.map((s: any) => ({ name: "Secrets", level: s.id, rows: [], secrets: secretNames.filter((x) => x.space === s.id) })),
    windowSection((k) => model.value(k))], off: offList(), offPlugins: offPlugins(),
  machines: [{ name: me?.host ?? "this machine", here: true, state: "connected" }, ...b.machines.map((name) => ({ name, here: false, state: "connected" }))],
})));
model.start();

// The Web add-on (Shepherdr settings > Window > Add-ons, Everywhere's "off" in ~/.herdr/shepherdr.json): off, the web
// app stops and /shepherdr is no longer shared; the service keeps its background work.
const SETTINGS = process.env.HERDR_TASK_SETTINGS || join(HOME, ".herdr", "shepherdr.json");
const APP_DATA = join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "data", "shepherdr");
function webOn() {
  if (process.env.SHEPHERDR_WEB === "off") return false;
  try { return !(JSON.parse(readFileSync(SETTINGS, "utf8"))?.everywhere?.off ?? []).includes("web"); } catch { return true; }
}

// Tailscale can come up after the service: look again now and then, and keep /shepherdr shared while web is on. What
// the window's Shepherdr settings > Web shows goes into ~/.herdr/shepherdr/web.json (the link, its QR code).
let wasOn: boolean | null = null;
async function tailnet() {
  me = await whoami();
  g.owner = me?.login ?? null;
  g.dns = me?.dns ?? null;
  const on = webOn();
  const link = me ? `https://${me.dns}/shepherdr/` : null;
  let why: string | null = me ? null : "Tailscale isn't running here";
  if (me && on) {
    const s = await served(me.dns);
    if (s.funnel) { why = "Funnel is on for this machine: the web app stays off until it's off"; g.owner = null; }
    else why = await share(me.dns, PORT);
  } else if (me && !on && wasOn !== false) await unshare(me.dns);
  wasOn = on;
  let qr: string | null = null;
  try { if (link && on && !why) qr = qrFile(existsSync(join(APP_DATA, "..")) ? APP_DATA : DATA, link); } catch {}
  writeFileSync(join(DATA, "web.json"), JSON.stringify({ on, link, qr, why, at: Date.now() }) + "\n");
  if (why) console.error(why);
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

// a call's name for its agent (a space's Assistant by the space, a task's by its id), and what it reads of the chat
const callName = (key: string) => (key.startsWith("p:") ? `the ${compat.last?.places.find((p) => p.chat === key)?.name ?? "space"} Assistant` : key.split("/")[0]);
function chatView(addr: string): ChatView {
  const items = () => (compat.reader?.(addr)?.conv?.items ?? []) as any[];
  return {
    lastReply: () => { const x = [...items()].reverse().find((i) => i.kind === "agent" && i.text); return x ? { id: x.id, text: x.text } : null; },
    recent: () => [`Status: ${(hub.terminals.get(addr) as any)?.status?.state ?? "unknown"}`,
      ...items().filter((i) => (i.kind === "agent" || i.kind === "user") && i.text).slice(-12).map((i) => `${i.kind === "user" ? "Person" : "Agent"}: ${i.text}`)].join("\n\n").slice(-12000),
    status: () => (hub.terminals.get(addr) as any)?.status?.state ?? null,
    asking: () => asks.of(addr)[0]?.words?.title ?? null,
  };
}

const server = Bun.serve<{ who: string }>({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.startsWith("/shepherdr/") ? url.pathname.slice(10) : url.pathname;
    // the window asks this (lib/service.js): while jobs is true it leaves its background work to the service
    if (path === "/api/health") return json({ ok: true, version: VERSION, core: hub.up, jobs: jobs.on && hub.up });
    // the Web add-on switched off: nothing for the tailnet (this machine's own callers still get the API)
    if (req.headers.has("tailscale-user-login") && !webOn()) return new Response("Shepherdr's web app is off (Shepherdr settings › Window › Add-ons).", { status: 404 });
    const socket = path === "/api/ws" || path === "/api/terminal" || path === "/api/browser" || path === "/api/voice";
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
    if (path === "/api/voice") {
      // a voice call with a chat's running agent (the Voice add-on)
      const key = url.searchParams.get("chat") ?? "", addr = compat.addrOf(key);
      if (offList().includes("voice") || !addr || addr.startsWith("log:") || hub.terminals.get(addr)?.state !== "live") return new Response("no call here", { status: 404 });
      return srv.upgrade(req, { data: { who: pass.who, voice: { key, addr } } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (socket) return srv.upgrade(req, { data: { who: pass.who } }) ? undefined : new Response("upgrade failed", { status: 400 });
    if (path === "/api/me") return json({ login: pass.who, via: pass.via, machine: me?.host ?? null, link: me ? `https://${me.dns}/shepherdr/` : null, version: VERSION, off: offPlugins() });
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
      let rel = "";
      try { rel = decodeURIComponent(art[3]); } catch { return json({ error: "not found" }, 404); }
      return artifacts.file(art[1], v, rel);
    }
    if (path === "/api/upload" && req.method === "POST") {
      // a file from the message box (+, the camera, a paste or a drop): kept where the window keeps pasted ones,
      // data/chat-attach, until it goes with a message as its path (another machine's agent gets a copy there)
      const form = await req.formData().catch(() => null);
      const f = form?.get("file");
      if (!(f instanceof File) || f.size > 25 * 1024 * 1024) return json({ error: "A file of at most 25 MB." }, 400);
      const dir = join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "data", "chat-attach");
      mkdirSync(dir, { recursive: true });
      const name = `web-${Date.now().toString(36)}-${(f.name || "file").replace(/[^\w.-]+/g, "-").replace(/^[-.]+/, "").slice(-80) || "file"}`;
      await Bun.write(join(dir, name), f);
      return json({ path: join(dir, name), name: f.name });
    }
    if (path === "/api/dictate" && req.method === "POST") {
      try { return json({ text: await dictate(await req.blob()) }); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/commands") {
      // the "/" list above the box (core/slash.js): its CLI's commands, and for Claude Code the person's own
      const a = compat.addrOf(url.searchParams.get("chat") ?? ""), t: any = a ? hub.terminals.get(a) : null;
      if (!a || !t) return json({ commands: [] });
      const kind = kindOf(t) ?? "claude", machine = a.includes("/") ? a.split("/")[0] : null;
      const mine = kind === "claude" ? scanned((await sh(hub, SCAN, ["scan", t.foreground?.cwd ?? t.cwd ?? ""], machine).catch(() => ({ stdout: "" }))).stdout) : [];
      return json({ commands: commandList(kind, mine), menus: [...(MENU[kind] ?? [])] });
    }
    if (path === "/api/folders") {
      const m = url.searchParams.get("machine"), machine = !m || m === me?.host ? null : m;
      const home = (await exec(hub, ["sh", "-c", 'printf %s "$HOME"'], machine).catch(() => ({ stdout: "" }))).stdout;
      try { return json(await folders(hub, machine, url.searchParams.get("path") ?? "~", home)); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/spaces" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      try {
        const machine = !b?.machine || b.machine === me?.host ? null : String(b.machine);
        const place = await newSpace(hub, { machine, path: String(b?.path ?? ""), name: typeof b?.name === "string" ? b.name : undefined, create: !!b?.create, store: compat.shared! });
        return json({ place });
      } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/push/key") return json({ key: await push.key() });
    if (path === "/api/push/subscribe" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      try { push.subscribe(body?.sub, body?.device); return json({ ok: true }); } catch (err) { return json({ error: (err as Error).message }, 400); }
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
      if (body?.type === "secret" && typeof body.name === "string" && typeof body.level === "string") {
        // a value goes straight to the vault (herdr-secret set, from stdin); the agent hears its name only
        try {
          const card = body.card && typeof body.card.chat === "string" ? { address: compat.addrOf(body.card.chat) ?? "" } : undefined;
          if (card && !card.address) throw new Error("That agent isn't here any more.");
          await secrets.keep(body.level, body.name, typeof body.value === "string" ? body.value : null, card);
          await refreshSecrets();
          return json({ ok: true });
        } catch (err) { return new Response((err as Error).message, { status: 400 }); }
      }
      if (body?.type === "setting" && body.key === "notify") {
        // a space's Notify (from its menu or Settings), or Everywhere's, in 3.0's shared "notify"
        const v = typeof body.value === "string" ? body.value : null, n = model.value("notify") ?? {};
        const next = !body.place || body.place === "all" ? withEverywhere(n, v) : withSpace(n, String(body.place), v);
        await store.set("notify", next);
        return json({ ok: true });
      }
      if (body?.type === "setting" && typeof body.key === "string" && body.key.startsWith("autopilot.") && typeof body.place === "string") {
        try { await setPilot(body.place, body.key, typeof body.value === "string" ? body.value : null); await model.readAutopilot(); model.rebuild(); return json({ ok: true }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "autopilot-run" && typeof body.place === "string") {
        try { await runPilot(body.place); await model.readAutopilot(); model.rebuild(); return json({ ok: true }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "setting" && typeof body.key === "string" && /^(window|addon)\./.test(body.key)) {
        try { await setWindow(body.key, typeof body.value === "string" ? body.value : null, (k, v) => store.set(k, v)); return json({ ok: true }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "setting" && typeof body.key === "string") {
        try {
          // a space's own: its name, machine and repo folder go with it (herdr-task finds a space's settings by folder)
          const level = typeof body.place === "string" ? body.place : "all";
          const sp = level !== "all" && !level.startsWith("m:") ? model.spaceById(level) : null;
          const folder = sp ? (await exec(hub, ["git", "-C", sp.folder || "~", "rev-parse", "--show-toplevel"], sp.machine ?? null).catch(() => null))?.stdout.trim() || sp.folder : null;
          settings.set(body.key, typeof body.value === "string" ? body.value : null, level, sp ? { id: sp.id, name: sp.name, machine: sp.machine ?? null, folder } : null);
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "template" && typeof body.role === "string") {
        try { return json({ ok: true, text: settings.template(body.role, typeof body.text === "string" ? body.text : undefined) }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "limits-check") { await machines.checkNow(); return json({ ok: true }); }
      if (body?.type === "role-info") {
        try { return json({ ok: true, clis: await compat.agents!.choices(null) }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      try { return json(await act(hub, body, compat)); } catch (err) { return new Response((err as Error).message, { status: 400 }); }
    }
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);
    return file(path);
  },
  websocket: {
    open(ws) {
      const d: any = ws.data;
      const page = { send: (x: any) => { ws.send(x); }, close: () => ws.close(), buffered: () => ws.getBufferedAmount() };
      if (d.voice) d.bridge = voiceCall(hub, d.voice.addr, callName(d.voice.key), chatView(d.voice.addr), page);
      else if (d.term) d.bridge = terminalBridge(hub, d.term, page);
      else if (d.browser) d.bridge = browserRelay(d.browser, page);
      else live.join(ws);
    },
    message(ws, msg) { const d: any = ws.data; if (d.voice) d.bridge?.message(msg); else if (d.bridge) d.bridge.message(String(msg)); else live.message(ws, String(msg)); },
    close(ws) { const d: any = ws.data; if (d.bridge) d.bridge.end(); else live.leave(ws); },
  },
});

console.log(`Shepherdr ${VERSION} on http://127.0.0.1:${server.port} (data ${DATA})${me && webOn() ? `, https://${me.dns}/shepherdr/` : ""}`);

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.stop(true); release(); process.exit(0); });
