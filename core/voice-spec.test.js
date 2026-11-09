// The voice agent's spec reaches agents made before (ensureAgent): kept and up to date, nothing asked; from another
// spec, PATCHed (and the tools it replaced removed); gone from ElevenLabs, made again; made with another key, a new one.
import { expect, test } from "bun:test";
import { ensureAgent, agentSpec, SPEC, specTag, TOOLS, SYSTEM_TOOLS, hangUpGuard, closeWords, chimePcm, HUNG_UP, REFUSED, agentFile, envLines, opening, prompt, FIRST, LANGUAGES, TTS_MODEL, VOICE_ID, batchLines, needLine, replyLine, REPLY_MAX, toolWords, turnGate } from "./voice.js";

function fake(o = {}) {
  const calls = [], saved = [];
  let tools = o.tools ?? ["old_send", "old_read"];
  return { calls, saved, io: { tag: "tag1", made: "", saved: {}, ...o.io,
    save: (id, spec) => saved.push({ id, spec }),
    api: async (path, init = {}) => {
      const m = init.method ?? "GET";
      calls.push(`${m} ${path}`);
      if (o.fail?.(m, path)) throw new Error(o.fail(m, path));
      if (m === "POST") return { agent_id: "agent_new" };
      if (m === "PATCH") { tools = ["new_look", "new_open", "new_send", "new_act"]; return {}; }
      if (m === "GET") return { conversation_config: { agent: { prompt: { tool_ids: tools } } } };
      return null;
    } } };
}

