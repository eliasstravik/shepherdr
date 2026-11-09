// shepherdr web serve-from <machine|here> [--take-link] [--json]: moves the web app to a machine (bin/shepherdr runs
// this with Bun; Settings › Web's Serve from runs that). In order:
//   1. Shepherdr's web service there, installed or brought up to date (shepherdr web install-on, over herdr-core's link),
//      and running (its node record says so);
//   2. with --take-link, /shepherdr on that machine's tailnet name shared to something else is set aside (kept in
//      replaced-share.json in the service's folder there; moving away again puts it back);
//   3. the shared document, the settings file and the role instructions copied from the machine serving now, in the
//      new one's words (core/host.js);
//   4. the host record, newer, written here and on every machine linked from here; each service follows it: the new
//      host shares /shepherdr, the old one stops, the others read and write their shared data there;
//   5. the new link, once the new host says it.
// shepherdr web status [--json]: which machine serves it now and its link.
import { CoreClient } from "./hc/client.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as HC from "../core/host.js";
import { buildId } from "./build.ts";
import { underTest } from "./paths.ts";
import { SH } from "../core/paths.js";

const { HOST_DOC, NODE_DOC, newestHost, nodeAlive, renamer, relocateDoc, relocateSettings } = HC as any;
const VERSION = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version as string;

const args = process.argv.slice(2);
const json = args.includes("--json"), take = args.includes("--take-link");
const [cmd, target] = args.filter((a) => !a.startsWith("--"));
const say = (s: string) => { if (!json) console.log(s); };
const fail = (s: string): never => { if (json) console.log(JSON.stringify({ ok: false, error: s })); else console.error(`shepherdr: ${s}`); process.exit(1); };

const c = await CoreClient.endpoint({ binary: process.env.SHEPHERDR_HC || "hc" }).catch((e) => fail(`herdr-core isn't answering here: ${(e as Error).message}`));
const call = <T = any>(method: string, params: Record<string, unknown> = {}, timeout = 20_000) => c.call<T>(method, params, timeout);
const at = (on: string | null) => (on ? { on } : {});
const getDoc = (name: string, on: string | null) => call<{ value: any; version: number }>("doc.get", { name, ...at(on) });
async function setDoc(name: string, value: unknown, on: string | null) {
  for (let i = 0; i < 5; i++) {
    const d = await getDoc(name, on);
    try { return await call("doc.set", { name, value, version: d.version, ...at(on) }); }
    catch (e) { if ((e as any).kind !== "conflict") throw e; }
  }
  throw new Error(`${name} kept changing`);
}
async function exec(argv: string[], on: string | null, input?: string, timeout = 60) {
  const r = await call<{ code: number; stdout: string; stderr: string }>("machine.exec", { argv, ...at(on), timeout, ...(input !== undefined ? { input: Buffer.from(input).toString("base64") } : {}) }, (timeout + 5) * 1000);
  const text = (b: string) => Buffer.from(b ?? "", "base64").toString("utf8");
  return { code: r.code, stdout: text(r.stdout), stderr: text(r.stderr) };
}
async function readFile(rel: string, on: string | null): Promise<string | null> {
  try { return (await call<{ text: string }>("file.read", { path: rel, ...at(on) })).text; }
  catch (e) { if ((e as any).kind === "not_found") return null; throw e; }
}
// The settings file on a machine, wherever it keeps it (its Shepherdr folders, or ~/.herdr on an older one: core/paths.js SH).
async function readSettingsOn(on: string | null): Promise<string | null> {
  const r = await exec(["sh", "-c", SH + '[ -e "$SHEP_SETTINGS" ] || exit 3; cat "$SHEP_SETTINGS"'], on);
  if (r.code === 3) return null;
  if (r.code !== 0) throw new Error(`couldn't read the settings${on ? ` on ${on}` : ""}: ${r.stderr.trim()}`);
  return r.stdout;
}
async function writeSettingsOn(text: string, on: string | null) {
  if (underTest()) throw new Error("A test may not write a real settings file.");
  const r = await exec(["sh", "-c", SH + 'f="$SHEP_SETTINGS"; mkdir -p "$(dirname "$f")" && umask 077 && cat > "$f.host-tmp" && mv "$f.host-tmp" "$f"'], on, text);
  if (r.code !== 0) throw new Error(`couldn't write the settings${on ? ` on ${on}` : ""}`);
}
const writeFile = async (rel: string, text: string, on: string | null) => {
  // a test never moves the person's settings (paths.ts writableSettings)
  if (underTest() && rel.endsWith("shepherdr.json")) throw new Error("A test may not write a real settings file.");
  const r = await exec(["sh", "-c", 'mkdir -p "$(dirname "$1")" && umask 077 && cat > "$1.host-tmp" && mv "$1.host-tmp" "$1"', "sh", rel], on, text);
  if (r.code !== 0) throw new Error(`couldn't write ${rel}${on ? ` on ${on}` : ""}`);
};

