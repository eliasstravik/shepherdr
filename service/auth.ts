// Who may use the service. Two ways in, nothing else:
// - through tailscale serve: Tailscale's login header must be the machine owner's, on the machine's own name, on a
//   connection tailscaled (or the owner) opened (peer.ts: another user here can't just send the header);
// - on this machine (the Herdr window, the CLI): the token in ~/.local/state/shepherdr/service/token, on 127.0.0.1.
// Writes and sockets also need the page's own origin, and writes a header no plain form or link can send.
// The service listens on 127.0.0.1 only, so the tailnet reaches it through tailscale serve alone.

// httpsPort: the tailnet HTTPS port the web app is shared on (none: 443); the page's host and origin carry it when it
// isn't 443, and only that port gets in.
export type Gate = { owner: string | null; dns: string | null; port: number; token: string; httpsPort?: number };
export type Pass = { ok: true; who: string; via: "tailnet" | "local" } | { ok: false; status: number; why: string };

const READS = new Set(["GET", "HEAD"]);

// A link from another site (Slack, a page, a bookmark) opens the entry page: a GET top-level navigation to a page, not
// the API or a socket (GitHub #913). Browsers mark a page inside a frame, a script or a fetch with other Sec-Fetch
// values, so those stay refused. Everything the page then asks for is same-origin.
function pageLink(req: Request, socket: boolean) {
  const h = req.headers;
  if (socket || req.method !== "GET") return false;
  if (h.get("sec-fetch-mode") !== "navigate" || h.get("sec-fetch-dest") !== "document") return false;
  const path = new URL(req.url).pathname.replace(/^\/shepherdr(?=\/)/, "");
  return !/^\/api(\/|$)/.test(path);
}

export function gate(req: Request, g: Gate, socket = false, peerTrusted = false): Pass {
  const h = req.headers;
  const host = (h.get("host") ?? "").toLowerCase();
  const login = h.get("tailscale-user-login");
  const write = socket || !READS.has(req.method);
  if (req.method === "OPTIONS") return { ok: false, status: 403, why: "no cross-site requests" };
  if (h.get("sec-fetch-site") === "cross-site" && !pageLink(req, socket)) return { ok: false, status: 403, why: "cross-site" };

  if (login !== null) {
    if (!g.owner || !g.dns) return { ok: false, status: 503, why: "Tailscale isn't running here" };
    if (!peerTrusted) return { ok: false, status: 403, why: "not from Tailscale" };
    if (login !== g.owner) return { ok: false, status: 403, why: "only this machine's owner" };
    const hp = g.httpsPort ?? 443;
    if (hp === 443 ? host !== g.dns && host !== `${g.dns}:443` : host !== `${g.dns}:${hp}`) return { ok: false, status: 421, why: "wrong host" };
    if (write) {
      const origin = h.get("origin");
      if (origin !== (hp === 443 ? `https://${g.dns}` : `https://${g.dns}:${hp}`)) return { ok: false, status: 403, why: "wrong origin" };
      if (!socket && h.get("x-shepherdr") !== "1") return { ok: false, status: 403, why: "missing x-shepherdr" };
    }
    return { ok: true, who: login, via: "tailnet" };
  }

  if (host !== `127.0.0.1:${g.port}` && host !== `localhost:${g.port}`) return { ok: false, status: 421, why: "wrong host" };
  const auth = h.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!g.token || !same(given, g.token)) return { ok: false, status: 401, why: "no token" };
  if (h.get("origin")) return { ok: false, status: 403, why: "no browser pages on 127.0.0.1" };
  return { ok: true, who: "local", via: "local" };
}

/** A caller on this machine (the window, the CLI, a call), as health tells only them the service's id (main.ts):
 *  127.0.0.1 by the service's own port, no tailnet login, no browser page. */
export function localCaller(req: Request, port: number) {
  const h = req.headers, host = (h.get("host") ?? "").toLowerCase();
  return !h.has("tailscale-user-login") && !h.get("origin") && (host === `127.0.0.1:${port}` || host === `localhost:${port}`);
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
