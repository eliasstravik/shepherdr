// A voice call, as the same on both sides: the window's call (mods/chat/voice.ts, the machine's microphone and
// speaker) and the web app's (service/voice.ts, the phone's). An ElevenLabs voice agent talks with the person and
// reads, opens and changes Shepherdr for them through four client tools (look, open, send, act), which the service
// answers (service/voice-tools.ts; the window's call asks its machine's service). It is told the called agent's
// replies and status as [Update] lines. Plain data and words: each side does its own audio, files and sockets.
// Shared core: the source is core/voice.js.

export const API = "https://api.elevenlabs.io/v1";

export const prompt = (who, where = "") => `You are Shepherdr's voice: the person's hands-free assistant for Shepherdr, an app where AI coding agents work on tasks across their machines. You are on a call that started in ${who}'s chat.

How Shepherdr works:
- A machine (this computer, a Mac mini, a VM) has spaces. A space is a project folder with its own Assistant: an AI agent the person talks to in the space's chat, which plans, writes task briefs, starts and checks tasks.
- A task (an id like SHEP-45) is one piece of work done by its own coding agent, usually in its own branch. Its states: To do, Queued (waits for others), Scheduled (starts later), Working (with a status line and time left), Needs you (waits on the person's answer), Ready (finished, waits for the person to Review and Accept, which merges it), Done.
- Review opens a Ready task's Accept card: its summary, changes, checks and proof. Accept merges it.
- Autopilot: a space's Assistant wakes on a schedule and works on its own toward the space's direction (its heartbeat).
- Needs you: everything waiting on the person: questions, Ready tasks, asks for a secret.
- Artifacts are pages agents publish (proofs, reports). Secrets are kept by name: never read a value out, never ask for one by voice.

Your tools:
- look: read anything: where the call is and what is on screen, a chat (latest messages or a search), spaces, machines, tasks, one task, Needs you, news, Autopilot, automations, settings, secret names, artifacts.
- open: show something in the person's app (the one the call runs in): a space, a task and its tab, the Tasks panel, Needs you, an artifact, Settings, or back to the call's chat.
- send: write in a chat as the person: the call's chat, any space's Assistant or a task's agent.
- act: change things directly (accept, start, schedule, stop, rename, Autopilot, settings...).

Rules:
- Always use look before you answer about the person's work: never guess or invent what an agent said, a task's state or anything else. If look can't tell, say so.
- "Here", "this task", "this space", "that one" mean what the call's context says (look with what "here" when unsure), or what you just talked about.
- Making or planning things (a new task with a brief, a new space, an automation, Autopilot's direction, editing a brief, anything that takes judgment) goes to that space's Assistant with send, in the person's words with every detail. Say you passed it on.
- Before any act, say in a few words exactly what it will do and ask; call act with confirmed true only after the person clearly said yes on this call. Without a yes, call it with confirmed false (it changes nothing and tells you what to ask).
- Sending is fine without asking when the person clearly asked you to send it. Never send greetings, chit-chat, or what the person says to you about the call. If unsure whether something is meant for an agent, ask.
- Messages that start with [Update] come from Shepherdr, not the person: never send them on. Tell the person what they say, briefly, and plainly when an agent needs them.
- open shows it on the very screen the call runs on, and its answer says whether that screen confirmed it. Say something is on screen only when open's answer says it is; otherwise say it didn't open and why. If several spaces or machines fit, ask which.
- Speak briefly and naturally, like a person: one or two sentences, then stop. Summarize; never read out code, paths, links or ids letter by letter (say "SHEP 45"). Offer more only if asked.${where ? `\n\nWhere the call is now: ${where}` : ""}`;

const PLACE = { type: "string", description: "Which one: a space's name, a task's id (SHEP-45), a machine's or artifact's name, or \"here\" (the call's or what is on screen). Leave out for all." };
const tool = (name, description, props, required = []) =>
  ({ type: "client", name, description, expects_response: true, response_timeout_secs: 30, parameters: { type: "object", properties: props, required } });

