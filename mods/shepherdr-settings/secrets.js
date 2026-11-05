// Secrets for agents (bin/herdr-secret): the vault on the machine that keeps them (Settings ›
// Secrets › Kept on, `herdr-secret where`), ~/.herdr/vault.json there (owner-only), values by name
// for Everywhere, a machine or a space, the most specific winning. On another machine every read
// and write goes there through herdr-secret (names, set, rm: it passes them on over hc). The
// person's masked boxes (an agent's ask card in its chat, Settings > Secrets) write it here
// directly: a value never goes through hc send, a chat, a log or an artifact. What mods show of
// it is names and scopes, never values.
// An agent asks with a label on its own terminal, herdr.secret.ask.<NAME>=<why> (herdr-secret
// ask); answering removes it and tells the agent by name only.
// Shared: the source is lib/secrets.js; bin/sync-shared copies it into each mod in lib/COPIES.
// Edit lib/secrets.js, never a mod's copy, then run bin/sync-shared.

import { appHome, home, exec, hc, readTextFile, writeTextFile } from "herdr";
import { terminals, spaces, panes } from "./live.js";
import { serviceRuns } from "./service.js";

// The ask's label and the words the agent hears: core/secrets.js, shared with the web app.
import { NAME, ASK, asksIn, keptLine, declinedLine } from "./core/secrets.js";
import { sendAsPerson } from "./core/person.js";
export { NAME };
const WANT = "herdr.secret.want";
const SPACE_LABELS = ["herdr.space", "herdr.task.space", "herdr.coordinator.space"];
const bin = () => `${appHome()}/bin/herdr-secret`;
const vault = () => `${home()}/.herdr/vault.json`;

// ---- scopes ---------------------------------------------------------------------------------
// A scope: { scope: "everywhere" | "machine" | "space", machine, space } (machine null: this one;
// a space id as Herdr names it, another machine's with its name in front).

export const scopeKey = (s) => `${s.scope}:${s.machine ?? ""}:${s.space ?? ""}`;
const same = (e, s) => e.scope === s.scope && (e.machine ?? null) === (s.machine ?? null) && (e.space ?? null) === (s.space ?? null);
const qualify = (machine, id) => (machine && id && !id.includes("/") ? `${machine}/${id}` : id);

// Where a terminal works: its machine and space (a sub-agent's parent's when it has none).
export function placeOf(address) {
  const machine = String(address ?? "").includes("/") ? address.split("/")[0] : null;
  let t = terminals().find((x) => x.address === address);
  for (let i = 0; i < 5 && t; i++) {
    const l = t.labels ?? {};
    // An agent parked behind its chat has only herdr.chat=<chat pane>: the chat's space.
    const chat = l["herdr.chat"] && panes().find((p) => p.pane === qualify(machine, l["herdr.chat"]));
    const sp = SPACE_LABELS.map((k) => l[k]).find(Boolean) ?? (chat && spaces().find((s) => s.tabs?.some((x) => x.id === chat.tab))?.id);
    if (sp) return { machine, space: qualify(machine, sp) };
    if (!t.parent) break;
    const p = qualify(machine, t.parent);
    t = terminals().find((x) => x.address === p);
  }
  return { machine, space: null };
}

const spaceName = (id) => spaces().find((s) => s.id === id)?.name || "This space";
export const machineName = (m) => m || "This computer";

// The scopes a terminal's agent reaches, most specific first, each with its words.
export function levels(address) {
  const { machine, space } = placeOf(address);
  const out = [];
  if (space) out.push({ scope: "space", machine: null, space, label: spaceName(space) });
  out.push({ scope: "machine", machine, space: null, label: machineName(machine) });
  out.push({ scope: "everywhere", machine: null, space: null, label: "Everywhere" });
  return out;
}

// A scope in words, for lists: "Everywhere", "laptop", "Space ~".
export function where(s) {
  if (s.scope === "space") return `Space ${spaces().find((x) => x.id === s.space)?.name || s.space}`;
  if (s.scope === "machine") return machineName(s.machine);
  return "Everywhere";
}

// ---- asks -----------------------------------------------------------------------------------

// What a terminal asks for: [{ name, why }]. ts: terminals(), when the caller has them already.
export function asksOf(address, ts = terminals()) {
  return asksIn(ts.find((x) => x.address === address)?.labels);
}

// Every waiting ask: [{ address, name, why }].
export function allAsks() {
  return terminals().filter((t) => t.state === "live" || t.state == null)
    .flatMap((t) => asksOf(t.address).map((a) => ({ address: t.address, ...a })));
}

async function answer(address, name, text) {
  await hc(["label", address, `${ASK}${name}=`]).catch(() => {});
  // the person's answer: plain input from them, never "Another agent" on another machine (core/person.js)
  await sendAsPerson({ hc, exec }, address, text).catch(() => {});
}

export async function decline(address, name) {
  await answer(address, name, declinedLine(name));
}

