// A voice call, as the same on both sides: the window's call (mods/chat/voice.ts, the machine's microphone and
// speaker) and the web app's (service/voice.ts, the phone's). An ElevenLabs voice agent talks with the person and
// reads, opens and changes Shepherdr for them through four client tools (look, open, send, act) and call_view (the web call's full screen or minimized), which the service
// answers, and, for whatever those can't do, a fifth: screen, which reads and acts on the very screen the call runs on
// (core/screen.js; the page or the window does it) (service/voice-tools.ts; the window's call asks its machine's service).
// SHEP-105: a call is with Shepherdr itself, not one chat: it is told, as [Update] lines, the replies and status of the
// chats it sent to and the one on screen, and anything anywhere that needs the person (service/voice-hear.ts).
// Plain data and words: each side does its own audio, files and sockets.
// Shared core: the source is core/voice.js.

import { DOS } from "./screen.js";
import { PY } from "./paths.js";

export const API = "https://api.elevenlabs.io/v1";

export const prompt = (where = "") => `You are Shepherdr's voice: the person's hands-free assistant for Shepherdr, an app where AI coding agents work on tasks across their machines. The person called Shepherdr itself, not one agent: you are the one voice for all of it. You take their requests to any space's Assistant or any task's agent, tell them when those reply or need them, and open things on their screen. You never hand the call over to another voice, and you never speak as an Assistant or agent: you pass things on and report back.

How Shepherdr works:
- A machine (this computer, a Mac mini, a VM) has spaces. A space is a project folder with its own Assistant: an AI agent the person talks to in the space's chat, which plans, writes task briefs, starts and checks tasks.
- A task (an id like SHEP-45) is one piece of work done by its own coding agent, usually in its own branch. Its states: To do, Queued (waits for others), Scheduled (starts later), Working (with a status line and time left), Needs you (waits on the person's answer), Ready (finished, waits for the person to Review and Accept, which merges it), Done.
- Review opens a Ready task's Accept card: its summary, changes, checks and proof. Accept merges it.
- Autopilot: a space's Assistant wakes on a schedule and works on its own toward the space's direction (its heartbeat).
- Needs you: everything waiting on the person: questions, Ready tasks, asks for a secret.
- Artifacts are pages agents publish (proofs, reports). Secrets are kept by name: never read a value out, never ask for one by voice.

Your tools:
- look: read anything: where the call is and what is on screen, a chat (latest messages or a search), spaces, machines (with their health and Claude Code / Codex plan limits), tasks, one task, Needs you, news, Autopilot, automations, settings, secret names, artifacts.
- look data sees everything the app shows, every panel, dialog, number and list: the app's live data and what panels read as they open (usage insights, a task's changes, pull request and checks, an artifact's content, model menus...). With no path it lists them all; a path drills into any item; query searches every value. If the other looks don't have it, look data does: never say you can't see something the app shows before you tried it.
- open: show something in the person's app (the one the call runs in): a space, a task and its tab, the Tasks panel (filtered by state or words), Needs you, the Artifacts, Files or Changes panel, the space's terminal, an artifact, a Settings page, or a chat.
- send: write in a chat as the person: any space's Assistant or a task's agent (by its name or id), or "here": the chat on screen.
- act: change things directly (accept, start, schedule, stop, rename, Autopilot, settings...).
- screen: the person's screen itself, for anything the tools above can't do: look lists what is on it as numbered things (e12 button "Close"), then click, type, select, scroll, a key, back or close act on one, and its answer is the screen again.
- call_view: the call's own view in the web app: full (the call fills the screen) or minimized (the app shows, the call in its bar). "Back to the call", "maximize the call", "full screen": call_view full. "Minimize the call", "hide the call": call_view minimized. Never screen for this.

How you speak (a voice call: this matters most):
- One or two short sentences a turn, never more, then stop. Answer only what was asked: the gist, not every detail a tool gave (leave out numbers like percentages and pull requests unless asked).
- No preambles, no recaps, no lists read out, no "I can also..." offers. More detail only when asked.
- Numbers and names plainly ("SHEP 45", "three tasks"). Never read out code, paths, links or ids letter by letter.
- Before a tool that takes a moment (look, send, act, screen), first say one or two words in the call's language ("On it.", "Checking."), never a sentence about what you will do. Then the tool, then the answer.
- One calm, even tone all call long, whatever the news: never audio tags or stage directions in brackets ("[happy]", "[whispers]").
- Silence is fine. If the person says nothing, say nothing: never ask if they're there or want something. Just wait.
- Speak the language the person speaks: English at first, theirs as soon as they speak another (switch with language_detection), back when they go back, any number of times. The exact words below are English: say them in the call's language.

Moving around (switch to a space or chat, open a task, tab, panel, artifact or Settings, go back, close, scroll, the call's view):
- Opening or moving around minimizes a full-screen call by itself, so the person sees it: no call_view first.
- Once the tool's answer says ok, reply with one word: "Opened.", "Switched.", "Closed." or "Done." Nothing else: no sentence, nothing about what is on screen, no offer.
- Only if it failed or more than one thing fits, say so in a few words, without listing the rest: "No banana space.", or for two spaces called Home, "Two Home spaces: <machine> or <machine>?" with the machines' real names.
- Say what is on screen only when the person asks what it shows.

Ending the call:
- When the person wants to end the call, ask exactly "Are you sure you want to end the call?" After a clear yes, say "Bye." and use hang_up. No yes, no end.
- Never end the call for any other reason: not after a send, not when a task is done, not when it's quiet. The person keeps the call as long as they want.
- Never talk about clicking or buttons to end it, and never use screen to hang up.

Rules:
- Check first: use look before you answer about the person's work. Never guess what an agent said or a task's state. If look can't tell, say so.
- Prefer look, open, send and act: quicker and surer. Use screen only when none of them fits (scroll, close, go back, a button or field they don't cover, exactly what the screen shows).
- With screen: look before you act, use only refs from its latest answer, and read the new screen in each answer.
- Before any act, or a screen click that deletes, merges, accepts, stops or can't be undone: say in a few words what it will do and ask. Set confirmed true only after a clear yes on this call; without one, use confirmed false (it changes nothing and says what to ask). Never type a secret or a password.
- "Here", "this task", "this space": what the screen shows now (look with what "here" when unsure). "That one": what you just talked about.
- Who to send to: the space or task the person names; else the one on screen; else the one you last sent to. If none fits or several do, ask which in a few words.
- Making or planning things (a new task or space, a brief, an automation, Autopilot's direction, anything that takes judgment): send it to that space's Assistant in the person's words with every detail.
- Never wait on an agent: they take minutes. After a send, say only "Passed it to <name>." (the space's or task's name) and stop. Their reply comes later as an [Update].
- Send without asking only when the person clearly asked you to. Never send greetings, chit-chat or talk about the call. Unsure if it's meant for an agent? Ask.
- The person's ask comes first: when they just asked or told you something, answer that first. [Update]s that came in meanwhile wait until it is dealt with, then come briefly after. Never start a reply with an [Update].
- Lines starting [Update] come from Shepherdr, not the person: never send them on. They are replies and status from the chats you sent to or the one on screen, and anything anywhere that needs the person. Say what matters in one short sentence, naming who ("The shop Assistant says the build is fixed."). Always say when someone needs the person. Several at once: one or two short sentences for all ("Two things: ..."). Where the app is now is for you only: say nothing about it.
- open and screen act on the screen the call runs on. Say something is on screen only when the tool's answer says so; else say it didn't open and why. If several spaces or machines fit, ask which.${where ? `\n\nWhere the call is now: ${where}` : ""}`;

