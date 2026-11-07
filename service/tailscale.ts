// The tailnet side: who owns this machine, its name, and sharing /shepherdr privately with tailscale serve.
// Never funnel: serving stops when Funnel is on for the port /shepherdr is served on.
import { MOUNT } from "./paths.ts";

export type Me = { login: string; name: string; dns: string; host: string };

async function run(args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const p = Bun.spawn(["tailscale", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    return { ok: (await p.exited) === 0, out };
  } catch {
    return { ok: false, out: "" };
  }
}

/** The machine owner's login and the machine's tailnet name, or null without Tailscale. */
export async function whoami(): Promise<Me | null> {
  const r = await run(["status", "--json"]);
  if (!r.ok) return null;
  try {
    const s = JSON.parse(r.out);
    const user = s.User?.[String(s.Self?.UserID)];
    const dns = String(s.Self?.DNSName ?? "").replace(/\.$/, "");
    if (!user?.LoginName || !dns) return null;
    return { login: user.LoginName, name: user.DisplayName ?? user.LoginName, dns, host: s.Self?.HostName ?? dns.split(".")[0] };
  } catch {
    return null;
  }
}

export type Served = { proxy: string | null; port: string | null; funnel: boolean };

/** What tailscale serve does with /shepherdr now: its target, the HTTPS port, and whether Funnel is on there. */
export async function served(dns: string): Promise<Served> {
  const r = await run(["serve", "status", "--json"]);
  const none = { proxy: null, port: null, funnel: false };
  if (!r.ok) return none;
  try {
    const s = JSON.parse(r.out || "{}");
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
  const r = await run(["serve", "status", "--json"]);
  try { return Object.values(JSON.parse(r.out || "{}").AllowFunnel ?? {}).some(Boolean); } catch { return false; }
}

/** Shares 127.0.0.1:<port> at https://<machine>/shepherdr. Refuses to replace /shepherdr when it points elsewhere. */
export async function share(dns: string, port: number): Promise<string | null> {
  const now = await served(dns);
  const ours = `http://127.0.0.1:${port}`;
  if (now.funnel) return "Funnel is on for this machine's HTTPS port: BossGoat won't serve there";
  if (now.proxy === ours) return null;
  if (now.proxy) return `${MOUNT} is already shared to ${now.proxy}`;
  const r = await run(["serve", "--bg", "--set-path", MOUNT, String(port)]);
  return r.ok ? null : "tailscale serve failed";
}

/** Stops sharing /shepherdr. port: only when it leads to this service (another one's share is left alone). */
export async function unshare(dns: string, port?: number): Promise<void> {
  const now = await served(dns);
  if (now.proxy && (port === undefined || now.proxy === `http://127.0.0.1:${port}`)) await run(["serve", `--https=${now.port ?? 443}`, "--set-path", MOUNT, "off"]);
}

/** What a move here set aside (shepherdr web serve-from --take-link: ~/.herdr/shepherdr/replaced-share.json), shared
 *  again once this machine no longer serves the web app. */
export async function restoreShare(file: string): Promise<boolean> {
  let r: { port?: string; proxy?: string } | null = null;
  try { r = JSON.parse(await Bun.file(file).text()); } catch { return false; }
  if (!r?.proxy || !/^\d+$/.test(String(r.port)) || !/^https?:\/\/127\.0\.0\.1:\d+\/?$/.test(r.proxy)) return false;
  const ok = (await run(["serve", "--bg", `--https=${r.port}`, "--set-path", MOUNT, r.proxy])).ok;
  if (ok) try { (await import("node:fs")).unlinkSync(file); } catch {}
  return ok;
}
