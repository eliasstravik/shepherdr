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

async function run(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const p = Bun.spawn(["tailscale", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { ok: (await p.exited) === 0, out, err };
  } catch (e) {
    return { ok: false, out: "", err: (e as Error).message };
  }
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
export function shareProblem(status: any, hp: number, err = ""): string {
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
export async function share(dns: string, port: number, hp = DEFAULT_HTTPS): Promise<string | null> {
  const status = await serveStatus();
  const now = await served(dns, status);
  const ours = `http://127.0.0.1:${port}`;
  if (now.funnel || status?.AllowFunnel?.[`${dns}:${hp}`]) return "Funnel is on for this machine's HTTPS port: Shepherdr won't serve there";
  if (now.proxy === ours && now.port === String(hp)) return null;
  if (now.proxy && now.proxy !== ours) return `${MOUNT} is already shared to ${now.proxy}`;
  if (heldBy(status, hp)) return shareProblem(status, hp);
  const r = await run(["serve", "--bg", `--https=${hp}`, "--set-path", MOUNT, String(port)]);
  if (!r.ok) return shareProblem(status, hp, r.err || r.out);
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