const PLACE = { type: "string", description: "Which one: a space's name, a task's id (SHEP-45), a machine's or artifact's name, or \"here\" (what is on screen). Leave out for all." };
// SHEP-113: the person always knows the call heard them. pre_tool_speech "force": the agent says a word or two
// ("On it.") before the tool runs, "auto" where ElevenLabs decides from how long the tool takes (open and screen are
// quick, and say one word after: SHEP-83); tool_call_sound "typing" plays while a tool it spoke before runs long (the
// call's "still working"). https://elevenlabs.io/docs/agents-platform/api-reference/agents/create (pre_tool_speech,
// tool_call_sound, tool_call_sound_behavior on a client tool) and
// https://elevenlabs.io/docs/eleven-agents/customization/tools/tool-configuration/tool-call-sounds
const tool = (name, description, props, required = [], speech = "force") =>
  ({ type: "client", name, description, expects_response: true, response_timeout_secs: 30, pre_tool_speech: speech,
    tool_call_sound: "typing", tool_call_sound_behavior: "auto", parameters: { type: "object", properties: props, required } });

/** What a look can read, an open can show and an act can do (service/voice-tools.ts answers each). */
export const LOOKS = ["here", "chat", "spaces", "machines", "tasks", "task", "needs", "news", "autopilot", "automations", "settings", "secrets", "artifacts", "data"];
export const OPENS = ["space", "task", "tasks", "needs", "artifacts", "files", "changes", "terminal", "artifact", "settings", "chat"];
export const TABS = ["chat", "terminal", "pr", "browser", "review"];
/** the call's own view (call_view): full screen or minimized */
export const VIEWS = ["full", "minimized"];
export const ACTS = ["accept", "start", "schedule", "unschedule", "stop", "resume", "done", "reopen", "delete", "pin", "unpin",
  "autopilot_on", "autopilot_off", "autopilot_run", "rename_space", "remove_space", "setting", "forget_secret", "delete_artifact"];

