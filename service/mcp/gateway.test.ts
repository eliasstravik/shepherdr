import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway, type Upstream } from "./gateway.ts";
import { allowed, cspOf, grantedOf, listCalls, matchCall, readCall, readHtml, stable, CallIndex } from "./records.ts";
import { mcpAppsRoute, sandboxPage } from "../mcp-apps.ts";

// a fake server on the far side: answers what it is asked as a server with a view would
const TOOLS = [
  { name: "show", description: "Show a board", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://demo/board.html" } } },
  { name: "refresh", description: "Only the view's", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://demo/board.html", visibility: ["app"] } } },
  { name: "secret", description: "Only the model's", inputSchema: { type: "object" }, _meta: { ui: { visibility: ["model"] } } },
  { name: "plain", description: "No view", inputSchema: { type: "object" } },
];
function fake() {
  const got: any[] = [];
  const up: Upstream & { got: any[] } = {
    got,
    onmessage: () => {},
    onclose: () => {},
    close: () => {},
    send(m: any) {
      got.push(m);
      const ok = (result: any) => queueMicrotask(() => up.onmessage({ jsonrpc: "2.0", id: m.id, result }));
      if (m.method === "initialize") ok({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "demo", version: "1" } });
      else if (m.method === "tools/list") ok({ tools: TOOLS });
      else if (m.method === "resources/read") ok({ contents: [{ uri: m.params.uri, mimeType: "text/html;profile=mcp-app", text: "<html><head></head><body>board</body></html>", _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] }, prefersBorder: true } } }] });
      else if (m.method === "tools/call") ok({ content: [{ type: "text", text: `ran ${m.params.name}` }], structuredContent: { n: 1 } });
    },
  };
  return up;
}
const tick = () => new Promise((r) => setTimeout(r, 20));

function setup() {
  const data = mkdtempSync(join(tmpdir(), "shep-mcp-"));
  const up = fake();
  const out: any[] = [];
  const gw = new Gateway({ name: "demo", upstream: up, toAgent: (m) => out.push(m), data, terminal: "t9", now: () => 1_000_000 });
  return { data, up, out, gw };
}

test("the agent's initialize says this host shows views; the rest passes as it is", async () => {
  const { up, out, gw } = setup();
  gw.fromAgent({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name: "claude-code", version: "2" } } });
  await tick();
  expect(up.got[0].params.capabilities).toEqual({ roots: {}, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } });
  expect(up.got[0].params.clientInfo.name).toBe("claude-code");
  expect(out[0].id).toBe(1);
  gw.fromAgent({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect(up.got[1]).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
});

test("tools/list leaves out the tools only a view may call", async () => {
  const { out, gw } = setup();
  gw.fromAgent({ jsonrpc: "2.0", id: "a", method: "tools/list", params: {} });
  await tick();
  expect(out[0].result.tools.map((t: any) => t.name)).toEqual(["show", "secret", "plain"]);
  expect(gw.tools.has("refresh")).toBe(true);
});

