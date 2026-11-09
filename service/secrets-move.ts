// shepherdr secrets move-to <machine|here> [--restore] [--json]: moves the secrets (the vault: secrets/vault.json in
// Shepherdr's data folder, or ~/.herdr/vault.json on a machine whose data hasn't moved yet: core/paths.js SH) to
// another machine linked over herdr-core, which then keeps them (Settings › Secrets › Kept on runs this). Run anywhere:
// a machine that doesn't keep them passes the move to the one that does. On the machine that keeps them, in order:
//   1. herdr-secret there knows where secrets are kept (a release that has `herdr-secret where`), and its names for
//      the machines (each machine names the others its own way: a machine's or a space's secret is renamed);
//   2. the vault there, if any, backed up as vault.json.before-move-<time>, its entries this one lacks kept;
//   3. the vault written there whole (owner-only, over herdr-core's link: never in a command line or a log) and read
//      back: the same bytes, or nothing changes;
//   4. the record ("shepherdr.secrets" = { id, at, by }) written here, there and on every machine linked from here;
//      each service hands it on. From then the new machine answers every agent's request, and this one refuses;
//   5. a few seconds later (requests under way here finish), the vault here set aside as vault.json.moved-<time>
//      (owner-only: the backup to roll back to) and this machine marked remote.
// Rollback: `shepherdr secrets move-to <old machine>` from anywhere moves them back with whatever was added since.
// With the machine that keeps them gone for good: `shepherdr secrets move-to here --restore` on the old one puts its
// backup back and names it again (what was added since then on the other one isn't in it). Once the other one is back,
// `shepherdr secrets move-to here` there hands it the newer record (each service does that too).
// shepherdr secrets where [--json]: which machine keeps them.
import { CoreClient } from "./hc/client.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, copyFileSync, chmodSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOME, where } from "./paths.ts";
import { SH } from "../core/paths.js";
import * as SC from "../core/secrets.js";
import * as HC from "../core/host.js";

const { SECRETS_DOC, secretsRecord } = SC as any;
const { renamer, moveId, HOST_DOC, newestHost } = HC as any;

const args = process.argv.slice(2);
const json = args.includes("--json"), restore = args.includes("--restore");
const toIdArg = (() => { const i = args.indexOf("--to-id"); return i >= 0 ? args[i + 1] ?? "" : ""; })();
const [cmd, target] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--to-id");
const say = (s: string) => { if (!json) console.log(s); };
function fail(s: string): never { if (json) console.log(JSON.stringify({ ok: false, error: s })); else console.error(`shepherdr: ${s}`); process.exit(1); }

const HERDR = join(HOME, ".herdr");   // an older Shepherdr's backups are here
const VAULT = where().vault, MARK = where()["secret-remote"], SECRETS = dirname(VAULT);
// herdr-secret and hc there, wherever they were installed (PATH over herdr-core's exec may not have them)
const PATHS = 'PATH="$HOME/.local/bin:$HOME/.local/share/shepherdr/bin:${HERDR_APP_HOME:-$HOME/.config/herdr-app}/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH; ';

// the hc session as hc and herdr-secret take it (HC_SESSION), else the default one
const c = await CoreClient.endpoint({ binary: process.env.SHEPHERDR_HC || "hc", ...(process.env.HC_SESSION ? { session: process.env.HC_SESSION } : {}) }).catch((e) => fail(`herdr-core isn't answering here: ${(e as Error).message}`));
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
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

// ---- who is who ---------------------------------------------------------------------------------------------------
const me = (await call<any>("server.status")).core as { id: string; name: string };
const list = ((await call<{ machines: any[] }>("machine.list")).machines ?? []).filter((m) => !m.temporary);
const links: Record<string, string> = Object.fromEntries(list.filter((m) => m.id).map((m) => [m.name, m.id]));
const connected = list.filter((m) => m.state === "connected").map((m) => m.name as string);
const nameOf = (id: string): string | null | undefined => (id === me.id ? null : list.find((m) => m.id === id)?.name);
const record = secretsRecord((await getDoc(SECRETS_DOC, null).catch(() => null))?.value);
const amMain = record ? record.id === me.id : !existsSync(MARK);
// the machine serving the web app: secrets kept there follow it (auto: Settings says "Same as Serve from"), elsewhere
// they stay where the person put them
const hostId: string | null = newestHost([(await getDoc(HOST_DOC, null).catch(() => null))?.value])?.id ?? null;
const follows = (id: string) => (id === hostId ? { auto: true } : {});
const mainName = record ? nameOf(record.id) : amMain ? null : undefined;
const words = (n: string | null | undefined) => (n === null ? "this computer" : n ?? "a machine not linked from here");