export const TOOLS = [
  tool("look", "Read Shepherdr: where the call is, a chat, spaces, machines (health, plan limits), tasks, a task's details, what needs the person, news, Autopilot, automations, settings, secret names, artifacts, and data: everything else the app shows anywhere. Answers in short sentences.", {
    what: { type: "string", enum: LOOKS, description: "What to read. here: the call's context and what is on screen. chat: a chat's latest messages (or a search with query). tasks: a list (filter with id and query). task: one task's details, summary, proof and pull request. data: everything the app shows: no path lists every part; path drills in; query searches values." },
    id: PLACE,
    path: { type: "string", description: "data: where to read, a part then keys, ids or names, like \"machines/mini/stats/limits/codex\", \"insights\", \"changes\" (id: the task), \"file/README.md\" (id: the task or space)." },
    query: { type: "string", description: "Words to search for (a chat, tasks, settings, artifacts), or a task state to filter tasks (working, ready, needs, queued, scheduled, todo, done)." },
    count: { type: "integer", description: "How many chat messages or items (default 6, at most 30)." },
  }, ["what"]),
  tool("open", "Show something in the person's app, the one the call runs in: a space, a task (on a tab), the Tasks panel, Needs you, the shown space's Artifacts, Files or Changes panel or its Assistant's terminal, an artifact, a Settings page, or a chat (a space's Assistant or a task's agent).", {
    what: { type: "string", enum: OPENS, description: "What to show. artifacts, files, changes, terminal: the shown space's panel (id a space's name to switch first). settings: id is the page (Secrets, Window, Voice...)." },
    id: PLACE,
    tab: { type: "string", enum: TABS, description: "A task's tab: chat, terminal, pr (pull request: its changes), browser, or review (a Ready task's Accept card)." },
    query: { type: "string", description: "tasks: a state to filter by (working, ready, needs, queued, scheduled, todo, done) and/or words to type in its filter box." },
  }, ["what"], "auto"),
  tool("send", "Write a message as the person: to a space's Assistant (by the space's name) or a task's agent (by its id), or the chat on screen (\"here\"). Also how to ask an Assistant to make, plan or change things.", {
    to: { type: "string", description: "A space's name (its Assistant), a task's id (its agent), or \"here\" (the chat on screen)." },
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
  }, ["do"], "auto"),
  tool("act", "Change something directly. Ask the person first and set confirmed true only after a clear yes; with confirmed false nothing changes and it says what to ask.", {
    action: { type: "string", enum: ACTS, description: "accept: a Ready task (merges it). start: a task now. schedule: a task later (value: when, \"in 2h\", \"tomorrow 9:00\"). unschedule. stop: a working task's agent. resume: an ended task's agent. done: mark a task done without merging. reopen: a done or ready task. delete: a task. pin, unpin: a task. autopilot_on, autopilot_off, autopilot_run (wake now): a space's. rename_space (value: the new name). remove_space: forget a space (its folder stays). setting: change a setting (key: its name, value, id: a space or leave out for everywhere). forget_secret: delete a secret by name (key). delete_artifact." },
    id: PLACE,
    key: { type: "string", description: "setting: the setting's name as Settings shows it. forget_secret: the secret's name." },
    value: { type: "string", description: "The new value: a time for schedule, a name for rename_space, a setting's value." },
    confirmed: { type: "boolean", description: "True only after the person said yes to exactly this on the call." },
  }, ["action", "confirmed"]),
  // SHEP-124: the call's own view, never by screen clicks (the web app's full-screen call, SHEP-118)
  tool("call_view", "Show the call full screen (full: the call fills the person's screen) or minimize it (minimized: the app shows, the call in its bar). The web app's call only. Opening things minimizes it by itself.", {
    view: { type: "string", enum: VIEWS, description: "full: the full-screen call. minimized: the app, with the call in its bar." },
  }, ["view"], "auto"),
  // SHEP-173: Shepherdr ends the call (hangUpGuard), only right after the person said yes to ending it
  tool("hang_up", "End the call. Only right after the person said yes to \"Are you sure you want to end the call?\" on this call: never after a send, a task or a quiet moment.", {}, [], "auto"),
];