test("kept for this key and spec: used as it is, ElevenLabs not asked", async () => {
  const f = fake({ io: { saved: { ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1", ELEVENLABS_SPEC: SPEC } } });
  expect(await ensureAgent(f.io)).toBe("agent_1");
  expect(f.calls).toEqual([]);
});

test("kept from an older spec: PATCHed to this one, its old tools removed, the spec kept", async () => {
  const f = fake({ io: { saved: { ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1" } } });
  expect(await ensureAgent(f.io)).toBe("agent_1");
  expect(f.calls).toEqual(["GET /convai/agents/agent_1", "PATCH /convai/agents/agent_1", "GET /convai/agents/agent_1", "DELETE /convai/tools/old_send", "DELETE /convai/tools/old_read"]);
  expect(f.saved).toEqual([{ id: "agent_1", spec: SPEC }]);
});

test("gone from ElevenLabs (404): made again", async () => {
  const f = fake({ io: { saved: { ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1", ELEVENLABS_SPEC: "old" } }, fail: (m) => (m === "PATCH" ? "ElevenLabs said 404: not found" : null) });
  expect(await ensureAgent(f.io)).toBe("agent_new");
  expect(f.calls.at(-1)).toBe("POST /convai/agents/create");
  expect(f.saved).toEqual([{ id: "agent_new", spec: SPEC }]);
});

test("a PATCH that fails otherwise: the call goes on with the agent, and tries again next time", async () => {
  const f = fake({ io: { saved: { ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1", ELEVENLABS_SPEC: "old" } }, fail: (m) => (m === "PATCH" ? "ElevenLabs said 500" : null) });
  expect(await ensureAgent(f.io)).toBe("agent_1");
  expect(f.saved).toEqual([]);
  expect(f.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
});

test("the machine that keeps the key made one: brought up to date and kept here; none at all: made", async () => {
  const made = fake({ io: { made: "agent_there" } });
  expect(await ensureAgent(made.io)).toBe("agent_there");
  expect(made.calls).toContain("PATCH /convai/agents/agent_there");
  expect(made.saved).toEqual([{ id: "agent_there", spec: SPEC }]);
  const none = fake();
  expect(await ensureAgent(none.io)).toBe("agent_new");
  expect(none.calls).toEqual(["POST /convai/agents/create"]);
});

test("one kept for another key isn't used: a new one", async () => {
  const f = fake({ io: { saved: { ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "other", ELEVENLABS_SPEC: SPEC } } });
  expect(await ensureAgent(f.io)).toBe("agent_new");
});

test("the spec: seven client tools (screen the fallback, call_view the call's own view, hang_up), a version that follows its words, and a file without the key", () => {
  expect(TOOLS.map((t) => t.name)).toEqual(["look", "open", "send", "screen", "act", "call_view", "hang_up"]);
  for (const t of TOOLS) { expect(t.type).toBe("client"); expect(t.expects_response).toBe(true); expect(t.response_timeout_secs).toBeLessThanOrEqual(120); }
  expect(TOOLS.find((t) => t.name === "act").parameters.required).toContain("confirmed");
  expect(SPEC).toBe(specTag(agentSpec()));
  const changed = agentSpec(); changed.conversation_config.agent.prompt.tools[0].description += "!";
  expect(specTag(changed)).not.toBe(SPEC);
  expect(envLines(agentFile("agent_1", "tag1", SPEC))).toEqual({ ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1", ELEVENLABS_SPEC: SPEC });
  const o = opening("The app shows task SHEP 45.");
  expect(o.conversation_config_override.agent.prompt.prompt).toContain("Where the call is now: The app shows task SHEP 45.");
  expect(prompt()).toContain("Set confirmed true only after a clear yes on this call");
});

test("SHEP-67: ends the call itself after a yes, waits quietly through silence, speaks briefly", () => {
  const c = agentSpec().conversation_config;
  // ElevenLabs' skip_turn, listed with ours (a separate built_in_tools field beside inline tools is dropped); SHEP-173:
  // no end_call of ElevenLabs': our hang_up, which Shepherdr allows only after the person's yes
  expect(c.agent.prompt.tools.map((t) => t.name)).toEqual(["look", "open", "send", "screen", "act", "call_view", "hang_up", "skip_turn", "language_detection"]);
  expect(SYSTEM_TOOLS.map((t) => [t.type, t.params.system_tool_type])).toEqual([["system", "skip_turn"], ["system", "language_detection"]]);
  expect(c.agent.prompt.tools.find((t) => t.name === "hang_up").type).toBe("client");
  expect(c.agent.prompt.built_in_tools).toBeUndefined();
  // no "are you there?" after a silence; SHEP-173: only a 30-minute silence or a 2-hour call (ElevenLabs' most) ends it
  expect(c.turn).toMatchObject({ turn_timeout: -1, silence_end_call_timeout: 1800 });
  expect(c.conversation.max_duration_seconds).toBe(7200);
  // a short hello, on the spec and on each call
  expect(c.agent.first_message).toBe(FIRST);
  expect(opening().conversation_config_override.agent.first_message).toBe(FIRST);
  expect(FIRST.split(" ").length).toBeLessThanOrEqual(4);
  const p = prompt();
  expect(p).toContain('ask exactly "Are you sure you want to end the call?" After a clear yes, say "Bye." and use hang_up');
  expect(p).toContain("Never end the call for any other reason: not after a send");
  expect(p).not.toContain('"End the call?"');
  // moving around: one word once it's shown, a few words only when it failed or is unclear (SHEP-83)
  expect(p).toContain('reply with one word: "Opened.", "Switched.", "Closed." or "Done." Nothing else');
  expect(p).toContain("Only if it failed or more than one thing fits");
  expect(p).toContain("never use screen to hang up");
  expect(p).toContain("If the person says nothing, say nothing");
  expect(p).toContain("One or two short sentences a turn");
  expect(p).toContain('no "I can also..." offers');
});

test("SHEP-104: English first, then whatever language the person speaks, back and forth all call long", () => {
  const c = agentSpec().conversation_config;
  expect(c.agent.language).toBe("en");
  // ElevenLabs' language detection, allowed after the first two turns too
  const ld = c.agent.prompt.tools.find((t) => t.name === "language_detection");
  expect(ld.params).toEqual({ system_tool_type: "language_detection", only_at_conversation_start: false });
  // every preset language ElevenLabs takes, English not among them (it is the call's own), none twice
  expect(LANGUAGES).toContain("sv");
  expect(LANGUAGES).not.toContain("en");
  expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
  expect(LANGUAGES.length).toBeGreaterThanOrEqual(90);
  expect(Object.keys(c.language_presets)).toEqual(LANGUAGES);
  expect(c.language_presets.sv).toEqual({ overrides: {} });
  // a speech model that speaks them (not an English-only v2), set rather than left to ElevenLabs' default
  expect(c.tts.model_id).toBe(TTS_MODEL);
  expect(TTS_MODEL).not.toMatch(/_v2$/);
  // SHEP-162: one even voice: no expressive audio tags, one pinned voice, stability above ElevenLabs' 0.5 default
  expect(c.tts).toMatchObject({ voice_id: VOICE_ID, expressive_mode: false, agent_output_audio_format: "pcm_16000" });
  expect(c.tts.stability).toBeGreaterThanOrEqual(0.6);
  expect(Object.values(c.language_presets).every((p) => !p.overrides.tts)).toBe(true);
  expect(prompt()).toContain("never audio tags");
  // the prompt says to answer in the person's language, the hello stays English
  expect(prompt()).toContain("Speak the language the person speaks");
  expect(opening().conversation_config_override.agent.first_message).toBe(FIRST);
  // a changed spec: agents made before are PATCHed to it (ensureAgent)
  const before = agentSpec(); delete before.conversation_config.language_presets;
  expect(specTag(before)).not.toBe(SPEC);
});

test("SHEP-105: one Shepherdr voice for everything, never tied to the chat it started in", () => {
  const p = prompt();
  expect(p).toContain("The person called Shepherdr itself, not one agent");
  expect(p).toContain("You never hand the call over to another voice");
  expect(p).not.toMatch(/started in .*'s chat/);
  expect(p).not.toContain("the call's chat");
  // sends and moves on: the reply comes later as an [Update]
  expect(p).toContain('say only "Passed it to <name>."');
  expect(p).toContain("Several at once: one or two short sentences");
  // what stays (SHEP-67, SHEP-83, SHEP-104)
  expect(p).toContain('ask exactly "Are you sure you want to end the call?"');
  expect(p).toContain('reply with one word: "Opened.", "Switched.", "Closed." or "Done."');
  expect(p).toContain("Speak the language the person speaks");
  // updates that come together are said as one; quiet notes stay quiet
  expect(batchLines([])).toEqual([]);
  const one = batchLines([replyLine("the shop Assistant", "Fixed it.")]);
  expect(one).toEqual([{ type: "user_message", text: expect.stringContaining("the shop Assistant replied") }]);
  const two = batchLines([{ type: "contextual_update", text: "[Update] x is working now." }, replyLine("the shop Assistant", "Fixed it."), needLine("TEST-7 is ready for review")]);
  expect(two.map((l) => l.type)).toEqual(["contextual_update", "user_message"]);
  expect(two[1].text).toContain("2 things came in together");
  expect(two[1].text).toContain("TEST-7 is ready for review");
});

test("SHEP-113: a word before a slow tool, a filler for a slow reply, a sound while a tool runs, the ask first", () => {
  const c = agentSpec().conversation_config;
  // ElevenLabs' pre-tool speech: always before look, send and act; ElevenLabs decides for the quick open and screen
  expect(Object.fromEntries(TOOLS.map((t) => [t.name, t.pre_tool_speech]))).toEqual({ look: "force", open: "auto", send: "force", screen: "auto", act: "force", call_view: "auto", hang_up: "auto" });
  for (const t of TOOLS) { expect(t.force_pre_tool_speech).toBeUndefined(); expect(t.tool_call_sound).toBe("typing"); expect(t.tool_call_sound_behavior).toBe("auto"); }
  // a slow model: a short filler of its own after 3 s (within ElevenLabs' 0.5..8)
  const soft = c.turn.soft_timeout_config;
  expect(soft.timeout_seconds).toBeGreaterThanOrEqual(0.5);
  expect(soft.timeout_seconds).toBeLessThanOrEqual(8);
  expect(soft.use_llm_generated_message).toBe(true);
  expect(soft.message.length).toBeLessThanOrEqual(200);
  const p = prompt();
  expect(p).toContain('first say one or two words in the call\'s language ("On it.", "Checking."), never a sentence');
  expect(p).toContain("The person's ask comes first");
  expect(p).toContain("Never start a reply with an [Update].");
  // still one word after a move (SHEP-83)
  expect(p).toContain('reply with one word: "Opened."');
});

test("SHEP-113: what a tool is doing, in plain words", () => {
  expect(toolWords("look", { what: "tasks" })).toBe("checking tasks");
  expect(toolWords("look", { what: "nope" })).toBe("looking");
  expect(toolWords("send", { to: "shop" })).toBe("sending to shop");
  expect(toolWords("send", { to: "here" })).toBe("sending to this chat");
  expect(toolWords("act", { action: "accept", confirmed: true })).toBe("accepting the task");
  expect(toolWords("act", { action: "accept", confirmed: false })).toBe("checking");
  expect(toolWords("screen", { do: "click" })).toBe("using the screen");
  expect(toolWords("call_view", { view: "full" })).toBe("showing the call");
  expect(toolWords("call_view", { view: "minimized" })).toBe("minimizing the call");
  expect(toolWords("open", { what: "task" })).toBe("opening it");
  expect(toolWords("whatever")).toBe("working");
});

test("SHEP-113: the person's ask holds the updates until it is answered, tools and all", () => {
  const g = turnGate(30000);
  expect(g.holding(0)).toBe(false);
  g.seen("user_transcript", 1000);
  expect(g.holding(1500)).toBe(true);
  // "On it." then the tool: still held while it runs, and after its result until the answer
  g.seen("agent_response", 2000);
  g.seen("client_tool_call", 2100);
  expect(g.holding(2200)).toBe(true);
  g.seen("client_tool_result", 5000);
  expect(g.holding(5100)).toBe(true);
  g.seen("agent_response", 6000);
  expect(g.holding(6100)).toBe(false);
  // a model that never answers holds no longer than the cap
  g.seen("user_transcript", 10000);
  expect(g.holding(39000)).toBe(true);
  expect(g.holding(41000)).toBe(false);
});

test("SHEP-124: call_view sets the call's own view (full or minimized), never screen clicks; opening minimizes by itself", () => {
  const t = TOOLS.find((x) => x.name === "call_view");
  expect(t.parameters.required).toEqual(["view"]);
  expect(t.parameters.properties.view.enum).toEqual(["full", "minimized"]);
  const p = prompt();
  expect(p).toContain('"Back to the call", "maximize the call", "full screen": call_view full');
  expect(p).toContain("Never screen for this.");
  expect(p).toContain("Opening or moving around minimizes a full-screen call by itself");
});

// SHEP-173: ElevenLabs' records of the person's calls: "Passed it to the Home Assistant." then end_call, no yes asked
test("SHEP-173: hang_up only right after the person answered a question, with no tool since", () => {
  const g = hangUpGuard();
  expect(g.may()).toBe(false);
  g.seen("user_transcript", "Tell Home to update codex.");
  g.seen("agent_response", "On it.");
  g.seen("client_tool_call", "send");
  g.seen("agent_response", "Passed it to the Home Assistant.");
  g.seen("client_tool_call", "hang_up");
  expect(g.may()).toBe(false);
  // asked, then a yes: may (in any language: only the question mark counts)
  g.seen("user_transcript", "End the call.");
  g.seen("agent_response", "Are you sure you want to end the call?");
  g.seen("user_transcript", "Yes.");
  g.seen("agent_response", "Bye.");
  g.seen("client_tool_call", "hang_up");
  expect(g.may()).toBe(true);
  const sv = hangUpGuard();
  sv.seen("agent_response", "Vill du verkligen avsluta samtalet?");
  sv.seen("user_transcript", "Ja.");
  expect(sv.may()).toBe(true);
  // a question, a yes, then a send before hanging up: not
  sv.seen("client_tool_call", "send");
  expect(sv.may()).toBe(false);
  expect(JSON.parse(HUNG_UP).ok).toBe(true);
  expect(JSON.parse(REFUSED).ok).toBe(false);
});

test("SHEP-173: why a call ended, in plain words", () => {
  expect(closeWords(1000, "Conversation has exceeded maximum duration")).toBe("it reached the 2-hour limit");
  expect(closeWords(1002, "No user message received for a long period of time - probably a network error occurred.")).toBe("it was quiet for a long time");
  expect(closeWords(1000, "")).toBe("the voice service ended it");
  expect(closeWords(1006, "")).toBe("the connection to the voice service was lost");
  expect(closeWords(4000, "quota")).toBe("the voice service closed it (quota)");
});

test("SHEP-173: the end chime is short, soft and ends in silence", () => {
  const pcm = chimePcm(16000);
  expect(pcm).toBeInstanceOf(Int16Array);
  expect(pcm.length / 16000).toBeGreaterThan(0.3);
  expect(pcm.length / 16000).toBeLessThan(0.7);
  const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  expect(peak).toBeGreaterThan(3000);
  expect(peak).toBeLessThan(16000);
  expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(800);
});

test("a long reply is said whole; past the limit it says it was cut and where the rest is (#785)", () => {
  const five = "Sentence. ".repeat(500) + "Last words.";
  expect(replyLine("the shop Assistant", five).text).toContain("Last words.");
  expect(replyLine("the shop Assistant", five).text).not.toContain("cut short");
  const huge = replyLine("the shop Assistant", "y".repeat(REPLY_MAX + 10)).text;
  expect(huge).toContain("cut short here; the rest is in the chat");
  expect(huge).toContain("Tell the person what it says");
});
