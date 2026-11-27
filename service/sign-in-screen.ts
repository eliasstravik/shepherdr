import { readScreen } from "../core/screens.js";
import type { SignIn } from "../web/shared/types.ts";

export type LoginChoice = { label: string; keys?: number; command?: "/login" | "/mcp"; mode?: "device" | "key" | "connector"; fallback?: string };
export type LoginStep = SignIn & { options?: LoginChoice[]; cursor?: number; connector?: string; closeMenu?: boolean };

const CLAUDE = "Claude Code", CODEX = "Codex";
const CLAUDE_AUTH = /^(?:Not logged in[. ·—-]*\s*(?:Please run \/login.*)?|(?:API Error: .*?[·. ]\s*)?(?:Please run|Run) \/login\b.*|OAuth token has expired\b.*)$/i;
const CODEX_AUTH = /^(?:Your access token could not be refreshed\b.*|(?:Please )?(?:log|sign) (?:out and (?:log|sign) )?in again[.!]?|(?:Error: )?Not logged in[.!]?)$/i;
const CONNECTOR_AUTH = /(?:needs you to sign in again|needs authentication)\s*\(run \/mcp to re-authenticate\)/i;
const CONNECTOR_NAME = /^[\w][\w.-]{0,119}$/;

function urlAfter(lines: string[], after: RegExp, width: number, accept: (url: URL) => boolean) {
  const from = lines.findLastIndex((line) => after.test(line));
  if (from < 0) return;
  for (let i = from; i < Math.min(from + 5, lines.length); i++) {
    const line = lines[i];
    let raw = line.match(/https:\/\/[^\s<>]+/)?.[0];
    if (!raw) continue;
    while (lines[i].length >= width && /^[\w%?&=./~+#:@-]+$/.test(lines[i + 1] ?? "")) raw += lines[++i];
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && !url.username && !url.password && accept(url)) return url.href;
    } catch {}
  }
}

const oauth = (url: URL) => url.searchParams.has("state") && url.searchParams.has("redirect_uri");
const openAI = (url: URL) => url.hostname === "auth.openai.com";
const anthropic = (url: URL) => /^(?:claude\.ai|(?:platform|console|claude)\.anthropic\.com)$/.test(url.hostname);

