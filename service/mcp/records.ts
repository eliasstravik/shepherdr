// MCP Apps (spec 2026-01-26, extension io.modelcontextprotocol/ui): what the gateway (gateway.ts) keeps of a call to a
// tool that has a view, and what the service and the page read back. One folder, the service's own (DATA/mcp-apps):
//   calls/<id>.json   a call: its server, tool, input, result, the view it shows and the gateway that made it
//   html/<sha>.html   a view's HTML (resources/read), kept once however many calls show it
//   allow.json        the tools a view may call without asking, by "<server>/<tool>" (the person's Always)
// Gateways listen on a socket each (sockFor) for the calls a view makes through the page, on the agent's own link.
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";

export const EXTENSION = "io.modelcontextprotocol/ui";
export const MIME = "text/html;profile=mcp-app";
export const PROTOCOL = "2026-01-26";

export type Csp = { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] };
export type Permissions = { camera?: {}; microphone?: {}; geolocation?: {}; clipboardWrite?: {} };
export type ResourceMeta = { csp?: Csp; permissions?: Permissions; domain?: string; prefersBorder?: boolean };

export type CallRecord = {
  id: string;
  /** the name the person gave the server (herdr-mcp <name>) */
  server: string;
  tool: string;
  /** the tool as tools/list gave it (name, description, inputSchema, _meta) */
  def: any;
  args: Record<string, unknown>;
  state: "running" | "done" | "error" | "cancelled";
  /** the CallToolResult, once it came */
  result?: any;
  error?: string;
  at: number;
  end?: number;
  /** the agent's terminal (HC_TERMINAL_ID), when its environment had it */
  terminal?: string | null;
  /** the view: its ui:// address, the HTML's sha (html/<sha>.html) and its _meta.ui */
  view?: { uri: string; sha?: string; meta?: ResourceMeta; error?: string };
  /** the gateway that made it: a view's own calls go back through it while it runs */
  gateway: { pid: number; sock: string };
};

export const appsDir = (data: string) => join(data, "mcp-apps");
const callsDir = (data: string) => join(appsDir(data), "calls");
const htmlDir = (data: string) => join(appsDir(data), "html");

/** the view a tool shows (its _meta.ui.resourceUri, or the older flat "ui/resourceUri"), when it is a ui:// one */
export function viewOf(tool: any): string | null {
  const m = tool?._meta;
  const uri = m?.ui?.resourceUri ?? m?.["ui/resourceUri"];
  return typeof uri === "string" && uri.startsWith("ui://") ? uri : null;
}

/** who may call a tool: its _meta.ui.visibility, ["model", "app"] when it says none */
export function visibilityOf(tool: any): string[] {
  const v = tool?._meta?.ui?.visibility;
  return Array.isArray(v) ? v.map(String) : ["model", "app"];
}

/** a call's id: short, random, safe in a path and a link */
export const newId = () => randomUUID().replace(/-/g, "").slice(0, 20);
export const okId = (id: string) => /^[a-f0-9]{20}$/.test(id);

function writeJson(path: string, v: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
  renameSync(tmp, path);
}

export function ensureDirs(data: string) {
  for (const d of [appsDir(data), callsDir(data), htmlDir(data)]) mkdirSync(d, { recursive: true, mode: 0o700 });
}

export function saveCall(data: string, r: CallRecord) {
  ensureDirs(data);
  writeJson(join(callsDir(data), `${r.id}.json`), r);
}

export function readCall(data: string, id: string): CallRecord | null {
  if (!okId(id)) return null;
  try { return JSON.parse(readFileSync(join(callsDir(data), `${id}.json`), "utf8")); } catch { return null; }
}

/** a view's HTML, kept by its sha -> the sha */
export function saveHtml(data: string, html: string): string {
  ensureDirs(data);
  const sha = createHash("sha256").update(html).digest("hex");
  const p = join(htmlDir(data), `${sha}.html`);
  if (!existsSync(p)) {
    writeFileSync(`${p}.${process.pid}.tmp`, html, { mode: 0o600 });
    renameSync(`${p}.${process.pid}.tmp`, p);
  }
  return sha;
}

export function readHtml(data: string, sha: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(sha)) return null;
  try { return readFileSync(join(htmlDir(data), `${sha}.html`), "utf8"); } catch { return null; }
}

