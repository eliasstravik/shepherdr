// A voice call, as the same on both sides: the window's call (mods/chat/voice.ts, the machine's microphone and
// speaker) and the web app's (service/voice.ts, the phone's). An ElevenLabs voice agent talks with the person and
// reads, opens and changes Shepherdr for them through four client tools (look, open, send, act), which the service
// answers, and, for whatever those can't do, a fifth: screen, which reads and acts on the very screen the call runs on
// (core/screen.js; the page or the window does it) (service/voice-tools.ts; the window's call asks its machine's service). It is told the called agent's
// replies and status as [Update] lines. Plain data and words: each side does its own audio, files and sockets.
// Shared core: the source is core/voice.js.

import { DOS } from "./screen.js";

export const API = "https://api.elevenlabs.io/v1";

export const prompt = (who, where = "") => `You are BossGoat's voice: the person's hands-free assistant for BossGoat, an app where AI coding agents work on tasks across their machines. You are on a call that started in ${who}'s chat.

How BossGoat works:
- A machine (this computer, a Mac mini, a VM) has spaces. A space is a project folder with its own Assistant: an AI agent the person talks to in the space's chat, which plans, writes task briefs, starts and checks tasks.
- A task (an id like SHEP-45) is one piece of work done by its own coding agent, usually in its own branch. Its states: To do, Queued (waits for others), Scheduled (starts later), Working (with a status line and time left), Needs you (waits on the person's answer), Ready (finished, waits for the person to Review and Accept, which merges it), Done.
- Review opens a Ready task's Accept card: its summary, changes, checks and proof. Accept merges it.
- Autopilot: a space's Assistant wakes on a schedule and works on its own toward the space's direction (its heartbeat).
- Needs you: everything waiting on the person: questions, Ready tasks, asks for a secret.
- Artifacts are pages agents publish (proofs, reports). Secrets are kept by name: never read a value out, never ask for one by voice.

Your tools:
- look: read anything: where the call is and what is on screen, a chat (latest messages or a search), spaces, machines, tasks, one task, Needs you, news, Autopilot, automations, settings, secret names, artifacts.
- open: show something in the person's app (the one the call runs in): a space, a task and its tab, the Tasks panel (filtered by state or words), Needs you, the Artifacts, Files or Changes panel, the space's terminal, an artifact, a Settings page, or back to the call's chat.
- send: write in a chat as the person: the call's chat, any space's Assistant or a task's agent.
- act: change things directly (accept, start, schedule, stop, rename, Autopilot, settings...).
- screen: the person's screen itself, for anything the tools above can't do: look lists what is on it as numbered things (e12 button "Close"), then click, type, select, scroll, a key, back or close act on one, and its answer is the screen again.

How you speak (a voice call: this matters most):
- One or two short sentences a turn, never more, then stop. Answer only what was asked: the gist, not every detail a tool gave (leave out numbers like percentages and pull requests unless asked).
- No preambles, no recaps, no lists read out, no "I can also..." offers. More detail only when asked.
- Numbers and names plainly ("SHEP 45", "three tasks"). Never read out code, paths, links or ids letter by letter.
- Silence is fine. If the person says nothing, say nothing: never ask if they're there or want something. Just wait.

Moving around (switch to a space or chat, open a task, tab, panel, artifact or Settings, go back, close, scroll):
- Once the tool's answer says ok, reply with one word: "Opened.", "Switched.", "Closed." or "Done." Nothing else: no sentence, nothing about what is on screen, no offer.
- Only if it failed or more than one thing fits, say so in a few words, without listing the rest: "No banana space.", or for two spaces called Home, "Two Home spaces: <machine> or <machine>?" with the machines' real names.
- Say what is on screen only when the person asks what it shows.

Ending the call:
- When the person wants to end the call, ask exactly "Are you sure you want to end the call?" After a clear yes, say "Bye." and use end_call. No yes, no end.
- Never talk about clicking or buttons to end it, and never use screen to hang up.

Rules:
- Check first: use look before you answer about the person's work. Never guess what an agent said or a task's state. If look can't tell, say so.
- Prefer look, open, send and act: quicker and surer. Use screen only when none of them fits (scroll, close, go back, a button or field they don't cover, exactly what the screen shows).
- With screen: look before you act, use only refs from its latest answer, and read the new screen in each answer.
- Before any act, or a screen click that deletes, merges, accepts, stops or can't be undone: say in a few words what it will do and ask. Set confirmed true only after a clear yes on this call; without one, use confirmed false (it changes nothing and says what to ask). Never type a secret or a password.
- "Here", "this task", "that one": what the call's context says (look with what "here" when unsure), or what you just talked about.
- Making or planning things (a new task or space, a brief, an automation, Autopilot's direction, anything that takes judgment): send it to that space's Assistant in the person's words with every detail, then say you passed it on.
- Send without asking only when the person clearly asked you to. Never send greetings, chit-chat or talk about the call. Unsure if it's meant for an agent? Ask.
- Lines starting [Update] come from BossGoat, not the person: never send them on. Say what matters in one short sentence; always say when an agent needs the person. Where the app is now is for you only: say nothing about it.
- open and screen act on the screen the call runs on. Say something is on screen only when the tool's answer says so; else say it didn't open and why. If several spaces or machines fit, ask which.${where ? `\n\nWhere the call is now: ${where}` : ""}`;

