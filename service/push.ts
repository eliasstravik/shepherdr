// Push alerts to phones and browsers that asked for them (2.1's alerts: the service worker web/public/sw.js shows
// them). Web Push with nothing but WebCrypto: a VAPID key pair kept owner-only in ~/.herdr/shepherdr/vapid.json, each
// alert encrypted for its subscription (RFC 8291, aes128gcm) and signed (RFC 8292, ES256). Subscriptions are kept in
// push.json. A device whose app is on screen gets none (the page says so over its socket).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import * as T from "../core/toasts.js";
import { notifies, taskWho } from "../web/shared/alerts.ts";

/**
 * What each push alert says, as the window's toasts (core/toasts.js): an agent that needs you, "HERD-4 · Needs you" or
 * "tt-repo Assistant · Needs you", why under it (an Assistant only by its space's Notify); a task whose agent finished,
 * ready to accept, "HERD-4 · Finished" under its name, a tap opening its Accept card. Keyed so each goes once.
 */
export function alertsOf(snap: any): Map<string, { title: string; body: string; tag: string; waits?: true; url?: string }> {
  const now = new Map<string, { title: string; body: string; tag: string; waits?: true; url?: string }>();
  const who = (n: any) => n.task ? taskWho(snap, n.task) : T.assistantWho(snap.places?.find((p: any) => p.id === n.place)?.name);
  for (const n of snap.needs ?? []) {
    if (snap.settings && !notifies(snap, { go: { place: n.place }, task: n.task ? true : undefined })) continue;
    now.set(`need:${n.chat}:${n.id}`, { title: T.toastTitle(who(n), T.NEEDS_YOU), body: T.needReason(n), tag: n.task ?? n.chat, waits: true });
  }
  for (const t of snap.tasks ?? []) if (t.status === "ready" && !t.archived)
    now.set(`ready:${t.id}`, { title: T.toastTitle(taskWho(snap, t.id), T.FINISHED), body: t.name, tag: t.id, url: `./#accept=${encodeURIComponent(t.id)}` });
  // an agent's own alert (herdr-task alert), as its toast: a task's always, an Assistant's by its space's Notify
  for (const a of snap.alerts ?? []) if (a.notify) now.set(`alert:${a.id}`, { title: a.title, body: a.body, tag: `alert:${a.id}` });
  return now;
}

/**
 * The agents' own alerts (`herdr-task alert "<title>" --body "<why>"`: the core label herdr.alert = { id, at, title,
 * body, task?, about? } on the agent's terminal), as the window's toasts say them (lib/inbox.js agentAlerts): "<who> ·
 * <title>" (60 characters at most) over its body (300), the chat it is from, and whether it reaches the person (a
 * task's agent or an alert about a task always; an Assistant's by its space's Notify). chatOf: a terminal's chat key.
 */
export function agentAlerts(terminals: Iterable<any>, snap: any, chatOf: (address: string) => string | null, home: string) {
  const out: { id: string; at: number; title: string; body: string; chat?: string; place?: string; notify: boolean }[] = [];
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
    const place = task?.place ?? coord?.id;
    const notify = Boolean(a.about || task || k.labels?.["herdr.task"] || !place || notifies(snap, { go: { place } }));
    out.push({ id: String(a.id), at: Number(a.at) || 0, title: T.clip(T.toastTitle(who, String(a.title ?? "")), 60), body: T.clip(String(a.body ?? ""), 300), ...(chat ? { chat } : {}), ...(place ? { place } : {}), notify });
  }
  // Assistants here that their model's provider kept cutting off (herdr-task tick's .retries.json), once per cut, as
  // the window's (lib/inbox.js readRetries): "<who> · <why>", "Write to it to carry on, or restart it."
  let rows: Record<string, any> = {};
  try { rows = JSON.parse(readFileSync(join(home, ".herdr", "tasks", ".retries.json"), "utf8")) ?? {}; } catch {}
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

type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string; at: number };

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

  constructor(private subject: () => string) {
    try { this.subs = JSON.parse(readFileSync(join(DATA, "push.json"), "utf8")); } catch {}
  }

  async key() {
    if (this.vapid) return this.vapid.publicKey;
    const file = join(DATA, "vapid.json");
    if (existsSync(file)) { this.vapid = JSON.parse(readFileSync(file, "utf8")); return this.vapid!.publicKey; }
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    this.vapid = { publicKey: b64u(await subtle.exportKey("raw", pair.publicKey)), privateJwk: await subtle.exportKey("jwk", pair.privateKey) };
    writeFileSync(file, JSON.stringify(this.vapid), { mode: 0o600 });
    return this.vapid.publicKey;
  }

  subscribe(sub: any, device?: string) {
    if (typeof sub?.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") throw new Error("Not a push subscription.");
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device: String(device ?? "").slice(0, 200), at: Date.now() }].slice(-20);
    writeFileSync(join(DATA, "push.json"), JSON.stringify(this.subs), { mode: 0o600 });
  }

  private async jwt(aud: string) {
    await this.key();
    const k = await subtle.importKey("jwk", this.vapid!.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: this.subject() })));
    const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, enc(`${head}.${body}`));
    return `${head}.${body}.${b64u(sig)}`;
  }

  /** Sends an alert to every subscribed device whose app isn't on screen. A gone subscription is dropped. */
  async send(alert: Record<string, unknown>) {
    const payload = enc(JSON.stringify(alert));
    for (const s of [...this.subs]) {
      if (this.visible.has(s.endpoint)) continue;
      try {
        const body = await encrypt(payload, s.keys.p256dh, s.keys.auth);
        const r = await fetch(s.endpoint, { method: "POST", body, headers: {
          "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high",
          authorization: `vapid t=${await this.jwt(new URL(s.endpoint).origin)}, k=${await this.key()}`,
        } });
        if (r.status === 404 || r.status === 410) {
          this.subs = this.subs.filter((x) => x.endpoint !== s.endpoint);
          writeFileSync(join(DATA, "push.json"), JSON.stringify(this.subs), { mode: 0o600 });
        }
      } catch {}
    }
  }
}
