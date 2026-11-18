// Push alerts to phones and browsers that asked for them (2.1's alerts: the service worker web/public/sw.js shows
// them). Web Push with nothing but WebCrypto: a VAPID key pair kept owner-only in the service's folder (vapid.json), each
// alert encrypted for its subscription (RFC 8291, aes128gcm) and signed (RFC 8292, ES256). Subscriptions are kept in
// push.json. A device whose app is on screen gets none (the page says so over its socket).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, where } from "./paths.ts";
import * as T from "../core/toasts.js";
import { alertUrl, ACCEPT, choiceButtons, DEFAULT_TOPICS, notifies, notifyOf, pushTopics, REPLY, taskWho, WATCH_BODY, WATCH_TITLE, watchTitle, type PushAction, type PushTopic } from "../web/shared/alerts.ts";
import { excerpt } from "../web/shared/excerpt.ts";
import { unread } from "../web/shared/needs-you.ts";

/** a push alert; its buttons (SHEP-243) and what each does: answer a card, accept a task, reply in its chat */
type Out = {
  title: string; body: string; tag: string; topic: PushTopic; place?: string; waits?: true; url?: string;
  actions?: PushAction[]; answer?: { chat: string; question: string }; accept?: { task: string }; reply?: { chat: string; to?: string };
};

/**
 * What each push alert says, as the window's toasts (core/toasts.js): an agent that needs you, "HERD-4 · Needs you" or
 * "tt-repo Assistant · Needs you", why under it (an Assistant only by its space's Notify); a task whose agent finished,
 * ready to accept, "HERD-4 · Finished" under its name, a tap opening its Accept card; a task done; an Assistant's new
 * message (an Autopilot update when its Autopilot woke it: woke, the spaces whose wake was under way a moment ago).
 * Keyed so each goes once; each with its topic and space, which every device chooses by (Settings › Notifications).
 */
/** a need's alert key: one per card or wait */
export const needKey = (n: any) => `need:${n.chat}:${n.id}`;

/** what a need's alert says (whether it is sent or not: its space's Notify decides), in words that fit a watch */
export function needAlert(snap: any, n: any): Out {
  const who = n.task ? taskWho(snap, n.task) : T.assistantWho(snap.places?.find((p: any) => p.id === n.place)?.name);
  const go = alertUrl({ place: n.place, ...(n.task ? { task: n.task } : {}), ...(n.question?.id ? { focus: n.question.id } : {}) });
  // its card's choices as buttons; a question with none a button may send opens the app; no card: a reply
  const buttons = n.question ? choiceButtons(n.question) : [];
  const acts = n.question ? (buttons.length ? { actions: buttons, answer: { chat: n.chat, question: n.question.id } } : {})
    : n.secret ? {} : { actions: [REPLY], reply: { chat: n.chat, ...(n.reply ? { to: n.reply } : {}) } };
  return { title: watchTitle(T.toastTitle(who, T.NEEDS_YOU)), body: excerpt(T.needReason(n), WATCH_BODY), tag: n.task ?? n.chat, topic: "needs", place: n.place, waits: true, url: go, ...acts };
}