/** What a look can read, an open can show and an act can do (service/voice-tools.ts answers each). */
export const LOOKS = ["here", "chat", "spaces", "machines", "tasks", "task", "needs", "news", "autopilot", "automations", "settings", "secrets", "artifacts"];
export const OPENS = ["space", "task", "tasks", "needs", "artifact", "settings", "chat"];
export const TABS = ["chat", "terminal", "files", "changes", "pr", "browser", "review"];
export const ACTS = ["accept", "start", "schedule", "unschedule", "stop", "resume", "done", "reopen", "delete", "pin", "unpin",
  "autopilot_on", "autopilot_off", "autopilot_run", "rename_space", "remove_space", "setting", "forget_secret", "delete_artifact"];

export const TOOLS = [
  tool("look", "Read Shepherdr: where the call is, a chat, spaces, machines, tasks, a task's details, what needs the person, news, Autopilot, automations, settings, secret names, artifacts. Answers in short sentences.", {
    what: { type: "string", enum: LOOKS, description: "What to read. here: the call's context and what is on screen. chat: a chat's latest messages (or a search with query). tasks: a list (filter with id and query). task: one task's details, summary, proof and pull request." },
    id: PLACE,
    query: { type: "string", description: "Words to search for (a chat, tasks, settings, artifacts), or a task state to filter tasks (working, ready, needs, queued, scheduled, todo, done)." },
    count: { type: "integer", description: "How many chat messages or items (default 6, at most 30)." },
  }, ["what"]),
  tool("open", "Show something in the person's app, the one the call runs in: a space, a task (on a tab), the Tasks panel, Needs you, an artifact, Settings, or the call's chat.", {
    what: { type: "string", enum: OPENS, description: "What to show." },
    id: PLACE,
    tab: { type: "string", enum: TABS, description: "A task's tab: chat, terminal, files, changes, pr (pull request), browser, or review (a Ready task's Accept card)." },
  }, ["what"]),
  tool("send", "Write a message as the person: to the call's chat (default), a space's Assistant (by the space's name) or a task's agent (by its id). Also how to ask an Assistant to make, plan or change things.", {
    to: { type: "string", description: "A space's name (its Assistant), a task's id (its agent), or \"here\" (the call's chat, the default)." },
    text: { type: "string", description: "The message, in the person's words, tidied, with every detail." },
  }, ["text"]),
  tool("act", "Change something directly. Ask the person first and set confirmed true only after a clear yes; with confirmed false nothing changes and it says what to ask.", {
    action: { type: "string", enum: ACTS, description: "accept: a Ready task (merges it). start: a task now. schedule: a task later (value: when, \"in 2h\", \"tomorrow 9:00\"). unschedule. stop: a working task's agent. resume: an ended task's agent. done: mark a task done without merging. reopen: a done or ready task. delete: a task. pin, unpin: a task. autopilot_on, autopilot_off, autopilot_run (wake now): a space's. rename_space (value: the new name). remove_space: forget a space (its folder stays). setting: change a setting (key: its name, value, id: a space or leave out for everywhere). forget_secret: delete a secret by name (key). delete_artifact." },
    id: PLACE,
    key: { type: "string", description: "setting: the setting's name as Settings shows it. forget_secret: the secret's name." },
    value: { type: "string", description: "The new value: a time for schedule, a name for rename_space, a setting's value." },
    confirmed: { type: "boolean", description: "True only after the person said yes to exactly this on the call." },
  }, ["action", "confirmed"]),
];