/** the calls kept, newest first, without their results (cheap: the chat matches its calls against these) */
export function listCalls(data: string): Pick<CallRecord, "id" | "server" | "tool" | "args" | "at" | "terminal">[] {
  let names: string[] = [];
  try { names = readdirSync(callsDir(data)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const out: any[] = [];
  for (const n of names) {
    const r = readCall(data, n.slice(0, -5));
    if (r) out.push({ id: r.id, server: r.server, tool: r.tool, args: r.args, at: r.at, terminal: r.terminal ?? null });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** the calls kept, for matching (listCalls), each read once: what matching uses never changes after a call starts */
export class CallIndex {
  private seen = new Map<string, Pick<CallRecord, "id" | "server" | "tool" | "args" | "at" | "terminal">>();
  constructor(private data: string) {}
  list() {
    let names: string[] = [];
    try { names = readdirSync(callsDir(this.data)).filter((n) => n.endsWith(".json")); } catch { return []; }
    const here = new Set<string>();
    for (const n of names) {
      const id = n.slice(0, -5);
      here.add(id);
      if (this.seen.has(id)) continue;
      const r = readCall(this.data, id);
      if (r) this.seen.set(id, { id: r.id, server: r.server, tool: r.tool, args: r.args, at: r.at, terminal: r.terminal ?? null });
    }
    for (const id of [...this.seen.keys()]) if (!here.has(id)) this.seen.delete(id);
    return [...this.seen.values()];
  }
}

/** calls older than days go, and the HTML no call left names */
export function prune(data: string, days = 30, now = Date.now()) {
  let names: string[] = [];
  try { names = readdirSync(callsDir(data)); } catch { return; }
  const keep = new Set<string>();
  for (const n of names) {
    const p = join(callsDir(data), n);
    const r = n.endsWith(".json") ? readCall(data, n.slice(0, -5)) : null;
    if (!r || now - r.at > days * 86400_000) { try { if (!r && now - statSync(p).mtimeMs < 60_000) continue; rmSync(p, { force: true }); } catch {} continue; }
    if (r.view?.sha) keep.add(r.view.sha);
  }
  try { for (const n of readdirSync(htmlDir(data))) if (!keep.has(n.replace(/\.html$/, ""))) rmSync(join(htmlDir(data), n), { force: true }); } catch {}
}

// ---- allowed without asking -------------------------------------------------------------------

const allowPath = (data: string) => join(appsDir(data), "allow.json");
export function allowed(data: string): Record<string, boolean> {
  try { const v = JSON.parse(readFileSync(allowPath(data), "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function allow(data: string, server: string, tool: string) {
  ensureDirs(data);
  writeJson(allowPath(data), { ...allowed(data), [`${server}/${tool}`]: true });
}

// ---- which call a chat's step was ---------------------------------------------------------------

/** a server's name as agents write it in a tool's name (Claude Code: mcp__<server>__<tool>, other characters as _) */
export const serverKey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** the same JSON whatever the order of its keys */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** the call a chat's MCP step made: same server, tool and input, from that chat's terminal when the call says one,
 *  started from a minute before the step was logged to ten after (the log line can come before or after the call);
 *  taken: ids already given to an earlier step of this chat */
export function matchCall(
  calls: Pick<CallRecord, "id" | "server" | "tool" | "args" | "at" | "terminal">[],
  step: { server: string; tool: string; input: unknown; at: number },
  terminal: string | null,
  taken: Set<string> = new Set(),
): string | null {
  const want = stable(step.input ?? {});
  const best = calls
    .filter((c) => !taken.has(c.id) && serverKey(c.server) === serverKey(step.server) && c.tool === step.tool)
    .filter((c) => !c.terminal || !terminal || c.terminal === terminal)
    .filter((c) => !step.at || (c.at >= step.at - 60_000 && c.at <= step.at + 600_000))
    .filter((c) => stable(c.args ?? {}) === want)
    .sort((a, b) => Math.abs(a.at - step.at) - Math.abs(b.at - step.at))[0];
  return best?.id ?? null;
}

// ---- the view's Content Security Policy -------------------------------------------------------------

/** only plain origins (https://x.example, wss://…, https://*.x.example): nothing that could close the directive */
const origin = (d: unknown) => (typeof d === "string" && /^(https?|wss?):\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/i.test(d) ? d : null);
const list = (ds: unknown) => (Array.isArray(ds) ? ds.map(origin).filter(Boolean).join(" ") : "");

/** the CSP a view runs under, from its resource's _meta.ui.csp: the spec's restrictive default, opened only for the
 *  origins it declares (never wider) */
export function cspOf(csp: Csp | undefined | null): string {
  const res = list(csp?.resourceDomains), con = list(csp?.connectDomains), fr = list(csp?.frameDomains), base = list(csp?.baseUriDomains);
  const with_ = (s: string) => (res ? `${s} ${res}` : s);
  return [
    "default-src 'none'",
    with_("script-src 'self' 'unsafe-inline'"),
    with_("style-src 'self' 'unsafe-inline'"),
    with_("img-src 'self' data:"),
    with_("font-src 'self' data:"),
    with_("media-src 'self' data:"),
    `connect-src ${con || "'none'"}`,
    `frame-src ${fr || "'none'"}`,
    `base-uri ${base || "'self'"}`,
    "object-src 'none'",
    "form-action 'none'",
  ].join("; ");
}

/** the permissions a view gets of those it asks for (the spec lets a host grant them or not): only writing to the
 *  clipboard; never the camera, the microphone or where the device is */
export function grantedOf(p: Permissions | undefined | null): Permissions {
  return p?.clipboardWrite ? { clipboardWrite: {} } : {};
}
