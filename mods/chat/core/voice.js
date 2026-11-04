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
