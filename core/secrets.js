// Secrets an agent asks for by name (herdr-secret ask): the label on its terminal, and the words it hears when the
// person keeps or declines one (never the value). The window's masked card (lib/secrets.js) and the web app's say the
// same. Shared core: the source is core/secrets.js; bin/sync-shared copies it into the mods in lib/COPIES.

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

// Which machine keeps the secrets (Settings › Secrets › Kept on): herdr-core document "shepherdr.secrets" = { id, at, by }
// on every machine (id: that machine's herdr-core id), as "shepherdr.host" is for Serve from (core/host.js): the newest
// record wins, each service hands it on to the machines it links, and a machine believes only its own record or a newer
// one from the machine that keeps the secrets now. No record: the machine without ~/.herdr/secret-remote keeps them
// (bin/herdr-secret remote()). `shepherdr secrets move-to <machine>` moves them (service/secrets-move.ts).
export const SECRETS_DOC = "shepherdr.secrets";

/** A record as it may be believed: { id, at, by? } with a sane time, else null. */
export function secretsRecord(v, now = Date.now()) {
  return v && typeof v.id === "string" && v.id && Number.isFinite(v.at) && v.at <= now + 60_000 ? { id: v.id, at: v.at, ...(typeof v.by === "string" ? { by: v.by } : {}) } : null;
}

/** Which record a machine keeps: its own, or a newer one from the machine its own names (that machine hands a move
 *  on). `there`: { [machine id]: record } of the machines it reads. */
export function believeRecord(mine, there) {
  const own = secretsRecord(mine);
  if (!own) return null;
  const fromMain = secretsRecord(there?.[own.id]);
  return fromMain && fromMain.at > own.at ? fromMain : own;
}

/** The words for where secrets are kept: "This computer", a machine's name, or its id when it isn't linked. */
export const keptWhere = (m) => (!m ? "" : m.here ? "This computer" : m.name || "another machine (not linked from here)");
