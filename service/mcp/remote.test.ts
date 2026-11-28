import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Gateway, type Upstream } from "./gateway.ts";
import { allowed } from "./records.ts";
import { RemoteCalls, type Exec } from "./remote.ts";
import { mcpAppsRoute } from "../mcp-apps.ts";

// The far machine: a gateway with its calls in its own folder, and the real herdr-mcp (bin/herdr-mcp) answering
// machine.exec there. This machine's service has a folder of its own, which never sees those calls.
function farMachine() {
  const far = mkdtempSync(join(tmpdir(), "shep-mcp-far-"));
  const home = mkdtempSync(join(tmpdir(), "shep-mcp-home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  symlinkSync(join(import.meta.dir, "..", "..", "bin", "herdr-mcp"), join(home, ".local", "bin", "herdr-mcp"));
  const asked: string[][] = [];
  const exec: Exec = async (machine, argv) => {
    asked.push([machine, ...argv]);
    if (machine !== "vm-far") return { code: 255, out: Buffer.from(""), err: "no such machine" };
    // not spawnSync: the far gateway answers in this process
    const p = spawn(argv[0], argv.slice(1), { env: { HOME: home, PATH: process.env.PATH, SHEPHERDR_DATA: far } });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    const code = await new Promise<number>((ok) => p.on("close", (c) => ok(c ?? 1)));
    return { code, out: Buffer.concat(out), err: Buffer.concat(err).toString() };
  };
  return { far, exec, asked };
}

function upstream() {
  const up: Upstream = {
    onmessage: () => {}, onclose: () => {}, close: () => {},
    send(m: any) {
      const ok = (result: any) => queueMicrotask(() => up.onmessage({ jsonrpc: "2.0", id: m.id, result }));
      if (m.method === "tools/list") ok({ tools: [
        { name: "show", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://demo/board.html" } } },
        { name: "refresh", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://demo/board.html", visibility: ["app"] } } },
      ] });
      else if (m.method === "resources/read") ok({ contents: [{ uri: m.params.uri, mimeType: "text/html;profile=mcp-app", text: BIG }] });
      else if (m.method === "tools/call") ok({ content: [{ type: "text", text: `ran ${m.params.name} there` }] });
    },
  };
  return up;
}
// bigger than a pipe takes at once (Flowbound's view is ~900 KB): herdr-mcp must not exit before it is all written
const BIG = `<html><head></head><body>far board${"x".repeat(300_000)}</body></html>`;
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test("a view from an agent on another machine: listed, read and called there, the yes asked here", async () => {
  const { far, exec, asked } = farMachine();
  const here = mkdtempSync(join(tmpdir(), "shep-mcp-here-"));
  const gw = new Gateway({ name: "demo", upstream: upstream(), toAgent: () => {}, data: far, terminal: "t1" });
  const srv = await gw.listen();
  gw.fromAgent({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  await tick();
  gw.fromAgent({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "show", arguments: { board: "q4" } } });
  await tick(100);

  const remote = new RemoteCalls(exec);
  remote.machines = () => ["vm-far", "vm-gone"];
  let told = 0;
  remote.on(() => told++);
  await remote.read();
  const [c] = remote.of("vm-far");
  expect(c).toMatchObject({ server: "demo", tool: "show", args: { board: "q4" } });
  expect(told).toBe(1);
  expect(remote.of("vm-gone")).toEqual([]);
  // read again: only what is newer is asked for, nothing changed, no one told
  await remote.read();
  expect(told).toBe(1);
  expect(asked.filter((a) => a[0] === "vm-far").at(-1)).toContain(String(c.at));
  // a machine without herdr-mcp isn't asked again at once
  const gone = asked.filter((a) => a[0] === "vm-gone").length;
  await remote.read();
  expect(asked.filter((a) => a[0] === "vm-gone").length).toBe(gone);

  const base = `/api/mcp-apps/on/vm-far/${c.id}`;
  const get = (what = "") => mcpAppsRoute(new Request("http://x/"), `${base}${what}`, here, remote);
  const post = (body: unknown) => mcpAppsRoute(new Request("http://x/", { method: "POST", body: JSON.stringify(body) }), `${base}/call`, here, remote);
  const read = await (await get())!.json();
  expect(read).toMatchObject({ tool: "show", state: "done", live: true, always: [] });
  expect(read.gateway).toBeUndefined();
  expect(await (await get("/html"))!.text()).toBe(BIG);
  expect((await get("/sandbox"))!.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  // the person's yes, here, before anything reaches that machine
  const before = asked.length;
  expect((await post({ method: "tools/call", params: { name: "refresh" } }))!.status).toBe(409);
  expect(asked.length).toBe(before + 1);   // only the read of the call
  expect((await (await post({ method: "tools/call", params: { name: "refresh" }, ok: "once" }))!.json()).result.content[0].text).toBe("ran refresh there");
  await post({ method: "tools/call", params: { name: "refresh" }, ok: "always" });
  // Always is that machine's server's: the same name here or elsewhere asks again
  expect(allowed(here)).toEqual({ "vm-far:demo/refresh": true });
  expect((await (await get())!.json()).always).toEqual(["refresh"]);
  expect((await post({ method: "tools/call", params: { name: "refresh" } }))!.status).toBe(200);
  // the far gateway gone: its view stays, read only
  srv.close();
  (await import("node:fs")).rmSync(gw.sock, { force: true });
  expect((await (await get())!.json()).live).toBe(false);
  expect((await post({ method: "tools/call", params: { name: "refresh" } }))!.status).toBe(410);
  // no such machine or call
  expect((await mcpAppsRoute(new Request("http://x/"), `/api/mcp-apps/on/vm-gone/${c.id}`, here, remote))!.status).toBe(404);
  expect((await mcpAppsRoute(new Request("http://x/"), `/api/mcp-apps/on/a%20b/${c.id}`, here, remote))!.status).toBe(404);
  expect((await mcpAppsRoute(new Request("http://x/"), `/api/mcp-apps/on/vm-far/${c.id}`, here, null))!.status).toBe(404);
}, 30_000);