export function alertsOf(snap: any, woke: Set<string> = new Set(), said: (chat: string) => string | undefined = () => undefined): Map<string, Out> {
  const now = new Map<string, Out>();
  for (const n of snap.needs ?? []) {
    if (snap.settings && !notifies(snap, { go: { place: n.place }, task: n.task ? true : undefined })) continue;
    now.set(needKey(n), needAlert(snap, n));
  }
  // a task ready for the person's Accept (Ready is only that: one Settings merge by itself shows Working meanwhile,
  // core/tasks.js readyWait), the same Accept as the Tasks panel's
  for (const t of snap.tasks ?? []) if (t.status === "ready" && !t.archived)
    now.set(`ready:${t.id}`, { title: T.toastTitle(taskWho(snap, t.id), T.FINISHED), body: t.name, tag: t.id, topic: "ready", place: t.place, waits: true, url: `./#accept=${encodeURIComponent(t.id)}`,
      actions: [ACCEPT], accept: { task: t.id } });
  for (const t of snap.tasks ?? []) if (t.status === "done" && !t.archived)
    now.set(`done:${t.id}`, { title: T.toastTitle(taskWho(snap, t.id), "Done"), body: t.name, tag: t.id, topic: "done", place: t.place, url: alertUrl({ place: t.place, task: t.id }) });
  // an Assistant's new message (its chat's last moved on, not yet read), unless its space's Notify is Off
  for (const p of snap.places ?? []) {
    // unread as everywhere else (web/shared/needs-you.ts: Needs you lists it until read)
    if (!unread(snap, p.chat)) continue;
    const last = Number(snap.last[p.chat]);
    // its question already says so (Needs you)
    if ((snap.needs ?? []).some((n: any) => n.chat === p.chat)) continue;
    if (snap.settings && notifyOf(snap, p.id) === "Off") continue;
    const pilot = woke.has(p.id) || (p.pilot?.on && (p.pilot.inflight || p.pilot.pending));
    now.set(`msg:${p.chat}:${last}`, { title: T.toastTitle(T.assistantWho(p.name), pilot ? "Autopilot update" : "New message"), body: said(p.chat) || "Tap to read it.", tag: `msg:${p.chat}`, topic: pilot ? "autopilot" : "assistant", place: p.id, url: alertUrl({ place: p.id }), actions: [REPLY], reply: { chat: p.chat } });
  }
  // an agent's own alert (herdr-task alert), as its toast: a task's always, an Assistant's by its space's Notify
  for (const a of snap.alerts ?? []) if (a.notify) now.set(`alert:${a.id}`, { title: a.title, body: a.body, tag: `alert:${a.id}`, topic: "needs", ...(a.place ? { place: a.place, url: alertUrl({ place: a.place }) } : {}) });
  // short enough for a watch: its title on one line, its body in two
  for (const a of now.values()) { a.title = watchTitle(a.title); a.body = excerpt(a.body, WATCH_BODY); }
  return now;
}

/**
 * The agents' own alerts (`herdr-task alert "<title>" --body "<why>"`: the core label herdr.alert = { id, at, title,
 * body, task?, about? } on the agent's terminal), as the window's toasts say them (lib/inbox.js agentAlerts): "<who> ·
 * <title>" (60 characters at most) over its body (300), the chat it is from, and whether it reaches the person (a
 * task's agent or an alert about a task always; an Assistant's by its space's Notify). chatOf: a terminal's chat key.
 */
export function agentAlerts(terminals: Iterable<any>, snap: any, chatOf: (address: string) => string | null, home: string) {
  const out: { id: string; at: number; title: string; body: string; chat?: string; task?: string; place?: string; notify: boolean; ended?: true; machine?: string | null; memory?: true }[] = [];
  const all = [...terminals];
  for (const k of all) {
    let a: any = null;
    try { a = JSON.parse(k?.labels?.["herdr.alert"] ?? "null"); } catch {}
    if (!a?.id) continue;
    const chat = chatOf(k.address) ?? undefined;
    const task = chat?.includes("/") ? snap.tasks?.find((t: any) => t.id === chat.slice(0, chat.lastIndexOf("/"))) : null;
    const coord = !task && chat ? snap.places?.find((p: any) => p.chat === chat) : null;
    const ref = a.task ?? (task ? taskWho(snap, task.id) : null) ?? (k.labels?.["herdr.task"] ? (/^([a-z][a-z0-9]*-\d+)/.exec(k.name ?? "")?.[1] ?? "").toUpperCase() : "");
    const who = ref || (k.labels?.["herdr.role"] === "coordinator" || coord ? T.assistantWho(coord?.name) : k.program?.name ?? "Agent");
    // SHEP-255: the task it is about, so Tasks shows it on that task's row: its chat's task, else its herdr.task
    // label's (a task's own helper, by its name "<ref>-…" on its machine: a task here is "<ref>", elsewhere "<machine>:<ref>"); none: no task's, Chat and notifications only
    const machineOf = String(k.address ?? "").includes("/") ? String(k.address).slice(0, String(k.address).indexOf("/")) : null;
    const labelled = !task && k.labels?.["herdr.task"] && ref ? snap.tasks?.find((t: any) => t.id === (machineOf ? `${machineOf}:${ref}` : ref)) : null;
    const of = task ?? labelled;
    const place = of?.place ?? coord?.id;
    const notify = Boolean(a.about || task || k.labels?.["herdr.task"] || !place || notifies(snap, { go: { place } }));
    // SHEP-246: what the glance feed needs to keep only what is still true: its terminal finished, its machine, and a
    // memory guard's alert (herdr-task tick memory_guard: a machine's state, over once memory is back under)
    const ended = k.state !== undefined && k.state !== "live";
    const machine = String(k.address ?? "").includes("/") ? String(k.address).slice(0, String(k.address).indexOf("/")) : null;
    const memory = a.about && /^Memory at \d+%/.test(String(a.title ?? ""));
    out.push({ id: String(a.id), at: Number(a.at) || 0, title: T.clip(T.toastTitle(who, String(a.title ?? "")), 60), body: T.clip(String(a.body ?? ""), 300), ...(chat ? { chat } : {}), ...(of ? { task: of.id } : {}), ...(place ? { place } : {}), notify,
      ...(ended ? { ended: true as const } : {}), ...(machine ? { machine } : {}), ...(memory ? { memory: true as const } : {}) });
  }
  // Assistants here that their model's provider kept cutting off (herdr-task tick's .retries.json), once per cut, as
  // the window's (lib/inbox.js readRetries): "<who> · <why>", "Write to it to carry on, or restart it."
  let rows: Record<string, any> = {};
  try { rows = JSON.parse(readFileSync(join(where(home).tasks, ".retries.json"), "utf8")) ?? {}; } catch {}
  const live = new Map([...all].map((k) => [k.address, k]));
  for (const r of Object.values(rows)) {
    if (r?.role !== "coordinator" || !r.over || !r.reason || r.stale || live.get(r.address)?.state !== "live") continue;
    const chat = chatOf(r.address) ?? undefined;
    const coord = chat ? snap.places?.find((p: any) => p.chat === chat) : null;
    out.push({ id: `provider:${r.address}:${r.cut}`, at: Number(r.at) || 0, title: T.toastTitle(T.assistantWho(coord?.name), String(r.reason)), body: PROVIDER_BODY, ...(chat ? { chat } : {}), ...(coord ? { place: coord.id } : {}), notify: true });
  }
  return out;
}
export const PROVIDER_BODY = "Write to it to carry on, or restart it.";

