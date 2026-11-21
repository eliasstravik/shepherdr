// The tailnet side: who owns this machine, its name, and sharing /shepherdr privately with tailscale serve.
// Never funnel: serving stops when Funnel is on for the port /shepherdr is served on.
// The HTTPS port it is shared on: 443, or the one this machine set (shepherdr web https-port, install --https-port),
// kept in the service's folder as https-port; read at each look, so a change needs no restart.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, MOUNT } from "./paths.ts";

export type Me = { login: string; name: string; dns: string; host: string };

export const DEFAULT_HTTPS = 443;
export const HTTPS_PORT_FILE = join(DATA, "https-port");

/** The tailnet HTTPS port the web app is shared on: the https-port file's number, else 443. */
export function httpsPort(file = HTTPS_PORT_FILE): number {
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_HTTPS;
  } catch {
    return DEFAULT_HTTPS;
  }
}

/** The web app's origin on the tailnet: https://<machine>, with :<port> when it isn't 443. */
export const webOrigin = (dns: string, hp = DEFAULT_HTTPS) => (hp === DEFAULT_HTTPS ? `https://${dns}` : `https://${dns}:${hp}`);
/** The web app's link: <origin>/shepherdr/. */
export const webLink = (dns: string, hp = DEFAULT_HTTPS) => `${webOrigin(dns, hp)}${MOUNT}/`;

/** How long `tailscale serve` may take before it is ended: it answers in a second or two when it can share. */
export const SERVE_WAIT = Number(process.env.SHEPHERDR_TEST_SERVE_WAIT) || 20_000;

export type Ran = { ok: boolean; out: string; err: string; timedOut?: boolean };

/** Runs cmd, ended after ms when given (GitHub #1229: on a tailnet without Serve, `tailscale serve` waits forever on its
 *  consent link). What it printed before then is kept, so the link can be read. */
export async function runCmd(cmd: string[], ms?: number): Promise<Ran> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    let timedOut = false;
    const timer = ms ? setTimeout(() => { timedOut = true; try { p.kill("SIGKILL"); } catch {} }, ms) : null;
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    if (timer) clearTimeout(timer);
    return { ok: code === 0 && !timedOut, out, err, ...(timedOut ? { timedOut } : {}) };
  } catch (e) {
    return { ok: false, out: "", err: (e as Error).message };
  }
}
// every tailscale call is ended in time: one that waits never holds up the service
const run = (args: string[], ms = SERVE_WAIT) => runCmd(["tailscale", ...args], ms);


/** Where an admin turns Serve on when tailscale gave no link of its own. */
export const SERVE_ADMIN = "https://login.tailscale.com/admin";

/** Plain words when tailscale serve refused because Serve isn't turned on for the tailnet (GitHub #1229, #1114), with
 *  the link it gave to turn it on; null when that isn't what it said. */
export function serveNotEnabled(said: string): string | null {
  if (!/serve is not enabled|serve isn.t enabled|serve.{0,30}not.{0,10}enabled/i.test(said)) return null;
  const link = said.match(/https:\/\/\S+/)?.[0]?.replace(/[.,)]+$/, "") ?? SERVE_ADMIN;
  return `Tailscale Serve isn't turned on for your tailnet. An admin can turn it on here: ${link}`;
}

async function serveStatus(): Promise<any> {
  const r = await run(["serve", "status", "--json"]);
  try { return r.ok ? JSON.parse(r.out || "{}") : {}; } catch { return {}; }
}

/** The machine owner's login and the machine's tailnet name from `tailscale status --json`'s output, or null.
 *  User ids can pass 2^53 (#845): JSON.parse would round them and miss their exact key in User, so they are read as
 *  strings. */
export function meOf(out: string): Me | null {
  try {
    const s = JSON.parse(out.replace(/"UserID"\s*:\s*(\d+)/g, '"UserID":"$1"'));
    const user = s.User?.[String(s.Self?.UserID)];
    const dns = String(s.Self?.DNSName ?? "").replace(/\.$/, "");
    if (!user?.LoginName || !dns) return null;
    return { login: user.LoginName, name: user.DisplayName ?? user.LoginName, dns, host: s.Self?.HostName ?? dns.split(".")[0] };
  } catch {
    return null;
  }
}

/** The machine owner's login and the machine's tailnet name, or null without Tailscale. */
export async function whoami(): Promise<Me | null> {
  const r = await run(["status", "--json"]);
  return r.ok ? meOf(r.out) : null;
}

/** The tailnet device a request came through tailscale serve from (SHEP-240): its node's id, by `tailscale whois` of the
 *  address tailscaled puts in X-Forwarded-For (it sets that header itself, replacing any the caller sent). One device
 *  comes from its IPv4 or its IPv6 address; whois gives both the same id. No whois answer: the address itself. */
export async function deviceOf(ip: string, whois = (a: string) => run(["whois", "--json", a])): Promise<string> {
  const hit = devices.get(ip);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id;
  const r = await whois(ip);
  let id = ip;
  try { id = r.ok ? String(JSON.parse(r.out)?.Node?.StableID || ip) : ip; } catch {}
  // a passing failure isn't kept: the next connection asks again
  if (id !== ip || r.ok) devices.set(ip, { id, at: Date.now() });
  return id;
}
const devices = new Map<string, { id: string; at: number }>();
/** The address tailscale serve says a request came from, or null (not through it). */
export const forwardedFrom = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

export type Served = { proxy: string | null; port: string | null; funnel: boolean };

