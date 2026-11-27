// The Shepherdr service: one per machine, always on (user systemd / launchd). It does Shepherdr's background work
// and serves the web app with its live updates, on 127.0.0.1 only; the tailnet reaches it through
// tailscale serve --set-path /shepherdr (never funnel).
//
//   bun service/main.ts            run it (systemd and launchd run exactly this)
//   SHEPHERDR_PORT=7788            the port on 127.0.0.1
//   SHEPHERDR_WEB=off              don't share it on the tailnet (a test, a throwaway service); the web app is the app,
//                                  so there is no other switch for it
// Serve from (service/host.ts): one machine serves the web app and holds the shared data; on the others the service
// reads and writes it there, keeps their settings in step (service/sync.ts) and doesn't share /shepherdr.
import { useSession } from "./session.ts";
import { spawn } from "./spawn.ts";
useSession();
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync, watchFile } from "node:fs";
import { join, normalize } from "node:path";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { DATA, SOCK, TOKEN, PORT, HOME, ensureData, settingsFile, where } from "./paths.ts";
import { holdLock } from "./lock.ts";
import { gate, localCaller, type Gate } from "./auth.ts";
import { refusedWhy, trustedPeer } from "./peer.ts";
import { whoami, share, served, unshare, restoreShare, httpsPort, webLink, webOrigin, deviceOf, forwardedFrom, HTTPS_PORT_FILE, type Me } from "./tailscale.ts";
import { qrFile } from "./qr.ts";
import { Hub } from "./hub.ts";
import { Store } from "./store.ts";
import { Host } from "./host.ts";
import { Sync } from "./sync.ts";
import { Live } from "./live.ts";
import { webBuild } from "./webbuild.ts";
import { Model } from "./model.ts";
import { checkFlags } from "./flags.ts";
import type { Snapshot } from "../web/shared/types.ts";
import { catalogOf, configOf, enrich, offPlugins, pluginOn, plansOf, reposOf, scheduleAgentArgs, scheduleOf, setConfig, spaceRepo } from "./next.ts";
import { ensureShell, type ShellAt } from "./shells.ts";
import { Chats } from "./chats.ts";
import { act, findMachines, hc as hcRun } from "./actions.ts";
import { analyticsAction, howOf, noteVersion, record as note } from "./analytics.ts";
import { AgentWatch } from "./watch.ts";
import { Compat, activity, newsKey, placeKey } from "./compat.ts";
import { keep, served as fileResponse, smaller } from "./media.ts";
import { Asks } from "./asks.ts";
import { Jobs } from "./jobs.ts";
import { terminalBridge } from "./terminal.ts";
import { worktree } from "./worktree.ts";
import * as files from "./files.ts";
import * as SPm from "../core/spaces.js";
import { createScreens, SCREEN_PASSWORD } from "./screens.ts";
import { voiceCall, callToResume, callsOn, handOff, type ChatView } from "./voice.ts";
import type { HearIO } from "./voice-hear.ts";
import type { VoiceIO } from "./voice-tools.ts";
import { Artifacts, artifactAction, artifactRoute } from "./artifacts.ts";
import { TaskLogs } from "./task-logs.ts";
import { Settings, onWritten, PUSH, pushBody, readSettings } from "./settings.ts";
import { Secrets, SecretsHome, secretValue } from "./secrets.ts";
import { Agents } from "./agents.ts";
import { Updates } from "./agent-update.ts";
import { Machines } from "./machines.ts";
import { Push, alertsOf, agentAlerts, pushChanges, waitingTags } from "./push.ts";
import { waiting } from "../web/shared/alerts.ts";
import { GlanceFeed, MAX_CHATS, glanceOf, openUrlOk, saidToPerson } from "./glance.ts";
import { chatPage } from "./native-chat.ts";
import { unreadChats } from "../web/shared/needs-you.ts";
import type { Watcher } from "./chats.ts";
import { Shows } from "./show.ts";
import { dictate, liveToken, cachedKey, refused, forgetKey, checkVoiceKey } from "./dictate.ts";
import { readUsage } from "../core/voice.js";
import { sh, exec } from "./model.ts";
import { existedWords, folders, newSpace, newSpaceInfo } from "./spaces.ts";
import { kindOf } from "../core/chat-reader.js";
import * as SL from "../core/slash.js";
import * as SCORE from "../core/settings.js";
import { CHOICE_KEY, choiceOf } from "../core/agents.js";
const SC = SCORE as any;
const { SCAN, scanned, commandList, MENU } = SL as any;
import * as HCORE from "../core/host.js";
const { serveChoice } = HCORE as any;
import { iconValue, isPicture } from "../core/space-icon.js";
import * as MN from "../core/mentions.js";
const { REACH_FILE, reachable } = MN as any;

// A machine's reach map, as its spaces: kept a minute (its scheduler redraws it every 5)
const reaches = new Map<string, { at: number; got: Promise<{ from: string | null; spaces: any[]; checked: number | null }> }>();
// The spaces the service knows (its own list, each with its place's name): a reach map that reads a machine's
// spaces as empty still lists them (core/mentions.js reachable, SHEP-185).
function knownSpaces() {
  return compat.allSpaces().map((s) => {
    const p = compat.last?.places.find((x) => x.id === s.id);
    return { id: s.id.split("/").pop()!, name: p?.name ?? "", folder: s.folder, machine: s.machine ?? null, everything: s.id === compat.last?.everything, ...(p?.emoji && !isPicture(p.emoji) ? { emoji: p.emoji } : {}), assistant: !!(p && compat.addrOf(p.chat)) };
  });
}
function reachOf(machine: string | null) {
  const k = machine ?? "", was = reaches.get(k);
  if (was && Date.now() - was.at < 60_000) return was.got;
  const got = exec(hub, ["sh", "-c", REACH_FILE], machine, 20).then((r) => {
    const d = JSON.parse(r.stdout || "null");
    return { from: d?.graph?.core?.name ?? machine, spaces: reachable(d?.graph, knownSpaces()), checked: d?.at ?? null };
  }).catch(() => null).then((r) => r?.checked ? r : {
    // no map there yet (its scheduler hasn't run): its own spaces, which it always reaches
    from: machine, checked: null,
    spaces: compat.allSpaces().filter((s) => (s.machine ?? null) === machine).map((s) => {
      const id = s.id.split("/").pop()!, p = compat.last?.places.find((x) => x.id === s.id);
      return { id, name: s.id === compat.last?.everything ? "Everything" : p?.name ?? id, route: "", machine: machine ?? me?.host ?? "", target: id, ...(p?.emoji && !isPicture(p.emoji) ? { emoji: p.emoji } : {}), assistant: !!(p && compat.addrOf(p.chat)) };
    }),
  });
  reaches.set(k, { at: Date.now(), got });
  return got;
}

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
// This start's id (GitHub #635): written with the port into service.json once the port is ours, and answered by health
// to this machine's callers only, so the CLI and a call know it is Shepherdr's own service
// on that port, never another app holding it, before they send the token or the shared state.
const SERVICE_ID = randomBytes(16).toString("hex");
const SERVICE_FILE = join(DATA, "service.json");