// ---- who is who ---------------------------------------------------------------------------------------------------
const me = (await call<any>("server.status")).core as { id: string; name: string };
const list = ((await call<{ machines: any[] }>("machine.list")).machines ?? []).filter((m) => !m.temporary);
const links: Record<string, string> = Object.fromEntries(list.filter((m) => m.id).map((m) => [m.name, m.id]));
const nameOf = (id: string): string | null | undefined => (id === me.id ? null : list.find((m) => m.id === id)?.name);
const connected = list.filter((m) => m.state === "connected").map((m) => m.name as string);
const node = async (on: string | null) => { const v = (await getDoc(NODE_DOC, on).catch(() => null))?.value; return nodeAlive(v) ? v : null; };
// a machine's names for the others: its node record's, or for this machine its link list now
const namesOf = async (on: string | null) => (on === null ? { id: me.id, links } : await node(on));

const record = newestHost([(await getDoc(HOST_DOC, null).catch(() => null))?.value]);
const from = record ? nameOf(record.id) : null;   // the machine serving now (null: this one)
const linkOf = async (on: string | null) => (await node(on))?.link ?? null;

if (cmd === "status") {
  const where = from === undefined ? "a machine not linked from here" : from === null ? "this computer" : from;
  const link = from === undefined ? null : await linkOf(from as string | null);
  if (json) console.log(JSON.stringify({ ok: true, host: from ?? null, here: from === null, link }));
  else say(`Shepherdr's web app is served from ${where}${link ? `: ${link}` : ""}.`);
  process.exit(0);
}
if (cmd !== "serve-from" || !target) fail("usage: shepherdr web serve-from <machine|here> [--take-link] [--json] | shepherdr web status");

const to: string | null = target === "here" || target === me.name ? null : target;
if (to !== null && !links[to]) fail(`${to} isn't a machine linked from here (hc machine ls).`);
if (to !== null && !connected.includes(to)) fail(`${to} is offline: it needs to be on to serve the web app.`);
const toId = to === null ? me.id : links[to];
if (from === undefined) fail("The machine serving the web app now isn't linked from here: move it from there.");
const was = from as string | null;
if (from && !connected.includes(from)) say(`${from} (serving now) is offline: its shared data stays as this machine last had it.`);

// ---- 1. the service there -----------------------------------------------------------------------------------------
// what this machine would send: its own build (the other one runs another: send it again, even at one version)
const BUILD = buildId();
let there = await node(to);
if (!there || there.version !== VERSION || (there.build && there.build !== BUILD) || (!there.build && to !== null)) {
  say(`Installing Shepherdr's web service on ${to ?? "this computer"}…`);
  const cli = process.env.SHEPHERDR_CLI || "shepherdr";
  const p = Bun.spawn([cli, "web", "install-on", to ?? "here"], { stdout: json ? "pipe" : "inherit", stderr: "pipe", stdin: "ignore" });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) !== 0) fail(err.trim().split("\n").pop()?.replace(/^shepherdr: /, "") || `couldn't install it on ${to}`);
  for (let i = 0; i < 60 && !(there?.build === BUILD); i++) { await Bun.sleep(2000); there = await node(to); }
  if (there?.build !== BUILD) fail(`Shepherdr's web service on ${to ?? "this computer"} hasn't started again: \`shepherdr doctor\` there says why.`);
}

