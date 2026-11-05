// A voice call with an agent's chat, as the same on both sides: the window's call (mods/chat/voice.ts, the machine's
// microphone and speaker) and the web app's (service/voice.ts, the phone's). An ElevenLabs voice agent talks with the
// person and passes on only what is meant for the coding agent (send_to_agent); it is told the coding agent's replies
// and status as [Update] lines. Plain data and words: each side does its own audio, files and sockets.
// Shared core: the source is core/voice.js.

export const API = "https://api.elevenlabs.io/v1";

export const prompt = (who) => `You are the voice of a chat with a coding agent (${who}) in the Herdr app. The person talks to you hands-free while the coding agent works in a terminal.
- Talk with the person naturally and briefly. Answer small talk, questions about what is going on, and clarifications yourself.
- Only when the person wants the coding agent to do or know something, call send_to_agent with their request in their own words (tidy it, keep every detail). Never send greetings, chit-chat, thanks, or anything the person says to you about the call. If unsure whether something is meant for the agent, ask the person.
- After sending, say in a few words that you passed it on.
- Messages that start with [Update] come from Herdr, not the person: never send them to the coding agent. Tell the person what they say, briefly: summarize a reply in one or two sentences in plain speech (no code, no paths read out letter by letter), and say plainly when the agent needs them.
- To answer "what is it doing?" or "what did it say?", call read_chat first. Never make up what the agent said or did.`;

const tool = (name, description, props, required) =>
  ({ type: "client", name, description, expects_response: true, response_timeout_secs: 20, parameters: { type: "object", properties: props, required } });

// The dedicated "Herdr chat" voice agent, made once with the person's key (its id kept in <app home>/secrets).
export const agentSpec = (who = "the coding agent") => ({
  name: "Herdr chat",
  conversation_config: {
    agent: {
      first_message: "Hi, I'm listening.",
      language: "en",
      prompt: { prompt: prompt(who), tools: [
        tool("send_to_agent", "Pass the person's request to the coding agent as a chat message. Only for what is meant for the coding agent.", { text: { type: "string", description: "The request, in the person's words" } }, ["text"]),
        tool("read_chat", "Read the coding agent's status and its last messages.", {}, []),
      ] },
    },
    asr: { user_input_audio_format: "pcm_16000" },
    tts: { agent_output_audio_format: "pcm_16000" },
  },
  platform_settings: {
    auth: { enable_auth: true },
    overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true } } },
    privacy: { record_voice: false, retention_days: 0 },
  },
});

// What starts the conversation, once its socket is open.
export const opening = (who) => ({ type: "conversation_initiation_client_data",
  conversation_config_override: { agent: { prompt: { prompt: prompt(who) }, first_message: `You're on a call about ${who}. Go ahead.` } } });

// The coding agent replied in the chat: the voice agent says it.
export const replyLine = (who, text) => ({ type: "user_message", text: `[Update] ${who} replied in the chat: """${String(text).slice(0, 3000)}""" Tell the person what it says, briefly.` });

// Its status changed: a quiet note, or (it needs the person) said out loud. null: nothing to say.
export function statusLine(who, status, asking) {
  if (status === "working") return { type: "contextual_update", text: `[Update] ${who} is working now.` };
  if (status === "blocked") return { type: "user_message", text: `[Update] ${who} needs the person${asking ? `: ${String(asking).slice(0, 600)}` : " to answer something in the terminal"}. Tell them, briefly.` };
  if (status === "idle" || status === "done") return { type: "contextual_update", text: `[Update] ${who} finished and is waiting.` };
  return null;
}