if (cmd === "where") {
  if (json) console.log(JSON.stringify({ ok: true, here: amMain, named: !!record, auto: !!record?.auto, machine: amMain ? null : mainName ?? null }));
  else say(amMain ? `This computer keeps the secrets${record?.auto ? " (following Serve from)" : ""}.` : record ? `${words(mainName)} keeps the secrets${record.auto ? " (following Serve from)" : ""}.` : "Another machine keeps the secrets (none is named yet: this one is marked remote).");
  process.exit(0);
}
if (cmd !== "move-to" || (!target && !toIdArg)) fail("usage: shepherdr secrets move-to <machine|here> [--restore] [--json] | shepherdr secrets where");

const toId = toIdArg || (target === "here" || target === me.name ? me.id : links[target!]);
if (!toId) fail(`${target} isn't a machine linked from here (hc machine ls).`);
const toMaybe = nameOf(toId);
// passed on from another machine that this one doesn't link (each machine links others its own way): they stay here
if (toMaybe === undefined) fail(toIdArg ? `${me.name}, which keeps the secrets, doesn't link the machine to move them to: they stay on ${me.name} (link it there with hc machine add).` : "That machine isn't linked from here.");
const to: string | null = toMaybe;

// ---- rollback with the machine that keeps them gone ---------------------------------------------------------------
function backups() {
  // newest last, in the secrets folder or (made by an older Shepherdr) in ~/.herdr
  const of = (d: string) => { try { return readdirSync(d).filter((f) => /^vault\.json\.moved-\d{8}T\d{6}$/.test(f)).map((f) => join(d, f)); } catch { return []; } };
  return [...new Set([...of(HERDR), ...of(SECRETS)])].sort((a, b) => a.slice(a.lastIndexOf("/")).localeCompare(b.slice(b.lastIndexOf("/"))));
}
if (restore) {
  if (to !== null) fail("--restore puts this machine's own backup back: shepherdr secrets move-to here --restore.");
  if (amMain) fail("This computer keeps the secrets already.");
  if (typeof mainName === "string" && connected.includes(mainName)) fail(`${mainName} keeps them and can be reached: move them back from there, with what was added since (shepherdr secrets move-to ${me.name} --json, or Settings › Secrets).`);
  const bp = backups().pop(), b = bp?.slice(bp.lastIndexOf("/") + 1);
  if (!existsSync(VAULT)) {
    if (!b) fail(`There's no backup of the secrets here (${SECRETS}/vault.json.moved-*).`);
    copyFileSync(bp!, VAULT);
    chmodSync(VAULT, 0o600);
  }
  const next = { id: me.id, at: Date.now(), by: me.id };
  await setDoc(SECRETS_DOC, next, null);
  for (const m of connected) await setDoc(SECRETS_DOC, next, m).catch(() => {});
  try { unlinkSync(MARK); } catch {}
  if (json) console.log(JSON.stringify({ ok: true, to: null, restored: b ?? "vault.json" }));
  else say(`This computer keeps the secrets again${b ? ` (from ${b})` : ""}. What was added on ${words(mainName)} since isn't here.`);
  c.close();
  process.exit(0);
}