export function authNotice(cli: "claude" | "codex", text: string): LoginStep | null {
  const lines = text.split("\n").map((l) => l.trim().replace(/^[⎿■●⚠]\s*/, ""));
  if (cli === "claude") {
    if (lines.some((l) => CONNECTOR_AUTH.test(l))) return { cli: CLAUDE, stage: "start", connector: "", options: [{ label: "Sign in", command: "/mcp" }] } satisfies LoginStep;
    if (lines.some((l) => CLAUDE_AUTH.test(l))) return { cli: CLAUDE, stage: "start", options: [{ label: "Sign in", command: "/login" }] } satisfies LoginStep;
  } else {
    const name = /\bcodex mcp login [`'"]?([\w.-]+)[`'"]?\b/i.exec(lines.join(" "))?.[1];
    if (name && CONNECTOR_NAME.test(name) && lines.some((l) => /^(?:MCP|startup:)|(?:run|try)\s+[`'"]?codex mcp login/i.test(l))) {
      return { cli: CODEX, stage: "start", connector: name, options: [{ label: "Sign in", mode: "connector" }] } satisfies LoginStep;
    }
    if (lines.some((l) => CODEX_AUTH.test(l))) return { cli: CODEX, stage: "methods", options: codexMethods() } satisfies LoginStep;
  }
  return null;
}

const CODEX_BROWSER = "The browser has to run on the same computer as Codex for this option. On a phone or another computer, choose the device code.";
const CUSTOM = "Set up your provider’s credentials on the computer that runs the agent, then return to this chat.";
const codexMethods = (): LoginChoice[] => [
  { label: "ChatGPT with a device code", mode: "device" },
  { label: "OpenAI API key", mode: "key" },
  { label: "ChatGPT in a browser on the agent’s computer", fallback: CODEX_BROWSER },
];

export function loginScreen(cli: "claude" | "codex", text: string, width: number, active?: LoginStep, helper = false): LoginStep | null {
  const name = cli === "claude" ? CLAUDE : CODEX;
  const lines = text.split("\n").map((l) => l.trimEnd());
  const body = lines.join("\n");
  const menu = readScreen(body, width);
  const options = menu.choices.map(({ label }: { label: string }, keys: number) => ({ label, keys }));
  const connector = active?.connector;
  if (cli === "codex") {
    const device = urlAfter(lines, /open this link|open this url/i, width, (u) => openAI(u) && u.pathname === "/codex/device");
    const devicePrompt = lines.findIndex((l) => /enter this one-time code/i.test(l));
    const code = devicePrompt < 0 ? undefined : lines.slice(devicePrompt + 1, devicePrompt + 5).map((l) => l.trim()).find((l) => /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/.test(l));
    if (device && code) return { cli: name, stage: "browser", url: device, deviceCode: code };
    if (helper && connector !== undefined) {
      const url = urlAfter(lines, /authorize .*by opening this url/i, width, oauth);
      if (url && /callback url \(input hidden\)/i.test(body)) return { cli: name, stage: "browser", connector, url, input: "callback" };
    }
    if (/Welcome to Codex|Choose how you want to use Codex/i.test(body) && options.some((o) => /sign in with ChatGPT/i.test(o.label))) {
      const methods: LoginChoice[] = options.flatMap((o): LoginChoice[] => {
        if (/device code/i.test(o.label)) return [{ ...o, label: "ChatGPT with a device code" }];
        if (/ChatGPT/i.test(o.label)) return [{ ...o, label: "ChatGPT in a browser on the agent’s computer", fallback: CODEX_BROWSER }];
        if (/API key|sign in another way/i.test(o.label)) return [{ label: "OpenAI API key", mode: "key" }, { label: "Another provider", fallback: CUSTOM }];
        return [];
      });
      return { cli: name, stage: "methods", options: methods, cursor: menu.at };
    }
    const browser = urlAfter(lines, /open.*(?:browser|link|url)|sign in via your browser/i, width, (u) => openAI(u) && oauth(u));
    if (browser && /sign.?in|log.?in/i.test(body)) return { cli: name, stage: "browser", url: browser, instructions: CODEX_BROWSER };
    if (active?.stage === "browser" && active.deviceCode && /Do you trust the contents of this directory\?|Do you trust this directory\?|(?:^|\n)\s*[›❯] Ask Codex to do anything\b/m.test(body) && !/Welcome to Codex|Finish signing in/i.test(body)) {
      return { cli: name, stage: "signed" };
    }
  } else {
    if (/select (?:a )?login method/i.test(body) && options.some((o) => /Claude account|Anthropic Console/i.test(o.label))) {
      const methods: LoginChoice[] = options.filter((o) => /Claude account|Anthropic Console|platform/i.test(o.label)).map((o) =>
        /platform/i.test(o.label) ? { ...o, label: "Bedrock, Microsoft Foundry or Google Vertex AI", fallback: CUSTOM }
          : { ...o, label: /Console/i.test(o.label) ? "Anthropic Console" : "Claude subscription" });
      return { cli: name, stage: "methods", options: methods, cursor: menu.at };
    }
    if (/paste (?:the )?(?:authentication )?code here/i.test(body)) {
      const url = urlAfter(lines, /use the url below|open this url|browser didn.t open/i, width, anthropic);
      if (url) return { cli: name, stage: "browser", url, input: "code" };
    }
    const callback = /(?:paste|enter).*(?:callback|redirect).*url|if the redirect page.*paste the url/i.test(body);
    if (callback) {
      const url = urlAfter(lines, /(?:authoriz|authenticate|open|browser didn.t open).*(?:browser|url|link)/i, width, oauth);
      if (url) return { cli: name, stage: "browser", connector: /(?:^|\n)\s*Authenticate with ([^\n]+)/i.exec(body)?.[1].trim() ?? connector ?? "", url, input: "callback" };
    }
    if (active && /(?:^|\n)\s*[✓✔]?\s*(?:Login successful|Authentication successful|Successfully (?:logged in|authenticated))\b/i.test(body)) {
      const advance = /(?:press enter|enter to continue)/i.test(body);
      return { cli: name, stage: advance ? "continue" : "signed", connector,
        ...(advance ? { cursor: 0, options: [{ label: "Continue", keys: 0 }] } : {}) };
    }
    if (active && /[✘×]\s*OAuth error:|[✘×]\s*Authentication failed/i.test(body) && /press enter to retry/i.test(body)) {
      return { cli: name, stage: "retry", connector, instructions: "Claude couldn’t finish this sign-in. Try again for a fresh link.", cursor: 0, options: [{ label: "Try again", keys: 0 }] };
    }
    const detail = /(?:^|\n)\s*([^\n]+)\n\s*MCP server\s*(?:\n|$)/i.exec(body)?.[1].trim();
    if (detail && /↑\/↓ to navigate.*enter to select/i.test(body)) {
      const signIn = options.filter((o) => /^(?:authenticate|re-authenticate)\b/i.test(o.label));
      if (signIn.length) return { cli: name, stage: "methods", connector: detail, cursor: menu.at,
        options: signIn.map((o) => ({ ...o, label: "Sign in to this connector" })),
        ...(/(?:sdk auth failed|authentication failed)/i.test(body) ? { instructions: "The connector couldn’t finish sign-in. Try again, or check its setup in the terminal." } : {}) };
      if (connector === detail && active && /Status:\s*[✓✔]?\s*connected/i.test(body)) return { cli: name, stage: "continue", connector,
        cursor: 0, options: [{ label: "Continue", keys: 0 }], closeMenu: true };
    }
    if (/(?:^|\n)\s*MCP servers\s*\n/i.test(body) && /enter to view/i.test(body)) {
      const servers = lines.flatMap((l) => {
        const found = /^\s*([❯›])?\s*[⚠✓✔✘✗○●△◌\u25ce]\s+(.+?)\s{2,}(\S.*?)\s*$/u.exec(l);
        return found ? [{ current: !!found[1], label: found[2], status: found[3] }] : [];
      });
      const cursor = servers.findIndex((s) => s.current);
      const choices = servers.flatMap((s, keys) => /needs sign-in|needs auth|authentication required|not authenticated/i.test(s.status) ? [{ label: s.label, keys }] : []);
      if (cursor >= 0 && choices.length) return { cli: name, stage: "methods", connector: "", cursor, options: choices };
    }

  }
  if (helper) return null;
  return authNotice(cli, body);
}

export function loginInput(step: LoginStep, input: unknown) {
  if (typeof input !== "string" || !input || input.length > 2048) return null;
  const text = input.trim();
  if (step.input === "code") return /^[\w.#~+/=-]{1,2048}$/.test(text) ? text : null;
  if (step.input !== "callback" || !step.url || !/^[\x21-\x7e]+$/.test(text)) return null;
  try {
    const authorization = new URL(step.url);
    const target = new URL(authorization.searchParams.get("redirect_uri") ?? "");
    const got = new URL(text);
    if (got.origin !== target.origin || got.pathname !== target.pathname || got.username || got.password || got.hash) return null;
    if (!got.searchParams.get("code") || got.searchParams.getAll("code").length !== 1 || got.searchParams.getAll("state").length !== 1 || !authorization.searchParams.get("state") || got.searchParams.get("state") !== authorization.searchParams.get("state")) return null;
    return text;
  } catch { return null; }
}