/** What the agent says first: short, then it listens. */
export const FIRST = "Hi, go ahead.";

// ElevenLabs' own system tools, listed with ours (a built_in_tools field beside inline tools is dropped): end_call hangs
// up (only after the person's yes, the prompt says), skip_turn stays quiet.
const system = (name, description, params = {}) => ({ type: "system", name, description, params: { system_tool_type: name, ...params } });
// SHEP-173: no end_call system tool. The model used it on its own, right after "Passed it to <name>." (ElevenLabs'
// records: four of the person's calls ended so, with no yes asked); hang_up is ours, and Shepherdr ends the call only
// when the person just said yes (hangUpGuard).
export const SYSTEM_TOOLS = [
  system("skip_turn", "Say nothing this turn: when the person says to wait or hold on, or is clearly talking to someone else.", { wait_timeout_secs: -1 }),
  // switches the call's language (voice and words) all call long, not only at its start (SHEP-104)
  system("language_detection", "Switch the call's language: as soon as the person speaks another language than the call's, or asks for one. Again each time they change, back to English too.", { only_at_conversation_start: false }),
];

// Every language a call can switch to: all ElevenLabs takes as a language preset (its create API lists them when given
// another), English being the call's own. The speech model speaks them all (eleven_v4_turbo, GET /v1/models). None has
// a first message of its own: a call always starts in English (language_presets).
export const TTS_MODEL = "eleven_v4_turbo";

// SHEP-162: one even voice all call long. With eleven_v4_turbo ElevenLabs turns on expressive mode by default: the LLM
// writes audio tags ("[happy]", "[whispering]") that the voice acts out, so it swung from dark to light within a call.
// Off, with the voice pinned (ElevenLabs' default agent voice, Eric) and its stability up from 0.5 (ElevenLabs:
// 0.60-0.85 keeps delivery consistent), the same voice says every turn in every language.
export const VOICE_ID = "cjVigY5qzO86Huf0OWal";
export const TTS = { model_id: TTS_MODEL, voice_id: VOICE_ID, expressive_mode: false, stability: 0.75, similarity_boost: 0.75, speed: 1, agent_output_audio_format: "pcm_16000" };
export const LANGUAGES = ("zh es hi pt pt-br fr de ja ar ko id it nl tr pl ru sv tl fil ms ro uk el cs da fi bg hr sk ta vi no hu af hy " +
  "as ast az be bn bs ca yue et gl ka gu ha he is ga jv kn kk ky lv lt lb mk ml mt mi mr my mn ne oc or ps fa pa " +
  "sr sd sl so sw tg te th ur uz yo cy am lo lg sn ckb wo zu").trim().split(" ");

// Silence: the agent never prompts a quiet person (turn_timeout -1: no "are you there?"), and only a call silent for
// 30 minutes ends (a forgotten call stops costing); any call ends after two hours, the most ElevenLabs allows
// (SHEP-173: it refuses more than 7200; its default is 10 minutes).
export const SILENT_END_SECS = 1800;
export const MAX_CALL_SECS = 7200;