// A key=value file (secrets/elevenlabs.env), as its lines.
export function envLines(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// An error from ElevenLabs, said without anything that looks like a key.
export const apiError = (status, body) => `ElevenLabs said ${status}${body ? `: ${String(body).slice(0, 300).replace(/[A-Za-z0-9_-]{32,}/g, "…")}` : ""}`;

// ---- the key ------------------------------------------------------------------------------
// ELEVENLABS_API_KEY lives in Settings › Secrets (Everywhere), in the vault on the machine that keeps the secrets
// (`herdr-secret where`; Settings › Secrets › Kept on). A call on another machine reads it from there over herdr-core's
// link into memory only: it's never written, logged or copied here. The voice agent's id made with it is kept beside it
// there (secrets/elevenlabs-agent.env, with a tag of the key), so every machine uses the same "Herdr chat" agent.

export const KEY_NAME = "ELEVENLABS_API_KEY";
export const NO_KEY = "Voice calls need an ElevenLabs key: add it in Settings › Secrets (as ELEVENLABS_API_KEY, for Everywhere).";
export const noKeyOn = (name) => `Voice calls need an ElevenLabs key: ${name}, which keeps your secrets, has none. Add ELEVENLABS_API_KEY in Settings › Secrets, for Everywhere.`;
export const unreachable = (name) => `Can't reach ${name}, which keeps your secrets, for the ElevenLabs key: is it on and linked? Try again in a moment.`;

// Run with python3 on the machine that keeps the secrets: prints {"key", "agent"} (the agent only if made with this
// key). Reads the vault's Everywhere entry, else the old secrets/elevenlabs.env there.
export const KEY_SCRIPT = `
import hashlib, json, os
H = os.path.expanduser("~")
app = os.environ.get("HERDR_APP_HOME") or os.path.join(H, ".config", "herdr-app")
def env(p):
    out = {}
    try:
        with open(p) as f:
            for l in f:
                l = l.strip()
                if l.startswith("export "):
                    l = l[7:].strip()
                if l and not l.startswith("#") and "=" in l:
                    k, v = l.split("=", 1)
                    out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out
key = ""
try:
    with open(os.path.join(H, ".herdr", "vault.json")) as f:
        v = json.load(f)
    key = next((e["value"] for e in v.get("secrets", []) if e.get("name") == "${KEY_NAME}" and e.get("scope") == "everywhere" and isinstance(e.get("value"), str)), "")
except Exception:
    pass
key = key or env(os.path.join(app, "secrets", "elevenlabs.env")).get("${KEY_NAME}", "")
a = env(os.path.join(app, "secrets", "elevenlabs-agent.env"))
tag = hashlib.sha256(key.encode()).hexdigest()[:16] if key else ""
print(json.dumps({"key": key, "agent": a.get("ELEVENLABS_AGENT_ID", "") if key and a.get("ELEVENLABS_KEY_TAG") == tag else ""}))
`;

/** The vault's Everywhere value of a name (the vault file's text), else "". */
export function vaultValue(text, name = KEY_NAME) {
  try {
    const v = JSON.parse(text);
    const e = (Array.isArray(v?.secrets) ? v.secrets : []).find((x) => x?.name === name && x?.scope === "everywhere");
    return typeof e?.value === "string" ? e.value : "";
  } catch { return ""; }
}

/**
 * The key for a call: { key, agent?, from } (from: "file" | "here" | the main machine's name) or { error, why }
 * (why: "none" when the machine that keeps the secrets truly has none, "unreachable" when it can't be asked now,
 * No machine named to keep them yet (the services name one on their own, core/secrets.js autoKeeper; this is until that
 * reaches here): this machine's vault, then each machine linked from here, the first with a key. io:
 *   oldFile()          the old <app home>/secrets/elevenlabs.env here: its key or ""
 *   where()            `herdr-secret where --json` here: { here, set, name } (null: no herdr-secret: this machine)
 *   vault()            the vault file's text here, or null
 *   ask(name, script)  python3 -c script on that machine: its stdout, or null when it couldn't run there
 *   machines()         the names of the machines linked from here that are on now (only asked when none is named)
 */
export async function voiceKey(io) {
  const file = io.oldFile();
  if (file) return { key: file, from: "file" };
  const w = await io.where().catch(() => null);
  if (!w || w.here) {
    const key = vaultValue(io.vault() ?? "");
    return key ? { key, from: "here" } : { error: NO_KEY, why: "none" };
  }
  if (!w.set) {
    const here = vaultValue(io.vault() ?? "");
    if (here) return { key: here, from: "here" };
    for (const name of (await io.machines?.().catch(() => null)) ?? []) {
      const r = await askKey(io, name);
      if (r?.key) return r;
    }
    return { error: NO_KEY, why: "none" };
  }
  if (!w.name) return { error: unreachable("the machine that keeps your secrets (not linked from here)"), why: "unreachable" };
  const r = await askKey(io, w.name);
  if (!r) return { error: unreachable(w.name), why: "unreachable" };
  if (!r.key) return { error: noKeyOn(w.name), why: "none" };
  return r;
}

// The key on that machine (KEY_SCRIPT): { key, agent, from } (key "" when it has none), or null when it can't be asked.
async function askKey(io, name) {
  const out = await io.ask(name, KEY_SCRIPT).catch(() => null);
  let r = null;
  try { r = JSON.parse(String(out ?? "").trim().split("\n").pop()); } catch {}
  if (!r || typeof r.key !== "string") return null;
  return { key: r.key, agent: r.key && typeof r.agent === "string" && /^[\w-]{1,200}$/.test(r.agent) ? r.agent : "", from: name };
}

// ---- dictation ----------------------------------------------------------------------------
// The composer's mic (the window's mods/chat/transcribe.ts, the web app's service/dictate.ts): the recording goes to
// ElevenLabs speech to text (Scribe) with the same key as a call (voiceKey), the language found from the audio (the
// person writes English and Swedish). The words go into the box to edit; nothing is kept and the key never leaves memory.

export const STT_MODEL = "scribe_v2";
export const DICTATE_NO_KEY = "Dictation needs an ElevenLabs key in Settings › Secrets.";
export const MAX_AUDIO = 20 * 1024 * 1024;

/** A failed key lookup (voiceKey's { error, why }) in dictation's words: no key → where to add it; else as it said. */
export const dictateKeyError = (k) => k.why === "none" ? DICTATE_NO_KEY : k.error;

/** The speech to text request: POST <API>/speech-to-text, multipart with the audio and the model; no language_code,
 *  so it finds the language itself; no audio events ("(laughter)"). */
export function sttRequest(key, audio, filename = "dictation") {
  const form = new FormData();
  form.append("model_id", STT_MODEL);
  form.append("tag_audio_events", "false");
  form.append("file", audio, filename);
  return { url: `${API}/speech-to-text`, init: { method: "POST", body: form, redirect: "error", headers: { "xi-api-key": key } } };
}

/** ElevenLabs' short reason for a failed request (its detail.message, else the status), keys and tokens hidden. */
export function sttError(status, body) {
  let why = "";
  try {
    const d = JSON.parse(body)?.detail;
    why = typeof d === "string" ? d : typeof d?.message === "string" ? d.message : Array.isArray(d) && typeof d[0]?.msg === "string" ? d[0].msg : "";
  } catch {}
  why = why.replace(/[A-Za-z0-9_-]{32,}/g, "…").replace(/\s+/g, " ").trim().slice(0, 200);
  return why ? `ElevenLabs said: ${why}` : `ElevenLabs said ${status}.`;
}

/** Writes a recording down: its words ("" when nothing was said), or throws an Error in plain words.
 *  key(): voiceKey's answer (the caller's io); fetchFn: fetch (a test's stand-in). */
export async function transcribe(audio, key, fetchFn = fetch, filename) {
  if (!audio?.size) throw new Error("Nothing was recorded.");
  if (audio.size > MAX_AUDIO) throw new Error("That recording is too long.");
  const k = await key();
  if ("error" in k) throw new Error(dictateKeyError(k));
  const { url, init } = sttRequest(k.key, audio, filename);
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new Error(e?.name === "TimeoutError" ? "ElevenLabs didn't answer in time. Try again." : "Can't reach ElevenLabs. Check this machine's internet, then try again."); }
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(sttError(r.status, body));
  let text = "";
  try { text = JSON.parse(body)?.text; } catch {}
  if (typeof text !== "string") throw new Error("ElevenLabs gave no words back.");
  return text.replace(/\s+/g, " ").trim();
}