const PLACE = { type: "string", description: "Which one: a space's name, a task's id (SHEP-45), a machine's or artifact's name, or \"here\" (the call's or what is on screen). Leave out for all." };
const tool = (name, description, props, required = []) =>
  ({ type: "client", name, description, expects_response: true, response_timeout_secs: 30, parameters: { type: "object", properties: props, required } });

/** What a look can read, an open can show and an act can do (service/voice-tools.ts answers each). */
export const LOOKS = ["here", "chat", "spaces", "machines", "tasks", "task", "needs", "news", "autopilot", "automations", "settings", "secrets", "artifacts"];
export const OPENS = ["space", "task", "tasks", "needs", "artifacts", "files", "changes", "terminal", "artifact", "settings", "chat"];
export const TABS = ["chat", "terminal", "files", "changes", "pr", "browser", "review"];
export const ACTS = ["accept", "start", "schedule", "unschedule", "stop", "resume", "done", "reopen", "delete", "pin", "unpin",
  "autopilot_on", "autopilot_off", "autopilot_run", "rename_space", "remove_space", "setting", "forget_secret", "delete_artifact"];

export const TOOLS = [
  tool("look", "Read BossGoat: where the call is, a chat, spaces, machines, tasks, a task's details, what needs the person, news, Autopilot, automations, settings, secret names, artifacts. Answers in short sentences.", {
    what: { type: "string", enum: LOOKS, description: "What to read. here: the call's context and what is on screen. chat: a chat's latest messages (or a search with query). tasks: a list (filter with id and query). task: one task's details, summary, proof and pull request." },
    id: PLACE,
    query: { type: "string", description: "Words to search for (a chat, tasks, settings, artifacts), or a task state to filter tasks (working, ready, needs, queued, scheduled, todo, done)." },
    count: { type: "integer", description: "How many chat messages or items (default 6, at most 30)." },
  }, ["what"]),
  tool("open", "Show something in the person's app, the one the call runs in: a space, a task (on a tab), the Tasks panel, Needs you, the shown space's Artifacts, Files or Changes panel or its Assistant's terminal, an artifact, a Settings page, or the call's chat.", {
    what: { type: "string", enum: OPENS, description: "What to show. artifacts, files, changes, terminal: the shown space's panel (id a space's name to switch first). settings: id is the page (Secrets, Window, Voice...)." },
    id: PLACE,
    tab: { type: "string", enum: TABS, description: "A task's tab: chat, terminal, files, changes, pr (pull request), browser, or review (a Ready task's Accept card)." },
    query: { type: "string", description: "tasks: a state to filter by (working, ready, needs, queued, scheduled, todo, done) and/or words to type in its filter box." },
  }, ["what"]),
  tool("send", "Write a message as the person: to the call's chat (default), a space's Assistant (by the space's name) or a task's agent (by its id). Also how to ask an Assistant to make, plan or change things.", {
    to: { type: "string", description: "A space's name (its Assistant), a task's id (its agent), or \"here\" (the call's chat, the default)." },
    text: { type: "string", description: "The message, in the person's words, tidied, with every detail." },
  }, ["text"]),
  tool("screen", "The person's screen itself, as numbered things (refs): read it, then act on one. Only for what look, open, send and act can't do: scroll, close, go back, press a button, fill or pick in a field, expand or collapse. Its answer is always the screen as it is now.", {
    do: { type: "string", enum: DOS, description: "look: list what is on screen (find narrows it). click: press ref. type: put text in ref (submit true presses Enter). select: pick text in ref's list. scroll: direction, in ref or the main part. key: press text (Enter, Escape, Tab, ArrowDown...). back: the app's Back. close: close what is on top (a menu, dialog, artifact, Settings)." },
    ref: { type: "string", description: "A ref from screen's latest answer, like e12." },
    text: { type: "string", description: "type: the words. select: the choice. key: the key." },
    direction: { type: "string", enum: ["down", "up", "top", "bottom"], description: "scroll's direction." },
    submit: { type: "boolean", description: "type: press Enter after." },
    find: { type: "string", description: "Words to list only matching things (a long screen)." },
    confirmed: { type: "boolean", description: "click: true only after the person said yes to a click that deletes, merges, stops or can't be undone." },
  }, ["do"]),
  tool("act", "Change something directly. Ask the person first and set confirmed true only after a clear yes; with confirmed false nothing changes and it says what to ask.", {
    action: { type: "string", enum: ACTS, description: "accept: a Ready task (merges it). start: a task now. schedule: a task later (value: when, \"in 2h\", \"tomorrow 9:00\"). unschedule. stop: a working task's agent. resume: an ended task's agent. done: mark a task done without merging. reopen: a done or ready task. delete: a task. pin, unpin: a task. autopilot_on, autopilot_off, autopilot_run (wake now): a space's. rename_space (value: the new name). remove_space: forget a space (its folder stays). setting: change a setting (key: its name, value, id: a space or leave out for everywhere). forget_secret: delete a secret by name (key). delete_artifact." },
    id: PLACE,
    key: { type: "string", description: "setting: the setting's name as Settings shows it. forget_secret: the secret's name." },
    value: { type: "string", description: "The new value: a time for schedule, a name for rename_space, a setting's value." },
    confirmed: { type: "boolean", description: "True only after the person said yes to exactly this on the call." },
  }, ["action", "confirmed"]),
];

