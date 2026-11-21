import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVE_ADMIN, SERVE_WAIT, freePort, heldBy, httpsPort, meOf, runCmd, serveNotEnabled, shareProblem, webLink, webOrigin } from "./tailscale.ts";

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

describe("who owns this machine (GitHub #845)", () => {
  const status = (id: string, extra = "") =>
    `{"Self":{"UserID":${id},"DNSName":"box.tailnet.example.","HostName":"box"},${extra}"User":{"${id}":{"LoginName":"sam@example.com","DisplayName":"Sam"}}}`;
  test("a small user id finds its owner", () => {
    expect(meOf(status("12345"))).toEqual({ login: "sam@example.com", name: "Sam", dns: "box.tailnet.example", host: "box" });
  });
  test("a user id past 2^53 still finds its owner", () => {
    expect(meOf(status("9007199254740993"))?.login).toBe("sam@example.com");
    expect(meOf(status("5934875123456789123", `"Peer":{"k":{"UserID":5934875123456789124}},`))?.login).toBe("sam@example.com");
  });
  test("no owner or bad output is null", () => {
    expect(meOf(`{"Self":{"UserID":1,"DNSName":"box.tailnet.example."},"User":{}}`)).toBeNull();
    expect(meOf("not json")).toBeNull();
  });
});

describe("Serve not turned on for the tailnet (GitHub #1229, #1114)", () => {
  const said = "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.example/f/serve?node=n123\n";
  test("says it plainly with tailscale's own link", () => {
    expect(serveNotEnabled(said)).toBe("Tailscale Serve isn't turned on for your tailnet. An admin can turn it on here: https://login.tailscale.example/f/serve?node=n123");
    expect(shareProblem({}, 443, said, true)).toBe(serveNotEnabled(said)!);
  });
  test("no link of its own: the admin console's", () => {
    expect(serveNotEnabled("Serve is not enabled on your tailnet.")).toContain(SERVE_ADMIN);
  });
  test("other failures keep tailscale's own words", () => {
    expect(serveNotEnabled("error: serve config denied")).toBeNull();
    expect(shareProblem({}, 443, "", true)).toBe(`tailscale serve didn't answer in ${SERVE_WAIT / 1000} seconds`);
  });
  test("a command that waits forever is ended in time, keeping what it printed", async () => {
    const t = Date.now();
    const r = await runCmd(["sh", "-c", "echo 'Serve is not enabled on your tailnet.'; echo 'https://login.tailscale.example/f/serve?node=x'; exec sleep 30"], 500);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(serveNotEnabled(r.out)).toContain("https://login.tailscale.example/f/serve?node=x");
  });
  test("a quick one isn't marked as timed out", async () => {
    expect(await runCmd(["sh", "-c", "echo hi"], 5000)).toEqual({ ok: true, out: "hi\n", err: "" });
  });
});

describe("one tailscale serve at a time (GitHub #1229)", () => {
  test("looks while one waits share its answer; nothing is left running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shep-ts-"));
    const log = join(dir, "log");
    // a tailscale whose serve waits on its consent link, as on a tailnet without Serve
    writeFileSync(join(dir, "tailscale"), `#!/bin/sh
case "$1 $2" in
  "serve status") echo '{}' ;;
  "serve --bg") echo serve >> "${log}"; echo 'Serve is not enabled on your tailnet.'; echo 'To enable, visit:'; echo '  https://login.tailscale.example/f/serve?node=n1'; exec sleep 30 ;;
esac
`, { mode: 0o755 });
    const script = join(dir, "run.ts");
    writeFileSync(script, `import * as ts from ${JSON.stringify(join(import.meta.dir, "tailscale.ts"))};
const said = await Promise.all([ts.share("box.example", 7788), ts.share("box.example", 7788), ts.share("box.example", 7788)]);
console.log(JSON.stringify(said));`);
    const p = Bun.spawn([process.execPath, script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SHEPHERDR_TEST_SERVE_WAIT: "700" }, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    const said = JSON.parse(out.trim().split("\n").pop()!);
    expect(said).toHaveLength(3);
    for (const s of said) expect(s).toBe("Tailscale Serve isn't turned on for your tailnet. An admin can turn it on here: https://login.tailscale.example/f/serve?node=n1");
    expect(readFileSync(log, "utf8")).toBe("serve\n");
  }, 15_000);
});