const hub = new Hub();
const host = new Host(hub, VERSION);
noteVersion(VERSION);
await Promise.race([host.start(), Bun.sleep(10_000)]);
const store = new Store(hub, host);
new Sync(hub, host).start();
let me: Me | null = await whoami();
const g: Gate = { owner: me?.login ?? null, dns: me?.dns ?? null, port: PORT, token };
// the 403 reason last logged for a Mac that can't see who connected (peer.ts refusedWhy), said once
let saidPeer = "";
// the tailnet HTTPS port the web app is shared on (tailscale.ts httpsPort: 443 unless this machine set another),
// looked at again with the rest of the tailnet; ownLink: this machine's own link on it
let hp = httpsPort();
g.httpsPort = hp;
const ownLink = () => (me ? webLink(me.dns, hp) : null);
const live = new Live(hub, store, () => me, VERSION, ownLink);
live.web = webBuild(WEB);
const compat = new Compat();
const model = new Model(hub, live);
live.chats = new Chats(hub);
live.compat = compat;
compat.reader = (a) => live.chats?.reader(a) ?? null;
compat.queued = (a) => live.chats?.queued(a) ?? [];
compat.refreshQuestions = async (a) => { await live.chats?.refresh(a); };
compat.questionScreen = async (a) => (await live.chats?.screen(a)) ?? null;
live.chats.onQuestions = () => model.rebuild();
// the chat scrolled to its top: the page before
(compat as any).earlier = (a: string) => live.chats?.earlier(a);
const push = new Push(() => (me ? webOrigin(me.dns, hp) : "https://herdr.dev"));
// only the machine that serves the web app sends push alerts (its pages subscribed there): never two of one alert
const pushSend = push.send.bind(push);
push.send = ((a: any) => (host.serving() ? pushSend(a) : Promise.resolve())) as typeof push.send;
live.onVisible = (v) => { push.visible = v; };
// the glance feed for the phone's and watch's own app (SHEP-246): while its native stream is open (and 2 minutes after),
// that device gets no web push, never two notifications of one alert
const glance = new GlanceFeed();
push.quiet = (node) => glance.quiet(node);
// the app on screen on a device (SHEP-338): no system notification there, web push nor its phone app's own
push.looking = (node) => live.looking(node);
glance.looking = (device) => live.looking(device);
live.onPushDevice = (endpoint, device) => push.nodeOf(endpoint, device);
// an agent's herdr-artifact open (service/show.ts): the serving machine's screen the person is on opens the artifact
const shows = new Shows();
hub.on((e) => {
  if (e.type !== "reset" && e.type !== "labels" && e.type !== "created") return;
  for (const a of shows.take(hub.terminals.values())) if (host.serving()) live.show(a.artifact);
});
// what was already waiting or ready when the service started: no alert for it
let alerted: ReturnType<typeof alertsOf> | null = null;
// the agents' own alerts ride on the snapshot (the web app's toasts: web/plugins/alerts/toasts.tsx), then push
const chatOfAddress = (a: string) => { for (const [k, v] of ((compat as any).chats ?? new Map()) as Map<string, string>) if (v === a) return k; return null; };
const alertNewAnd = (snap: any) => { try { snap.alerts = agentAlerts(hub.terminals.values(), snap, chatOfAddress, HOME); alertNew(snap); } catch {} return snap; };
// what waits on you now, as the last alerts said it: the app icon's count and the tags of the alerts that may stay (the
// service worker asks after a notification's button did something: GET /api/waiting)
let waitingNow = { count: 0, tags: [] as string[] };
// an Assistant's last words, for its New message alert
const lastSaid = (key: string) => {
  const a = compat.addrOf(key), items: any[] = (a ? live.chats?.reader(a)?.conv?.items : null) ?? [];
  return items.findLast((x) => x.kind === "agent" && x.text)?.text as string | undefined;
};
// a chat's newest message with words (the person's or its agent's), for the glance's suggested replies
const lastWords = (key: string) => {
  const a = compat.addrOf(key), items: any[] = (a ? live.chats?.reader(a)?.conv?.items : null) ?? [];
  // as the chat lists them (compat.ts): its words or the person's; messages between agents (another agent's in, one it
  // sent) never clear the bubbles, as web/plugins/chat/suggest.ts suggestionOf
  const m = items.findLast(saidToPerson);
  return m ? { who: m.kind === "user" ? "you" as const : "agent" as const, text: m.text as string, ...(m.kind === "agent" ? { suggests: m.suggests as string[] | undefined } : {}) } : null;
};
// SHEP-447: an unread Assistant chat's newest words, for the glance feed's chats: Chats reads a chat only while someone
// follows it, so each unread one is read once per new turn (followed until read, then let go) and its words kept
const news = new Map<string, { turn: number; said?: ReturnType<typeof lastWords> }>();
function readNews(snap: any) {
  const now = unreadChats(snap).slice(0, MAX_CHATS);
  const keep = new Set(now.map((u) => u.chat));
  for (const k of news.keys()) if (!keep.has(k)) news.delete(k);
  for (const u of now) {
    if (news.get(u.chat)?.turn === u.at) continue;
    const addr = compat.addrOf(u.chat), chats = live.chats;
    if (!addr || !chats) continue;
    const entry: { turn: number; said?: ReturnType<typeof lastWords> } = { turn: u.at };
    news.set(u.chat, entry);
    let done = false, cut: ReturnType<typeof setTimeout> | undefined;
    const w: Watcher = () => {
      if (done) return;
      done = true;
      if (cut) clearTimeout(cut);
      queueMicrotask(() => chats.unwatch(addr, w));
      entry.said = lastWords(u.chat);
      if (entry.said && news.get(u.chat) === entry) model.rebuild();
    };
    // never read: tried again on its next turn
    chats.watch(addr, w);
    if (!done) cut = setTimeout(() => { if (!done) { done = true; chats.unwatch(addr, w); } }, 15_000);
  }
}
const newsOf = (key: string) => lastWords(key) ?? news.get(key)?.said ?? null;
function alertNew(snap: any) {
  // their words: service/push.ts alertsOf
  const now = alertsOf(snap, lastSaid);
  // the phone's and watch's glance, with these same words (service/glance.ts)
  try { readNews(snap); glance.set(glanceOf(snap, now, Date.now(), newsOf)); } catch (err) { console.error(`glance: ${(err as Error).message}`); }
  waitingNow = { count: waiting(snap).count, tags: waitingTags(now) };
  if (alerted) for (const a of pushChanges(alerted, now, waitingNow.count, waitingNow.tags)) void push.send(a);
  alerted = now;
}
compat.agents = new Agents(hub);
(compat.agents as Agents).onOffer = () => live.refresh();
(compat.agents as Agents).onSettings = () => {
  live.refresh();
  live.chats?.refreshAll();
};
compat.updates = new Updates(hub, (addr, reader) => (compat.agents as Agents).revive(addr, reader));
(compat.updates as Updates).onChange = () => live.refresh();
const machines = new Machines(hub, () => model.machineNames());
machines.onChange = () => model.rebuild();
compat.machineStats = (m) => machines.of(m);
// SHEP-128: the ElevenLabs plan under this machine's Plan usage, with the voice key (kept in memory only); none while the
// Voice plugin is off or there is no key
machines.voiceUsage = async () => {
  if (!pluginOn("voice")) return null;
  const r: any = await readUsage(() => cachedKey(hub).get());
  if (r?.state === "unknown") refused(r.why);
  return r;
};
machines.watched = () => live.anyone();
live.onFirstPage(() => void machines.poll());
machines.start();
const secrets = new Secrets(hub);
compat.secrets = secrets;
(compat as any).terminalsOf = (a: string) => hub.terminals.get(a);
(compat as any).terminalsAll = () => [...hub.terminals.values()];
(compat as any).coreName = () => host.me?.name || null;
let secretNames: { name: string; at: number; space: string | null }[] = [];
let vaultList: Awaited<ReturnType<Secrets["entries"]>> = [];
const refreshSecrets = async () => { [secretNames, vaultList] = await Promise.all([secrets.names(), secrets.entries()]); model.rebuild(); };
void refreshSecrets();
setInterval(() => void refreshSecrets(), 30_000);
// stale secret asks close by themselves: withdrawn, their agent gone, or their task finished (Secrets.sweep)
setInterval(() => void secrets.sweep((addr) => compat.workerFinished(addr)).then((c) => { if (c) model.rebuild(); }).catch(() => {}), 5000);
// which machine keeps the secrets; there, other machines' requests are answered
const home = new SecretsHome(hub);
home.on(() => { void refreshSecrets(); });
void home.start();
// Settings › Secrets › Kept on: a move this service started (shepherdr secrets move-to), until it ends
let secretsMoving: { to: string; at: number; error?: string } | null = null;
async function moveSecrets(machine: string | null) {
  const target = machine ?? home.me?.name ?? "here";
  secretsMoving = { to: target, at: Date.now() };
  model.rebuild();
  const cli = [join(HOME, ".local", "bin", "shepherdr"), join(ROOT, "bin", "shepherdr")].find(existsSync) ?? "shepherdr";
  try {
    const p = spawn([cli, "secrets", "move-to", machine ?? "here", "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    let r: any = null;
    try { r = JSON.parse(out.trim().split("\n").pop() ?? ""); } catch {}
    if ((await p.exited) !== 0 || r?.ok === false) throw new Error(r?.error || err.trim().split("\n").pop()?.replace(/^shepherdr: /, "") || "The move didn't finish.");
    secretsMoving = null;
  } catch (err) {
    secretsMoving = { to: target, at: Date.now(), error: (err as Error).message };
    setTimeout(() => { if (secretsMoving?.error) { secretsMoving = null; model.rebuild(); } }, 120_000);
  }
  await home.poll();
  await refreshSecrets();
}
// Secrets follow Serve from unless the person picked a machine (core/secrets.js followTo): kept elsewhere (where they
// were before, or Serve from moved), the machine serving the web app moves them to itself the same safe way as Kept on
// (shepherdr secrets move-to: a backup, a verified copy, rollback), once the machine that keeps them is on; a failed
// try waits ten minutes and says why in Settings › Secrets.
let followTried = 0;
setInterval(() => {
  if (!home.shouldFollow() || (secretsMoving && !secretsMoving.error) || Date.now() - followTried < 10 * 60_000) return;
  followTried = Date.now();
  console.error("secrets: following Serve from: moving them here");
  void moveSecrets(null).catch(() => {});
}, 30_000);
const settings = new Settings();
// a space's Assistant runs the agent Settings chooses for it (#1051) unless the person chose in its chat before its
// first message (the model menu: core/agents.js CHOICE_KEY, SHEP-263)
compat.assistantPick = (space) => choiceOf(model.value(CHOICE_KEY), space) ?? settings.role(space, "coordinator");
// Settings › Agents' model menu and buttons (core/settings.js choicesFrom), from each CLI's own settings here, read
// again every ten minutes; a CLI herdr-task's check finds missing here isn't offered
const readDefaults = async () => {
  try {
    let check: any = {};
    try { check = JSON.parse(readFileSync(where()["cli-check"], "utf8"))?.machines?.[""] ?? {}; } catch {}
    settings.choices = SC.choicesFrom(await compat.agents!.ownDefaults(), { claude: check.claude !== "missing", codex: check.codex !== "missing" });
    model.rebuild();
  } catch {}
};
// Settings › Web: what the service last said of the web app (tailnet() below), its QR code as a picture
let webNow: { on: boolean; link: string | null; why: string | null; qr: string | null; serve?: any } | null = null;
// Settings › Secrets: each kept secret with where it is, and each agent's waiting ask with its name and
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
  const kept = { ...home.view(), moving: secretsMoving && !secretsMoving.error ? secretsMoving.to : null, error: secretsMoving?.error ?? null };
  return { vault, asks, kept };
}
// Base branch's empty box: the branch a space's folder has checked out, on its machine
settings.fetchBranch = async (s) => {
  const sp = model.spaceById(s.id);
  const r = await exec(hub, ["git", "-C", sp?.folder || "~", "symbolic-ref", "--short", "HEAD"], sp?.machine ?? null).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() : "";
};
setTimeout(() => void readDefaults(), 3000);
setInterval(() => void readDefaults(), 10 * 60_000);
// a change made here goes to the other machines' herdr-task (one push at a time)
let pushing: Promise<unknown> = Promise.resolve();
onWritten((file) => { pushing = pushing.then(() => Promise.all(model.machineNames().map((m) => exec(hub, ["sh", "-c", PUSH, "sh", pushBody(file, m)], m).catch(() => null)))); });
settings.on(() => { model.rebuild(); void tailnet(); });
settings.start();
const artifacts = new Artifacts();
compat.artifacts = artifacts;
// other machines' artifacts, read there through herdr-core
artifacts.hub = hub;
artifacts.machines = () => model.machineNames();
artifacts.watched = () => live.anyone();
live.onFirstPage(() => { void artifacts.read(); void artifacts.readThere(); });
artifacts.on(() => model.rebuild());
// a task's chat logs, for its older artifacts that name no task (its Artifacts tab)
const taskLogs = new TaskLogs();
taskLogs.onChange = () => model.rebuild();
compat.taskLogs = taskLogs;
compat.promptOf = (k) => model.prompts.get(k) ?? null;
artifacts.start();
const asks = new Asks();
compat.asks = asks;
asks.on(() => { model.rebuild(); live.chats?.refreshAll(); });
asks.start();
// another machine's agents a page shows (the web served from a machine other than theirs): their asks too
asks.remote(hub, () => live.watched());
// start screens and lost sessions of the agents whose chats pages have open, and of an open Assistant chat's workers
// (service/watch.ts)
const watch = new AgentWatch(hub, hcRun, {
  watched: () => {
    const out: { addr: string; ref?: string | null }[] = [];
    for (const a of live.chats?.addresses() ?? []) {
      out.push({ addr: a });
      out.push(...(compat as any).workersOf(a).map((w: any) => ({ addr: w.addr, ref: w.ref })));
    }
    return out;
  },
  loginWatches: () => [...hub.terminals].filter(([addr]) => !!compat.trustWho(addr)).map(([addr]) => addr),
  alreadyCarded: (addr) => !!asks.of(addr).length || !!compat.queued?.(addr).length,
  log: (addr) => compat.reader?.(addr)?.conv?.items ?? [],
  changed: () => { live.chats?.refreshAll(); model.rebuild(); },
});
(compat as any).watch = watch;
watch.start();
const jobs = new Jobs(hub, host);
jobs.watched = () => live.watched();
jobs.start();
model.doc = () => store.doc.value;
// the Herdr window's spaces carried over once (service/carry-over.ts), by the machine that keeps the shared document,
// once that document is read (never onto a list it only hasn't read yet)
model.own = { ready: () => host.serving() && store.loaded, update: (change) => store.update(change) };
compat.shared = { value: (k) => model.value(k), set: (k, v) => store.set(k, v) };
store.on(() => model.rebuild());
void store.load().catch(() => {});
/** the snapshot as the app shows it (with 3.2's facts): what the voice reads too */
let shown: Snapshot | null = null;
/** 3.2 (service/next.ts): what the new app shows on top of the model's snapshot */
const withNext = (snap: Snapshot, b: Parameters<NonNullable<typeof model.onBuild>>[0]): Snapshot => {
  const d = pickFrom(settings.choices?.defaults) ?? { agent: "claude" };
  // reviews run on the other agent where there is one, as before
  const others = Object.keys(settings.choices?.menus ?? {}).filter((k) => k !== d.agent);
  const review = others.length ? { agent: others[0], model: settings.choices.menus[others[0]]?.models?.[0]?.id ?? null, effort: null, fast: false as const, perm: null } : d;
  const config = configOf({ defaults: { Chats: d, Tasks: d, Reviews: review }, spaces: b.spaces.map((x: any) => x.id), secrets: secretNames, plans: plansOf(snap),
    addMachine: "hc machine add <its name on your tailnet>", desktops: desktopsOf(), repos: reposOf(b.spaces, snap.tasks ?? [], me?.host ?? null) });
  const asked = (chat: string) => {
    const a = compat.addrOf(chat);
    if (a) for (const x of compat.asks?.open.values() ?? []) if ((x as any).terminal === a) return (x as any).words?.kind === "permission" ? "permission" as const : "question" as const;
    return null;
  };
  const reportOf = (address: string | null) => {
    const k: any = address ? hub.terminals.get(address) : null;
    if (!k) return null;
    const st = typeof k.status === "object" ? k.status : null;
    return { state: st?.state, kind: st?.kind ?? k.report?.kind };
  };
  const bar = model.value("spaces-chat") as any;
  return (shown = enrich(snap, { spaces: b.spaces.map((s: any) => watch.notes.has(s.assistant) ? { ...s, assistantStatus: "stopped" } : s), rows: b.rows, archived: Array.isArray(bar?.archived) ? bar.archived : [], asked, reportOf, config, screens: pluginOn("screens") ? screens.screensOf() : {}, waiting: pluginOn("screens") ? screens.waiting() : [], hostName: hostname().split(".")[0], schedules: pluginOn("schedules") ? b.automations : [] }));
};
const pickFrom = (v: any) => (v?.agent ? { agent: String(v.agent), model: v.model ?? null, effort: v.effort ?? null, fast: v.fast === "ultrafast" ? "ultrafast" as const : !!v.fast, perm: v.perm ?? null } : null);
/** where your own terminal starts: a space's folder, or a task's (its worktree when it has one), on its machine */
function shellAt(key: string): ShellAt | null {
  if (key.startsWith("sh:task:")) {
    const id = key.slice(8), r = (model.rows as any[]).find((x) => (x.machine ? `${x.machine}:${x.ref}` : x.ref) === id);
    return r ? { folder: r.worktree ?? r.folder, machine: r.machine ?? null } : null;
  }
  const s = (model.spaces as any[]).find((x) => x.id === key.slice(3));
  return s?.folder ? { folder: s.folder, machine: s.machine ?? null } : null;
}
/** Screens (service/screens.ts): each chat's and task's browser tab and desktop, to watch and take over. A key names
 *  whose: "chat:<space id>", "task:<task id>", "machine:<key>". */
const screens = createScreens({
  who(key) {
    const bare = (id: string) => id.slice(id.lastIndexOf("/") + 1);
    if (key.startsWith("task:")) {
      const id = key.slice(5), r = (model.rows as any[]).find((x) => (x.machine ? `${x.machine}:${x.ref}` : x.ref) === id);
      if (!r) return null;
      const sp = r.space ?? (model.spaces as any[]).find((x) => (x.machine ?? null) === (r.machine ?? null) && x.folder === r.folder)?.id ?? "";
      const k: any = r.worker ? hub.terminals.get(r.worker) : null, st = typeof k?.status === "object" ? k.status : null;
      return { task: `${r.slug}#${r.id}`, space: bare(String(sp)), machine: r.machine ?? null, address: r.worker ?? null, title: r.title, auth: st?.state === "blocked" && (st?.kind ?? k?.report?.kind) === "auth" };
    }
    if (key.startsWith("chat:")) {
      const s = (model.spaces as any[]).find((x) => x.id === key.slice(5));
      return s ? { space: bare(String(s.id)), machine: s.machine ?? null, address: s.assistant ?? null, title: s.name } : null;
    }
    return null;
  },
  keyOf(who) {
    if (who.startsWith("chat:")) { const s = (model.spaces as any[]).find((x) => !x.machine && String(x.id) === who.slice(5)); return s ? `chat:${s.id}` : null; }
    const r = (model.rows as any[]).find((x) => !x.machine && `${x.slug}#${x.id}` === who);
    return r ? `task:${r.ref}` : null;
  },
  machine: me?.host ?? "this machine",
  send: (m) => void hub.send(m.address, m.text).catch(() => null),
  changed: () => model.rebuild(),
  // a Mac's Screen Sharing password: the secret SCREEN_SHARING_PASSWORD (Settings › Secrets), as herdr-desktop's doctor names it
  password: () => secretValue(SCREEN_PASSWORD, hub),
  machines: async () => ((await hub.call<{ machines: any[] }>("machine.list", {}, 8000)).machines ?? []).map((m) => ({ name: String(m.name), target: String(m.target ?? ""), via: !!m.via, state: String(m.state ?? "") })),
});
if (pluginOn("screens")) screens.start();
let desktopsOf: () => string[] = () => (pluginOn("screens") ? screens.desktops() : []);
const snapshotOf = (b: Parameters<NonNullable<typeof model.onBuild>>[0]) => live.setSnapshot(alertNewAnd(withNext(compat.snapshot({
  host: me?.host ?? "this machine", user: me?.name ?? "You", spaces: b.spaces, sections: b.sections, rows: b.rows, artifacts: artifacts.list, automations: b.automations,
  settings: [...settings.sections(webNow ?? ownLink(), b.spaces.map((s: any) => ({ id: s.id, name: s.name, machine: s.machine ?? null, repo: spaceRepo(s) })), b.machines, me?.host ?? "this machine"),
    // Secrets (Everywhere's and each space's own): every kept secret and where, and the agents waiting on one
    ...[{ id: "all" }, ...b.spaces].map((s: any) => ({ name: "Secrets", level: s.id, rows: [], ...secretsPage(b.spaces),
      secrets: secretNames.filter((x) => (s.id === "all" ? !x.space : x.space === s.id)) }))], offPlugins: offPlugins(),
  // every machine: one not connected reads "Offline" (or "Connecting…") under its header
  // in the order the person dragged them into (SHEP-153): this computer first until then
  machines: (SPm.byMachineOrder as any)([{ name: me?.host ?? "this machine", here: true, state: "connected" }, ...b.known.map((m) => ({ name: m.name, here: false, state: m.state, why: m.why }))],
    (SPm.machineOrderOf as any)(model.value("spaces-chat")), (m: { name: string; here: boolean }) => (m.here ? null : m.name)),
}), b)));
// a task that moved on (accepted, done) changes its news lines in its Assistant's chat, whose conversation may not move:
// open chats are told again (compat.chat reads the rows the snapshot just took)
let newsWas: string | null = null;
model.onBuild = (b) => {
  live.chats?.trackCodex([...b.spaces.map((s) => s.assistant), ...b.rows.filter((r) => !r.archived).map((r) => r.worker)].filter(Boolean));
  snapshotOf(b);
  const now = newsKey(b.rows);
  if (newsWas !== null && now !== newsWas) live.chats?.refreshAll();
  newsWas = now;
};
model.start();

/** where files from a page's message box are kept */
const ATTACH = join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "data", "chat-attach");
/** shared on the tailnet, unless SHEPHERDR_WEB=off (a test, a throwaway service) */
const webOn = () => process.env.SHEPHERDR_WEB !== "off";