// ---- 2. the link there --------------------------------------------------------------------------------------------
const TAKE = `${SH}set -e; mkdir -p "$SHEP_SERVICE"; f="$SHEP_SERVICE/replaced-share.json"
s=$(tailscale serve status --json 2>/dev/null || echo '{}')
printf '%s' "$s" | SHEP_SERVICE="$SHEP_SERVICE" python3 -c '
import json, os, sys
s = json.load(sys.stdin)
try: port = int(json.load(open(os.path.join(os.environ["SHEP_SERVICE"], "service.json")))["port"])
except Exception: port = 7788
for hp, web in (s.get("Web") or {}).items():
    h = (web.get("Handlers") or {}).get("/shepherdr")
    if h and h.get("Proxy") and not h["Proxy"].endswith(f":{port}"):
        print(hp.rsplit(":", 1)[1], h["Proxy"])
' > "$f.tmp" || true
if [ -s "$f.tmp" ]; then read port proxy < "$f.tmp"; printf '{"port":"%s","proxy":"%s","at":%s}\\n' "$port" "$proxy" "$(date +%s)" > "$f"
  tailscale serve --https="$port" --set-path /shepherdr off >/dev/null; echo "took $proxy"; fi
rm -f "$f.tmp"`;
if (take) {
  const r = await exec(["sh", "-c", `PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/Applications/Tailscale.app/Contents/MacOS:$PATH"; ${TAKE}`], to);
  if (r.code !== 0) fail(`couldn't set aside /shepherdr on ${to ?? "this computer"}: ${r.stderr.trim()}`);
  if (r.stdout.trim()) say(`/shepherdr on ${to ?? "this computer"} was shared to ${r.stdout.trim().slice(5)}: set aside (moving away puts it back).`);
}

// ---- 3. the shared data, in the new host's words ------------------------------------------------------------------
if ((record?.id ?? me.id) !== toId && (was === null || connected.includes(was))) {
  const src = await namesOf(was), dst = to === null ? { id: me.id, links } : there;
  if (!src || !dst) fail("couldn't read both machines' names (is Shepherdr's service running on both?)");
  const move = renamer(src, dst);
  const doc = (await getDoc("shepherdr", was)).value;
  if (doc && typeof doc === "object") await setDoc("shepherdr", relocateDoc(doc, move), to);
  const settings = await readSettingsOn(was);
  if (settings) {
    let f: any = null;
    try { f = JSON.parse(settings); } catch { fail("the settings file there isn't valid JSON: fix it first"); }
    // a pushed copy holds only that machine's part: no truth to move
    if (!("pushed_from" in f)) await writeSettingsOn(JSON.stringify({ ...relocateSettings(f, move), version: 1 }, null, 2) + "\n", to);
  }
  for (const t of ["assistant.md", "worker.md", "reviewer.md"]) {
    const text = await readFile(`.config/herdr-core/templates/${t}`, was);
    if (text !== null) await writeFile(`.config/herdr-core/templates/${t}`, text, to);
  }
  say("Copied the pins, sidebar, Notify, settings and role instructions over.");
}

// ---- 4. the record everywhere -------------------------------------------------------------------------------------
const next = { id: toId, at: Date.now(), by: me.id };
await setDoc(HOST_DOC, next, null);
for (const m of connected) await setDoc(HOST_DOC, next, m).catch(() => {});

// ---- 5. the new link ----------------------------------------------------------------------------------------------
let link: string | null = null;
for (let i = 0; i < 45 && !link; i++) {
  const n = await node(to);
  if (n?.serving && n.link) link = n.link;
  else await Bun.sleep(2000);
}
if (json) console.log(JSON.stringify({ ok: true, host: to, link }));
else say(link ? `Shepherdr's web app is served from ${to ?? "this computer"}: ${link}` : `Moved to ${to ?? "this computer"}; its link comes once Tailscale shares it there (\`shepherdr web status\`).`);
c.close();
process.exit(0);
