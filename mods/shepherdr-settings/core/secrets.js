// Secrets an agent asks for by name (herdr-secret ask): the label on its terminal, and the words it hears when the
// person keeps or declines one (never the value). The window's masked card (lib/secrets.js) and the web app's say the
// same. Shared core: the source is core/secrets.js; bin/sync-shared copies it into the mods in lib/COPIES.

import { PY } from "./paths.js";
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
export const ASK = "herdr.secret.ask.";

// What a terminal's labels ask for: [{ name, why }].
export function asksIn(labels) {
  const l = labels ?? {};
  return Object.keys(l).filter((k) => k.startsWith(ASK) && NAME.test(k.slice(ASK.length)) && l[k])
    .sort().map((k) => ({ name: k.slice(ASK.length), why: l[k] === "-" ? "" : String(l[k]) }));
}

// The agent hears it's kept, by name: never the value.
export const keptLine = (name, at) => `<hc from="person" secret="${name}">Kept: ${name} (for ${at}). Use it by name: herdr-secret run ${name} -- <command>, or herdr-secret env ${name} --file .env in a git-ignored file. Never print it or put it in a chat, brief, artifact or commit.</hc>`;

export const declinedLine = (name) => `<hc from="person" secret="${name}">Declined: ${name}. The person won't give it now: go on without it, or say plainly what you can't do without it. Don't ask for its value in the chat.</hc>`;

// Which machine keeps the secrets (Settings › Secrets › Kept on): herdr-core document "shepherdr.secrets" = { id, at, by,
// auto? } on every machine (id: that machine's herdr-core id), as "shepherdr.host" is for Serve from (core/host.js): the
// newest record wins, each service hands it on to the machines it links, and a machine believes its own record or a
// newer one from the machine that keeps the secrets now (none of its own yet: the newest it's handed).
// By default they follow Serve from (auto: true, "Same as Serve from" in Settings): nobody named a machine, so the
// services name the one they're on now (autoKeeper) and the machine serving the web app moves them to itself, the safe
// way (followTo: `shepherdr secrets move-to`, with its backup and rollback); a later Serve from change carries them along
// the same way. The person picking another machine in Kept on overrides it (a record without auto); picking the Serve
// from machine follows it again. No record anywhere yet: the machine without ~/.local/share/shepherdr/secrets/remote keeps them
// (bin/herdr-secret remote()). `shepherdr secrets move-to <machine>` moves them (service/secrets-move.ts).
export const SECRETS_DOC = "shepherdr.secrets";

/** A record as it may be believed: { id, at, by?, auto? } with a sane time, else null. */
export function secretsRecord(v, now = Date.now()) {
  return v && typeof v.id === "string" && v.id && Number.isFinite(v.at) && v.at <= now + 60_000
    ? { id: v.id, at: v.at, ...(typeof v.by === "string" ? { by: v.by } : {}), ...(v.auto === true ? { auto: true } : {}) } : null;
}

/** Which record a machine keeps: its own, or a newer one from the machine its own names (that machine hands a move
 *  on); none of its own: the newest one the machines it reads have. `there`: { [machine id]: record }. */
export function believeRecord(mine, there) {
  const own = secretsRecord(mine);
  if (!own) {
    let best = null;
    for (const v of Object.values(there ?? {})) { const r = secretsRecord(v); if (r && (!best || r.at > best.at)) best = r; }
    return best;
  }
  const fromMain = secretsRecord(there?.[own.id]);
  return fromMain && fromMain.at > own.at ? fromMain : own;
}

/**
 * The machine that keeps the secrets now, when nobody named one (the same answer on every machine that sees the same
 * facts): where they already are, so nothing moves under a running agent (followTo then moves them to Serve from):
 *   1. the machine whose vault (~/.local/share/shepherdr/secrets/vault.json) has secrets in it, not marked remote;
 *   2. several: the one with the most that isn't serving the web app (moving it there keeps the other's entries:
 *      `move-to` merges), else the lowest id;
 *   3. none has any: the machine serving the web app;
 *   4. none has any, none serves the web app, and every machine is marked remote (each installed the other's copy):
 *      the lowest id, else none could ever keep a secret (#800). Some not marked: each keeps its own, as before.
 * machines: [{ id, count, remote }] (count: secrets in its vault, 0 without one; null: unknown, it can't be asked now).
 * host: the id of the machine serving the web app (shepherdr.host), or null.
 * Returns { id } or null: nothing to decide yet (no vault seen with a machine still unknown, or no host to fall back on).
 */
export function autoKeeper(machines, host) {
  const ms = (machines ?? []).filter((m) => m && typeof m.id === "string" && m.id);
  const holders = ms.filter((m) => Number.isFinite(m.count) && m.count > 0 && !m.remote);
  if (holders.length) {
    const pick = [...holders].sort((a, b) => (a.id === host) - (b.id === host) || b.count - a.count || (a.id < b.id ? -1 : 1))[0];
    return { id: pick.id };
  }
  // no vault anywhere seen: only when every machine answered (a sleeping laptop may hold them)
  if (ms.some((m) => m.count == null)) return null;
  if (host) return { id: host };
  return ms.length && ms.every((m) => m.remote) ? { id: [...ms].map((m) => m.id).sort()[0] } : null;
}

/** Secrets that follow Serve from but are kept elsewhere: the id of the machine serving the web app to move them to,
 *  for that machine to do (me: its own id), else null. */
export function followTo(record, host, me) {
  const r = secretsRecord(record);
  return r?.auto && host && me === host && r.id !== host ? host : null;
}

// Run with python3 on a machine: how many secrets its vault has (never a value), and whether it's marked remote.
export const COUNT_SCRIPT = `
import json, os
${PY}
n = 0
try:
    with open(SHEP(".herdr/vault.json")) as f:
        n = len(json.load(f).get("secrets") or [])
except Exception:
    n = 0
print(json.dumps({"count": n, "remote": os.path.exists(SHEP(".herdr/secret-remote"))}))
`;

/** The words for where secrets are kept: "This computer", a machine's name, or its id when it isn't linked. */
export const keptWhere = (m) => (!m ? "" : m.here ? "This computer" : m.name || "another machine (not linked from here)");
