import { describe, expect, test } from "bun:test";
import { gate, localCaller, type Gate } from "./auth.ts";

const g: Gate = { owner: "me@example.com", dns: "box.tailnet.example", port: 7788, token: "secret-token" };
const tailnet = (init: { method?: string; headers?: Record<string, string> } = {}) =>
  new Request("http://box.tailnet.example/api/me", {
    method: init.method ?? "GET",
    headers: { host: "box.tailnet.example", "tailscale-user-login": "me@example.com", ...init.headers },
  });
const local = (headers: Record<string, string> = {}) =>
  new Request("http://127.0.0.1:7788/api/me", { headers: { host: "127.0.0.1:7788", ...headers } });

describe("through tailscale serve", () => {
  test("the owner reads", () => expect(gate(tailnet(), g, false, true)).toMatchObject({ ok: true, via: "tailnet" }));
  test("someone else on the tailnet is refused", () =>
    expect(gate(tailnet({ headers: { "tailscale-user-login": "other@example.com" } }), g, false, true)).toMatchObject({ ok: false, status: 403 }));
  test("the header from a connection Tailscale didn't open is refused", () =>
    expect(gate(tailnet(), g, false, false)).toMatchObject({ ok: false, status: 403 }));
  test("another host name is refused (DNS rebinding)", () =>
    expect(gate(tailnet({ headers: { host: "evil.example" } }), g, false, true)).toMatchObject({ ok: false, status: 421 }));
  test("without Tailscale running nobody gets in", () =>
    expect(gate(tailnet(), { ...g, owner: null }, false, true)).toMatchObject({ ok: false, status: 503 }));
  test("a write needs the page's own origin and the header", () => {
    const ok = tailnet({ method: "POST", headers: { origin: "https://box.tailnet.example", "x-shepherdr": "1" } });
    expect(gate(ok, g, false, true)).toMatchObject({ ok: true });
    const noHeader = tailnet({ method: "POST", headers: { origin: "https://box.tailnet.example" } });
    expect(gate(noHeader, g, false, true)).toMatchObject({ ok: false, status: 403 });
    const otherOrigin = tailnet({ method: "POST", headers: { origin: "https://evil.example", "x-shepherdr": "1" } });
    expect(gate(otherOrigin, g, false, true)).toMatchObject({ ok: false, status: 403 });
  });
  test("a socket from another site is refused", () => {
    expect(gate(tailnet({ headers: { origin: "https://evil.example" } }), g, true, true)).toMatchObject({ ok: false });
    expect(gate(tailnet({ headers: { origin: "https://box.tailnet.example" } }), g, true, true)).toMatchObject({ ok: true });
  });
  test("on another HTTPS port (GitHub #778), only that port's host and origin get in", () => {
    const g2: Gate = { ...g, httpsPort: 8443 };
    const at = (method = "GET", headers: Record<string, string> = {}) =>
      tailnet({ method, headers: { host: "box.tailnet.example:8443", ...headers } });
    expect(gate(at(), g2, false, true)).toMatchObject({ ok: true, via: "tailnet" });
    expect(gate(tailnet(), g2, false, true)).toMatchObject({ ok: false, status: 421 });
    expect(gate(tailnet({ headers: { host: "box.tailnet.example:443" } }), g2, false, true)).toMatchObject({ ok: false, status: 421 });
    expect(gate(at("POST", { origin: "https://box.tailnet.example:8443", "x-shepherdr": "1" }), g2, false, true)).toMatchObject({ ok: true });
    expect(gate(at("POST", { origin: "https://box.tailnet.example", "x-shepherdr": "1" }), g2, false, true)).toMatchObject({ ok: false, status: 403 });
    expect(gate(at("GET", { origin: "https://box.tailnet.example:8443" }), g2, true, true)).toMatchObject({ ok: true });
    expect(gate(at("GET", { origin: "https://box.tailnet.example:9443" }), g2, true, true)).toMatchObject({ ok: false, status: 403 });
  });
  test("443 set outright is the default: the bare name and :443 both get in", () => {
    const g443: Gate = { ...g, httpsPort: 443 };
    expect(gate(tailnet(), g443, false, true)).toMatchObject({ ok: true });
    expect(gate(tailnet({ headers: { host: "box.tailnet.example:443" } }), g443, false, true)).toMatchObject({ ok: true });
    expect(gate(tailnet({ headers: { host: "box.tailnet.example:8443" } }), g443, false, true)).toMatchObject({ ok: false, status: 421 });
  });
  test("cross-site and preflight requests are refused", () => {
    expect(gate(tailnet({ headers: { "sec-fetch-site": "cross-site" } }), g, false, true)).toMatchObject({ ok: false });
    expect(gate(tailnet({ method: "OPTIONS" }), g, false, true)).toMatchObject({ ok: false });
  });
  describe("a link from another site (GitHub #913, SHEP-191)", () => {
    // a top-level navigation: a link clicked in Slack or another site, a typed or bookmarked page
    const nav = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
    const page = (path: string, headers: Record<string, string> = {}, method = "GET") =>
      new Request(`http://box.tailnet.example${path}`, {
        method,
        headers: { host: "box.tailnet.example", "tailscale-user-login": "me@example.com", ...headers },
      });

    test("the owner's cross-site link opens the entry page", () => {
      expect(gate(page("/", nav), g, false, true)).toMatchObject({ ok: true, via: "tailnet" });
      expect(gate(page("/?task=abc", nav), g, false, true)).toMatchObject({ ok: true, via: "tailnet" });
      expect(gate(page("/shepherdr/", nav), g, false, true)).toMatchObject({ ok: true, via: "tailnet" });
    });
    test("the link still needs the owner, the host and Tailscale's connection", () => {
      expect(gate(page("/", { ...nav, "tailscale-user-login": "other@example.com" }), g, false, true)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/", nav), g, false, false)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/", { ...nav, host: "evil.example" }), g, false, true)).toMatchObject({ ok: false, status: 421 });
    });
    test("a cross-site API read is still refused, even as a navigation", () => {
      expect(gate(page("/api/me", nav), g, false, true)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/shepherdr/api/me", nav), g, false, true)).toMatchObject({ ok: false, status: 403 });
    });
    test("a cross-site page that isn't a top-level navigation is refused", () => {
      const iframe = { ...nav, "sec-fetch-dest": "iframe" };
      expect(gate(page("/", iframe), g, false, true)).toMatchObject({ ok: false, status: 403 });
      const script = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" };
      expect(gate(page("/", script), g, false, true)).toMatchObject({ ok: false, status: 403 });
      const fetched = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
      expect(gate(page("/", fetched), g, false, true)).toMatchObject({ ok: false, status: 403 });
    });
    test("a cross-site write is refused, even when it is a form's navigation", () => {
      expect(gate(page("/", { ...nav, origin: "https://evil.example", "x-shepherdr": "1" }, "POST"), g, false, true)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/", { ...nav, origin: "https://box.tailnet.example", "x-shepherdr": "1" }, "POST"), g, false, true)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/", { ...nav, origin: "https://box.tailnet.example", "x-shepherdr": "1" }, "PUT"), g, false, true)).toMatchObject({ ok: false, status: 403 });
    });
    test("a cross-site WebSocket is refused, even when it looks like a navigation", () => {
      expect(gate(page("/api/ws", nav), g, true, true)).toMatchObject({ ok: false, status: 403 });
      expect(gate(page("/api/ws", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "websocket", "sec-fetch-dest": "empty", origin: "https://evil.example" }), g, true, true)).toMatchObject({ ok: false, status: 403 });
    });
  });
});

