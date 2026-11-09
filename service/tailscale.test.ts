import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, heldBy, httpsPort, shareProblem, webLink, webOrigin } from "./tailscale.ts";

describe("the web app's tailnet HTTPS port", () => {
  test("443 unless the https-port file says another", () => {
    const dir = mkdtempSync(join(tmpdir(), "shep-hp-"));
    const f = join(dir, "https-port");
    expect(httpsPort(f)).toBe(443);
    writeFileSync(f, "8443\n");
    expect(httpsPort(f)).toBe(8443);
    for (const junk of ["0", "70000", "x", "84.5"]) {
      writeFileSync(f, junk);
      expect(httpsPort(f)).toBe(443);
    }
  });
  test("links carry the port only when it isn't 443", () => {
    expect(webLink("box.tailnet.example")).toBe("https://box.tailnet.example/shepherdr/");
    expect(webLink("box.tailnet.example", 443)).toBe("https://box.tailnet.example/shepherdr/");
    expect(webLink("box.tailnet.example", 8443)).toBe("https://box.tailnet.example:8443/shepherdr/");
    expect(webOrigin("box.tailnet.example", 8443)).toBe("https://box.tailnet.example:8443");
  });
});

describe("why sharing can't work (GitHub #754)", () => {
  const forward = { TCP: { "443": { TCPForward: "127.0.0.1:9000" } } };
  test("a TCP forward on the port holds it; Tailscale's own HTTPS there doesn't", () => {
    expect(heldBy(forward, 443)).toBe("a TCP forward to 127.0.0.1:9000");
    expect(heldBy({ TCP: { "443": { HTTPS: true } } }, 443)).toBeNull();
    expect(heldBy(forward, 8443)).toBeNull();
    expect(heldBy({}, 443)).toBeNull();
  });
  test("says plainly the port is taken and suggests a free one", () => {
    const why = shareProblem(forward, 443);
    expect(why).toContain("Port 443");
    expect(why).toContain("TCP forward to 127.0.0.1:9000");
    expect(why).toContain("`shepherdr web https-port 8443`");
    expect(freePort({ TCP: { "443": {}, "8443": {} } }, 443)).toBe(9443);
    expect(freePort({}, 8443)).toBe(9443);
  });
  test("passes tailscale's own words through", () => {
    expect(shareProblem({}, 443, "error: serve config denied\n\nmore detail\n")).toBe("tailscale serve failed: error: serve config denied more detail");
    expect(shareProblem({}, 443, "")).toBe("tailscale serve failed");
    expect(shareProblem({}, 443, "port 443 is already in use")).toContain("`shepherdr web https-port 8443`");
  });
});
