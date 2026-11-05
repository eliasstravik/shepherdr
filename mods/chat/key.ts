// The ElevenLabs key for a call (voice.ts) or dictation (transcribe.ts): ELEVENLABS_API_KEY from the old
// <app home>/secrets/elevenlabs.env here, else as kept in Settings › Secrets for Everywhere (the vault), here or on the
// machine that keeps the secrets, read from there over herdr-core's link into memory only (core/voice.js voiceKey).
// Never printed, logged or written here.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { envLines, voiceKey } from "./core/voice.js";

export const HOME = process.env.HERDR_APP_HOME || join(process.env.HOME ?? "", ".config/herdr-app");
export const SECRETS = join(HOME, "secrets");

// A program's output (null: it failed), its input none.
export async function output(argv: string[]) {
  try {
    const p = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const out = await new Response(p.stdout).text();
    return (await p.exited) === 0 ? out : null;
  } catch { return null; }
}
const secretBin = () => [join(HOME, "bin", "herdr-secret"), join(process.env.HOME ?? "", ".local", "bin", "herdr-secret")].find(existsSync) ?? "herdr-secret";

export function envFile(file: string): Record<string, string> {
  try { return envLines(readFileSync(file, "utf8")); } catch { return {}; }
}

// The key: the old file here, the vault here, or the machine that keeps the secrets (in memory only).
export const keyFor = () => voiceKey({
  oldFile: () => envFile(join(SECRETS, "elevenlabs.env")).ELEVENLABS_API_KEY || "",
  where: async () => { const out = await output([secretBin(), "where", "--json"]); return out ? JSON.parse(out) : null; },
  vault: () => { try { return readFileSync(join(process.env.HOME ?? "", ".herdr", "vault.json"), "utf8"); } catch { return null; } },
  ask: (on: string, script: string) => output(["hc", "exec", "--on", on, "--timeout", "15", "--", "python3", "-c", script]),
  // none named to keep them yet: each machine linked from here that is on (SHEP-33)
  machines: async () => {
    const out = await output(["hc", "machine", "ls", "--json"]);
    try { return (JSON.parse(out ?? "").machines ?? []).filter((m: any) => !m.temporary && m.state === "connected" && m.name).map((m: any) => String(m.name)); } catch { return []; }
  },
}) as Promise<{ key: string; agent?: string } | { error: string; why: string }>;