// The dedicated "Herdr chat" voice agent, made with the person's key (its id kept in <app home>/secrets) and brought
// up to this spec whenever it changes (SPEC, ensureAgent).
export const agentSpec = () => ({
  name: "Herdr chat",
  conversation_config: {
    agent: {
      first_message: "Hi, I'm listening.",
      language: "en",
      // a model that is good with tools (ElevenLabs' advice), quick enough to talk
      prompt: { prompt: prompt("an agent"), llm: "claude-sonnet-5-5", tools: TOOLS },
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

/** A short fingerprint of a spec (FNV-1a over its JSON): a change to the tools or prompt changes it. */
export function specTag(spec = agentSpec()) {
  let h = 0x811c9dc5;
  const s = JSON.stringify(spec);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
export const SPEC = specTag();

/**
 * The voice agent's id, up to this spec: the one kept here for this key (tag), else the one the machine that keeps the
 * key made (made), else an old untagged one, else a new one. One kept from another spec is PATCHed to this one (one
 * gone from ElevenLabs is made again); a failed PATCH still calls on it, and tries again next call. io:
 *   saved           the kept file's lines: { ELEVENLABS_AGENT_ID, ELEVENLABS_KEY_TAG, ELEVENLABS_SPEC }
 *   tag             a tag of the key (never the key)
 *   made            the agent the machine that keeps the key made with it, or ""
 *   api(path, init) ElevenLabs' JSON answer, or throws an Error whose message has its status ("ElevenLabs said 404")
 *   save(id, spec)  keep the id with the tag and spec
 */
export async function ensureAgent(io) {
  const s = io.saved ?? {};
  const mine = s.ELEVENLABS_AGENT_ID && s.ELEVENLABS_KEY_TAG === io.tag;
  let id = (mine ? s.ELEVENLABS_AGENT_ID : "") || io.made || (s.ELEVENLABS_AGENT_ID && !s.ELEVENLABS_KEY_TAG ? s.ELEVENLABS_AGENT_ID : "");
  if (id && mine && s.ELEVENLABS_SPEC === SPEC) return id;
  if (id) {
    const path = `/convai/agents/${encodeURIComponent(id)}`;
    // ElevenLabs keeps an agent's tools as records of their own: the ones this PATCH replaces go (best effort)
    const toolIds = async () => (await io.api(path).catch(() => null))?.conversation_config?.agent?.prompt?.tool_ids ?? [];
    const before = await toolIds();
    try { await io.api(path, { method: "PATCH", body: JSON.stringify(agentSpec()) }); }
    catch (e) {
      if (!/\b404\b/.test(String(e?.message ?? e))) { if (!mine) io.save(id, ""); return id; }
      id = "";
    }
    if (id && before.length) {
      const now = new Set(await toolIds());
      // (none read back: nothing goes)
      if (now.size) for (const t of before) if (typeof t === "string" && /^[\w-]{1,200}$/.test(t) && !now.has(t)) await io.api(`/convai/tools/${t}`, { method: "DELETE" }).catch(() => null);
    }
  }
  if (!id) {
    const r = await io.api("/convai/agents/create", { method: "POST", body: JSON.stringify(agentSpec()) });
    if (typeof r?.agent_id !== "string" || !/^[\w-]{1,200}$/.test(r.agent_id)) throw new Error("ElevenLabs didn't make the voice agent.");
    id = r.agent_id;
  }
  io.save(id, SPEC);
  return id;
}

/** The kept file's words: only the id, a tag of the key and the spec it was brought up to, never the key. */
export const agentFile = (id, tag, spec) =>
  `# The "Herdr chat" voice agent, made by Shepherdr with ELEVENLABS_API_KEY.\nELEVENLABS_AGENT_ID=${id}\nELEVENLABS_KEY_TAG=${tag}\nELEVENLABS_SPEC=${spec}\n`;

// What starts the conversation, once its socket is open: the prompt with where the call is.
export const opening = (who, where = "") => ({ type: "conversation_initiation_client_data",
  conversation_config_override: { agent: { prompt: { prompt: prompt(who, where) }, first_message: `You're on a call about ${who}. Go ahead.` } } });

/** The person moved in the app during the call: a quiet note of where they are now. */
export const whereLine = (where) => ({ type: "contextual_update", text: `[Update] The person's app now shows: ${String(where).slice(0, 600)}` });

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

/**
 * An open's words for the voice agent once the app that started the call tried it (ack: { ok, why } from that page or
 * window; null: it didn't answer in time). Only an ok says it is on screen.
 */
export function navWords(shows, ack) {
  const cut = (t) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > 200 ? `${x.slice(0, 199)}…` : x; };
  if (ack?.ok) return { result: `It's on the person's screen now: ${shows}.` };
  if (!ack) return { result: `The person's app didn't confirm it opened ${shows}: say it may not have opened, and that reloading the app can fix it.`, error: true };
  return { result: `It couldn't open ${shows} on the person's screen: ${cut(ack.why || "it didn't open")}.`, error: true };
}
