// MCP Apps views in the chat (spec 2026-01-26): what the page reads of a call the gateway kept (service/mcp/), the
// sandbox the view runs in, and the calls a view makes, back through the gateway on the agent's own link.
//   GET  /api/mcp-apps/<id>          the call: server, tool, input, result, state, the view's address and _meta.ui,
//                                    whether its gateway still runs (a view's calls need it), whether a tool needs a yes
//   GET  /api/mcp-apps/<id>/html     the view's HTML, as text (the page hands it to the sandbox)
//   GET  /api/mcp-apps/<id>/sandbox  the sandbox proxy: a page with no origin of its own (CSP sandbox, no
//                                    allow-same-origin), under the view's CSP, which loads the view and passes messages
//   POST /api/mcp-apps/<id>/call     { method: "tools/call" | "resources/read", params, ok?: "once" | "always" }: a tool
//                                    call runs only once the person said yes (ok) or always lets that tool
//   …/on/<machine>/<id>[/html|/sandbox|/call]  the same for a call an agent on another machine made (mcp/remote.ts):
//                                    read there over herdr-core's machine link; the yes is asked here all the same
import { allow, allowed, cspOf, grantedOf, readCall, readHtml, type CallRecord } from "./mcp/records.ts";
import { askGateway, callThere, liveGateway } from "./mcp/gateway.ts";
import { MACHINE, type RemoteCalls } from "./mcp/remote.ts";

export { askGateway, liveGateway };

/** whose Always a tool's yes is: the server's name, with its machine's when it runs on another one */
export const allowKey = (server: string, machine: string | null = null) => (machine ? `${machine}:${server}` : server);

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

/** the tools of a server the person said Always for */
const alwaysOf = (key: string, allowList: Record<string, boolean>) =>
  Object.keys(allowList).filter((k) => k.startsWith(`${key}/`)).map((k) => k.slice(key.length + 1));

/** the call as the page reads it: no paths of this machine */
export function publicCall(r: CallRecord, allowList: Record<string, boolean>) {
  return { ...callThere(r), always: alwaysOf(r.server, allowList) };
}

/** A call, wherever it was made: here (read from this service's folder) or on another machine (read there). */
type Where = {
  call: any;
  html(): Promise<string | null>;
  ask(method: string, params: unknown): Promise<{ result?: any; error?: { code?: number; message: string }; closed?: boolean }>;
};

export async function mcpAppsRoute(req: Request, path: string, data: string, remote: RemoteCalls | null = null): Promise<Response | null> {
  const m = /^\/api\/mcp-apps\/(?:on\/([^/]+)\/)?([a-f0-9]{20})(?:\/(html|sandbox|call))?$/.exec(path);
  if (!m) return path.startsWith("/api/mcp-apps/") ? json({ error: "not found" }, 404) : null;
  const machine = m[1] ?? null, id = m[2];
  if (machine && (!MACHINE.test(machine) || !remote)) return json({ error: "No such machine." }, 404);
  let at: Where | null = null;
  if (machine) {
    const c = await remote!.get(machine, id);
    if (c) at = { call: c, html: () => remote!.html(machine, id), ask: (method, params) => remote!.call(machine, id, method, params) };
  } else {
    const r = readCall(data, id);
    if (r) at = {
      call: callThere(r),
      html: async () => (r.view?.sha ? readHtml(data, r.view.sha) : null),
      ask: async (method, params) => (liveGateway(r) ? askGateway(r.gateway.sock, method, params) : { closed: true, error: { code: -32000, message: "The agent that made this view has closed its link to the MCP server." } }),
    };
  }
  if (!at) return json({ error: "No such view." }, 404);
  const r = at.call;
  const key = allowKey(String(r.server ?? ""), machine);
  const what = m[3] ?? "";
  if (req.method === "GET" && what === "") return json({ ...r, always: alwaysOf(key, allowed(data)) });
  if (req.method === "GET" && what === "html") {
    const html = r.view?.sha ? await at.html() : null;
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
      const yes = allowed(data)[`${key}/${tool}`] || body?.ok === "once" || body?.ok === "always";
      if (!yes) return json({ ask: true, error: { code: -32000, message: "Waiting for the person's yes." } }, 409);
      if (body?.ok === "always") allow(data, key, tool);
    }
    if (!r.live) return json({ error: { code: -32000, message: "The agent that made this view has closed its link to the MCP server." } }, 410);
    const a = await at.ask(method, body?.params ?? {});
    if (a.closed) return json({ error: a.error }, 410);
    return json({ result: a.result, error: a.error });
  }
  return json({ error: "not found" }, 404);
}