/** What tailscale serve does with /shepherdr now: its target, the HTTPS port, and whether Funnel is on there. */
export async function served(dns: string, status?: any): Promise<Served> {
  const none = { proxy: null, port: null, funnel: false };
  try {
    const s = status ?? (await serveStatus());
    for (const [hostPort, web] of Object.entries<any>(s.Web ?? {})) {
      const [host, port] = hostPort.split(":");
      if (host !== dns) continue;
      const h = web?.Handlers?.[MOUNT];
      if (h) return { proxy: h.Proxy ?? null, port, funnel: !!s.AllowFunnel?.[hostPort] };
    }
    return none;
  } catch {
    return none;
  }
}

export async function funnelAnywhere(): Promise<boolean> {
  return Object.values((await serveStatus()).AllowFunnel ?? {}).some(Boolean);
}

/** Who else holds HTTPS port hp on this machine's tailnet name, in tailscale serve's status: a TCP forward (another
 *  app's raw proxy) or plain TCP; null when it is free or already Tailscale's HTTPS (/shepherdr can join it). */
export function heldBy(status: any, hp: number): string | null {
  const t = status?.TCP?.[String(hp)];
  if (!t) return null;
  if (t.TCPForward) return `a TCP forward to ${t.TCPForward}`;
  return t.HTTPS || t.HTTP ? null : "another app's TCP share";
}

/** A port to suggest instead of hp: the first of 8443, 9443, 10443… that tailscale serve doesn't use here. */
export function freePort(status: any, hp: number): number {
  const used = new Set(Object.keys(status?.TCP ?? {}).map(Number));
  for (let p = 8443; p < 65535; p += 1000) if (p !== hp && !used.has(p)) return p;
  return 8443;
}

/** What to say when sharing on hp can't work or failed: tailscale's own words when it gave some, and another port. */
export function shareProblem(status: any, hp: number, err = "", timedOut = false): string {
  const off = serveNotEnabled(err);
  if (off) return off;
  if (timedOut) return `tailscale serve didn't answer in ${SERVE_WAIT / 1000} seconds${err.trim() ? `: ${err.trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ")}` : ""}`;
  const other = freePort(status, hp);
  const fix = `Pick another port: \`shepherdr web https-port ${other}\`.`;
  const held = heldBy(status, hp);
  if (held) return `Port ${hp} on this machine's tailnet name is taken (${held}). ${fix}`;
  const said = err.trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" ");
  const busy = /already|in use|conflict|listener/i.test(said);
  return `tailscale serve failed${said ? `: ${said}` : ""}` + (busy ? ` Port ${hp} may be taken. ${fix}` : "");
}

/** Shares 127.0.0.1:<port> at https://<machine>[:<hp>]/shepherdr. Refuses to replace /shepherdr when it points
 *  elsewhere. Ours on another HTTPS port (the setting changed) moves to hp: the old share goes once the new one is up.
 *  Returns null, or why it isn't shared (tailscale's own words, and another port when hp is taken). */
export function share(dns: string, port: number, hp = DEFAULT_HTTPS): Promise<string | null> {
  // never a second `tailscale serve` while one still waits (GitHub #1229): a look meanwhile gets the same answer
  return (sharing ??= shareOnce(dns, port, hp).finally(() => { sharing = null; }));
}
let sharing: Promise<string | null> | null = null;

async function shareOnce(dns: string, port: number, hp: number): Promise<string | null> {
  const status = await serveStatus();
  const now = await served(dns, status);
  const ours = `http://127.0.0.1:${port}`;
  if (now.funnel || status?.AllowFunnel?.[`${dns}:${hp}`]) return "Funnel is on for this machine's HTTPS port: Shepherdr won't serve there";
  if (now.proxy === ours && now.port === String(hp)) return null;
  if (now.proxy && now.proxy !== ours) return `${MOUNT} is already shared to ${now.proxy}`;
  if (heldBy(status, hp)) return shareProblem(status, hp);
  const r = await run(["serve", "--bg", `--https=${hp}`, "--set-path", MOUNT, String(port)]);
  if (!r.ok) return shareProblem(status, hp, [r.err, r.out].filter((x) => x.trim()).join("\n"), r.timedOut);
  if (now.proxy === ours && now.port) await run(["serve", `--https=${now.port}`, "--set-path", MOUNT, "off"]);
  return null;
}

/** Stops sharing /shepherdr. port: only when it leads to this service (another one's share is left alone). */
export async function unshare(dns: string, port?: number): Promise<void> {
  const now = await served(dns);
  if (now.proxy && (port === undefined || now.proxy === `http://127.0.0.1:${port}`)) await run(["serve", `--https=${now.port ?? 443}`, "--set-path", MOUNT, "off"]);
}

/** What a move here set aside (shepherdr web serve-from --take-link: ~/.local/state/shepherdr/service/replaced-share.json), shared
 *  again once this machine no longer serves the web app. */
export async function restoreShare(file: string): Promise<boolean> {
  let r: { port?: string; proxy?: string } | null = null;
  try { r = JSON.parse(await Bun.file(file).text()); } catch { return false; }
  if (!r?.proxy || !/^\d+$/.test(String(r.port)) || !/^https?:\/\/127\.0\.0\.1:\d+\/?$/.test(r.proxy)) return false;
  const ok = (await run(["serve", "--bg", `--https=${r.port}`, "--set-path", MOUNT, r.proxy])).ok;
  if (ok) try { (await import("node:fs")).unlinkSync(file); } catch {}
  return ok;
}
