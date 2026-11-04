import { describe, expect, test } from "bun:test";
import { gate, type Gate } from "./auth.ts";

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
  test("cross-site and preflight requests are refused", () => {
    expect(gate(tailnet({ headers: { "sec-fetch-site": "cross-site" } }), g, false, true)).toMatchObject({ ok: false });
    expect(gate(tailnet({ method: "OPTIONS" }), g, false, true)).toMatchObject({ ok: false });
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
