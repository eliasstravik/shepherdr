// Secrets for agents (bin/herdr-secret): the vault on this machine, ~/.herdr/vault.json (owner-
// only), values by name for Everywhere, a machine or a space, the most specific winning. The
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
  await hc(["send", address, text]).catch(() => {});
}

export async function decline(address, name) {
  await answer(address, name, declinedLine(name));
}

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

// Every entry, without its value: [{ name, scope, machine, space, at }].
export async function entries() {
  const { data } = await read();
  return data.secrets.filter((e) => NAME.test(String(e?.name ?? ""))).map((e) => ({ name: e.name, scope: e.scope, machine: e.machine ?? null, space: e.space ?? null, at: e.at ?? null }));
}

// Keeps a value, then answers every waiting ask it now reaches (as agents may ask at once).
export async function keep(name, scope, value) {
  if (!NAME.test(name)) throw new Error("Name it like an environment variable: GITHUB_TOKEN.");
  const v = String(value ?? "").replace(/[\r\n]+$/, "");
  if (!v) throw new Error("Type or paste the value first.");
  const s = { scope: scope.scope, machine: scope.machine ?? null, space: scope.space ?? null };
  await change((data) => {
    data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, s)));
    data.secrets.push({ name, ...s, value: v, at: Date.now() });
  });
  const at = where(s);
  for (const a of allAsks().filter((a) => a.name === name && levels(a.address).some((l) => scopeKey(l) === scopeKey(s)))) {
    await answer(a.address, name, keptLine(name, at));
  }
}

export async function remove(name, scope) {
  await change((data) => { data.secrets = data.secrets.filter((e) => !(e.name === name && same(e, scope))); });
}

// ---- another machine's agents ---------------------------------------------------------------
// A remote herdr-secret run/env/list puts herdr.secret.want on its terminal and waits on a FIFO;
// herdr-secret serve answers it from here over hc. Called from render: each request once.
// ts: terminals(), when the caller has them already.
const served = new Set();
export function serveRemote(ts = terminals()) {
  // Shepherdr's service answers them while it runs (lib/service.js).
  if (serviceRuns()) return;
  for (const t of ts) {
    const w = t.labels?.[WANT];
    if (!w || !String(t.address).includes("/") || served.has(w)) continue;
    served.add(w);
    exec(bin(), ["serve", t.address]).catch(() => {});
  }
  if (served.size > 200) served.clear();
}