// ---- not the machine that keeps them: it does the move --------------------------------------------------------------
if (!amMain) {
  if (typeof mainName !== "string") fail(record ? "The machine that keeps the secrets isn't linked from here: move them from there." : "This machine is marked remote and no machine is named to keep the secrets: run this on the one that has them.");
  if (!connected.includes(mainName)) fail(`${mainName} keeps the secrets and can't be reached now: it needs to be on (or, gone for good, \`shepherdr secrets move-to here --restore\` where a backup is).`);
  const r = await exec(["sh", "-c", `${PATHS}exec shepherdr secrets move-to --to-id "$1" --json`, "sh", toId], mainName, undefined, 180);
  let out: any = null;
  try { out = JSON.parse(r.stdout.trim().split("\n").pop() ?? ""); } catch {}
  if (!out) fail(`${mainName} didn't move them: ${(r.stderr.trim().split("\n").pop() ?? "").replace(/^shepherdr: /, "") || `exit ${r.code}`}`);
  if (!out.ok) fail(out.error);
  if (json) console.log(JSON.stringify({ ...out, to }));
  else say(`${to ? to : "This computer"} keeps the secrets now (moved by ${mainName}).`);
  c.close();
  process.exit(0);
}
if (to === null) {
  // already here: the record handed again to each machine linked from here that has an older one (one that was off
  // at a rollback comes back believing it still keeps them, until this or a service hands it on)
  const handed: string[] = [];
  // picked here on purpose: follows Serve from if this machine serves the web app, else the person's choice from now on
  if (!record || !!record.auto !== (me.id === hostId)) {
    const chosen = { id: me.id, at: Date.now(), by: me.id, ...follows(me.id) };
    await setDoc(SECRETS_DOC, chosen, null);
    for (const m of connected) if (await setDoc(SECRETS_DOC, chosen, m).then(() => true, () => false)) handed.push(m);
  } else if (record) for (const m of connected) {
    const theirs = secretsRecord((await getDoc(SECRETS_DOC, m).catch(() => null))?.value);
    if ((theirs?.at ?? 0) < record.at && await setDoc(SECRETS_DOC, record, m).then(() => true, () => false)) handed.push(m);
  }
  if (json) console.log(JSON.stringify({ ok: true, to: null, already: true, handed }));
  else say(`This computer keeps the secrets already${handed.length ? ` (told ${handed.join(", ")} again)` : ""}.`);
  c.close();
  process.exit(0);
}
if (!connected.includes(to)) fail(`${to} is offline: it needs to be on to take the secrets.`);

// ---- 1. herdr-secret there, and its names -------------------------------------------------------------------------
const w = await exec(["sh", "-c", `${PATHS}herdr-secret where --json`], to);
let whereThere: any = null;
try { whereThere = JSON.parse(w.stdout.trim().split("\n").pop() ?? ""); } catch {}
if (w.code !== 0 || !whereThere || typeof whereThere.here !== "boolean") fail(`herdr-secret on ${to} doesn't know where secrets are kept yet: update Shepherdr there first (shepherdr update, or the release).`);
const ml = await exec(["sh", "-c", `${PATHS}hc machine ls --json`], to);
let theirs: Record<string, string> = {};
try { theirs = Object.fromEntries((JSON.parse(ml.stdout).machines ?? []).filter((m: any) => m.id && !m.temporary).map((m: any) => [m.name, m.id])); }
catch { fail(`couldn't read ${to}'s machines (hc machine ls there).`); }
const rename = renamer({ id: me.id, links }, { id: toId, links: theirs });

