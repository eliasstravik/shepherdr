// Knowing that an agent needs signing in, from its screen or its own log, and saying what to do in its own words.
// Shepherdr only reads here: it never types /login or /mcp, runs a login command, pastes a code or keeps a key.
// The person signs in themselves, in the agent's terminal (AGENTS.md: Nothing that risks a ban).

export type SignInNeed = { cli: "Claude Code" | "Codex"; connector?: string };

const CLAUDE_AUTH = /^(?:Not logged in[. ·—-]*\s*(?:Please run \/login.*)?|(?:API Error: .*?[·. ]\s*)?(?:Please run|Run) \/login\b.*|OAuth token has expired\b.*)$/i;
const CODEX_AUTH = /^(?:Your access token could not be refreshed\b.*|(?:Please )?(?:log|sign) (?:out and (?:log|sign) )?in again[.!]?|(?:Error: )?Not logged in[.!]?)$/i;
const CONNECTOR_AUTH = /^(.*?)\s*(?:needs you to sign in again|needs authentication)\s*\(run \/mcp to re-authenticate\)/i;
const CONNECTOR_NAME = /^[\w][\w.-]{0,119}$/;

/** A message from the CLI itself (an error line in its log or on its screen) that says it needs signing in. */
export function authNotice(cli: "claude" | "codex", text: string): SignInNeed | null {
  const lines = text.split("\n").map((l) => l.trim().replace(/^[⎿■●⚠]\s*/, ""));
  if (cli === "claude") {
    for (const l of lines) {
      const m = CONNECTOR_AUTH.exec(l);
      if (m) return { cli: "Claude Code", connector: CONNECTOR_NAME.test(m[1]) ? m[1] : "" };
    }
    if (lines.some((l) => CLAUDE_AUTH.test(l))) return { cli: "Claude Code" };
  } else {
    const name = /\bcodex mcp login [`'"]?([\w.-]+)[`'"]?\b/i.exec(lines.join(" "))?.[1];
    if (name && CONNECTOR_NAME.test(name) && lines.some((l) => /^(?:MCP|startup:)|(?:run|try)\s+[`'"]?codex mcp login/i.test(l))) return { cli: "Codex", connector: name };
    if (lines.some((l) => CODEX_AUTH.test(l))) return { cli: "Codex" };
  }
  return null;
}

/** Claude Code's login methods or Codex's welcome screen. */
export function signInMenu(cli: "claude" | "codex", text: string): SignInNeed | null {
  if (cli === "claude" && /select (?:a )?login method/i.test(text) && /Claude account|Anthropic Console/i.test(text)) return { cli: "Claude Code" };
  if (cli === "codex" && /Welcome to Codex|Choose how you want to use Codex/i.test(text) && /sign in with ChatGPT/i.test(text)) return { cli: "Codex" };
  return null;
}

export function signInScreen(cli: "claude" | "codex", text: string): SignInNeed | null {
  return signInMenu(cli, text) ?? authNotice(cli, text);
}

/** What the card says: the title, and what to run in the agent's own terminal. */
export function signInWords(need: SignInNeed): { title: string; how: string } {
  const title = `${need.cli} needs you to sign in`;
  if (need.cli === "Claude Code") {
    return { title, how: need.connector !== undefined ? `Open its terminal and run /mcp${need.connector ? ` to sign in to ${need.connector}` : ""}.` : "Open its terminal and run /login." };
  }
  if (need.connector) return { title, how: `Open its terminal and run codex mcp login ${need.connector}.` };
  return { title, how: "Open its terminal and run codex login (or codex login --device-auth on a machine without a browser)." };
}
