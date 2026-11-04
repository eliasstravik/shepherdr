// The Shepherdr service: one per machine, always on (user systemd / launchd). It does Shepherdr's background work
// and serves the web app with its live updates, on 127.0.0.1 only; the tailnet reaches it through
// tailscale serve --set-path /shepherdr (never funnel).
//
//   bun service/main.ts            run it (systemd and launchd run exactly this)
//   SHEPHERDR_PORT=7788            the port on 127.0.0.1
//   SHEPHERDR_WEB=on|off           serve the web app and share it on the tailnet (default on)
// Serve from (service/host.ts): one machine serves the web app and holds the shared data; on the others the service
// reads and writes it there, keeps their settings in step (service/sync.ts) and doesn't share /shepherdr.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { DATA, SOCK, TOKEN, PORT, HOME, ensureData } from "./paths.ts";
import { holdLock } from "./lock.ts";
import { gate, type Gate } from "./auth.ts";
import { trustedPeer } from "./peer.ts";
import { whoami, share, served, unshare, restoreShare, type Me } from "./tailscale.ts";
import { qrFile } from "./qr.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";
import { Host } from "./host.ts";
import { Sync } from "./sync.ts";
import { Live } from "./live.ts";
import { Model } from "./model.ts";
import { setPilot, runPilot } from "./autopilot.ts";
import { windowSection, setWindow, offList, offPlugins } from "./window.ts";
import { Chats } from "./chats.ts";
import { act, hc as hcRun } from "./actions.ts";
import { AgentWatch } from "./watch.ts";
import { Compat, activity } from "./compat.ts";
import { Asks } from "./asks.ts";
import { Jobs } from "./jobs.ts";
import { terminalBridge } from "./terminal.ts";
import { worktree } from "./worktree.ts";
import * as W from "../core/worktree.js";
import { browserRelay } from "./browser.ts";
import { voiceCall, type ChatView } from "./voice.ts";
import { Artifacts } from "./artifacts.ts";
import { Settings, onWritten, PUSH, pushBody } from "./settings.ts";
import { Secrets } from "./secrets.ts";
import { Agents } from "./agents.ts";
import { Machines } from "./machines.ts";
import { Push, alertsOf, agentAlerts } from "./push.ts";
import { dictate } from "./dictate.ts";
import { sh, exec } from "./model.ts";
import { folders, newSpace, newSpaceInfo } from "./spaces.ts";
import { kindOf } from "../core/chat-reader.js";
import * as SL from "../core/slash.js";
import * as SCORE from "../core/settings.js";
const SC = SCORE as any;
const { SCAN, scanned, commandList, MENU } = SL as any;
import * as HCORE from "../core/host.js";
const { serveChoice } = HCORE as any;
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
const host = new Host(hub, VERSION);
await Promise.race([host.start(), Bun.sleep(10_000)]);
const store = new Store(hub, host);
new Sync(hub, host).start();
let me: Me | null = await whoami();
const g: Gate = { owner: me?.login ?? null, dns: me?.dns ?? null, port: PORT, token };
const live = new Live(hub, store, () => me, VERSION);
const compat = new Compat();
const model = new Model(hub, live);
live.chats = new Chats(hub);
live.compat = compat;
compat.reader = (a) => live.chats?.reader(a) ?? null;
// the chat scrolled to its top: the page before (as the window's loadEarlier)
(compat as any).earlier = (a: string) => live.chats?.earlier(a);
const push = new Push(() => (me ? `https://${me.dns}` : "https://herdr.dev"));
// only the machine that serves the web app sends push alerts (its pages subscribed there): never two of one alert
const pushSend = push.send.bind(push);
push.send = ((a: any) => (host.serving() ? pushSend(a) : Promise.resolve())) as typeof push.send;
live.onVisible = (v) => { push.visible = v; };
// what was already waiting or ready when the service started: no alert for it
let alerted: Set<string> | null = null;
// the agents' own alerts ride on the snapshot (the web app's toasts: web/plugins/alerts/toasts.tsx), then push
const chatOfAddress = (a: string) => { for (const [k, v] of ((compat as any).chats ?? new Map()) as Map<string, string>) if (v === a) return k; return null; };
const alertNewAnd = (snap: any) => { try { snap.alerts = agentAlerts(hub.terminals.values(), snap, chatOfAddress, HOME); alertNew(snap); } catch {} return snap; };
function alertNew(snap: any) {
  // their words, as the window's toasts: service/push.ts alertsOf
  const now = alertsOf(snap);
  if (alerted) for (const [k, a] of now) if (!alerted.has(k)) void push.send({ ...a, badge: (snap.needs?.length ?? 0) + (snap.tasks ?? []).filter((t: any) => t.status === "ready" && !t.archived).length, open: [...now.values()].filter((x) => x.waits).map((x) => x.tag) });
  alerted = new Set(now.keys());
}
compat.agents = new Agents(hub);
const machines = new Machines(hub, () => model.machineNames());
machines.onChange = () => model.rebuild();
compat.machineStats = (m) => machines.of(m);
machines.windowStats = () => model.value("machines.stats");
machines.start();
const secrets = new Secrets(hub);
compat.secrets = secrets;
(compat as any).terminalsOf = (a: string) => hub.terminals.get(a);
let secretNames: { name: string; at: number; space: string | null }[] = [];
let vaultList: Awaited<ReturnType<Secrets["entries"]>> = [];
const refreshSecrets = async () => { [secretNames, vaultList] = await Promise.all([secrets.names(), secrets.entries()]); model.rebuild(); };
void refreshSecrets();
setInterval(() => void refreshSecrets(), 30_000);
const settings = new Settings();
// Settings › Agents' model menu and buttons (core/settings.js choicesFrom), from each CLI's own settings here, read
// again every ten minutes; a CLI herdr-task's check finds missing here isn't offered
const readDefaults = async () => {
  try {
    let check: any = {};
    try { check = JSON.parse(readFileSync(join(HOME, ".herdr", "cli-check.json"), "utf8"))?.machines?.[""] ?? {}; } catch {}
    const dflts: any = await compat.agents!.ownDefaults();
    // Claude Code and Codex as herdr-task's check found them; the other kinds (lib/kinds.json) when their command is here
    const installed = Object.fromEntries(Object.keys(dflts).map((k) => [k, check[k] === "missing" ? false : k === "claude" || k === "codex" || Boolean(dflts[k]?.installed)]));
    settings.choices = SC.choicesFrom(dflts, installed);
    model.rebuild();
  } catch {}
};
// Settings › Web: what the service last said of the web app (tailnet() below), its QR code as a picture
let webNow: { on: boolean; link: string | null; why: string | null; qr: string | null; serve?: any } | null = null;
// Settings › Secrets, as the window's: each kept secret with where it is, and each agent's waiting ask with its name and
// its narrowest scope (its space, else its machine), which Give it fills in
function secretsPage(spaces: any[]) {
  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name ?? id;
  const vault = vaultList.map((e) => ({ ...e, where: SC.secretWhere(e.scope, e.machine, e.space ? spaceName(e.space) : "") }));
  const asks = secrets.asks().map((a: any) => {
    const t: any = hub.terminals.get(a.address);
    const machine = String(a.address).includes("/") ? String(a.address).split("/")[0] : null;
    const l = t?.labels ?? {};
    const sp = l["herdr.space"] || l["herdr.task.space"] || l["herdr.coordinator.space"];
    const space = sp ? (machine && !String(sp).includes("/") ? `${machine}/${sp}` : sp) : null;
    return { address: a.address, name: a.name, why: a.why ?? "", who: t?.name || a.address, scope: space ?? `m:${machine ?? ""}` };
  });
  return { vault, asks };
}
// Base branch's empty box: the branch a space's folder has checked out, on its machine
settings.fetchBranch = async (s) => {
  const sp = model.spaceById(s.id);
  const r = await exec(hub, ["git", "-C", sp?.folder || "~", "symbolic-ref", "--short", "HEAD"], sp?.machine ?? null).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
};
setTimeout(() => void readDefaults(), 3000);
setInterval(() => void readDefaults(), 10 * 60_000);
// a change made on the web goes to the other machines' herdr-task as the window's does (one push at a time)
let pushing: Promise<unknown> = Promise.resolve();
onWritten((file) => { pushing = pushing.then(() => Promise.all(model.machineNames().map((m) => exec(hub, ["sh", "-c", PUSH, "sh", pushBody(file, m)], m).catch(() => null)))); });
settings.on(() => { model.rebuild(); void tailnet(); });
settings.start();
const artifacts = new Artifacts();
compat.artifacts = artifacts;
// other machines' artifacts, read there through herdr-core
artifacts.hub = hub;
artifacts.machines = () => model.machineNames();
artifacts.on(() => model.rebuild());
artifacts.start();
const asks = new Asks();
compat.asks = asks;
asks.on(() => { model.rebuild(); live.chats?.refreshAll(); });
asks.start();
// another machine's agents a page shows (the web served from a machine other than theirs): their asks too
asks.remote(hub, () => live.watched());
// start screens and lost sessions of the agents whose chats pages have open, and of an open Assistant chat's workers
// (service/watch.ts, as the window's chat watches them)
const watch = new AgentWatch(hub, hcRun, {
  watched: () => {
    const out: { addr: string; ref?: string | null }[] = [];
    for (const a of live.chats?.addresses() ?? []) {
      out.push({ addr: a });
      out.push(...(compat as any).workersOf(a).map((w: any) => ({ addr: w.addr, ref: w.ref })));
    }
    return out;
  },
  windowCards: () => model.value("chat.screens") ?? {},
  windowLost: () => model.value("chat.lost") ?? {},
  changed: () => live.chats?.refreshAll(),
});
(compat as any).watch = watch;
watch.start();
const jobs = new Jobs(hub, host);
jobs.watched = () => live.watched();
jobs.start();
model.doc = () => store.doc.value;
compat.shared = { value: (k) => model.value(k), set: (k, v) => store.set(k, v) };
store.on(() => model.rebuild());
void store.load().catch(() => {});
model.onBuild = (b) => live.setSnapshot(alertNewAnd(compat.snapshot({
  host: me?.host ?? "this machine", user: me?.name ?? "You", spaces: b.spaces, sections: b.sections, rows: b.rows, artifacts: artifacts.list, automations: b.automations,
  settings: [...settings.sections(webNow ?? (me ? `https://${me.dns}/shepherdr/` : null), b.spaces.map((s: any) => ({ id: s.id, name: s.name, machine: s.machine ?? null })), b.machines, me?.host ?? "this machine"),
    // Secrets, as the window's page (Everywhere's and each space's own): every kept secret and where, and the agents
    // waiting on one
    ...[{ id: "all" }, ...b.spaces].map((s: any) => ({ name: "Secrets", level: s.id, rows: [], ...secretsPage(b.spaces),
      secrets: secretNames.filter((x) => (s.id === "all" ? !x.space : x.space === s.id)) })),
    windowSection((k) => model.value(k))], off: offList(), offPlugins: offPlugins(), pilot: model.pilotEverywhere,
  // every machine the window's sidebar lists: one not connected reads "Offline" (or "Connecting…") under its header
  machines: [{ name: me?.host ?? "this machine", here: true, state: "connected" }, ...b.known.map((m) => ({ name: m.name, here: false, state: m.state }))],
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
// Serve from: a move this service started (shepherdr web serve-from), until it ends; what went wrong, for a while
let moving: { to: string; at: number; error?: string } | null = null;
async function tailnet() {
  me = await whoami();
  g.owner = me?.login ?? null;
  g.dns = me?.dns ?? null;
  const on = webOn(), serving = host.serving();
  const own = me ? `https://${me.dns}/shepherdr/` : null;
  host.link = own;
  // another machine serves it: its link (the window's Settings › Web shows it and its QR code); this one isn't shared
  const link = serving ? own : host.hostLink();
  let why: string | null = me || !serving ? null : "Tailscale isn't running here";
  if (me && on && serving) {
    const s = await served(me.dns);
    if (s.funnel) { why = "Funnel is on for this machine: the web app stays off until it's off"; g.owner = null; }
    else why = await share(me.dns, PORT);
  } else if (me && (!on || !serving) && wasOn !== false) {
    await unshare(me.dns, PORT);
    // moved away: what the move here set aside is shared again (shepherdr web serve-from --take-link)
    if (!serving) await restoreShare(join(DATA, "replaced-share.json"));
  }
  if (!serving && !link) why = host.reachable() ? "The machine serving the web app hasn't said its link yet." : "The machine serving the web app can't be reached now.";
  wasOn = on && serving;
  let qr: string | null = null;
  try { if (link && on && !why) qr = qrFile(existsSync(join(APP_DATA, "..")) ? APP_DATA : DATA, link); } catch {}
  const serve = serveNow();
  writeFileSync(join(DATA, "web.json"), JSON.stringify({ on, link, qr, why, serve, at: Date.now() }) + "\n");
  let picture: string | null = null;
  try { if (qr) picture = `data:image/svg+xml;base64,${Buffer.from(readFileSync(qr)).toString("base64")}`; } catch {}
  const was = JSON.stringify(webNow);
  webNow = { on, link, why, qr: picture, serve };
  if (JSON.stringify(webNow) !== was) model.rebuild();
  if (why) console.error(why);
}

/** Settings › Web's Serve from: every machine with its words, which one serves, and a move under way. */
function serveNow() {
  const rows = host.choices().map((m) => ({ name: m.name, here: !!m.here, state: m.state, os: m.os, serves: m.serves, label: serveChoice(m) }));
  const by = rows.find((r) => r.serves);
  return { rows, host: by ? (by.here ? null : by.name) : null, reachable: host.reachable(), moving: moving && !moving.error ? moving.to : null, error: moving?.error ?? null };
}

/** Moves the web app to a machine (null: this one): the installer does it (bin/shepherdr web serve-from). */
async function serveFrom(machine: string | null) {
  if (moving && !moving.error) throw new Error(`Already moving it to ${moving.to}.`);
  const target = machine ?? host.me?.name ?? "here";
  moving = { to: target, at: Date.now() };
  void tailnet();
  const cli = [join(HOME, ".local", "bin", "shepherdr"), join(ROOT, "bin", "shepherdr")].find(existsSync) ?? "shepherdr";
  try {
    const p = Bun.spawn([cli, "web", "serve-from", machine ?? "here", "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if ((await p.exited) !== 0) throw new Error(err.trim().split("\n").pop()?.replace(/^shepherdr: /, "") || "The move didn't finish.");
    moving = null;
    void out;
  } catch (err) {
    moving = { to: target, at: Date.now(), error: (err as Error).message };
    setTimeout(() => { if (moving?.error) { moving = null; void tailnet(); } }, 60_000);
  }
  await host.poll();
  await tailnet();
}
host.on(() => { void tailnet(); model.rebuild(); });
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
    if (path === "/api/health") return json({ ok: true, version: VERSION, core: hub.up, jobs: jobs.on && hub.up, serving: host.serving(), host: host.hubName() ?? null, reachable: host.reachable(),
      // the other machines this service ticks (Serve from: the host the ones with no service of their own)
      ticks: jobs.on ? host.tickOn() : [] });
    // the Web add-on switched off: nothing for the tailnet (this machine's own callers still get the API)
    if (req.headers.has("tailscale-user-login") && !webOn()) return new Response("Shepherdr's web app is off (Shepherdr settings › Window › Add-ons).", { status: 404 });
    // another machine serves it now (Serve from): a page that still comes here goes there
    if (req.headers.has("tailscale-user-login") && !host.serving()) {
      const there = host.hostLink();
      return there ? Response.redirect(there, 302) : new Response("Shepherdr's web app is served from another machine now.", { status: 404 });
    }
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
    // a file a chat shows (an image sent in it), on this machine: only one that chat's messages name
    if (path === "/api/file") {
      const key = url.searchParams.get("chat") ?? "", want = url.searchParams.get("path") ?? "";
      const at = compat.fileOf(key, want);
      const addr = compat.addrOf(key) ?? "", on = addr.includes("/") ? addr.split("/")[0] : null;
      if (!at || !at.startsWith("/") || at.includes("/../") || (!on && !existsSync(at))) return json({ error: "not found" }, 404);
      const named = { "cache-control": "private, max-age=3600", ...(url.searchParams.get("download") ? { "content-disposition": `attachment; filename="${at.split("/").pop()!.replace(/"/g, "")}"` } : {}) };
      if (on) {
        // a chat on another machine (one this machine serves the web app for): the file there, through herdr-core
        const r = await hub.call<{ code: number; stdout: string; truncated?: boolean }>("machine.exec", { on, argv: ["cat", "--", at], timeout: 30 }, 35_000).catch(() => null);
        if (!r || r.code !== 0 || r.truncated) return json({ error: "not found" }, 404);
        return new Response(Buffer.from(r.stdout, "base64"), { headers: { "content-type": Bun.file(at).type || "application/octet-stream", ...named } });
      }
      const f = Bun.file(at);
      return new Response(f, { headers: { "content-type": f.type || "application/octet-stream", ...named } });
    }
    // a recipe artifact's files (the web's recipe view asks api/artifacts/<id>/recipe?v=, /file/<path>?v=; &on=<machine>
    // for another machine's, read there)
    const art = /^\/api\/artifacts\/([\w.-]+)\/(recipe|file\/(.+))$/.exec(path);
    if (art) {
      const v = Number(url.searchParams.get("v"));
      const on = url.searchParams.get("on") || null;
      if (art[2] === "recipe") { const r = await artifacts.recipe(art[1], v, on); return r ? json(r) : json({ error: "No recipe here." }, 404); }
      let rel = "";
      try { rel = decodeURIComponent(art[3]); } catch { return json({ error: "not found" }, 404); }
      return artifacts.file(art[1], v, rel, on);
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
    if (path === "/api/newspace") {
      // New space on a machine: its home, recent folders and where the field starts (the shown space's folder)
      const m = url.searchParams.get("machine"), machine = !m || m === me?.host ? null : m;
      const sp = compat.spaceOf(url.searchParams.get("place") ?? "");
      try { return json(await newSpaceInfo(hub, machine, sp && (sp.machine ?? null) === machine ? sp.folder : null)); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/spaces" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      try {
        const machine = !b?.machine || b.machine === me?.host ? null : String(b.machine);
        const icon = typeof b?.icon === "string" && b.icon ? b.icon.slice(0, 16) : null;
        const place = await newSpace(hub, { machine, path: String(b?.path ?? ""), makeRepo: !!b?.makeRepo, icon, store: compat.shared! });
        return json({ place });
      } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/push/key") return json({ key: await push.key() });
    if (path === "/api/push/subscribe" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      try { push.subscribe(body?.sub, body?.device); return json({ ok: true }); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/worktree" && url.searchParams.has("space")) {
      // the tab bar's Files and Changes (Herdr's own panels): the space's folder, its uncommitted changes against HEAD
      const sp = compat.spaceOf(url.searchParams.get("space") ?? "");
      if (!sp) return json({ error: "No folder" }, 404);
      try {
        const what = url.searchParams.get("what") ?? "";
        if (!["dir", "marks", "file", "diff", "patch"].includes(what)) throw new Error("Ask for dir, marks, file, diff or patch.");
        const out: any = await worktree(hub, { folder: sp.folder, machine: sp.machine }, what, url.searchParams.get("path") ?? undefined);
        // in Herdr's panels' own words, not a task's
        const HERDR: Record<string, string> = { [(W as any).VIEW_WORDS.notGit]: "Not a git repository", [(W as any).VIEW_WORDS.folderGone]: "No folder" };
        if (out?.error && HERDR[out.error]) out.error = HERDR[out.error];
        return json(out);
      } catch (err) { return json({ error: (err as Error).message }, 400); }
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
      const id = url.searchParams.get("id") ?? "";
      // a background shell's or watcher's last lines (core/bg-jobs.js), asked again every few seconds while shown
      if (url.searchParams.get("what") === "job") {
        const out = id.startsWith("b:") && r ? await r.jobOutput(id.slice(2)).catch(() => null) : null;
        return json(out === null ? { error: "It isn't running any more." } : { output: out });
      }
      return json(await activity(r, id));
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
      if (body?.type === "setting" && typeof body.key === "string" && body.key.startsWith("notify.machine@")) {
        // Reset of what a machine set before machine scope went (the window's Notify rows under Everywhere's)
        await store.set("notify", (NF as any).withMachine(model.value("notify") ?? {}, body.key.slice("notify.machine@".length), null));
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
      if (body?.type === "setting" && body.key === "web.serve") {
        // Settings › Web's Serve from, confirmed: the machine by its line in the picker
        const row = serveNow().rows.find((r) => r.label === body.value);
        if (!row) return json({ ok: false, error: "That machine isn't linked." });
        if (row.serves) return json({ ok: true });
        if (moving && !moving.error) return json({ ok: false, error: `Already moving it to ${moving.to}.` });
        void serveFrom(row.here ? null : row.name).catch(() => {});
        return json({ ok: true });
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
          const value = typeof body.value === "string" ? body.value : null;
          // Home Assistant's Make home space (and turning it on), as the window's: herdr-task's home round makes one
          const home = /^machine\.(makehome|home)@([\w.-]+)$/.exec(body.key);
          if (home && (home[1] === "makehome" || value === "on")) await store.set("home.makereq", { machine: home[2] === "local" ? null : home[2], at: Date.now() });
          if (home?.[1] === "makehome") return json({ ok: true });
          // Base branch: checked before it's saved, here or on origin as git last fetched it (the window's words)
          if (body.key === "tasks.base" && value?.trim()) {
            const want = value.trim();
            const there = SC.branchShape(want) && sp && (await Promise.all([`refs/heads/${want}`, `refs/remotes/origin/${want}`].map((ref) =>
              exec(hub, ["git", "-C", folder || sp.folder || "~", "show-ref", "--verify", "--quiet", ref], sp.machine ?? null).catch(() => null)))).some((r) => r?.code === 0);
            if (!there) return json({ ok: false, error: SC.BASE.missing(want) });
          }
          settings.set(body.key, value, level, sp ? { id: sp.id, name: sp.name, machine: sp.machine ?? null, folder } : null);
          return json({ ok: true });
        } catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "template" && typeof body.role === "string") {
        try { return json({ ok: true, text: settings.template(body.role, typeof body.text === "string" ? body.text : undefined) }); }
        catch (err) { return json({ ok: false, error: (err as Error).message }); }
      }
      if (body?.type === "limits-check") { await machines.checkNow(); return json({ ok: true }); }
      if (body?.type === "serve-from") {
        // Settings › Web's Serve from: the move runs on (the page sees it in Settings › Web as it goes)
        const m = typeof body.machine === "string" && body.machine && body.machine !== host.me?.name ? body.machine : null;
        if (m !== null && !host.machines.has(m)) return json({ ok: false, error: "That machine isn't linked." });
        if (moving && !moving.error) return json({ ok: false, error: `Already moving it to ${moving.to}.` });
        void serveFrom(m).catch(() => {});
        return json({ ok: true });
      }
      if (body?.type === "role-info") {
        // Settings › Agents' model menu (the window's, settings mode): every installed CLI's models, levels, Fast and
        // permission modes
        try { if (!settings.choices) await readDefaults(); return json({ ok: true, menus: settings.choices?.menus ?? {}, permDefault: settings.choices?.permDefault ?? {}, clis: await compat.agents!.choices(null) }); }
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