// SHEP-113: the model slow to start a reply: after 3 s a short filler of its own words (in the call's language), the
// fixed one only if it can't. turn.soft_timeout_config, timeout_seconds 0.5..8 (-1 off):
// https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow
export const SOFT_TIMEOUT = { timeout_seconds: 3, message: "One moment.", use_llm_generated_message: true };

// The dedicated "Herdr chat" voice agent, made with the person's key (its id kept in <app home>/secrets) and brought
// up to this spec whenever it changes (SPEC, ensureAgent).
export const agentSpec = () => ({
  name: "Herdr chat",
  conversation_config: {
    agent: {
      first_message: FIRST,
      language: "en",
      // a model that is good with tools (ElevenLabs' advice), quick enough to talk
      prompt: { prompt: prompt(), llm: "claude-sonnet-5-5", tools: [...TOOLS, ...SYSTEM_TOOLS] },
    },
    turn: { turn_timeout: -1, silence_end_call_timeout: SILENT_END_SECS, soft_timeout_config: SOFT_TIMEOUT },
    conversation: { max_duration_seconds: MAX_CALL_SECS },
    // Scribe hears any language; the speech model speaks them all, in the same voice
    asr: { user_input_audio_format: "pcm_16000" },
    tts: TTS,
    language_presets: Object.fromEntries(LANGUAGES.map((l) => [l, { overrides: {} }])),
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
export const opening = (where = "") => ({ type: "conversation_initiation_client_data",
  conversation_config_override: { agent: { prompt: { prompt: prompt(where) }, first_message: FIRST } } });

/** The person moved in the app during the call: a quiet note of where they are now. */
export const whereLine = (where) => ({ type: "contextual_update", text: `[Update] The person's app now shows: ${String(where).slice(0, 600)}` });

// An agent the call follows replied in its chat: the voice agent says it. A long reply goes whole; one past REPLY_MAX
// is cut and says so, so the voice agent knows the rest is in the chat (#785).
export const REPLY_MAX = 40000;
export function replyLine(who, text) {
  const t = String(text);
  const body = t.length > REPLY_MAX ? `${t.slice(0, REPLY_MAX)}""" (cut short here; the rest is in the chat: look at the chat to read it.)` : `${t}"""`;
  return { type: "user_message", text: `[Update] ${who} replied: """${body} Tell the person what it says, briefly.` };
}

/**
 * Several [Update]s that came together, as one (SHEP-105): quiet notes stay quiet notes; what is said out loud goes as
 * one message the agent says in a sentence or two ("Two things: ..."), held while the person talks (the caller's job).
 * null: nothing.
 */
export function batchLines(lines) {
  const loud = lines.filter((l) => l?.type === "user_message").map((l) => String(l.text).replace(/^\[Update\]\s*/, ""));
  const quiet = lines.filter((l) => l?.type === "contextual_update");
  const out = [...quiet];
  if (loud.length === 1) out.push({ type: "user_message", text: `[Update] ${loud[0]}` });
  else if (loud.length > 1) out.push({ type: "user_message", text: `[Update] ${loud.length} things came in together:\n${loud.map((t, i) => `${i + 1}. ${t}`).join("\n")}\nTell the person all of them in one or two short sentences.` });
  return out;
}

// ---- what the call is doing (SHEP-113) -------------------------------------------------------

const LOOK_WORDS = { here: "looking at the screen", chat: "reading the chat", spaces: "checking spaces", machines: "checking machines",
  tasks: "checking tasks", task: "reading the task", needs: "checking what needs you", news: "reading the news", autopilot: "checking Autopilot",
  automations: "checking automations", settings: "reading settings", secrets: "checking secret names", artifacts: "checking artifacts", data: "looking it up" };
const ACT_WORDS = { accept: "accepting the task", start: "starting the task", schedule: "scheduling the task", unschedule: "unscheduling the task",
  stop: "stopping the agent", resume: "resuming the agent", done: "marking it done", reopen: "reopening the task", delete: "deleting the task",
  pin: "pinning the task", unpin: "unpinning the task", autopilot_on: "turning Autopilot on", autopilot_off: "turning Autopilot off",
  autopilot_run: "waking Autopilot", rename_space: "renaming the space", remove_space: "removing the space", setting: "changing a setting",
  forget_secret: "forgetting a secret", delete_artifact: "deleting the artifact" };

/** What a tool call is doing, in a few plain words for the call's status ("checking tasks", "sending to shop"). */
export function toolWords(name, params = {}) {
  const p = params && typeof params === "object" ? params : {};
  const s = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "");
  if (name === "look") return LOOK_WORDS[p.what] ?? "looking";
  if (name === "open") return "opening it";
  if (name === "send") { const to = s(p.to); return !to || to === "here" ? "sending to this chat" : `sending to ${to}`; }
  if (name === "act") return p.confirmed === true ? ACT_WORDS[p.action] ?? "making the change" : "checking";
  if (name === "screen") return p.do === "look" ? "reading the screen" : "using the screen";
  if (name === "call_view") return p.view === "full" ? "showing the call" : "minimizing the call";
  if (name === "hang_up") return "ending the call";
  return "working";
}

/**
 * SHEP-113: the person's ask comes first. Fed the voice agent's events as they come (seen), holding() says whether
 * the call still owes the person an answer: from their words (user_transcript) until the agent replied
 * (agent_response) with no tool running, and again after each tool's result (its answer follows). [Update]s wait
 * while it holds (the caller's job), so a reply never starts with them. A model that never answers holds no longer
 * than maxMs.
 */
export function turnGate(maxMs = 30000) {
  let owed = false, at = 0, tools = 0;
  return {
    seen(type, now = Date.now()) {
      if (type === "user_transcript") { owed = true; at = now; }
      else if (type === "client_tool_call") { tools++; at = now; }
      else if (type === "client_tool_result") { tools = Math.max(0, tools - 1); owed = true; at = now; }
      else if (type === "agent_response") { owed = false; at = now; }
    },
    // a tool that never came back holds four times as long at most
    holding: (now = Date.now()) => (tools > 0 && now - at < maxMs * 4) || (owed && now - at < maxMs),
  };
}

/**
 * SHEP-173: whether hang_up may end the call now. Fed the voice agent's events as they come (seen): the call ends only
 * when the agent's last words before the person's latest were a question ("Are you sure you want to end the call?", in
 * any language) and no other tool ran since the person spoke. A hang_up right after a send ("Passed it to ...") is
 * refused, with what to do instead (REFUSED).
 */
export function hangUpGuard() {
  let lastSaid = "", asked = false, spoke = false, toolsSince = 0;
  return {
    seen(type, text = "") {
      if (type === "agent_response") lastSaid = String(text ?? "");
      else if (type === "user_transcript") { spoke = true; asked = /[?？؟]\s*$/.test(lastSaid.trim()) || /[?？؟]/.test(lastSaid); toolsSince = 0; }
      else if (type === "client_tool_call" && text !== "hang_up") toolsSince++;
    },
    may: () => spoke && asked && toolsSince === 0,
  };
}
export const HUNG_UP = JSON.stringify({ ok: true, result: "The call ends once you've said Bye." });
export const REFUSED = JSON.stringify({ ok: false, result: "Not ended: the person didn't just say yes to ending the call. Never end it on your own. If they asked to end it, ask exactly \"Are you sure you want to end the call?\" and use hang_up only after their yes; else carry on, say nothing about it." });

/** Why the voice agent's socket closed, in a few plain words for "Call ended: ..." (null: the agent hung up after the
 *  person's yes, nothing to say). ElevenLabs closes with 1000 at its limits and says which in the reason. */
export function closeWords(code, reason = "") {
  const r = String(reason ?? "");
  if (/max(imum)? duration|duration/i.test(r)) return `it reached the ${Math.round(MAX_CALL_SECS / 3600)}-hour limit`;
  if (/silen|inactiv|no user message/i.test(r)) return "it was quiet for a long time";
  if (code === 1000) return "the voice service ended it";
  if (code !== 1006 && r.trim()) return `the voice service closed it (${r.trim().slice(0, 120)})`;
  return "the connection to the voice service was lost";
}

/** SHEP-173: the end chime, two soft notes going down (E5, then C5, about half a second), as 16-bit mono PCM at rate:
 *  played whenever a call ends, at the system's volume. */
export function chimePcm(rate = 16000) {
  const notes = [[659.25, 0, 0.22], [523.25, 0.16, 0.34]];
  const len = Math.ceil(rate * 0.52);
  const out = new Int16Array(len);
  for (const [f, start, dur] of notes) {
    const a = Math.floor(start * rate), n = Math.floor(dur * rate);
    for (let i = 0; i < n && a + i < len; i++) {
      const t = i / rate;
      // a quick soft attack, then a bell-like fade
      const env = Math.min(1, t / 0.012) * Math.exp(-t * 7);
      const v = 0.22 * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t));
      out[a + i] = Math.max(-32767, Math.min(32767, out[a + i] + v * 32767));
    }
  }
  return out;
}