// ---- 2. the vault here, in the words there; the one there backed up ----------------------------------------------
let mine: any = { version: 1, secrets: [] };
if (existsSync(VAULT)) {
  try { mine = JSON.parse(readFileSync(VAULT, "utf8")); } catch { fail(`The vault here (${VAULT}) isn't valid JSON: fix it first.`); }
  if (!mine || !Array.isArray(mine.secrets)) fail("The vault here isn't a Herdr vault.");
}
const unnamed: string[] = [];
const moved = mine.secrets.map((e: any) => {
  if (e?.scope === "machine") {
    const m = rename(e.machine ?? null);
    if (m === undefined) { unnamed.push(`${e.name} (${e.machine ?? me.name})`); return e; }
    return { ...e, machine: m };
  }
  if (e?.scope === "space" && e.space) {
    const sp = moveId(e.space, rename);
    if (sp === undefined) { unnamed.push(`${e.name} (space ${e.space})`); return e; }
    return { ...e, space: sp };
  }
  return e;
});
const key = (e: any) => `${e?.name}|${e?.scope}|${e?.machine ?? ""}|${e?.space ?? ""}`;
let there: string | null = null;
// wherever that machine keeps it (its Shepherdr folders, or ~/.herdr on an older one)
{
  const r = await exec(["sh", "-c", SH + '[ -e "$SHEP_VAULT" ] || exit 3; cat "$SHEP_VAULT"'], to).catch((e) => fail(`couldn't read the vault on ${to}: ${(e as Error).message}`));
  if (r.code === 0) there = r.stdout;
  else if (r.code !== 3) fail(`couldn't read the vault on ${to}: ${r.stderr.trim()}`);
}
let keptThere: any[] = [], backup: string | null = null;
if (there !== null && there.trim()) {
  let t: any = null;
  try { t = JSON.parse(there); } catch {}
  if (!t || !Array.isArray(t.secrets)) fail(`The vault on ${to} isn't readable: move it aside there first.`);
  if (t.secrets.length) {
    backup = `vault.json.before-move-${stamp()}`;
    const b = await exec(["sh", "-c", SH + 'd=$(dirname "$SHEP_VAULT"); cp -p "$SHEP_VAULT" "$d/$1" && chmod 600 "$d/$1"', "sh", backup], to);
    if (b.code !== 0) fail(`couldn't back up the vault on ${to}: ${b.stderr.trim()}`);
    const ours = new Set(moved.map(key));
    keptThere = t.secrets.filter((e: any) => !ours.has(key(e)));
  }
}
const text = JSON.stringify({ ...mine, secrets: [...moved, ...keptThere] }, null, 1);

// ---- 3. written there whole, and read back --------------------------------------------------------------------------
const WRITE = `${SH}set -e; umask 077; mkdir -p "$(dirname "$SHEP_VAULT")"; f="$SHEP_VAULT"; cat > "$f.move-tmp"
python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$f.move-tmp"`;
const wr = await exec(["sh", "-c", WRITE], to, text);
if (wr.code !== 0 || wr.stdout.trim() !== sha(text)) {
  await exec(["sh", "-c", SH + 'rm -f "$SHEP_VAULT.move-tmp"'], to).catch(() => {});
  fail(`the vault didn't arrive whole on ${to}: nothing changed.`);
}
const sw = await exec(["sh", "-c", SH + 'set -e; chmod 600 "$SHEP_VAULT.move-tmp"; mv "$SHEP_VAULT.move-tmp" "$SHEP_VAULT"; rm -f "$SHEP_SECRET_REMOTE"'], to);
if (sw.code !== 0) fail(`couldn't put the vault in place on ${to}: ${sw.stderr.trim()}`);
say(`Copied ${moved.length} secret${moved.length === 1 ? "" : "s"} to ${to}${keptThere.length ? ` (kept ${keptThere.length} it had)` : ""}${backup ? `; its old vault is ${backup} there` : ""}.`);

// ---- 4. the record everywhere ---------------------------------------------------------------------------------------
const next = { id: toId, at: Date.now(), by: me.id, ...follows(toId) };
await setDoc(SECRETS_DOC, next, null);
await setDoc(SECRETS_DOC, next, to);
for (const m of connected) if (m !== to) await setDoc(SECRETS_DOC, next, m).catch(() => {});

// ---- 5. this machine's vault set aside ------------------------------------------------------------------------------
await Bun.sleep(5000);
const aside = `vault.json.moved-${stamp()}`;
if (existsSync(VAULT)) { renameSync(VAULT, join(SECRETS, aside)); chmodSync(join(SECRETS, aside), 0o600); }
writeFileSync(MARK, "");
if (json) console.log(JSON.stringify({ ok: true, to, moved: moved.length, keptThere: keptThere.length, unnamed, backupHere: existsSync(join(SECRETS, aside)) ? aside : null, backupThere: backup }));
else {
  say(`${to} keeps the secrets now. This computer's copy is ${join(SECRETS, aside)} (to roll back: shepherdr secrets move-to ${me.name}, from anywhere).`);
  if (unnamed.length) say(`${to} doesn't link what these were kept for, so they keep this machine's names: ${unnamed.join(", ")}.`);
}
c.close();
process.exit(0);