describe("on this machine", () => {
  test("the token gets in", () => expect(gate(local({ authorization: "Bearer secret-token" }), g)).toMatchObject({ ok: true, via: "local" }));
  test("no token, no entry", () => expect(gate(local(), g)).toMatchObject({ ok: false, status: 401 }));
  test("a wrong token is refused", () => expect(gate(local({ authorization: "Bearer nope" }), g)).toMatchObject({ ok: false, status: 401 }));
  test("a browser page on 127.0.0.1 is refused even with the token", () =>
    expect(gate(local({ authorization: "Bearer secret-token", origin: "http://127.0.0.1:7788" }), g)).toMatchObject({ ok: false }));
  test("another host name is refused", () =>
    expect(gate(new Request("http://x/api", { headers: { host: "evil.example", authorization: "Bearer secret-token" } }), g)).toMatchObject({ ok: false, status: 421 }));
});

test("macOS: the caller's side of the exact connection, from netstat -anv (Tailscale's extension runs as root)", async () => {
  const { darwinPids } = await import("./peer.ts");
  const text = [
    "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options",
    "tcp4       0      0  127.0.0.1.7788         127.0.0.1.56078        ESTABLISHED         4440          976  406272  146988              bun:87948  00102 00000004",
    "tcp4       0      0  127.0.0.1.56078        127.0.0.1.7788         ESTABLISHED         2160         2116  407552  146988 io.tailscale.ipn:3083   00182 00000008",
    "tcp4       0      0  127.0.0.1.56079        127.0.0.1.7788         TIME_WAIT           2160         2116  407552  146988 curl:4000   00182 00000008",
  ].join("\n");
  expect(darwinPids(56078, 7788, text)).toEqual([3083]);
  expect(darwinPids(56079, 7788, text)).toEqual([]);
  // a name made to look like a pid ("evil:1 x") still reads as its own pid, the last one netstat wrote
  const forged = "tcp4       0      0  127.0.0.1.56080        127.0.0.1.7788         ESTABLISHED         2160         2116  407552  146988 evil:1 x:4242   00182 00000008 000000000eb4b4f3 00000080 04000800      2      0 000000";
  expect(darwinPids(56080, 7788, forged)).toEqual([4242]);
});

test("macOS: netstat giving no socket table is said in the refusal, not a bare 'not from Tailscale' (GitHub #777)", async () => {
  const { netstatProblem } = await import("./peer.ts");
  expect(netstatProblem("Active Internet connections (including servers)\nProto Recv-Q", 0, "")).toBe(null);
  expect(netstatProblem("", 0, "")).toBe("netstat gave no socket table here (exit 0, no output)");
  expect(netstatProblem("", 1, "netstat: sysctl: net.inet.tcp.pcblist_n: Operation not permitted\n")).toContain("Operation not permitted");
  expect(netstatProblem("", null, "")).toContain("didn't run");
});

describe("health's id only to this machine's callers (GitHub #635)", () => {
  test("the window on 127.0.0.1 by the service's port", () => expect(localCaller(local(), 7788)).toBe(true));
  test("not through tailscale serve", () => expect(localCaller(tailnet(), 7788)).toBe(false));
  test("not a tagged device's request through tailscale serve (the machine's name, no login)", () =>
    expect(localCaller(tailnet({ headers: { "tailscale-user-login": "" } }), 7788)).toBe(false));
  test("not a browser page", () => expect(localCaller(local({ origin: "http://127.0.0.1:7788" }), 7788)).toBe(false));
  test("not by another port", () => expect(localCaller(local(), 7790)).toBe(false));
});