/** a device's subscription: what it is told about (none kept: what it got before it could choose) and the spaces it hears
 *  nothing from */
type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string; at: number; topics?: PushTopic[]; muted?: string[];
  /** the tailnet device it is on (main.ts deviceFrom): a device whose phone app shows its own alerts gets none (SHEP-246) */
  node?: string };

/** does a device want this alert: its topic chosen, its space not muted; an alert with no topic (a test) always */
export function wants(s: Pick<Sub, "topics" | "muted">, a: { topic?: string; place?: string }) {
  if (!a.topic) return true;
  if (!pushTopics(s.topics).includes(a.topic as PushTopic)) return false;
  return !(a.place && s.muted?.includes(a.place));
}

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const enc = (s: string) => new TextEncoder().encode(s);
// WebCrypto as untyped: its buffer types reject plain Uint8Arrays this file builds byte by byte
const subtle = crypto.subtle as any;

async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

/** RFC 8291: the payload encrypted for one subscription, as the aes128gcm body. */
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const uaKey = await subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const prkKey = await hmac(secret, shared);
  const ikm = await hmac(prkKey, cat(enc("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, sealed);
}

export class Push {
  private subs: Sub[] = [];
  private vapid: { publicKey: string; privateJwk: JsonWebKey } | null = null;
  /** endpoints of devices whose app is on screen now (their pages say so) */
  visible = new Set<string>();
  /** a tailnet device whose own app shows the alerts now (the glance feed's native stream, SHEP-246): no web push */
  quiet: (node: string | undefined) => boolean = () => false;

  constructor(private subject: () => string, private file = join(DATA, "push.json")) {
    try { this.subs = JSON.parse(readFileSync(this.file, "utf8")); } catch {}
  }

  private save() { writeFileSync(this.file, JSON.stringify(this.subs), { mode: 0o600 }); }

  async key() {
    if (this.vapid) return this.vapid.publicKey;
    const file = join(DATA, "vapid.json");
    if (existsSync(file)) { this.vapid = JSON.parse(readFileSync(file, "utf8")); return this.vapid!.publicKey; }
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    this.vapid = { publicKey: b64u(await subtle.exportKey("raw", pair.publicKey)), privateJwk: await subtle.exportKey("jwk", pair.privateKey) };
    writeFileSync(file, JSON.stringify(this.vapid), { mode: 0o600 });
    return this.vapid.publicKey;
  }

  /** a device turned on (or again, with a new subscription: from: the one it had); it keeps what it chose */
  subscribe(sub: any, device?: string, from?: string, node?: string | null) {
    if (typeof sub?.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") throw new Error("Not a push subscription.");
    const had = this.subs.find((s) => s.endpoint === sub.endpoint) ?? (from ? this.subs.find((s) => s.endpoint === from) : undefined);
    const chose = had ? { topics: pushTopics(had.topics), ...(had.muted?.length ? { muted: had.muted } : {}) } : { topics: [...DEFAULT_TOPICS] };
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint && s !== had), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device: String(device ?? "").slice(0, 200), at: Date.now(), ...chose,
      ...(node ? { node } : had?.node ? { node: had.node } : {}) }].slice(-20);
    this.save();
  }

  /** the tailnet device a subscription is on, told by its page's socket (one subscribed before SHEP-246 had none) */
  nodeOf(endpoint: string, node: string | null | undefined) {
    const s = node ? this.subs.find((x) => x.endpoint === endpoint) : undefined;
    if (!s || s.node === node) return;
    s.node = node!;
    this.save();
  }

  /** a device turned off: it gets nothing more */
  unsubscribe(endpoint: string) {
    const n = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== n) this.save();
  }

  /** what the server keeps for a device: whether it is on, what it hears about, and how many devices are on */
  state(endpoint: string) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    return { on: !!s, topics: pushTopics(s?.topics ?? DEFAULT_TOPICS), muted: s?.muted ?? [], devices: this.subs.length };
  }

  /** a device's choice (all: every device's), what it hears about and the spaces it mutes */
  choose(endpoint: string, c: { topics?: unknown; muted?: unknown }, all = false) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    if (!s) throw new Error("Alerts are off for this device.");
    const topics = c.topics === undefined ? pushTopics(s.topics) : pushTopics(c.topics);
    const muted = Array.isArray(c.muted) ? c.muted.filter((m): m is string => typeof m === "string").slice(0, 200) : s.muted ?? [];
    for (const x of all ? this.subs : [s]) { x.topics = [...topics]; x.muted = [...muted]; }
    this.save();
    return this.state(endpoint);
  }

  private async jwt(aud: string) {
    await this.key();
    const k = await subtle.importKey("jwk", this.vapid!.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: this.subject() })));
    const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, enc(`${head}.${body}`));
    return `${head}.${body}.${b64u(sig)}`;
  }

  /** one alert to one device: the push service's answer (0: it couldn't be reached); a gone subscription is dropped */
  private async deliver(s: Sub, payload: Uint8Array) {
    try {
      const body = await encrypt(payload, s.keys.p256dh, s.keys.auth);
      const r = await fetch(s.endpoint, { method: "POST", body, headers: {
        "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high",
        authorization: `vapid t=${await this.jwt(new URL(s.endpoint).origin)}, k=${await this.key()}`,
      } });
      if (r.status === 404 || r.status === 410) this.unsubscribe(s.endpoint);
      return r.status;
    } catch { return 0; }
  }

  /** Sends an alert to every subscribed device whose app isn't on screen, whose phone app doesn't show it natively, and
   *  that wants it (its topic, its space). */
  async send(alert: Record<string, unknown> & { topic?: string; place?: string }) {
    const payload = enc(JSON.stringify(alert));
    for (const s of [...this.subs]) {
      if (this.visible.has(s.endpoint) || this.quiet(s.node) || !wants(s, alert)) continue;
      await this.deliver(s, payload);
    }
  }

  /** a test alert to one device, on screen or not: what to say of it */
  async test(endpoint: string) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    if (!s) return { ok: false, said: "Alerts are off for this device." };
    const status = await this.deliver(s, enc(JSON.stringify({ title: "Shepherdr · Test", body: "Alerts reach this device.", tag: "test", test: true })));
    if (status >= 200 && status < 300) return { ok: true, said: "Sent. It should show in a few seconds." };
    if (status === 404 || status === 410) return { ok: false, said: "This device's subscription is gone. Turn alerts on again." };
    return { ok: false, said: status ? `The push service refused it (${status}).` : "The push service couldn't be reached." };
  }
}