/** Something anywhere needs the person (a question, a secret, a task Ready): one short line, said out loud. */
export const needLine = (what) => ({ type: "user_message", text: `[Update] ${String(what).slice(0, 600)}. Tell the person in one short line.` });

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
${PY}
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
    with open(SHEP(".herdr/vault.json")) as f:
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

// ---- usage -------------------------------------------------------------------------------
// SHEP-128: what is left of the person's ElevenLabs plan, under Plan usage beside Claude Code's and Codex's (the web's
// Settings › Machines, the serving machine's block), read with the voice key: GET <API>/user/subscription. Its
// character_count / character_limit are the plan's credits, refilled at next_character_count_reset_unix (seconds).
// A key restricted without "User → Read" gets 401 missing_permissions: a plain hint, never an error wall.

export const USAGE_PATH = "/user/subscription";
export const USAGE_NO_ACCESS = "Give your ElevenLabs key 'User → Read' access to see usage here: elevenlabs.io › Developers › API Keys, edit the key, set User to Read.";

/** ElevenLabs' answer as a plan read (core/machines.js planRows' shape): { state: "ok", plan, account, windows: [Credits] },
 *  { state: "no-access", why: the hint }, or { state: "unknown", why }. at: when it was read (ms). */
export function usageRead(status, body, at = Date.now()) {
  let d = null;
  try { d = JSON.parse(body); } catch {}
  if (status === 401 || status === 403) {
    const det = d?.detail;
    if (det?.status === "missing_permissions" || /missing.{0,20}permission|user_read/i.test(String(det?.message ?? det ?? ""))) {
      return { state: "no-access", why: USAGE_NO_ACCESS, at };
    }
  }
  if (status < 200 || status >= 300) return { state: "unknown", why: sttError(status, body), at };
  const used = Number(d?.character_count), limit = Number(d?.character_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return { state: "unknown", why: "ElevenLabs gave no usage numbers.", at };
  const reset = Number(d?.next_character_count_reset_unix);
  const n = (x) => Math.round(x).toLocaleString("en-US");
  const tier = typeof d?.tier === "string" ? d.tier.replace(/_/g, " ").trim().slice(0, 40) : "";
  return {
    state: "ok", at,
    ...(tier ? { plan: tier } : {}),
    account: limit > 0 ? `${n(used)} of ${n(limit)} credits used` : `${n(used)} credits used`,
    windows: limit > 0 ? [{ name: "Credits", used: Math.max(0, Math.min(100, (used / limit) * 100)), ...(reset > 0 ? { resets_at: reset * 1000 } : {}) }] : [],
  };
}

/** Reads it: the plan read, or null when there is no key (voice isn't set up: nothing shows). key(): voiceKey's answer. */
export async function readUsage(key, fetchFn = fetch, now = () => Date.now()) {
  const k = await key();
  if ("error" in k) return k.why === "none" ? null : { state: "unknown", why: k.error, at: now() };
  let r;
  try { r = await fetchFn(`${API}${USAGE_PATH}`, { redirect: "error", headers: { "xi-api-key": k.key }, signal: AbortSignal.timeout(15000) }); }
  catch { return { state: "unknown", why: "Can't reach ElevenLabs from this machine.", at: now() }; }
  return usageRead(r.status, await r.text().catch(() => ""), now());
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
