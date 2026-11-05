// The voice agent's spec reaches agents made before (ensureAgent): kept and up to date, nothing asked; from another
// spec, PATCHed (and the tools it replaced removed); gone from ElevenLabs, made again; made with another key, a new one.
import { expect, test } from "bun:test";
import { ensureAgent, agentSpec, SPEC, specTag, TOOLS, agentFile, envLines, opening, prompt } from "./voice.js";

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

test("the spec: four client tools, a version that follows its words, and a file without the key", () => {
  expect(TOOLS.map((t) => t.name)).toEqual(["look", "open", "send", "act"]);
  for (const t of TOOLS) { expect(t.type).toBe("client"); expect(t.expects_response).toBe(true); expect(t.response_timeout_secs).toBeLessThanOrEqual(120); }
  expect(TOOLS.find((t) => t.name === "act").parameters.required).toContain("confirmed");
  expect(SPEC).toBe(specTag(agentSpec()));
  const changed = agentSpec(); changed.conversation_config.agent.prompt.tools[0].description += "!";
  expect(specTag(changed)).not.toBe(SPEC);
  expect(envLines(agentFile("agent_1", "tag1", SPEC))).toEqual({ ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_KEY_TAG: "tag1", ELEVENLABS_SPEC: SPEC });
  const o = opening("the shepherdr Assistant", "The app shows task SHEP 45.");
  expect(o.conversation_config_override.agent.prompt.prompt).toContain("Where the call is now: The app shows task SHEP 45.");
  expect(prompt("x")).toContain("confirmed true only after the person clearly said yes");
});