// Tailscale can come up after the service: look again now and then, and keep /shepherdr shared. What the CLI
// (shepherdr web status, doctor) reads goes into ~/.local/state/shepherdr/service/web.json (the link, its QR code).
let wasOn: boolean | null = null;
// Serve from: a move this service started (shepherdr web serve-from), until it ends; what went wrong, for a while
let moving: { to: string; at: number; error?: string } | null = null;
async function tailnet() {
  me = await whoami();
  g.owner = me?.login ?? null;
  g.dns = me?.dns ?? null;
  g.httpsPort = hp = httpsPort();
  const on = webOn(), serving = host.serving();
  const own = ownLink();
  host.link = own;
  // another machine serves it: its link; this one isn't shared
  const link = serving ? own : host.hostLink();
  let why: string | null = me || !serving ? null : "Tailscale isn't running here";
  // what tailscale serve said when sharing failed (doctor counts it as broken, not a note)
  let shareWhy: string | null = null;
  if (me && on && serving) {
    const s = await served(me.dns);
    if (s.funnel) { why = "Funnel is on for this machine: the web app stays off until it's off"; g.owner = null; }
    else why = shareWhy = await share(me.dns, PORT, hp);
  } else if (me && (!on || !serving) && wasOn !== false) {
    await unshare(me.dns, PORT);
    // moved away: what the move here set aside is shared again (shepherdr web serve-from --take-link)
    if (!serving) await restoreShare(join(DATA, "replaced-share.json"));
  }
  if (!serving && !link) why = host.reachable() ? "The machine serving the web app hasn't said its link yet." : "The machine serving the web app can't be reached now.";
  wasOn = on && serving;
  let qr: string | null = null;
  try { if (link && on && !why) qr = qrFile(DATA, link); } catch {}
  const serve = serveNow();
  writeFileSync(join(DATA, "web.json"), JSON.stringify({ on, link, qr, why, share_error: shareWhy, https_port: hp, serve, at: Date.now() }) + "\n");
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
    const p = spawn([cli, "web", "serve-from", machine ?? "here", "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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
// shepherdr web https-port changed the port: move the share and the links within seconds, not at the next minute
watchFile(HTTPS_PORT_FILE, { interval: 2000 }, () => { if (httpsPort() !== hp) void tailnet(); });
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

// what a voice call reads of a chat
function chatView(addr: string): ChatView {
  const items = () => (compat.reader?.(addr)?.conv?.items ?? []) as any[];
  return {
    lastReply: () => { const x = [...items()].reverse().find((i) => i.kind === "agent" && i.text); return x ? { id: x.id, text: x.text, at: typeof x.at === "number" ? x.at : undefined } : null; },
    status: () => (hub.terminals.get(addr) as any)?.status?.state ?? null,
    asking: () => asks.of(addr)[0]?.words?.title ?? null,
  };
}

/** Keeps a chat read (service/chats.ts) while something needs it: a voice call, or a tool reading another chat. The
 *  first read has come once ready resolves; stop() lets it go (dropped a minute after, as a page's). */
function follow(addr: string) {
  let first: () => void = () => {};
  const ready = new Promise<void>((r) => { first = r; });
  const page = () => first();
  live.chats?.watch(addr, page);
  return { ready, stop: () => live.chats?.unwatch(addr, page) };
}

/** What a voice call hears (voice-hear.ts): any chat by its key, kept read while it follows it. */
const hearIO: HearIO = {
  snap: () => shown ?? compat.last,
  view: (key) => { const addr = compat.addrOf(key); return addr && !addr.startsWith("log:") ? chatView(addr) : null; },
  follow: (key) => { const addr = compat.addrOf(key); return addr ? follow(addr) : { stop: () => {} }; },
};

/** What a voice call's tools reach (service/voice-tools.ts): what the web app shows and does. */
const voiceIO: VoiceIO = {
  snap: () => shown ?? compat.last,
  async chat(key) {
    const addr = compat.addrOf(key);
    if (!addr) return null;
    const f = follow(addr);
    try {
      await Promise.race([f.ready, Bun.sleep(8000)]);
      const r = compat.reader?.(addr);
      if (!r) return null;
      const t: any = hub.terminals.get(addr);
      const items = () => ((r.conv?.items ?? []) as any[])
        .filter((i) => (i.kind === "user" || i.kind === "agent" || i.kind === "ask") && typeof i.text === "string" && i.text.trim())
        .map((i) => ({ who: (i.kind === "user" ? (i.from ? "news" : "you") : "agent") as "you" | "agent" | "news", text: String(i.text), at: typeof i.at === "number" ? i.at : undefined }));
      const out = { status: t?.status?.state ?? null, doing: r.conv?.doing ?? t?.status?.message ?? null, items: items(),
        earlier: async () => { const more = await r.earlier().catch(() => false); if (more) out.items = items(); return !!more; } };
      return out;
    } finally { f.stop(); }
  },
  async send(key, text) { await act(hub, { type: "send", chat: key, text, human: true }, compat); note("message.sent", { chat: key, how: "talk" }); },
  async action(body) {
    const answeredAt = Date.now();
    const r = await doAction(body);
    const text = await r.text();
    if (!r.ok) throw new Error(text.trim() || "That didn't go through.");
    let result: any;
    try { result = JSON.parse(text); } catch { result = { ok: true }; }
    if (result?.ok !== false && body.type === "answer" && body.byVoice === true && typeof body.question === "string" && typeof body.chat === "string" && typeof body.voiceAnswer === "string") {
      const entry = { id: body.question, chat: body.chat, text: body.voiceAnswer.slice(0, 4000), at: answeredAt };
      await store.update((v) => ({ ...v, "voice.answers": [...(Array.isArray(v["voice.answers"]) ? v["voice.answers"] as any[] : []).filter((x: any) => x.id !== entry.id), entry].slice(-200) })).catch(() => {});
      live.chats?.refreshAll();
    }
    return result;
  },
  addrOf: (key) => compat.addrOf(key),
  // #1509: the open artifact's page, as the app serves it (its own folder only; another machine's from there)
  async page(id, v, machine) {
    const r = await artifacts.file(id, v, ["index.html"], machine, null, {});
    return r.ok ? await r.text() : null;
  },
  taskWhere: (id) => { const t = compat.taskOf(id); return t ? { ref: t.ref, folder: t.folder, machine: t.machine } : null; },
  // SHEP-110: the web app's other reads (voice-data.ts SOURCES), each as the panel that shows it reads it
  async read(source, a) {
    const action = async (body: Record<string, unknown>) => {
      const r = await doAction(body), text = await r.text();
      if (!r.ok) throw new Error(text.trim() || "It couldn't be read.");
      const out = JSON.parse(text);
      if (out?.ok === false && out.error) throw new Error(String(out.error));
      return out;
    };
    // a task's folder (its worktree), else a space's: what its Files, Changes and Pull request tabs read
    const tree = () => {
      const t = a.task ? compat.taskOf(a.task) : null;
      if (t) return t.where;
      const sp = a.place ? compat.spaceOf(a.place) : null;
      if (sp) return { folder: sp.folder, machine: sp.machine };
      throw new Error("Which task or space?");
    };
    const path = String(a.path ?? "").replace(/^\/+/, "");
    if (/(^|\/)(\.env[^/]*|\.netrc|\.npmrc|\.pypirc|id_[a-z0-9]+|[^/]*\.(pem|key|p12|pfx)|credentials[^/]*|secrets?[^/]*)$/i.test(path)) throw new Error("That file may hold secrets: I don't read it out.");
    switch (source) {
      case "evidence": return action({ type: "evidence", task: a.task });
      case "changes": return worktree(hub, tree(), "diff");
      case "patch": return worktree(hub, tree(), "patch", path);
      case "pr": return worktree(hub, tree(), "pr");
      case "files": return worktree(hub, tree(), "dir", path || undefined);
      case "file": if (!path) throw new Error("Which file? Put its path after file/."); return worktree(hub, tree(), "file", path);
      // (3.2: an artifact is a page of its own, service/artifacts.ts: nothing here reads one out yet)
      case "artifact": throw new Error("An artifact's page can't be read out yet: open it instead.");
      case "activity": {
        const addr = a.chat ? compat.addrOf(a.chat) : null;
        if (!addr) throw new Error("That chat isn't running.");
        const f = follow(addr);
        try {
          await Promise.race([f.ready, Bun.sleep(8000)]);
          const r: any = compat.reader?.(addr);
          const turns = ((r?.conv?.items ?? []) as any[]).filter((i) => i.kind === "tools").slice(-3);
          return Promise.all(turns.map((x) => activity(r, x.id)));
        } finally { f.stop(); }
      }
      case "model": return action({ type: "restart-info", chat: a.chat });
      case "models": return action({ type: "role-info" });
      case "template": return action({ type: "template", role: a.role });
      case "hosts": return action({ type: "machine-hosts" });
      case "folders": {
        const machine = a.machine ?? null;
        const home = (await exec(hub, ["sh", "-c", 'printf %s "$HOME"'], machine).catch(() => ({ stdout: "" }))).stdout;
        return folders(hub, machine, path || "~", home);
      }
      case "me": return { machine: me?.host ?? null, link: ownLink(), version: VERSION, off: offPlugins() };
      // personal analytics, as `herdr-task analytics` sums them up (service/analytics.ts)
      case "insights": return action({ type: "analytics", do: "show", days: path === "day" ? 1 : path === "week" ? 7 : 30 });
    }
    throw new Error(`No such data: ${source}.`);
  },
};


/** The person's calls on a task that change its state (its list says so): read again once done (model.reread). */
const TASK_ACTS = new Set(["accept", "close", "delete", "archive", "reopen", "task-resume", "task-start", "task-move", "task-rename", "schedule"]);

/** One of the web app's actions (an Action, POST /api/action), as the page sends it: a voice call's acts go here too. */
async function doAction(body: any): Promise<Response> {
  // an artifact's own actions: delete, rename, pin, restore a version, keep a proof, a note with its spot, an answer
  if (typeof body?.type === "string" && body.type.startsWith("artifact-")) {
    const done = await artifactAction(body).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (done) { void artifacts.read(); return json(done); }
  }
  // Settings › Personal analytics, and the page's own events for it (service/analytics.ts)
  if (body?.type === "analytics") {
    try { return json(await analyticsAction(body, (key, value) => { setConfig("all", key, value); model.rebuild(); })); }
    catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // 3.2's settings window: one value for everything ("all") or a space; null puts a space's row back (Reset)
  if (body?.type === "config" && typeof body.key === "string") {
    try {
      const place = typeof body.place === "string" ? body.place : "all";
      // a repo's (SHEP-335): a space sitting on it goes along, for what a file not moved yet still keeps there
      const sp = place === "all" ? null : (model.spaces as any[]).find((x) => (place.startsWith("repo:") ? spaceRepo(x) === place.slice(5) : x.id === place));
      setConfig(place, body.key, body.value ?? null, sp ? { id: sp.id, name: sp.name, machine: sp.machine ?? null, folder: sp.folder ?? null, repo: spaceRepo(sp) } : null);
      note("settings.changed", { key: body.key, space: place === "all" ? undefined : place });
      model.rebuild();
      return json({ ok: true });
    } catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // the picker's lists: a machine's agents and each one's own models, efforts, speeds and permission modes
  if (body?.type === "catalog") {
    const machine = !body.machine || body.machine === me?.host ? null : String(body.machine);
    try {
      let check: any = {};
      try { check = JSON.parse(readFileSync(where()["cli-check"], "utf8"))?.machines?.[machine ?? ""] ?? {}; } catch {}
      return json({ ok: true, catalog: catalogOf(machine ?? me?.host ?? "", (await compat.agents!.choices(machine)) as any[], { claude: check.claude !== "missing", codex: check.codex !== "missing" }) });
    } catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // a screen's own actions: Take over, Hand back (or "I'm done"), Skip, a screenshot kept, Open on the desktop instead
  if (body?.type === "screen" && typeof body.key === "string") {
    if (!pluginOn("screens")) return json({ ok: false, error: "Screens is switched off in Settings › Plugins." });
    try {
      const r: any = await screens.screenAction(body);
      // what the agent is told (to look again and carry on, or to find another way)
      if (r?.send?.address) await hub.send(r.send.address, r.send.text).catch(() => null);
      model.rebuild();
      const { send: _s, ...rest } = r ?? {};
      return json({ ok: true, ...rest });
    } catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // a schedule's own menu: Run now, Pause, Resume; Edit sends the new words to that space's agent, which sets the
  // trigger exactly as when it is asked in a chat (if it can't make sense of them it says so there, and the schedule
  // keeps running as before)
  if (body?.type === "automation" && typeof body.id === "string") {
    const at = scheduleOf(body.id);
    if (!at) return json({ ok: false, error: "That schedule isn't here any more." });
    const tool = async (args: string[]) => {
      const p = spawn(["herdr-task", ...(at.machine ? ["--on", at.machine] : []), "auto", ...args, "--folder", at.folder, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      let j: any = null;
      try { j = JSON.parse(out); } catch {}
      if ((await p.exited) !== 0 || j?.error) throw new Error(j?.error ?? (err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "The schedule didn't change."));
    };
    try {
      if (body.op === "run") await tool(["run-now", at.id]);
      else if (body.op === "pause") await tool(["pause", at.id]);
      else if (body.op === "resume") await tool(["resume", at.id]);
      else if (body.op === "edit") {
        const agentArgs = body.agent ? scheduleAgentArgs(body.agent) : [];
        if (agentArgs.length && !body.when && !body.what && !body.to) {
          await tool(["edit", at.id, ...agentArgs]);
          void model.refresh();
          return json({ ok: true });
        }
        const sp = (model.spaces as any[]).find((x) => x.id === body.place);
        if (!sp) throw new Error("Its space isn't here any more.");
        const to = typeof body.to === "string" ? (model.spaces as any[]).find((x) => x.id === body.to) : null;
        const word = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 2000) : "");
        const lines = [word(body.when) && `- when it runs: ${word(body.when)}`, word(body.what) && `- what to do: ${word(body.what)}`, to && `- its space: ${to.name}${to.machine ? ` on ${to.machine}` : ""} (${to.folder})`,
          agentArgs.length && `- its agent choices: include these exact arguments in the same auto edit command: ${agentArgs.map((arg) => arg.startsWith("--") ? arg : JSON.stringify(arg)).join(" ")}`].filter(Boolean);
        if (!lines.length) return json({ ok: true });
        const text = `Change the schedule “${word(body.name)}” (herdr-task auto id ${at.id}, in ${at.folder}):\n${lines.join("\n")}\nSet it with herdr-task auto edit. If you can't make sense of the words, say so here and leave the schedule as it is.`;
        return json(await act(hub, { type: "send", chat: placeKey(sp.id), text, human: true, cid: `sched-${Date.now().toString(36)}` }, compat));
      } else return json({ ok: false, error: "A schedule can't do that." });
      void model.refresh();
      return json({ ok: true });
    } catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // Everything is never removed or archived (SHEP-296): refused before any of its tasks is stopped
  if ((body?.type === "space-remove" || (body?.type === "space-archive" && body.on !== false)) && typeof body.place === "string" && body.place === SPm.everythingOf(model.spaces, HOME)?.id) {
    return json({ ok: false, error: SPm.EVERYTHING_STAYS });
  }
  // archive a space (out of the list, its schedules stopped, nothing deleted) or bring it back
  if ((body?.type === "space-archive" || (body?.type === "space-remove" && body.stop)) && typeof body.place === "string") {
    // the working tasks there are stopped first (the confirmation named them)
    const sp = (model.spaces as any[]).find((x) => x.id === body.place);
    if (sp && body.on !== false) {
      const bare = String(sp.id).split("/").pop();
      // a task that would not stop, or schedules that would not pause: said plainly, and the space stays as it is
      const failed: string[] = [], stopped: string[] = [];
      for (const r of (model.rows as any[]).filter((x) => x.section === "working" && (x.space ? x.space === sp.id : (x.machine ?? null) === (sp.machine ?? null) && x.folder === sp.folder))) {
        const out: any = await act(hub, { type: "stop", chat: `${r.machine ? `${r.machine}:${r.ref}` : r.ref}/worker` }, compat).catch((e) => ({ ok: false, error: (e as Error).message }));
        if (out?.ok === false) failed.push(r.title); else stopped.push(r.title);
      }
      const stoppedWords = stopped.length ? ` ${stopped.map((t) => `“${t}”`).join(", ")} ${stopped.length === 1 ? "was" : "were"} stopped.` : "";
      if (failed.length) return json({ ok: false, error: `Couldn't stop ${failed.map((t) => `“${t}”`).join(", ")}. Nothing was ${body.type === "space-remove" ? "removed" : "archived"}.${stoppedWords} Try again.` });
      // an archived or removed space's schedules stop
      const paused = await spawn(["herdr-task", ...(sp.machine ? ["--on", sp.machine] : []), "auto", "pause", "--space", bare, "--all", "--folder", sp.folder, "--json"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).exited.catch(() => 1);
      if (paused !== 0) return json({ ok: false, error: `Couldn't stop its schedules. Nothing was ${body.type === "space-remove" ? "removed" : "archived"}.${stoppedWords} Try again.` });
    } else if (sp && body.type === "space-archive") {
      await spawn(["herdr-task", ...(sp.machine ? ["--on", sp.machine] : []), "auto", "resume", "--space", String(sp.id).split("/").pop()!, "--all", "--folder", sp.folder, "--json"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).exited.catch(() => null);
    }
  }
  if (body?.type === "space-archive" && typeof body.place === "string") {
    const bar = { ...((model.value("spaces-chat") as any) ?? {}) };
    const was: string[] = Array.isArray(bar.archived) ? bar.archived : [];
    bar.archived = body.on === false ? was.filter((x) => x !== body.place) : [...new Set([...was, body.place])];
    await store.set("spaces-chat", bar);
    model.rebuild();
    return json({ ok: true });
  }
  if (body?.type === "secret" && typeof body.name === "string" && typeof body.level === "string") {
    // a value goes straight to the vault (herdr-secret set, from stdin); the agent hears its name only
    try {
      // the asking agent by the card's own id: a task's ask shows in its Assistant's chat too, whose chat isn't the asker's
      const asker = body.card && typeof body.card.id === "string" ? secrets.asks().find((a) => a.id === body.card.id)?.address : undefined;
      const card = body.card && typeof body.card.chat === "string" ? { address: asker ?? compat.addrOf(body.card.chat) ?? "" } : undefined;
      if (card && !card.address) throw new Error("That agent isn't here any more.");
      await secrets.keep(body.level, body.name, typeof body.value === "string" ? body.value : null, card);
      if (body.name === "ELEVENLABS_API_KEY") forgetKey();
      await refreshSecrets();
      return json({ ok: true });
    } catch (err) { return new Response((err as Error).message, { status: 400 }); }
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
  if (body?.type === "setting" && typeof body.key === "string") {
    try {
      // a space's own: its name, machine and repo folder go with it (herdr-task finds a space's settings by folder)
      const level = typeof body.place === "string" ? body.place : "all";
      const sp = level !== "all" && !level.startsWith("m:") ? model.spaceById(level) : null;
      const folder = sp ? (await exec(hub, ["git", "-C", sp.folder || "~", "rev-parse", "--show-toplevel"], sp.machine ?? null).catch(() => null))?.stdout.trim() || sp.folder : null;
      let value = typeof body.value === "string" ? body.value : null;
      // Home Assistant's Make home space (and turning it on): herdr-task's home round makes one
      const home = /^machine\.(makehome|home)@([\w.-]+)$/.exec(body.key);
      if (home && (home[1] === "makehome" || value === "on")) await store.set("home.makereq", { machine: home[2] === "local" ? null : home[2], at: Date.now() });
      if (home?.[1] === "makehome") return json({ ok: true });
      // Extra flags (#1222): herdr-task checks them and says how it keeps them (a list); "none": none, empty: the level above's
      const fl = /^tasks\.(claude|codex)_flags$/.exec(body.key);
      if (fl && value !== null) value = /^\s*none\s*$/i.test(value) ? "[]" : value.trim() ? JSON.stringify(await checkFlags(fl[1], value)) : null;
      // Base branch: checked before it's saved, here or on origin as git last fetched it
      if (body.key === "tasks.base" && value?.trim()) {
        const want = value.trim();
        const there = SC.branchShape(want) && sp && (await Promise.all([`refs/heads/${want}`, `refs/remotes/origin/${want}`].map((ref) =>
          exec(hub, ["git", "-C", folder || sp.folder || "~", "show-ref", "--verify", "--quiet", ref], sp.machine ?? null).catch(() => null)))).some((r) => r?.code === 0);
        if (!there) return json({ ok: false, error: SC.BASE.missing(want) });
      }
      settings.set(body.key, value, level, sp ? { id: sp.id, name: sp.name, machine: sp.machine ?? null, folder, repo: spaceRepo(sp) } : null);
      // a machine's start limits (#1547): its card and meters show the new ones now, not at the next read
      if (body.key.startsWith("machine.")) machines.rehold();
      model.rebuild();
      return json({ ok: true });
    } catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  if (body?.type === "template" && typeof body.role === "string") {
    try { return json({ ok: true, text: settings.template(body.role, typeof body.text === "string" ? body.text : undefined) }); }
    catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  // Settings › Voice's test: whether the ElevenLabs key works, in plain words (never the key)
  if (body?.type === "voice-check") return json(await checkVoiceKey(hub));
  if (body?.type === "limits-check") { await machines.checkNow(); return json({ ok: true }); }
  if (body?.type === "secrets-move") {
    // Settings › Secrets › Kept on: the vault moves (shepherdr secrets move-to); the page sees it as it goes
    const m = HCORE.pickedMachine(body.machine, home.me?.name);
    if (m !== null && !home.machines.has(m)) return json({ ok: false, error: "That machine isn't linked." });
    if (secretsMoving && !secretsMoving.error) return json({ ok: false, error: `Already moving them to ${secretsMoving.to}.` });
    void moveSecrets(m).catch(() => {});
    return json({ ok: true });
  }
  if (body?.type === "serve-from") {
    // Settings › Web's Serve from: the move runs on (the page sees it in Settings › Web as it goes)
    const m = HCORE.pickedMachine(body.machine, host.me?.name);
    if (m !== null && !host.machines.has(m)) return json({ ok: false, error: "That machine isn't linked." });
    if (moving && !moving.error) return json({ ok: false, error: `Already moving it to ${moving.to}.` });
    void serveFrom(m).catch(() => {});
    return json({ ok: true });
  }
  if (body?.type === "role-info") {
    // Settings › Agents' model menu: every installed CLI's models, levels, Fast and
    // permission modes, and the person's pinned and recent models
    try { if (!settings.choices) await readDefaults(); return json({ ok: true, menus: settings.choices?.menus ?? {}, permDefault: settings.choices?.permDefault ?? {}, picks: (compat.agents as any).picks(), clis: await compat.agents!.choices(null) }); }
    catch (err) { return json({ ok: false, error: (err as Error).message }); }
  }
  try {
    // a task acted on: where its list is, to read it again once it is done (below)
    const ref = typeof body?.task === "string" ? body.task : typeof body?.chat === "string" ? body.chat.split("/")[0] : null;
    const onTask = TASK_ACTS.has(body?.type) && ref ? compat.taskOf(ref) : null;
    const r = await act(hub, body, compat);
    // personal analytics: that it happened and how, never what was said (service/analytics.ts)
    if (body?.type === "send" && typeof body.chat === "string" && !body.was) note("message.sent", { chat: body.chat, how: howOf(body.how) });
    else if (body?.type === "answer" && typeof body.chat === "string")
      note("question.answered", { chat: body.chat, how: body.byVoice || body.talk ? "talk" : typeof body.choice === "number" || Array.isArray(body.choices) ? "pick" : "typed" });
    // the list of spaces changed (renamed, removed): shown in the answer's snapshot, not at the next event
    if (body?.type === "rename" || body?.type === "space-remove") model.rebuild();
    // a task on another machine: its new state read now, so the card changes with this answer, not up to 10 s later
    // (bounded: a slow link still answers)
    if (onTask?.machine && (r as any)?.ok !== false) await Promise.race([model.reread(onTask.machine), Bun.sleep(4000)]);
    return json(r);
  } catch (err) { return new Response((err as Error).message, { status: 400 }); }
}

/** The tailnet device a request came from (tailscale serve's forwarded address, as its node's id), or null: this
 *  machine's own callers (the CLI) aren't a device of the tailnet. */
async function deviceFrom(req: Request, via: "tailnet" | "local") {
  const ip = via === "tailnet" ? forwardedFrom(req) : null;
  return ip ? await deviceOf(ip) : null;
}

const server = Bun.serve<{ who: string }>({
  hostname: "127.0.0.1",
  port: PORT,
  // a send with many pictures (copied to another machine, Claude Code reading each) can take longer than Bun's 10 s
  // default: cut off, the page took it as failed while it still went in (SHEP-93)
  idleTimeout: 180,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.startsWith("/shepherdr/") ? url.pathname.slice(10) : url.pathname;
    // the CLI asks this (bin/shepherdr): jobs says this service runs the background work
    if (path === "/api/health") return json({ ok: true, app: "shepherdr", ...(localCaller(req, PORT) ? { id: SERVICE_ID, calls: callsOn() } : {}), version: VERSION, core: hub.up, jobs: jobs.on && hub.up, serving: host.serving(), host: host.hubName() ?? null, reachable: host.reachable(),
      // the other machines this service ticks (Serve from: the host the ones with no service of their own)
      ticks: jobs.on ? host.tickOn() : [] });
    // SHEPHERDR_WEB=off: nothing for the tailnet (this machine's own callers still get the API)
    if (req.headers.has("tailscale-user-login") && !webOn()) return new Response("Shepherdr's web app isn't shared from this service.", { status: 404 });
    // another machine serves it now (Serve from): a page that still comes here goes there
    if (req.headers.has("tailscale-user-login") && !host.serving()) {
      const there = host.hostLink();
      return there ? Response.redirect(there, 302) : new Response("Shepherdr's web app is served from another machine now.", { status: 404 });
    }
    // Share into Shepherdr (SHEP-345): the app's service worker takes a share; one that reaches here came before the
    // worker was up, and the app says to share it again (nothing is read, so no gate is needed)
    if (path === "/share" && req.method === "POST") return new Response(null, { status: 303, headers: { location: "./?share=lost" } });
    const socket = path === "/api/ws" || path === "/api/terminal" || path === "/api/screen" || path === "/api/desktop" || path === "/api/voice";
    const viaTailnet = req.headers.has("tailscale-user-login");
    // the glance feed (SHEP-246) is read by the phone's own app: checked as a write (its origin, x-shepherdr: 1)
    const native = path === "/api/glance" && url.searchParams.get("native") === "1";
    const trusted = viaTailnet && trustedPeer(srv.requestIP(req)?.port, PORT, () => settings.webIgnoreAccounts());
    const pass = gate(req, g, socket, trusted, path === "/api/glance" || path === "/api/chat");
    if (!pass.ok) {
      const why = refusedWhy(pass.why);
      if (why !== pass.why && why !== saidPeer) console.error(`web: ${(saidPeer = why)}`);
      return new Response(why, { status: pass.status });
    }
    if (path === "/api/screen" || path === "/api/desktop") {
      // an agent's browser tab or desktop, live (the Screens plugin): relayed from this machine only, never a raw port
      const key = (url.searchParams.get("key") ?? "").slice(0, 300);
      if (!pluginOn("screens") || !/^(chat|task|machine):[\w.:/#~-]+$/.test(key)) return new Response("no such screen", { status: 404 });
      const desk = path === "/api/desktop";
      return srv.upgrade(req, { ...(desk ? { headers: { "Sec-WebSocket-Protocol": "binary" } } : {}), data: { who: pass.who, [desk ? "desktop" : "screen"]: key } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (path === "/api/terminal") {
      // a live terminal (2.1's terminal plugin): only a running one a chat names
      const asked = url.searchParams.get("chat") ?? "";
      // your own terminal (sh:<space>, sh:task:<task>): the shell kept for it, a fresh one when it has none
      if (asked.startsWith("sh:")) {
        const at = pluginOn("terminal") ? shellAt(asked) : null;
        if (!at) return new Response("no such terminal", { status: 404 });
        let own: string;
        try { own = await ensureShell(hub, asked, at); } catch (e) { return new Response((e as Error).message, { status: 503 }); }
        return srv.upgrade(req, { data: { who: pass.who, term: own, own: true } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const term = compat.addrOf(asked);
      if (!term || term.startsWith("log:") || hub.terminals.get(term)?.state !== "live") return new Response("no such terminal", { status: 404 });
      return srv.upgrade(req, { data: { who: pass.who, term } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (path === "/api/voice") {
      // a voice call with Shepherdr (the Voice plugin, SHEP-105): from anywhere; chat, the chat whose call button
      // started it (its "here" while the screen shows no chat), if it is running
      if (!pluginOn("voice")) return new Response("no calls here", { status: 404 });
      const asked = (url.searchParams.get("chat") ?? "").slice(0, 300), addr = asked ? compat.addrOf(asked) : null;
      const key = addr && !addr.startsWith("log:") ? asked : null;
      // SHEP-102: a page whose socket dropped (a locked phone) comes back to its call with the call's id
      const resume = (url.searchParams.get("resume") ?? "").slice(0, 64);
      // the device it is on: Shepherdr Wake takes a call over from its own device's page only (SHEP-251)
      const from = await deviceFrom(req, pass.via);
      return srv.upgrade(req, { data: { who: pass.who, from, voice: { key, resume } } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (socket) {
      // the device a page is on (a wake word reaches only its own device's pages, SHEP-240)
      const from = await deviceFrom(req, pass.via);
      return srv.upgrade(req, { data: { who: pass.who, from } as any }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (path === "/api/me") return json({ login: pass.who, via: pass.via, machine: me?.host ?? null, link: ownLink(), version: VERSION, off: offPlugins() });
    if (path === "/api/state" && req.method === "GET") return json(store.doc.version ? store.doc : await store.load());
    if (path === "/api/state" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.key !== "string" || !/^[a-z][\w.-]{0,63}$/.test(body.key)) return json({ error: "bad key" }, 400);
      return json(await store.set(body.key, body.value ?? null));
    }
    // a file a chat shows (an image sent in it), on this machine: only one that chat's messages name, or one uploaded
    // here (/api/upload: in the message box, or on its way to an agent on another machine)
    if (path === "/api/file") {
      const key = url.searchParams.get("chat") ?? "", want = url.searchParams.get("path") ?? "";
      const upload = want.startsWith(ATTACH + "/") && !want.slice(ATTACH.length + 1).includes("/") && !!statSync(want, { throwIfNoEntry: false })?.isFile();
      const at = upload ? want : compat.fileOf(key, want);
      const addr = compat.addrOf(key) ?? "", on = !upload && addr.includes("/") ? addr.split("/")[0] : null;
      // (another machine's agent may name one in its home: ~/…, read there)
      if (!at || !(at.startsWith("/") || (on && at.startsWith("~/"))) || at.includes("/../") || (!on && !existsSync(at))) return json({ error: "not found" }, 404);
      const named: Record<string, string> = url.searchParams.get("download") ? { "content-disposition": `attachment; filename="${at.split("/").pop()!.replace(/"/g, "")}"` } : {};
      const range = req.headers.get("range"), type = Bun.file(at).type || "application/octet-stream";
      if (on) {
        // a chat on another machine (one this machine serves the web app for): the file there, through herdr-core; kept
        // a little while, as a player asks for it part by part (service/media.ts)
        const k = `${on}\0${at}`;
        let bytes = keep(k);
        if (!bytes) {
          const argv = at.startsWith("~/") ? ["sh", "-c", 'cat -- "$HOME/$1"', "cat", at.slice(2)] : ["cat", "--", at];
          const r = await hub.call<{ code: number; stdout: string; truncated?: boolean }>("machine.exec", { on, argv, timeout: 30 }, 35_000).catch(() => null);
          if (!r || r.code !== 0 || r.truncated) return json({ error: "not found" }, 404);
          bytes = keep(k, new Uint8Array(Buffer.from(r.stdout, "base64")))!;
        }
        return fileResponse(new Blob([bytes as Uint8Array<ArrayBuffer>]), type, range, named);
      }
      // a big picture's thumbnail, a video's still (made here once: service/media.ts); the file itself when it has none
      const small = url.searchParams.get("thumb") ? await smaller(at, "thumb") : url.searchParams.get("poster") ? await smaller(at, "poster") : null;
      if (url.searchParams.get("poster") && !small) return json({ error: "no still" }, 404);
      if (small) return fileResponse(Bun.file(small), "image/jpeg", range);
      return fileResponse(Bun.file(at), type, range, named);
    }
    // an artifact's page, its files and its picture (service/artifacts.ts artifactRoute)
    const art = path.startsWith("/api/artifacts/") ? await artifactRoute(req, url) : null;
    if (art) return art;
    if (path === "/api/screen/shot") {
      // the picture now of an agent's browser tab or desktop: a card's and a thread's small live picture
      const shot = pluginOn("screens") ? await screens.shotOf((url.searchParams.get("key") ?? "").slice(0, 300), url.searchParams.get("src") === "d" ? "d" : "b").catch(() => null) : null;
      return shot ? new Response(shot.body as any, { headers: { "content-type": shot.type, "cache-control": "no-store" } }) : new Response("no picture", { status: 404 });
    }
    if (path === "/api/upload" && req.method === "POST") {
      // a file from the message box (+, the camera, a paste or a drop): kept in data/chat-attach until it goes with a message as its path (another machine's agent gets a copy there)
      const form = await req.formData().catch(() => null);
      const f = form?.get("file");
      if (!(f instanceof File) || f.size > 25 * 1024 * 1024) return json({ error: "A file of at most 25 MB." }, 400);
      const dir = ATTACH;
      mkdirSync(dir, { recursive: true });
      const name = `web-${Date.now().toString(36)}-${(f.name || "file").replace(/[^\w.-]+/g, "-").replace(/^[-.]+/, "").slice(-80) || "file"}`;
      await Bun.write(join(dir, name), f);
      return json({ path: join(dir, name), name: f.name });
    }
    if (path === "/api/dictate" && req.method === "POST") {
      try { return json({ text: await dictate(hub, await req.blob(), fetch, undefined, url.searchParams.getAll("word")) }); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    // live dictation: a single-use token as the page starts recording (the words are written while it records)
    if (path === "/api/dictate/live" && req.method === "POST") {
      try { return json({ token: await liveToken(hub) }); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/commands") {
      // the "/" list above the box (core/slash.js): its CLI's commands, and for Claude Code the person's own
      const a = compat.addrOf(url.searchParams.get("chat") ?? ""), t: any = a ? hub.terminals.get(a) : null;
      if (!a || !t) return json({ commands: [] });
      const kind = kindOf(t) ?? "claude", machine = a.includes("/") ? a.split("/")[0] : null;
      const mine = kind === "claude" ? scanned((await sh(hub, SCAN, ["scan", t.foreground?.cwd ?? t.cwd ?? ""], machine).catch(() => ({ stdout: "" }))).stdout) : [];
      return json({ commands: commandList(kind, mine), menus: [...(MENU[kind] ?? [])] });
    }
    if (path === "/api/reach") {
      // the "#" list above the box (core/mentions.js): the spaces the machine running this chat's agent can reach, from
      // its herdr-task reach map (what tell-assistant follows); a chat with no agent yet: its space's machine
      const key = url.searchParams.get("chat") ?? "", a = compat.addrOf(key);
      const sp = !a ? compat.allSpaces().find((s) => placeKey(s.id) === key) : null;
      const machine = a ? (a.includes("/") ? a.split("/")[0] : null) : sp?.machine ?? null;
      return json(await reachOf(machine));
    }
    if (path === "/api/machines/find") return json(await findMachines(req.method === "POST"));
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
        // an emoji or a picture, checked (core/space-icon.js)
        const icon = iconValue(b?.icon);
        // the name typed and the agent picked in the New space dialog (none: named after its folder, on Settings' choice)
        const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : undefined;
        const picked = pickFrom(b?.agent);
        const made = await newSpace(hub, { machine, path: String(b?.path ?? ""), ...(name ? { name } : {}), makeRepo: !!b?.makeRepo, icon, others: model.hasOthers(), store: compat.shared!, pick: picked ? () => picked : compat.assistantPick, keepPick: !!picked });
        if (made.error) console.error(`new space ${made.place}: ${made.error}`);
        // the page opens it once the sidebar has it: in the snapshot before the answer
        await model.waitSpace(made.place);
        // its agent didn't start: made, not a plain ok; the page opens it and says why (warning)
        // a folder with its space already (SHEP-296): that one opens, said, never a second space there
        if ("existed" in made) return json({ place: made.place, existed: true, warning: existedWords(made, machine) });
        return json(made.error ? { place: made.place, ok: false, warning: made.error } : { place: made.place });
      } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/push/key") return json({ key: await push.key() });
    if (path === "/api/waiting") return json(waitingNow);
    if (path === "/api/push/subscribe" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      try { push.subscribe(body?.sub, body?.device, typeof body?.from === "string" ? body.from : undefined, await deviceFrom(req, pass.via)); return json({ ok: true, ...push.state(body.sub.endpoint) }); } catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    // Settings › Notifications: this device's alerts as the server keeps them, turned off, chosen, tested
    if (path.startsWith("/api/push/") && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
      if (path === "/api/push/state") return json(push.state(endpoint));
      if (path === "/api/push/unsubscribe") { push.unsubscribe(endpoint); return json({ ok: true, ...push.state(endpoint) }); }
      if (path === "/api/push/choose") {
        try { return json({ ok: true, ...push.choose(endpoint, { topics: body?.topics, muted: body?.muted }, !!body?.all) }); } catch (err) { return json({ error: (err as Error).message }, 400); }
      }
      if (path === "/api/push/test") return json(await push.test(endpoint));
    }
    if (path === "/api/worktree") {
      // a task's worktree, or a space's own folder (space=<id>: only what isn't committed there)
      const t = compat.taskOf(url.searchParams.get("task") ?? "");
      const sp = t ? null : compat.spaceOf(url.searchParams.get("space") ?? "");
      const where = t?.where ?? (sp?.folder ? { folder: sp.folder, machine: sp.machine } : null);
      if (!where) return json({ error: t || url.searchParams.get("task") ? "No such task." : "No such space." }, 404);
      try { return json(await worktree(hub, where, url.searchParams.get("what") ?? "", url.searchParams.get("path") ?? undefined)); }
      catch (err) { return json({ error: (err as Error).message }, 400); }
    }
    if (path === "/api/files") {
      // Files (the files plugin, off by default): a space's folder, on the machine it lives on (service/files.ts)
      if (!pluginOn("files")) return json({ error: "Files is off in Settings › Plugins." }, 404);
      const sp = compat.spaceOf(url.searchParams.get("space") ?? "");
      if (!sp?.folder) return json({ error: "No such space." }, 404);
      const at = { folder: sp.folder, machine: !sp.machine || sp.machine === me?.host ? null : sp.machine };
      const what = url.searchParams.get("what") ?? "", rel = url.searchParams.get("path") ?? "";
      try {
        if (req.method === "GET" && what === "ls") return json(await files.list(hub, at, rel));
        if (req.method === "GET" && what === "read") return json(await files.read(hub, at, rel));
        if (req.method === "GET" && what === "file") return await files.file(hub, at, rel, url.searchParams.get("download") === "1");
        if (req.method === "GET" && what === "zip") return await files.zip(hub, at, rel);
        if (req.method === "POST" && what === "put") {
          const form = await req.formData().catch(() => null), f = form?.get("file");
          if (!(f instanceof File)) return json({ error: "No file came." }, 400);
          return json(await files.put(hub, at, rel, f, form?.get("replace") === "1"));
        }
        if (req.method === "POST" && what === "mv") {
          const b = await req.json().catch(() => null);
          return json(await files.move(hub, at, b?.from ?? "", b?.to ?? ""));
        }
      } catch (err) { return json({ error: (err as Error).message }, 400); }
      return json({ error: "Ask for ls, read, file, zip, put or mv." }, 400);
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
    if (path === "/api/action" && req.method === "POST") return doAction(await req.json().catch(() => null));
    if (path === "/api/glance" && req.method === "GET") {
      // the phone's and watch's small live feed (SHEP-246, docs/glance.md): the doc, or its stream (one frame per change)
      if (url.searchParams.get("stream") !== "1") {
        const doc = native ? glance.docFor(await deviceFrom(req, pass.via)) : glance.doc;
        return doc ? json(doc) : json({ error: "not ready yet" }, 503);
      }
      // a stream stays open all day: no idle cut (Bun's 180 s here; the ping comes every 240 s)
      srv.timeout(req, 0);
      return glance.stream(native ? await deviceFrom(req, pass.via) : null, native, req.signal);
    }
    if (path === "/api/chat" && req.method === "GET") {
      // a chat for the phone's and watch's own app (SHEP-447, docs/native-chat.md): a page of its messages, text only,
      // newest first
      const chats = live.chats;
      if (!chats) return json({ error: "not ready yet" }, 503);
      const key = url.searchParams.get("chat") ?? "";
      if (!key || key.length > 200) return json({ error: "which chat?" }, 400);
      const page = await chatPage({ addrOf: (k) => compat.addrOf(k), freshChat: (k) => (compat as any).freshChat?.(k) ?? null, chatOf: (k, r, t) => compat.chat(k, r, t),
        terminal: (a) => hub.terminals.get(a), watch: (a, w) => chats.watch(a, w), unwatch: (a, w) => chats.unwatch(a, w), earlier: (r) => r.earlier() },
        key, url.searchParams.get("before") || undefined, Number(url.searchParams.get("limit")) || undefined);
      return page ? json(page) : json({ error: "no such chat" }, 404);
    }
    if (path === "/api/open" && req.method === "POST") {
      // a tap on the phone app's alert (SHEP-246): the Shepherdr page already open on that device goes there in place, as
      // the wake does (SHEP-240), so the phone never makes Chrome build the page again. shown: false, held 15 s.
      const b = await req.json().catch(() => null);
      if (!openUrlOk(b?.url)) return json({ error: "Not a Shepherdr link: ./?place=… or ./#accept=…" }, 400);
      const from = await deviceFrom(req, pass.via);
      if (!from) return json({ error: "only from a device on the tailnet" }, 400);
      return json({ ok: true, shown: live.go(from, b.url) });
    }
    if (path === "/api/voice/wake" && req.method === "POST") {
      // a wake word heard on a phone (Shepherdr Wake, SHEP-240): its Shepherdr page already open starts a call, as
      // ?voice=1 would, without the phone opening a second page. shown: false, it waits 15 s for that page to show up.
      if (!pluginOn("voice")) return json({ error: "voice is off" }, 409);
      const from = await deviceFrom(req, pass.via);
      if (!from) return json({ error: "only from a device on the tailnet" }, 400);
      return json({ ok: true, shown: live.voiceWake(from) });
    }
    if (path === "/api/voice/handoff" && req.method === "POST") {
      // SHEP-251: the phone locks during a call on its page (Shepherdr Wake): the page lets go, the call holds, and
      // Wake comes back to it by its id (/api/voice?resume=<id>), as a page after a dropped socket does
      if (!pluginOn("voice")) return json({ error: "voice is off" }, 409);
      const from = await deviceFrom(req, pass.via);
      if (!from) return json({ error: "only from a device on the tailnet" }, 400);
      const id = handOff(from, String(pass.who ?? ""));
      return json(id ? { ok: true, id } : { ok: false });
    }
    if (path.startsWith("/api/")) return json({ error: "not found" }, 404);
    return file(path);
  },
  websocket: {
    open(ws) {
      const d: any = ws.data;
      const page = { send: (x: any) => { ws.send(x); }, close: () => ws.close(), buffered: () => ws.getBufferedAmount() };
      d.page = page;
      if (d.voice?.resume) {
        // back to a call that held for this page; gone (ended, or held too long): the page says so and stops
        d.bridge = callToResume(d.voice.resume, String(d.who ?? ""));
        if (!d.bridge?.attach(page, d.from ?? null)) { d.bridge = null; ws.send(JSON.stringify({ type: "ended", why: "the connection was lost" })); ws.close(); }
        return;
      }
      if (d.voice) d.bridge = voiceCall(hub, { io: voiceIO, hear: hearIO, where: { client: "web", call: d.voice.key, machine: me?.host ?? null },
        who: String(d.who ?? ""), from: d.from ?? null }, page);
      else if (d.term) d.bridge = terminalBridge(hub, d.term, page, !!d.own);
      else if (d.screen) d.bridge = screens.screenRelay(d.screen, page);
      else if (d.desktop) d.bridge = screens.desktopRelay(d.desktop, { send: (b: Uint8Array) => { ws.sendBinary(b); }, close: () => ws.close(), buffered: () => ws.getBufferedAmount() });
      else live.join(ws);
    },
    message(ws, msg) { const d: any = ws.data; if (d.voice || d.desktop) d.bridge?.message(msg); else if (d.bridge) d.bridge.message(String(msg)); else live.message(ws, String(msg)); },
    // a call's page that went without ending it holds the call for it to come back (SHEP-102)
    close(ws) { const d: any = ws.data; if (d.voice) d.bridge?.detach(d.page); else if (d.bridge) d.bridge.end(); else live.leave(ws); },
    // SHEP-173: a muted call sends nothing for minutes (Bun's default closes a quiet socket after 120 s); pages ping too
    idleTimeout: 600,
  },
});

console.log(`Shepherdr ${VERSION} on http://127.0.0.1:${server.port} (data ${DATA})${me && webOn() ? `, ${ownLink()}` : ""}`);

// the port is ours now: say where and this start's id (only this user can read it)
writeFileSync(SERVICE_FILE, JSON.stringify({ port: server.port, id: SERVICE_ID, pid: process.pid, version: VERSION }) + "\n", { mode: 0o600 });

// SHEP-173: an update while a call is on (bin/shepherdr) leaves this file instead of restarting the service, which
// would cut the call: the service starts again on the new code by itself once no call is on (launchd's KeepAlive,
// systemd's Restart=always bring it back).
const RESTART_WHEN_FREE = join(DATA, "restart-when-free");
try { rmSync(RESTART_WHEN_FREE); } catch {}
setInterval(() => {
  if (callsOn() || !existsSync(RESTART_WHEN_FREE)) return;
  console.log("Starting again on the update that waited for a call to end.");
  try { rmSync(RESTART_WHEN_FREE); } catch {}
  server.stop(true); try { rmSync(SERVICE_FILE); } catch {} release(); process.exit(0);
}, 5000);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { server.stop(true); try { rmSync(SERVICE_FILE); } catch {} release(); process.exit(0); });