test("a call to a tool with a view is kept, with its result and its view's HTML", async () => {
  const { data, out, gw } = setup();
  gw.fromAgent({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await tick();
  gw.fromAgent({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show", arguments: { board: "q3" } } });
  gw.fromAgent({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plain", arguments: {} } });
  await tick();
  // the agent gets the server's answers untouched, and never the gateway's own resources/read
  expect(out.map((m) => m.id)).toEqual([1, 2, 3]);
  expect(out[1].result.structuredContent).toEqual({ n: 1 });
  const calls = listCalls(data);
  expect(calls.length).toBe(1);
  const r = readCall(data, calls[0].id)!;
  expect(r).toMatchObject({ server: "demo", tool: "show", args: { board: "q3" }, state: "done", terminal: "t9", at: 1_000_000 });
  expect(r.result.content[0].text).toBe("ran show");
  expect(r.view?.meta?.csp?.connectDomains).toEqual(["https://api.example.com"]);
  expect(readHtml(data, r.view!.sha!)).toContain("board");
  expect(new CallIndex(data).list().map((c) => c.id)).toEqual([r.id]);
});

test("a view may call only tools whose visibility has app, and read resources", async () => {
  const { gw, up } = setup();
  gw.fromAgent({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await tick();
  expect((await gw.fromView("tools/call", { name: "refresh", arguments: { x: 1 } })).result.content[0].text).toBe("ran refresh");
  expect((await gw.fromView("tools/call", { name: "show" })).result).toBeTruthy();
  expect((await gw.fromView("tools/call", { name: "secret" })).error.message).toContain("may not call");
  expect((await gw.fromView("tools/call", { name: "nope" })).error.message).toContain("no tool");
  expect((await gw.fromView("prompts/get", {})).error.message).toContain("may not ask");
  expect((await gw.fromView("resources/read", { uri: "ui://demo/board.html" })).result.contents.length).toBe(1);
  // the gateway's own ids never look like the agent's
  expect(String(up.got.at(-1).id)).toMatch(/^herdr-mcp-\d+-\d+$/);
});

test("the gateway's socket answers a view's call through the service's route, after the person's yes", async () => {
  const { data, gw } = setup();
  const srv = await gw.listen();
  gw.fromAgent({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await tick();
  gw.fromAgent({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show", arguments: {} } });
  await tick();
  const id = listCalls(data)[0].id;
  const post = (body: unknown) => mcpAppsRoute(new Request("http://x/", { method: "POST", body: JSON.stringify(body) }), `/api/mcp-apps/${id}/call`, data);
  const get = (what = "") => mcpAppsRoute(new Request("http://x/"), `/api/mcp-apps/${id}${what}`, data);
  const read = await (await get())!.json();
  expect(read).toMatchObject({ tool: "show", state: "done", live: true, always: [] });
  expect(read.gateway).toBeUndefined();
  expect(read.terminal).toBeUndefined();
  // no yes yet: it asks
  const asked = await post({ method: "tools/call", params: { name: "refresh" } });
  expect(asked!.status).toBe(409);
  expect((await asked!.json()).ask).toBe(true);
  expect((await (await post({ method: "tools/call", params: { name: "refresh" }, ok: "once" }))!.json()).result.content[0].text).toBe("ran refresh");
  expect(allowed(data)).toEqual({});
  await post({ method: "tools/call", params: { name: "refresh" }, ok: "always" });
  expect(allowed(data)).toEqual({ "demo/refresh": true });
  expect((await (await post({ method: "tools/call", params: { name: "refresh" } }))!.json()).result).toBeTruthy();
  expect((await (await post({ method: "tools/call", params: { name: "secret" }, ok: "once" }))!.json()).error.message).toContain("may not call");
  expect((await post({ method: "tools/list" }))!.status).toBe(400);
  // the sandbox: no origin of its own, under the view's CSP
  const sb = (await get("/sandbox"))!;
  const csp = sb.headers.get("content-security-policy")!;
  expect(csp).toStartWith("sandbox allow-scripts");
  expect(csp).not.toContain("allow-same-origin");
  expect(csp).toContain("connect-src https://api.example.com");
  expect(await sb.text()).toContain("ui/notifications/sandbox-proxy-ready");
  expect(await (await get("/html"))!.text()).toContain("board");
  // the gateway gone: its view stays, read only
  srv.close();
  gw.sock && (await import("node:fs")).rmSync(gw.sock, { force: true });
  expect((await (await get())!.json()).live).toBe(false);
  expect((await post({ method: "tools/call", params: { name: "refresh" } }))!.status).toBe(410);
  expect((await mcpAppsRoute(new Request("http://x/"), "/api/mcp-apps/../../etc", data))!.status).toBe(404);
});

test("cspOf: the spec's restrictive default, opened only for declared plain origins", () => {
  const none = cspOf(undefined);
  expect(none).toContain("default-src 'none'");
  expect(none).toContain("connect-src 'none'");
  expect(none).toContain("frame-src 'none'");
  expect(none).toContain("base-uri 'self'");
  expect(none).toContain("object-src 'none'");
  expect(none).toContain("img-src 'self' data:");
  const some = cspOf({ resourceDomains: ["https://cdn.example.com", "https://x.example.com; script-src *", "javascript:alert(1)"], connectDomains: ["wss://*.example.com"], frameDomains: ["https://player.example.com"] });
  expect(some).toContain("script-src 'self' 'unsafe-inline' https://cdn.example.com;");
  expect(some).toContain("connect-src wss://*.example.com");
  expect(some).toContain("frame-src https://player.example.com");
  expect(some).not.toContain("script-src *");
  expect(some).not.toContain("javascript");
  expect(grantedOf({ camera: {}, microphone: {}, clipboardWrite: {} })).toEqual({ clipboardWrite: {} });
  expect(sandboxPage("default-src 'none'", "")).toContain('content=\\"default-src');
});

test("matchCall: the chat's MCP step finds its call by server, tool, input, time and terminal", () => {
  const calls = [
    { id: "a", server: "flowbound", tool: "execute", args: { code: "x", n: 1 }, at: 10_000, terminal: "t1" },
    { id: "b", server: "flowbound", tool: "execute", args: { code: "x", n: 1 }, at: 50_000, terminal: "t1" },
    { id: "c", server: "flowbound", tool: "execute", args: { code: "y" }, at: 10_000, terminal: "t2" },
  ];
  const step = { server: "flowbound", tool: "execute", input: { n: 1, code: "x" }, at: 9_000 };
  expect(matchCall(calls, step, "t1")).toBe("a");
  expect(matchCall(calls, step, "t1", new Set(["a"]))).toBe("b");
  expect(matchCall(calls, { ...step, input: { code: "y" } }, "t1")).toBe(null);
  expect(matchCall(calls, { ...step, input: { code: "y" } }, "t2")).toBe("c");
  expect(matchCall(calls, { ...step, at: 10_000_000 }, "t1")).toBe(null);
  expect(matchCall(calls, { ...step, server: "Flow-Bound" }, null)).toBe(null);
  expect(stable({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stable({ a: [1, { c: 3, d: 2 }], b: 1 }));
});

test("herdr-mcp passes a real stdio server through, line by line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shep-mcp-bin-"));
  const server = join(dir, "server.js");
  writeFileSync(server, `
const rl = require("readline").createInterface({ input: process.stdin });
rl.on("line", (l) => { const m = JSON.parse(l); if (m.id === undefined) return;
  const r = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "s", version: "1" }, echo: m.params.capabilities }
    : m.method === "tools/list" ? { tools: [] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: r }) + "\\n"); });`);
  chmodSync(server, 0o755);
  const { spawn } = await import("node:child_process");
  const p = spawn("bun", [join(import.meta.dir, "gateway.ts"), "demo", "--", "node", server], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, SHEPHERDR_DATA: dir } });
  const lines: any[] = [];
  const got = new Promise<void>((done) => {
    let buf = "";
    p.stdout!.on("data", (d) => {
      buf += d;
      while (buf.includes("\n")) { const i = buf.indexOf("\n"); lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      if (lines.length === 2) done();
    });
  });
  p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: {} } }) + "\n");
  p.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  await got;
  const exited = new Promise((done) => p.on("exit", done));
  p.stdin!.end();
  expect(lines.map((l) => l.id)).toEqual([1, 2]);
  expect(lines[0].result.echo.extensions["io.modelcontextprotocol/ui"].mimeTypes).toEqual(["text/html;profile=mcp-app"]);
  expect(await exited).toBe(0);
});
