// The person's words into a terminal from the window, as hc send pastes them but with no caller (SHEP-3). hc send
// names its caller (HC_TERMINAL_ID, else its parent process: the window), and another machine's core wraps a message
// from one in <hc from="<machine>/ppid:…">: the agent and both chats took the person's words for Another agent's.
// herdr-core's terminal.send with no caller lands as plain input from the person, here and on any machine; the
// service does the same through its own link (service/hub.ts send()). From the window it goes through `hc connect`
// (one JSON-RPC line in, its answer out), the documented way in that names nobody.
// Shared core: the source is core/person.js; bin/sync-shared copies it into the mods in lib/COPIES.

// The one request line: terminal.send for addr with text, no caller.
export const personRequest = (addr, text) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.send", params: { terminal: addr, text } });

// hc connect's answer, in hc send's own result shape: code 0 with the result, else its error
// ({ error: { kind, message } }) on stderr, for core/send.js's refusal(); null when there's no answer at all.
export function personResult(r) {
  const line = String(r?.stdout ?? "").split("\n").map((l) => l.trim()).find((l) => l.startsWith("{"));
  let m = null;
  try { m = line ? JSON.parse(line) : null; } catch {}
  if (!m || m.id !== 1 || !("result" in m || "error" in m)) return null;
  if (m.error) return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: m.error.data?.kind ?? null, message: m.error.message ?? "It didn't go through." } }) };
  return { code: 0, stdout: JSON.stringify(m.result ?? {}), stderr: "" };
}

// Sends text to addr as the person. exec: herdr's exec(command, args). When hc connect gave no answer (no sh, an hc
// without it), hc send instead: the words still go, named as before.
export async function sendAsPerson({ hc, exec }, addr, text) {
  const r = await exec("sh", ["-c", 'printf "%s\\n" "$1" | hc connect', "hc-send", personRequest(addr, text)]).catch(() => null);
  return personResult(r) ?? hc(["send", addr, text]);
}

// hc for sending the person's words: its plain send (`hc send <t> <text>`) goes as the person, everything else as is.
export const asPerson = (io) => (args) => args[0] === "send" && args.length === 3 ? sendAsPerson(io, args[1], args[2]) : io.hc(args);