// ---- which machine keeps them ----------------------------------------------------------------
// `herdr-secret where --json`: { here, set, id, name } (name: the main machine's here; "" when it
// isn't linked). Asked again every 15 s at most; null until first known.
let main = null, mainAt = 0, asking = false;
export function keptOn() {
  if (!asking && Date.now() - mainAt > 15000) {
    asking = true;
    exec(bin(), ["where", "--json"]).then((r) => { if (r.code === 0) main = JSON.parse(r.stdout); })
      .catch(() => {}).finally(() => { asking = false; mainAt = Date.now(); });
  }
  return main;
}
export async function whereNow() {
  const r = await exec(bin(), ["where", "--json"]).catch(() => null);
  if (r?.code === 0) try { main = JSON.parse(r.stdout); mainAt = Date.now(); } catch {}
  return main ?? { here: true, set: false, id: null, name: null };
}
const fail = (r, fallback) => new Error(String(r?.stderr ?? "").trim().split("\n").pop()?.replace(/^herdr-secret: /, "") || fallback);
// A scope as herdr-secret's flags (in this machine's words: herdr-secret renames them there).
const flags = (s) => (s.scope === "space" ? ["--space", s.space] : s.scope === "machine" ? (s.machine ? ["--machine", s.machine] : ["--machine"]) : []);

// ---- the vault ------------------------------------------------------------------------------

async function read() {
  const text = await readTextFile(vault()).catch(() => null);
  if (text == null) return { text: null, data: { version: 1, secrets: [] } };
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!data || !Array.isArray(data.secrets)) throw new Error("The vault (~/.herdr/vault.json) isn't readable; fix or move it first.");
  return { text, data };
}

// Changes the vault: fn(data) edits it in place. The file is made owner-only first (herdr-secret
// init), and replaced only if nobody changed it meanwhile (else read again, once more).
async function change(fn) {
  const r = await exec(bin(), ["init"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Couldn't open the vault.");
  for (let i = 0; i < 3; i++) {
    const { text, data } = await read();
    fn(data);
    try { await writeTextFile(vault(), JSON.stringify(data, null, 1), text); return; } catch (e) { if (i === 2) throw e; }
  }
}

// Every entry, without its value: [{ name, scope, machine, space, at }]. Throws when the machine
// that keeps them can't be asked now.
export async function entries() {
  if (!(await whereNow()).here) {
    const r = await exec(bin(), ["names", "--json"]);
    if (r.code !== 0) throw fail(r, "Can't reach the machine that keeps your secrets.");
    return JSON.parse(r.stdout).filter((e) => NAME.test(String(e?.name ?? ""))).map((e) => ({ name: e.name, scope: e.scope, machine: e.machine ?? null, space: e.space ?? null, at: e.at ?? null }));
  }
  const { data } = await read();
  return data.secrets.filter((e) => NAME.test(String(e?.name ?? ""))).map((e) => ({ name: e.name, scope: e.scope, machine: e.machine ?? null, space: e.space ?? null, at: e.at ?? null }));
}

// Keeps a value, then answers every waiting ask it now reaches (as agents may ask at once).
export async function keep(name, scope, value) {
  if (!NAME.test(name)) throw new Error("Name it like an environment variable: GITHUB_TOKEN.");
  const v = String(value ?? "").replace(/[\r\n]+$/, "");
  if (!v) throw new Error("Type or paste the value first.");
  const s = { scope: scope.scope, machine: scope.machine ?? null, space: scope.space ?? null };
  if ((await whereNow()).here) {
    await change((data) => {
      data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, s)));
      data.secrets.push({ name, ...s, value: v, at: Date.now() });
    });
  } else {
    // to the machine that keeps them: a mod's exec has no stdin, so the value waits in an owner-only file in
    // ~/.herdr/secret-drop (0700) that herdr-secret reads and removes at once, then sends on over hc's link
    const drop = `${home()}/.herdr/secret-drop`;
    await exec("sh", ["-c", 'mkdir -p "$1" && chmod 700 "$1"', "x", drop]);
    const file = `${drop}/set-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeTextFile(file, v, null);
    const r = await exec(bin(), ["set", name, ...flags(s), "--value-file", file]);
    await exec("rm", ["-f", file]).catch(() => {});
    if (r.code !== 0) throw fail(r, "It wasn't kept.");
  }
  const at = where(s);
  for (const a of allAsks().filter((a) => a.name === name && levels(a.address).some((l) => scopeKey(l) === scopeKey(s)))) {
    await answer(a.address, name, keptLine(name, at));
  }
}

export async function remove(name, scope) {
  if (!(await whereNow()).here) {
    const r = await exec(bin(), ["rm", name, ...flags(scope)]);
    if (r.code !== 0) throw fail(r, "It wasn't removed.");
    return;
  }
  await change((data) => { data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, scope))); });
}

// ---- another machine's agents ---------------------------------------------------------------
// A remote herdr-secret run/env/list puts herdr.secret.want on its terminal and waits on a FIFO;
// herdr-secret serve answers it from here over hc. Called from render: each request once.
// ts: terminals(), when the caller has them already.
const served = new Set();
export function serveRemote(ts = terminals()) {
  // Shepherdr's service answers them while it runs (lib/service.js); only the machine that keeps
  // the secrets answers.
  if (serviceRuns() || !keptOn()?.here) return;
  for (const t of ts) {
    const w = t.labels?.[WANT];
    if (!w || !String(t.address).includes("/") || served.has(w)) continue;
    served.add(w);
    exec(bin(), ["serve", t.address]).catch(() => {});
  }
  if (served.size > 200) served.clear();
}
