// Why something needs the person, in a line of at most 40 characters: the reasons the Tasks list, the inbox and
// the web app all show. Shared core: the source is core/needs.js; bin/sync-shared copies it into the mods in
// lib/COPIES (beside lib/inbox.js, which re-exports it). Edit it here, never a copy.
import { words } from "./asks.js";

// At most this many characters, as Shepherdr's status lines (herdr-task's LINE_MAX).
export const LINE_MAX = 40;
export const REASONS = { plan: "Plan to approve", permission: "Asks permission", question: "Question for you",
  reply: "Waits for your reply", signedOut: "Signed out", stopped: "Agent stopped", trust: "Asks to trust this folder" };

// One line of at most n characters, cut at a word ("…" at the end) when longer (herdr-task's fit()).
export function fit(text, n = LINE_MAX) {
  const s = String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (s.length <= n) return s;
  let cut = s.slice(0, n - 1);
  if (cut.includes(" ") && s[n - 1] !== " ") cut = cut.slice(0, cut.lastIndexOf(" "));
  return cut.replace(/[ ,;:.-]+$/, "") + "…";
}

// Why a hook's request waits (Claude's PermissionRequest): a plan, its question (cut to fit), or
// what a permission is for, as its card says it ("Run: npm test", "Edit mods/chat/main.js").
export function reqReason(req) {
  const tool = String(req?.tool_name ?? ""), v = req?.tool_input ?? {};
  if (tool === "ExitPlanMode") return REASONS.plan;
  if (tool === "AskUserQuestion") { const q = v?.questions?.[0]?.question; return q ? fit(q) : REASONS.question; }
  return fit(words(req).title) || REASONS.permission;
}

// What a permission is for from the agent's own report (OSC 7501 message: Claude's "approve
// Bash: npm test"), when no hook holds its request: "Run: npm test". Else null.
export function reportReason(msg) {
  const m = /^approve\s+(\S+?):\s*(.+)$/i.exec(String(msg ?? "").trim());
  if (!m) return null;
  return fit(m[1] === "Bash" ? `Run: ${m[2]}` : m[1] === "WebFetch" ? `Fetch ${m[2]}` : `${m[1]} ${m[2]}`);
}
