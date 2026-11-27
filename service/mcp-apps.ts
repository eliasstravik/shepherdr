// MCP Apps views in the chat (spec 2026-01-26): what the page reads of a call the gateway kept (service/mcp/), the
// sandbox the view runs in, and the calls a view makes, back through the gateway on the agent's own link.
//   GET  /api/mcp-apps/<id>          the call: server, tool, input, result, state, the view's address and _meta.ui,
//                                    whether its gateway still runs (a view's calls need it), whether a tool needs a yes
//   GET  /api/mcp-apps/<id>/html     the view's HTML, as text (the page hands it to the sandbox)
//   GET  /api/mcp-apps/<id>/sandbox  the sandbox proxy: a page with no origin of its own (CSP sandbox, no
//                                    allow-same-origin), under the view's CSP, which loads the view and passes messages
//   POST /api/mcp-apps/<id>/call     { method: "tools/call" | "resources/read", params, ok?: "once" | "always" }: a tool
//                                    call runs only once the person said yes (ok) or always lets that tool
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { allow, allowed, cspOf, grantedOf, readCall, readHtml, type CallRecord } from "./mcp/records.ts";

/** whether the gateway that made a call still runs (its view's own calls go through it) */
export function liveGateway(r: Pick<CallRecord, "gateway">): boolean {
  const g = r.gateway;
  if (!g?.pid || !g.sock || !existsSync(g.sock)) return false;
  try { process.kill(g.pid, 0); return true; } catch { return false; }
}

/** one request to a gateway's socket -> { result } | { error } */
export function askGateway(sock: string, method: string, params: unknown, timeout = 130_000): Promise<{ result?: any; error?: { code?: number; message: string } }> {
  return new Promise((done) => {
    let buf = "", over = false;
    const end = (v: any) => { if (!over) { over = true; clearTimeout(t); s.destroy(); done(v); } };
    const s = connect(sock);
    const t = setTimeout(() => end({ error: { message: "The MCP server didn't answer in time." } }), timeout);
    s.on("connect", () => s.write(JSON.stringify({ method, params }) + "\n"));
    s.on("data", (d) => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try { end(JSON.parse(buf.slice(0, i))); } catch { end({ error: { message: "The gateway's answer wasn't readable." } }); }
    });
    s.on("error", () => end({ error: { message: "The agent's link to this MCP server is closed." } }));
    s.on("close", () => end({ error: { message: "The agent's link to this MCP server closed." } }));
  });
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** the sandbox proxy (spec: Sandbox proxy). Its own origin is none (opaque), so it can't reach the app's; the view
 *  is its inner frame, written from the HTML the page sends (ui/notifications/sandbox-resource-ready), and inherits
 *  this page's CSP, which is the view's (cspOf). Every message that isn't a sandbox-* one passes through as it is. */
export function sandboxPage(csp: string, allowAttr: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}">`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}iframe{border:0;width:100%;height:100%;display:block;background:transparent}</style>
</head><body><script>
(function () {
  var host = window.parent, inner = null, META = ${JSON.stringify(meta)}, ALLOW = ${JSON.stringify(allowAttr)};
  var sandboxMsg = function (d) { return typeof d.method === "string" && d.method.indexOf("ui/notifications/sandbox-") === 0; };
  // the view's HTML with its CSP first in its head (the header this page came with applies too)
  function withCsp(html) {
    var m = /<head[^>]*>/i.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + META + html.slice(m.index + m[0].length);
    var h = /<html[^>]*>/i.exec(html);
    if (h) return html.slice(0, h.index + h[0].length) + "<head>" + META + "</head>" + html.slice(h.index + h[0].length);
    return META + html;
  }
  function load(p) {
    if (inner || !p || typeof p.html !== "string") return;
    inner = document.createElement("iframe");
    inner.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
    if (ALLOW) inner.setAttribute("allow", ALLOW);
    inner.setAttribute("title", "View");
    inner.srcdoc = withCsp(p.html);
    document.body.appendChild(inner);
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.jsonrpc !== "2.0") return;
    if (e.source === host) {
      if (d.method === "ui/notifications/sandbox-resource-ready") return load(d.params);
      if (sandboxMsg(d)) return;
      if (inner && inner.contentWindow) inner.contentWindow.postMessage(d, "*");
    } else if (inner && e.source === inner.contentWindow) {
      if (sandboxMsg(d)) return;
      host.postMessage(d, "*");
    }
  });
  host.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, "*");
})();
</script></body></html>`;
}

/** the call as the page reads it: no paths of this machine */
export function publicCall(r: CallRecord, allowList: Record<string, boolean>) {
  const { gateway: _g, terminal: _t, ...rest } = r;
  return { ...rest, live: liveGateway(r), always: Object.keys(allowList).filter((k) => k.startsWith(`${r.server}/`)).map((k) => k.slice(r.server.length + 1)) };
}

export async function mcpAppsRoute(req: Request, path: string, data: string): Promise<Response | null> {
  const m = /^\/api\/mcp-apps\/([a-f0-9]{20})(?:\/(html|sandbox|call))?$/.exec(path);
  if (!m) return path.startsWith("/api/mcp-apps/") ? json({ error: "not found" }, 404) : null;
  const r = readCall(data, m[1]);
  if (!r) return json({ error: "No such view." }, 404);
  const what = m[2] ?? "";
  if (req.method === "GET" && what === "") return json(publicCall(r, allowed(data)));
  if (req.method === "GET" && what === "html") {
    const html = r.view?.sha ? readHtml(data, r.view.sha) : null;
    return html === null ? json({ error: r.view?.error ?? "The view isn't here yet." }, 404)
      : new Response(html, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "content-security-policy": "sandbox; default-src 'none'", "x-content-type-options": "nosniff" } });
  }
  if (req.method === "GET" && what === "sandbox") {
    const csp = cspOf(r.view?.meta?.csp);
    const allowAttr = grantedOf(r.view?.meta?.permissions).clipboardWrite ? "clipboard-write" : "";
    // CSP sandbox without allow-same-origin: an origin of its own (opaque), never the app's
    return new Response(sandboxPage(csp, allowAttr), { headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
      "content-security-policy": `sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox; ${csp}`,
    } });
  }
  if (req.method === "POST" && what === "call") {
    const body = await req.json().catch(() => null) as { method?: string; params?: any; ok?: string } | null;
    const method = String(body?.method ?? "");
    if (method !== "tools/call" && method !== "resources/read") return json({ error: { code: -32601, message: `A view may not ask ${method}.` } }, 400);
    if (method === "tools/call") {
      const tool = String(body?.params?.name ?? "");
      if (!tool) return json({ error: { code: -32602, message: "Which tool?" } }, 400);
      const yes = allowed(data)[`${r.server}/${tool}`] || body?.ok === "once" || body?.ok === "always";
      if (!yes) return json({ ask: true, error: { code: -32000, message: "Waiting for the person's yes." } }, 409);
      if (body?.ok === "always") allow(data, r.server, tool);
    }
    if (!liveGateway(r)) return json({ error: { code: -32000, message: "The agent that made this view has closed its link to the MCP server." } }, 410);
    return json(await askGateway(r.gateway.sock, method, body?.params ?? {}));
  }
  return json({ error: "not found" }, 404);
}