/** What the agent says first: short, then it listens. */
export const FIRST = "Hi, go ahead.";

// ElevenLabs' own system tools, listed with ours (a built_in_tools field beside inline tools is dropped): end_call hangs
// up (only after the person's yes, the prompt says), skip_turn stays quiet.
const system = (name, description, params = {}) => ({ type: "system", name, description, params: { system_tool_type: name, ...params } });
export const SYSTEM_TOOLS = [
  system("end_call", "End the call. Only after the person said yes to ending it on this call."),
  system("skip_turn", "Say nothing this turn: when the person says to wait or hold on, or is clearly talking to someone else.", { wait_timeout_secs: -1 }),
];

// Silence: the agent never prompts a quiet person (turn_timeout -1: no "are you there?"), and only a call silent for
// 15 minutes ends (a forgotten call stops costing); any call ends after an hour (ElevenLabs' default is 10 minutes).
export const SILENT_END_SECS = 900;
export const MAX_CALL_SECS = 3600;

// The dedicated "Herdr chat" voice agent, made with the person's key (its id kept in <app home>/secrets) and brought
// up to this spec whenever it changes (SPEC, ensureAgent).
export const agentSpec = () => ({
  name: "Herdr chat",
  conversation_config: {
    agent: {
      first_message: FIRST,
      language: "en",
      // a model that is good with tools (ElevenLabs' advice), quick enough to talk
      prompt: { prompt: prompt("an agent"), llm: "claude-sonnet-5-5", tools: [...TOOLS, ...SYSTEM_TOOLS] },
    },
    turn: { turn_timeout: -1, silence_end_call_timeout: SILENT_END_SECS },
    conversation: { max_duration_seconds: MAX_CALL_SECS },
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
  `# The "Herdr chat" voice agent, made by BossGoat with ELEVENLABS_API_KEY.\nELEVENLABS_AGENT_ID=${id}\nELEVENLABS_KEY_TAG=${tag}\nELEVENLABS_SPEC=${spec}\n`;

// What starts the conversation, once its socket is open: the prompt with where the call is.
export const opening = (who, where = "") => ({ type: "conversation_initiation_client_data",
  conversation_config_override: { agent: { prompt: { prompt: prompt(who, where) }, first_message: FIRST } } });

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

// ---- live dictation (SHEP-63) -------------------------------------------------------------
// Writing a recording down after Done took about a second per 40 s of speech, plus the upload and the key lookup. Now
// the words are written while the person speaks: the audio streams to ElevenLabs' realtime speech to text (Scribe v2
// realtime) as it is recorded, and Done only asks for the last bit: the words land about 0.2 s later, however long it
// was. The recording is still kept until the words come, so a live session that fails falls back to the upload above.
// The browser connects with a single-use token from the service (liveTokenRequest; the key never reaches the page);
// the window's recorder (mods/chat/record.ts) with the key itself, in memory.

export const LIVE_MODEL = "scribe_v2_realtime";
export const LIVE_RATE = 16000;
/** Done's tail: 0.4 s of silence before the commit (ElevenLabs closes a session asked to commit under 0.3 s). */
export const LIVE_TAIL = new Uint8Array(LIVE_RATE * 2 * 0.4);
/** how long Done waits for the live words before it uploads the recording instead */
export const LIVE_WAIT = 4000;

/** The realtime socket's address: 16 kHz 16-bit PCM, commits only when asked (Done), the language found from the audio. */
export const liveUrl = (token = "") => `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=${LIVE_MODEL}&audio_format=pcm_${LIVE_RATE}&commit_strategy=manual${token ? `&token=${encodeURIComponent(token)}` : ""}`;

/** A single-use token for one live session from a browser (the key stays on the service). */
export const liveTokenRequest = (key) => ({ url: `${API}/single-use-token/realtime_scribe`, init: { method: "POST", redirect: "error", headers: { "xi-api-key": key } } });

/** One piece of audio for the socket (base64 PCM); commit: write down what's pending (Done). */
export const liveChunk = (b64, commit = false) => JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: b64, sample_rate: LIVE_RATE, commit });

/**
 * The words of a live session as they come: hear() each message from the socket, done() when Done's commit was sent.
 * hear answers "words" when Done's last words came (text() is all of it), "failed" when the session can't give them
 * (then upload the recording), else null. Each committed piece is kept in order; the partial ones only show progress.
 */
export function liveWords() {
  const said = [];
  let asked = false, over = null;
  return {
    done() { asked = true; },
    hear(raw) {
      if (over) return null;
      let m = null;
      try { m = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
      const t = String(m?.message_type ?? "");
      if (t === "committed_transcript") {
        if (typeof m.text === "string" && m.text.trim()) said.push(m.text.trim());
        if (asked) return (over = "words");
        return null;
      }
      if (t === "session_started" || t.startsWith("partial_transcript") || t.startsWith("committed_transcript")) return null;
      // anything else is an error (auth_error, quota_exceeded, commit_throttled, input_error...)
      if (m?.error || /error|exceeded|throttled|limit/.test(t)) return (over = "failed");
      return null;
    },
    text: () => said.join(" ").replace(/\s+/g, " ").trim(),
  };
}

/** 16-bit little-endian PCM bytes as base64 (no Buffer in a browser). */
export function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * A browser's microphone (any rate, float samples) down to 16 kHz 16-bit PCM, piece by piece: each sample out is the
 * mean of the ones it covers (a plain low-pass, enough for speech), its place carried across pieces.
 */
export function to16k(rate) {
  const step = rate / LIVE_RATE;
  let pos = 0; // where the next sample out starts, in this piece's samples (may be negative: a part of the last one)
  let carry = new Float32Array(0);
  return (input) => {
    const x = carry.length ? Float32Array.from([...carry, ...input]) : input;
    const out = [];
    while (pos + step <= x.length) {
      const a = Math.max(0, Math.floor(pos)), b = Math.min(x.length, Math.floor(pos + step));
      let sum = 0;
      for (let i = a; i < b; i++) sum += x[i];
      const v = b > a ? sum / (b - a) : x[a] ?? 0;
      out.push(Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
      pos += step;
    }
    const keep = Math.floor(pos);
    carry = x.slice(keep);
    pos -= keep;
    const pcm = new Int16Array(out);
    return new Uint8Array(pcm.buffer);
  };
}

/**
 * An open's words for the voice agent once the app that started the call tried it (ack: { ok, why } from that page or
 * window; null: it didn't answer in time). Only an ok says it is on screen, in as few words as can be.
 */
export function navWords(shows, ack) {
  const cut = (t) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > 200 ? `${x.slice(0, 199)}…` : x; };
  // shown: as little as can be, so the agent says one word and doesn't narrate (SHEP-83)
  if (ack?.ok) return { result: JSON.stringify({ ok: true, shown: cut(shows) }) };
  if (!ack) return { result: `The person's app didn't confirm it opened ${shows}: say it may not have opened, and that reloading the app can fix it.`, error: true };
  return { result: `It couldn't open ${shows} on the person's screen: ${cut(ack.why || "it didn't open")}.`, error: true };
}
