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
