// shepherdr secrets move-to <machine|here> [--restore] [--json]: moves the secrets (the vault, ~/.herdr/vault.json) to
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
// backup back and names it again (what was added since then on the other one isn't in it).
// shepherdr secrets where [--json]: which machine keeps them.
import { CoreClient } from "./hc/client.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, copyFileSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./paths.ts";
import * as SC from "../core/secrets.js";
import * as HC from "../core/host.js";

const { SECRETS_DOC, secretsRecord } = SC as any;
const { renamer, moveId } = HC as any;

const args = process.argv.slice(2);
const json = args.includes("--json"), restore = args.includes("--restore");
const toIdArg = (() => { const i = args.indexOf("--to-id"); return i >= 0 ? args[i + 1] ?? "" : ""; })();
const [cmd, target] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--to-id");
const say = (s: string) => { if (!json) console.log(s); };
function fail(s: string): never { if (json) console.log(JSON.stringify({ ok: false, error: s })); else console.error(`shepherdr: ${s}`); process.exit(1); }

const HERDR = join(HOME, ".herdr");
const VAULT = join(HERDR, "vault.json"), MARK = join(HERDR, "secret-remote");
// herdr-secret and hc there, wherever they were installed (PATH over herdr-core's exec may not have them)
const PATHS = 'PATH="$HOME/.local/bin:$HOME/.local/share/shepherdr/bin:${HERDR_APP_HOME:-$HOME/.config/herdr-app}/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH; ';

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
const mainName = record ? nameOf(record.id) : amMain ? null : undefined;
const words = (n: string | null | undefined) => (n === null ? "this computer" : n ?? "a machine not linked from here");

if (cmd === "where") {
  if (json) console.log(JSON.stringify({ ok: true, here: amMain, named: !!record, machine: amMain ? null : mainName ?? null }));
  else say(amMain ? "This computer keeps the secrets." : record ? `${words(mainName)} keeps the secrets.` : "Another machine keeps the secrets (none is named yet: this one is marked remote).");
  process.exit(0);
}
if (cmd !== "move-to" || (!target && !toIdArg)) fail("usage: shepherdr secrets move-to <machine|here> [--restore] [--json] | shepherdr secrets where");

const toId = toIdArg || (target === "here" || target === me.name ? me.id : links[target!]);
if (!toId) fail(`${target} isn't a machine linked from here (hc machine ls).`);
const toMaybe = nameOf(toId);
if (toMaybe === undefined) fail("That machine isn't linked from here.");
const to: string | null = toMaybe;

// ---- rollback with the machine that keeps them gone ---------------------------------------------------------------
function backups() {
  try { return readdirSync(HERDR).filter((f) => /^vault\.json\.moved-\d{8}T\d{6}$/.test(f)).sort(); } catch { return []; }
}
if (restore) {
  if (to !== null) fail("--restore puts this machine's own backup back: shepherdr secrets move-to here --restore.");
  if (amMain) fail("This computer keeps the secrets already.");
  if (typeof mainName === "string" && connected.includes(mainName)) fail(`${mainName} keeps them and can be reached: move them back from there, with what was added since (shepherdr secrets move-to ${me.name} --json, or Settings › Secrets).`);
  const b = backups().pop();
  if (!existsSync(VAULT)) {
    if (!b) fail("There's no backup of the secrets here (~/.herdr/vault.json.moved-*).");
    copyFileSync(join(HERDR, b), VAULT);
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
  if (json) console.log(JSON.stringify({ ok: true, to: null, already: true }));
  else say("This computer keeps the secrets already.");
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
  try { mine = JSON.parse(readFileSync(VAULT, "utf8")); } catch { fail("The vault here (~/.herdr/vault.json) isn't valid JSON: fix it first."); }
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
try { there = (await call<{ text: string }>("file.read", { path: ".herdr/vault.json", on: to })).text; }
catch (e) { if ((e as any).kind !== "not_found") fail(`couldn't read the vault on ${to}: ${(e as Error).message}`); }
let keptThere: any[] = [], backup: string | null = null;
if (there !== null && there.trim()) {
  let t: any = null;
  try { t = JSON.parse(there); } catch {}
  if (!t || !Array.isArray(t.secrets)) fail(`The vault on ${to} isn't readable: move it aside there first.`);
  if (t.secrets.length) {
    backup = `vault.json.before-move-${stamp()}`;
    const b = await exec(["sh", "-c", 'cd "$HOME/.herdr" && cp -p vault.json "$1" && chmod 600 "$1"', "sh", backup], to);
    if (b.code !== 0) fail(`couldn't back up the vault on ${to}: ${b.stderr.trim()}`);
    const ours = new Set(moved.map(key));
    keptThere = t.secrets.filter((e: any) => !ours.has(key(e)));
  }
}
const text = JSON.stringify({ ...mine, secrets: [...moved, ...keptThere] }, null, 1);

// ---- 3. written there whole, and read back --------------------------------------------------------------------------
const WRITE = `set -e; umask 077; mkdir -p "$HOME/.herdr"; f="$HOME/.herdr/vault.json"; cat > "$f.move-tmp"
python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$f.move-tmp"`;
const wr = await exec(["sh", "-c", WRITE], to, text);
if (wr.code !== 0 || wr.stdout.trim() !== sha(text)) {
  await exec(["sh", "-c", 'rm -f "$HOME/.herdr/vault.json.move-tmp"'], to).catch(() => {});
  fail(`the vault didn't arrive whole on ${to}: nothing changed.`);
}
const sw = await exec(["sh", "-c", 'set -e; cd "$HOME/.herdr"; chmod 600 vault.json.move-tmp; mv vault.json.move-tmp vault.json; rm -f secret-remote'], to);
if (sw.code !== 0) fail(`couldn't put the vault in place on ${to}: ${sw.stderr.trim()}`);
say(`Copied ${moved.length} secret${moved.length === 1 ? "" : "s"} to ${to}${keptThere.length ? ` (kept ${keptThere.length} it had)` : ""}${backup ? `; its old vault is ${backup} there` : ""}.`);

// ---- 4. the record everywhere ---------------------------------------------------------------------------------------
const next = { id: toId, at: Date.now(), by: me.id };
await setDoc(SECRETS_DOC, next, null);
await setDoc(SECRETS_DOC, next, to);
for (const m of connected) if (m !== to) await setDoc(SECRETS_DOC, next, m).catch(() => {});

// ---- 5. this machine's vault set aside ------------------------------------------------------------------------------
await Bun.sleep(5000);
const aside = `vault.json.moved-${stamp()}`;
if (existsSync(VAULT)) { renameSync(VAULT, join(HERDR, aside)); chmodSync(join(HERDR, aside), 0o600); }
writeFileSync(MARK, "");
if (json) console.log(JSON.stringify({ ok: true, to, moved: moved.length, keptThere: keptThere.length, unnamed, backupHere: existsSync(join(HERDR, aside)) ? aside : null, backupThere: backup }));
else {
  say(`${to} keeps the secrets now. This computer's copy is ~/.herdr/${aside} (to roll back: shepherdr secrets move-to ${me.name}, from anywhere).`);
  if (unnamed.length) say(`${to} doesn't link what these were kept for, so they keep this machine's names: ${unnamed.join(", ")}.`);
}
c.close();
process.exit(0);
