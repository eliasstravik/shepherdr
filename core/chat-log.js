// Shared core: the source is core/chat-log.js (was mods/chat/log.js); the chat mod, the service and the web
// app read agents' logs with it. bin/sync-shared copies it into mods/chat/core/. Edit it here, never a copy.
// Finding an agent's own session log and reading it as a conversation.
// Claude Code: ~/.claude/sessions/<pid>.json names the session its process writes, so the
// log is ~/.claude/projects/*/<sessionId>.jsonl. Codex keeps its rollout file open, so the
// file is whatever rollout-*.jsonl its process (or a child) holds. Both are exact: no
// guessing by folder or time, so two agents in one folder never get mixed up.

// Prints the log's path on the agent's machine, or nothing. Args: kind, pid.
import { codexQuestions } from "./asks.js";

export const FIND = `
kind="$1"; pid="$2"
kids() { for k in $(pgrep -P "$1" 2>/dev/null); do echo "$k"; kids "$k"; done; }
for p in "$pid" $(kids "$pid"); do
  if [ "$kind" = claude ]; then
    j="$HOME/.claude/sessions/$p.json"
    [ -f "$j" ] || continue
    id=$(sed -n 's/.*"sessionId":"\\([0-9a-fA-F-]*\\)".*/\\1/p' "$j")
    [ -n "$id" ] || continue
    for f in "$HOME"/.claude/projects/*/"$id".jsonl; do [ -f "$f" ] && { echo "$f"; exit 0; }; done
    echo "pending"; exit 0
  else
    if [ -d "/proc/$p/fd" ]; then
      f=$(for d in /proc/$p/fd/*; do readlink "$d"; done 2>/dev/null | grep '/rollout-.*\\.jsonl$' | head -1)
    else
      f=$(lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | grep '/rollout-.*\\.jsonl$' | head -1)
    fi
    [ -n "$f" ] && { echo "$f"; exit 0; }
  fi
done
true`;

// Reads a log on the agent's machine, sending back only what the chat shows. Each kept line
// comes back as "<offset>\t<kind>\t<data>": J a JSON line (images emptied), R a tool result's
// ids only (outputs stay in the file, fetched when a row is opened; "TASK=<id>" when the call
// left a job running in the background), T a call too big to send (its tool name), N a
// background job that ended ("<call id> <task id> <status>"). Lines the chat doesn't show
// (bookkeeping, thinking, requests) stay.
//   log tail <file> <from>            what was added since byte <from>: "T <size> <from> <end>"
//   log page <file> <before> <want>   about <want> messages ending at byte <before> (or the
//                                     last whole line), going back in growing chunks:
//                                     "P <start> <end>" (start 0: the very start)
//   log results <file> <offset>...    the first 64 KB of the lines at those offsets
export const LOG = String.raw`
mode="$1"; f="$2"
[ -f "$f" ] || { echo "missing"; exit 0; }
s=$(wc -c < "$f" | tr -d ' ')
X='
BEGIN { pos = base; first = base; msgs = 0 }
{
  off = pos; pos += length($0) + 1
  if (NR == 1 && skip) { first = pos; next }
  line = $0
  head = substr(line, 1, 400)
  claude = index(head, "\"isSidechain\":false") && index(line, "\"type\":\"user\",\"message\"")
  codex = index(head, "\"type\":\"response_item\"")
  # A background job (a shell, a watcher, a helper) that ended: Claude Code notes it the moment it
  # ends, as a message queued for the agent (which may read it much later).
  if (index(head, "\"type\":\"queue-operation\",\"operation\":\"enqueue\"") && index(line, "<task-notification>") && index(line, "<status>")) {
    if (count) next
    u = "-"; k = "-"; st = "-"
    if (match(line, /<tool-use-id>[^<]+/)) u = substr(line, RSTART + 13, RLENGTH - 13)
    if (match(line, /<task-id>[^<]+/)) k = substr(line, RSTART + 9, RLENGTH - 9)
    if (match(line, /<status>[^<]+/)) st = substr(line, RSTART + 8, RLENGTH - 8)
    print off "\tN\t" u " " k " " st
    # and as a place in the queue below
    if (length(line) <= 262144) print off "\tJ\t" line
    next
  }
  if ((claude && index(line, "\"tool_result\"")) || (codex && (index(head, "\"function_call_output\"") || index(head, "\"custom_tool_call_output\"")))) {
    if (count) next
    ids = ""; t = line
    while (match(t, /"(tool_use_id|call_id)":"[^"]*"/)) { m = substr(t, RSTART, RLENGTH); sub(/^"[a-z_]*":"/, "", m); sub(/"$/, "", m); ids = ids " " m; t = substr(t, RSTART + RLENGTH) }
    # A helper (or job) launched to run on its own: its result came at once, it is not done yet.
    if (index(line, "Async agent launched") || index(line, "running in background")) ids = ids " ASYNC"
    # A shell or watcher left running in the background (or moved there mid-run): its task id.
    if (match(line, /"(backgroundTaskId|taskId)":"[^"]+"/)) { m = substr(line, RSTART, RLENGTH); sub(/^"[A-Za-z]*":"/, "", m); sub(/"$/, "", m); ids = ids " TASK=" m }
    print off "\tR\t" ids
    # An answer to a question, or words that declined a request: read whole (answers()).
    if (claude && length(line) <= 262144 && ((index(line, "\"answers\":{") && index(line, "\"questions\":[")) || index(line, "wrote in the chat instead: "))) print off "\tJ\t" line
    next
  }
  # The queue of messages typed while Claude Code works: what goes in (the words of the person)
  # and what comes out, so the chat shows them queued at once. (No apostrophes: X is quoted.)
  if (index(head, "\"type\":\"queue-operation\"")) {
    if (count || length(line) > 262144) next
    gsub(/"data":"[^"]*"/, "\"data\":\"\"", line)
    print off "\tJ\t" line
    next
  }
  keep = 0
  if (index(head, "\"isSidechain\":false")) {
    if (index(line, "\"type\":\"user\",\"message\"") || index(line, "\"type\":\"assistant\",\"uuid\"") || (index(line, "\"type\":\"attachment\",\"uuid\"") && index(line, "\"queued_command\""))) keep = 1
  } else if (index(head, "\"type\":\"response_item\"")) {
    if (index(head, "\"type\":\"message\"") || index(head, "_call\"")) keep = 1
  } else if (index(head, "\"type\":\"event_msg\"")) {
    if (index(head, "\"task_complete\"") || index(head, "\"turn_aborted\"") || index(head, "\"token_count\"")) keep = 1
  } else if (index(head, "\"type\":\"turn_context\"")) {
    keep = 1
  }
  if (!keep) next
  if (index(line, "\"type\":\"text\"") || index(line, "\"role\":\"user\",\"content\":\"") || index(head, "\"type\":\"message\"")) msgs++
  if (count) next
  gsub(/"data":"[^"]*"/, "\"data\":\"\"", line)
  gsub(/"image_url":"data:[^"]*"/, "\"image_url\":\"\"", line)
  big = (index(line, "\"tool_use\"") || index(head, "_call\"")) ? 32768 : 262144
  if (length(line) > big) {
    nm = ""
    if (match(line, /"name":"[^"]*"/)) nm = substr(line, RSTART + 8, RLENGTH - 9)
    # A call too big to send: its name and its small fields (what the working line says).
    n = split("file_path notebook_path description command pattern url query path activeForm", ks, " ")
    for (k = 1; k <= n; k++) if (match(line, "\"" ks[k] "\":\"[^\"]*")) nm = nm "\037" ks[k] "=" substr(line, RSTART + length(ks[k]) + 4, (RLENGTH - length(ks[k]) - 4 > 200) ? 200 : RLENGTH - length(ks[k]) - 4)
    print off "\tT\t" nm
    next
  }
  print off "\tJ\t" line
}
END { if (first > pos) first = pos; print "#\t" first "\t" msgs }'
range() { tail -c +$(($1 + 1)) "$f" | head -c $(($2 - $1)) | LC_ALL=C awk -v base="$1" -v skip="$3" -v count="$4" "$X"; }
case "$mode" in
tail)
  o="$3"; [ "$s" -lt "$o" ] && o=0
  part=0
  if [ "$s" -gt "$o" ] && [ "$(tail -c +"$s" "$f" | head -c 1 | wc -l | tr -d ' ')" = 0 ]; then
    part=$(tail -c +$((o + 1)) "$f" | head -c $((s - o)) | LC_ALL=C awk 'END { print length($0) }')
  fi
  e=$((s - part))
  echo "T $s $o $e"
  [ "$e" -gt "$o" ] && range "$o" "$e" 0 0
  ;;
page)
  e="$3"; want="$4"
  if [ "$e" -ge "$s" ]; then
    e="$s"
    if [ "$s" -gt 0 ] && [ "$(tail -c +"$s" "$f" | head -c 1 | wc -l | tr -d ' ')" = 0 ]; then
      e=$((s - $(tail -c 1048576 "$f" | LC_ALL=C awk 'END { print length($0) }')))
    fi
  fi
  a="$e"; b="$e"; n=0; c=1000000
  while [ "$a" -gt 0 ] && [ "$n" -lt "$want" ]; do
    lo=$((b - c)); [ "$lo" -lt 0 ] && lo=0
    k=0; [ "$lo" -gt 0 ] && k=1
    r=$(range "$lo" "$b" "$k" 1 | tail -n 1)
    first=$(echo "$r" | cut -f2); m=$(echo "$r" | cut -f3)
    if [ "$first" -ge "$b" ] && [ "$lo" -gt 0 ]; then c=$((c * 2)); continue; fi
    n=$((n + m)); a="$first"; b="$first"
    [ "$c" -lt 16000000 ] && c=$((c * 2))
  done
  echo "P $a $e"
  [ "$e" -gt "$a" ] && range "$a" "$e" 0 0
  ;;
results)
  shift 2
  for o in "$@"; do printf '\036%s\n' "$o"; tail -c +$((o + 1)) "$f" | head -c 65536 | head -n 1; done
  ;;
esac
true`;


const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const time = (s) => Date.parse(s ?? "") || 0;

// Text Claude Code puts in a user line that the person didn't type.
const INJECTED = /^\s*(<(local-command-|system-reminder|bash-|task-notification|user-memory-input|user-prompt-submit-hook|command-message)|Caveat: The messages below|\[Request interrupted)/;
const CODEX_INJECTED = /^\s*(# AGENTS\.md instructions|<(environment_context|user_instructions|user_shell_command|turn_aborted|subagent_notification|skill|INSTRUCTIONS)\b)/;

// What the person typed, without what the CLI or herdr-core wrapped around it.
// A message another agent sent with `hc send` comes as <hc from="t3 name">text</hc>.
// Reactions travel as Herdr tag lines (taught to agents by session-note.sh):
//   the person  <hc from="person" reaction="👍" to="first words of the message"/>   (or reaction-removed=)
//   the agent   <hc react="👀" to="first words of the person's message"/>   on a line of its own
//               <hc no-reply/>   a reply that is only this shows nothing (<no-reply> too); on an Autopilot
//               wake <hc no-reply why="Waiting on your Accept of TG-2"/> puts its why on the wake's line
// Task news Herdr sends an Assistant (herdr-task's news_pass) is one <herdr-news> tag per line:
// each is a news item of its own ({ kind: "news", ref, event, text }), shown as a slim line in
// an Assistant's chat (mods/chat newsLines()); the tags themselves never show.
// None of these lines show in the chat; the reactions show on the messages they name.
// A value ends at the quote before the next attribute or the tag's end, so a quote inside it
// (an agent quoting the person's "words" in to=) doesn't break the line (SHEP-47).
const VALUE = String.raw`"((?:[^"]|"(?!\s*\/>|\s+[\w-]+(?:="|\s*\/>)))*)"`;
const ATTRS = new RegExp(String.raw`\s+([\w-]+)(?:=${VALUE})?`, "gy");
// A tag line: the attributes of the <hc …/> it starts with, and the text after it (rest).
function tagAt(line) {
  const s = line.trim();
  if (!s.startsWith("<hc")) return null;
  const a = {};
  let i = 3;
  for (;;) {
    ATTRS.lastIndex = i;
    const m = ATTRS.exec(s);
    if (!m) break;
    a[m[1]] = m[2] ?? "";
    i = ATTRS.lastIndex;
  }
  const end = /^\s*\/>/.exec(s.slice(i));
  if (!end || i === 3 && !Object.keys(a).length) return null;
  return { a, rest: s.slice(i + end[0].length).trim() };
}
function tagOf(line) {
  const t = tagAt(line);
  return t && !t.rest ? t.a : null;
}
// A message's start, as a reaction names it: its first words, on one line, quotes made curly.
export function excerpt(text, n = 60) {
  const one = String(text ?? "").replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim().replace(/"/g, "”");
  return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : one;
}
// Does `text` start with what a reaction's `to` quotes (loose: an agent may shorten it)?
// Quotes don't count: an agent may drop them or make them curly in to= (SHEP-47).
export function names(text, to) {
  const bare = (x) => x.replace(/["“”„]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = bare(excerpt(text, 400)), b = bare(String(to ?? "").replace(/…$/, ""));
  if (!b) return false;
  return a.startsWith(b) || (b.length >= 12 && a.includes(b.slice(0, 24)));
}

// The person's reaction lines in a message, and the rest of its text.
function reactionLines(t) {
  const reactions = [], rest = [];
  for (const line of String(t).split("\n")) {
    const a = tagOf(line);
    if (a && (a.reaction || a["reaction-removed"])) reactions.push({ emoji: a.reaction ?? a["reaction-removed"], on: Boolean(a.reaction), to: a.to ?? "" });
    else rest.push(line);
  }
  return { reactions, text: rest.join("\n").trim() };
}

// A reply from the chat: its first line <hc reply-to="first words of the message"/> (older
// replies quoted the message as a "> " blockquote instead; the chat matches those to messages).
function replyOf(t) {
  const lines = String(t).split("\n");
  const a = tagOf(lines[0] ?? "");
  if (a && "reply-to" in a) return { replyTo: a["reply-to"], text: lines.slice(1).join("\n").trim() };
  const m = /^((?:>[^\n]*\n)+)\n*([\s\S]+)$/.exec(String(t));
  if (m) return { quoted: m[1].split("\n").map((l) => l.replace(/^>\s?/, "")).join(" ").trim(), text: m[2].trim() };
  return null;
}

// Where a message has code, fenced (```) or inline (`…`): [[start, end]]. Herdr's own tags never start inside code: a
// role template's or brief's examples there (assistant.md's <herdr-news> lines) are words, not tags (#589). A real
// tag may hold code (a failed check's log): only where it starts counts.
function codeRanges(t) {
  return [...String(t).matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g)].map((m) => [m.index, m.index + m[0].length]);
}
const inCode = (ranges, at) => ranges.some(([a, b]) => at >= a && at < b);
// t.replace(re, by) for the matches that start outside code.
const replaceOutsideCode = (t, re, by) => {
  const code = codeRanges(t);
  return t.replace(re, (m, ...rest) => (inCode(code, rest.find((x) => typeof x === "number")) ? m : by));
};

// Task news in a message: [{ ref, event, text }], one per <herdr-news task=… event=…> tag.
const unattr = (v) => String(v ?? "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
function newsOf(t) {
  const s = String(t), code = codeRanges(s);
  return [...s.matchAll(/<herdr-news\b([^>]*)>([\s\S]*?)<\/herdr-news\s*>/g)].filter((m) => !inCode(code, m.index)).map(([, a, text]) => ({
    ref: unattr(/\btask="([^"]*)"/.exec(a)?.[1]), event: unattr(/\bevent="([^"]*)"/.exec(a)?.[1]), text: text.trim() })).filter((n) => n.ref && n.event);
}

// An Autopilot wake (herdr-task's <herdr-autopilot reason=…>): { reason }, else null. Its words never show; the chat
// shows one quiet line for it (pilotLine()).
// Only a message that is the wake itself (the CLI may wrap it as pasted): an Assistant's brief shows the tag as an example.
function pilotOf(t) {
  const m = /^<herdr-autopilot\b([^>]*)>/.exec(String(t).replace(/<\/?pasted_content\b[^>]*>/g, "").trim());
  return m ? { reason: unattr(/\breason="([^"]*)"/.exec(m[1])?.[1] ?? "") } : null;
}

// A message's words, with the task news it carries (news: shown as their own lines) and the Autopilot wake it is.
function cleanUser(t) {
  const news = newsOf(t), pilot = pilotOf(t);
  const u = cleanWords(t);
  const out = news.length ? { ...(u ?? { text: "" }), news } : u;
  return pilot ? { ...(out ?? { text: "" }), pilot } : out;
}

// Why Autopilot woke, in words: "on schedule", "Run now", "switched on", "HAT-4 is ready" (herdr-task's reasons).
const EVENT_WORDS = { added: "was added", ready: "is ready", failed: "failed", "needs-you": "needs you", merged: "was merged", stalled: "stalled" };
export function pilotWhy(reason) {
  const r = String(reason ?? "").trim();
  if (r === "schedule") return "on schedule";
  if (r === "run now") return "Run now";
  const ev = /^event:([\w-]+)\s+(.+)$/.exec(r);
  if (ev) return `${ev[2]} ${EVENT_WORDS[ev[1]] ?? ev[1]}`;
  return r || "on schedule";
}

// A wake's quiet line in the chat: "Autopilot woke · on schedule", then how it went once that shows in the log:
// its why when it answered <hc no-reply why="…"/> (" · Waiting on your Accept of TG-2", SHEP-40), else " · nothing to
// do" (a bare <hc no-reply/> without looking at anything), " · checked, nothing new" (it looked, then answered that),
// nothing more while it works or once it said something (its words follow as its message).
// item: { kind: "pilot", reason, steps, said, quiet, why }.
export const PILOT_WHY_MAX = 160;
export function pilotLine(item) {
  const head = `Autopilot woke · ${pilotWhy(item?.reason)}`;
  if (item?.said || !item?.quiet) return head;
  const why = String(item.why ?? "").replace(/\s+/g, " ").trim();
  if (why) return `${head} · ${why.length > PILOT_WHY_MAX ? why.slice(0, PILOT_WHY_MAX - 1).trimEnd() + "…" : why}`;
  return `${head} · ${item.steps ? "checked, nothing new" : "nothing to do"}`;
}

function cleanWords(t) {
  const r = reactionLines(t);
  if (r.reactions.length) {
    const u = r.text ? cleanWords(r.text) : null;
    return { ...(u ?? { text: "" }), reactions: r.reactions };
  }
  const cmd = /<command-name>([^<]*)<\/command-name>/.exec(t);
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1] ?? "";
    return { text: `${cmd[1].trim()} ${args.trim()}`.trim() };
  }
  if (INJECTED.test(t)) return null;
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/<\/?pasted_content\b[^>]*>\n?/g, "");
  // Another Assistant's message (herdr-task tell-assistant): <herdr-assistant from="mac/t13" machine="mac"
  // space="Home" can-reply="no">text</herdr-assistant>, the whole message (the CLI may wrap it as pasted).
  const peer = /^\s*<herdr-assistant\b([^>]*)>([\s\S]*?)<\/herdr-assistant\s*>\s*$/.exec(t);
  if (peer) {
    const at = (k) => unattr(new RegExp(`\\b${k}="([^"]*)"`).exec(peer[1])?.[1] ?? "");
    const from = at("from");
    if (from) return { text: peer[2].replace(/&lt;\/herdr-assistant/g, "</herdr-assistant").trim(), from,
      assistant: { machine: at("machine"), space: at("space"), reply: at("can-reply") === "yes" } };
  }
  // Task mentions (#4) come with a tag line each for the agent; the chat shows the "#4".
  t = replaceOutsideCode(t, /<hc task="[^"]*"[^>]*>[\s\S]*?<\/hc>\n?/g, "");
  // Herdr's own tags for the agent (<herdr-news>, <herdr-github>, ...), wherever they are in a
  // message: never shown, the words typed around them are. Not in code: a template's examples stay.
  t = replaceOutsideCode(t, /<(herdr-[\w-]+)\b[^>]*>[\s\S]*?<\/\1\s*>\n?/g, "");
  t = replaceOutsideCode(t, /<herdr-[\w-]+\b[^>]*\/>\n?/g, "").trim();
  if (!t) return null;
  // Herdr's own wrapper (other attributes may follow from=, e.g. reach="…").
  const hc = /^<hc\b([^>]*)>([\s\S]*?)<\/hc>$/.exec(t);
  if (hc) {
    const from = /\bfrom="([^"]*)"/.exec(hc[1])?.[1];
    // An artifact's form (mods/artifacts) says which one: "Message from Coverage". Else the
    // whole from= ("t7 herd-12-fix"): the chat names the sender from it (main.js sender()).
    const title = from === "artifact" ? /\btitle="([^"]*)"/.exec(hc[1])?.[1] : null;
    return from ? { text: hc[2].trim(), from: title || from } : null;
  }
  // A message that is one tag from end to end was written by a program, not typed.
  if (/^<([a-z][\w-]*)\b[^>]*>[\s\S]*<\/\1>$/.test(t)) return null;
  // A quote (a reply from the chat) ends where the typed text starts: the CLI may have joined them.
  t = t.replace(/^(>.*)\n(?!>|\n)/gm, "$1\n\n");
  const reply = replyOf(t);
  if (reply?.replyTo !== undefined) return { text: reply.text, replyTo: reply.replyTo };
  if (reply?.quoted) return { text: t, quoted: reply.quoted, rest: reply.text };
  return t ? { text: t } : null;
}

function claudeUser(c) {
  if (typeof c === "string") return cleanUser(c);
  if (!Array.isArray(c) || c.some((b) => b?.type === "tool_result")) return null;
  // Images sent with the message (Claude Code turns an image path into one): counted, and the
  // "[Image #1]" markers it leaves in the text go.
  const images = c.filter((b) => b?.type === "image").length;
  const parts = c.filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => cleanUser(images ? b.text.replace(/\[Image #\d+\]\s*/g, "") : b.text)).filter(Boolean);
  if (!parts.length) return images ? { text: "", images } : null;
  const reactions = parts.flatMap((p) => p.reactions ?? []), news = parts.flatMap((p) => p.news ?? []);
  const pilot = parts.find((p) => p.pilot)?.pilot;
  return { text: parts.map((p) => p.text).filter(Boolean).join("\n\n"), from: parts[0].from, ...(parts[0].assistant ? { assistant: parts[0].assistant } : {}), images, reactions, news, ...(pilot ? { pilot } : {}),
    replyTo: parts[0].replyTo, quoted: parts[0].quoted, rest: parts[0].rest };
}

// Claude Code may show the person a message it wrote mid-turn (before a call) as a short update in other words
// (thinkingDisplay "updates"): what it wrote never reaches the log, nor its <hc react> lines. The update is a
// thinking block the terminal shows as a message, its signature naming it narration ("narration" in base64, at
// each of its three alignments): the chat shows it as the agent's message too. Real thinking stays hidden (empty
// in the log, or "summarized").
const NARRATION = /bmFycmF0aW9u|5hcnJhdGlvb|uYXJyYXRpb2/;
function narration(l, b) {
  if (b?.type !== "thinking" || typeof b.thinking !== "string" || !b.thinking.trim()) return false;
  return l.thinkingDisplay === "updates" || NARRATION.test(String(b.signature ?? "").slice(0, 80));
}

const short = (p) => {
  const s = String(p ?? "");
  const parts = s.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : s;
};
const clip = (s, n = 90) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// A command that publishes an artifact (mods/artifacts): the chat shows a card for it, found in
// the artifacts' registry by who published it and when.
const ARTIFACT = /\bherdr-artifact\b[^\n|;&]*\b(publish|update)\b/;

// The messages a shell command sends other agents: [{ to, text, how }], how "hc" (`hc send [flags] <terminal>
// <text>`, to a terminal) or "assistant" (`herdr-task tell-assistant <address or space> <text>`). Read with a small
// shell lexer: quotes, escapes, `;` `&&` `||` `|` and new lines between commands, heredoc bodies skipped, and a text
// given as "$VAR" taken from a VAR=… set earlier in the same command. A text it can't know is left out.
const VALUED = new Set(["--if", "--timeout", "--on"]);
export function sendsOf(command) {
  const s = String(command ?? "");
  if (!/\b(hc|herdr-task)\b/.test(s) || !/\b(send|tell-assistant)\b/.test(s)) return [];
  const cmds = [], vars = new Map();
  let words = [], w = null, i = 0, heredocs = [];
  // w: { text, var? (the word was only $NAME) }
  const end = () => { if (w) words.push(w); w = null; };
  const done = () => { end(); if (words.length) cmds.push(words); words = []; };
  const add = (c) => { w ??= { text: "", raw: "" }; w.text += c; };
  while (i < s.length) {
    const c = s[i];
    if (c === "\n") {
      done(); i++;
      // heredoc bodies follow the line that opened them
      for (const tag of heredocs) {
        const close = new RegExp(`^\\t*${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
        const m = close.exec(s.slice(i));
        i = m ? i + m.index + m[0].length + 1 : s.length;
      }
      heredocs = [];
      continue;
    }
    if (c === " " || c === "\t") { end(); i++; continue; }
    if (c === ";" || c === "|" || (c === "&" && s[i - 1] !== ">" && s[i + 1] !== ">")) { done(); i += s[i + 1] === c ? 2 : 1; continue; }
    if (c === "#" && !w) { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
      end();
      const m = /^<<-?\s*(['"]?)([\w.-]+)\1/.exec(s.slice(i));
      if (m) { heredocs.push(m[2]); i += m[0].length; continue; }
    }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      add(s.slice(i + 1, j < 0 ? s.length : j)); w.raw += "'"; i = j < 0 ? s.length : j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, out = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\" && '"\\$`\n'.includes(s[j + 1] ?? "")) { out += s[j + 1] === "\n" ? "" : s[j + 1]; j += 2; }
        else out += s[j++];
      }
      const raw = s.slice(i + 1, j);
      add(out); w.raw += /^\$\{?\w+\}?$/.test(raw) ? raw : "\"";
      i = j + 1; continue;
    }
    if (c === "\\") { add(s[i + 1] ?? ""); w.raw += "\\"; i += 2; continue; }
    add(c); w.raw += c; i++;
  }
  done();
  const out = [];
  for (const cmd of cmds) {
    // NAME=value words before a command (or alone) set a variable for what follows
    let k = 0;
    while (k < cmd.length && /^[A-Za-z_]\w*=/.test(cmd[k].text)) {
      const eq = cmd[k].text.indexOf("=");
      vars.set(cmd[k].text.slice(0, eq), cmd[k].text.slice(eq + 1));
      k++;
    }
    const a = cmd.slice(k).map((x) => {
      const v = /^\$\{?(\w+)\}?$/.exec(x.raw);
      return v ? (vars.has(v[1]) ? vars.get(v[1]) : null) : x.text;
    });
    const prog = String(a[0] ?? "").split("/").pop();
    let rest = null, how = null;
    if (prog === "hc" && a[1] === "send") { rest = a.slice(2); how = "hc"; }
    else if (prog === "herdr-task" && a.includes("tell-assistant")) { rest = a.slice(a.indexOf("tell-assistant") + 1); how = "assistant"; }
    if (!rest) continue;
    const args = [];
    for (let j = 0; j < rest.length; j++) {
      const x = rest[j];
      if (x === null) { args.push(null); continue; }
      if (/^\d*>/.test(x) || x === ">" ) { if (!/^\d*>&?\S/.test(x)) j++; continue; }
      if (x.startsWith("--")) { if (VALUED.has(x)) j++; continue; }
      args.push(x);
    }
    const [to, text] = args;
    if (to && typeof text === "string" && text.trim()) out.push({ to, text: text.trim(), how });
  }
  return out;
}

// One tool call in words: its kind (for the summary) and a line for the open row.
// A command that only waits (hc wait, sleep): what it waits for, in words; else null. While
// it runs the agent is waiting, not busy: a message wakes it (hc wait returns on one).
function waitWords(command, description) {
  const w = /(?:^|[;&|(]\s*)(hc\s+wait\b[^;&|)]*|sleep\s+\d+)/.exec(String(command ?? ""));
  if (!w) return null;
  if (description) return description;
  if (/--children/.test(w[1])) return "Waiting for workers";
  const who = /hc\s+wait\s+([^\s-][^\s]*)/.exec(w[1])?.[1];
  return who ? `Waiting for ${who}` : "Waiting";
}

// A command in a few words: "bun test", "git status".
export const cmdWords = (c) => clip(String(c ?? "").replace(/^(cd [^&;]+(&&|;)\s*)+/, "").split(/\s*(?:&&|\|\||;|\|)\s*/)[0], 48);
const base = (p) => String(p ?? "").split("/").filter(Boolean).pop() ?? "";
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return clip(u, 40); } };

// One tool call in words: its kind (for the summary), a line for the open row, and what it is
// doing (for the working line: "Editing main.js", "Run the auth tests").
function claudeStep(name, input = {}) {
  switch (name) {
    case "Read": return { kind: "read", line: `Read ${short(input.file_path)}`, doing: `Reading ${base(input.file_path)}` };
    case "Edit": case "MultiEdit": case "NotebookEdit":
      return { kind: "edit", line: `Edited ${short(input.file_path ?? input.notebook_path)}`, doing: `Editing ${base(input.file_path ?? input.notebook_path)}` };
    case "Write": return { kind: "edit", line: `Wrote ${short(input.file_path)}`, doing: `Writing ${base(input.file_path)}` };
    case "Bash": {
      const line = input.description ? `${input.description}: ${clip(input.command, 80)}` : `Ran ${clip(input.command, 80)}`;
      // `shell`: what it is, should it move to the background mid-run (Claude Code does so when a
      // message comes while it runs).
      const shell = { kind: "shell", label: input.description || cmdWords(input.command), cmd: String(input.command ?? "") };
      // A job left running in the background: the turn goes on; the chat watches the job.
      if (input.run_in_background) return { kind: "run", line, doing: `Started ${shell.label}`, bg: shell, shell };
      const wait = waitWords(input.command, input.description);
      return { kind: "run", line, doing: wait ?? (input.description || `Running ${cmdWords(input.command)}`), waiting: Boolean(wait), shell };
    }
    // A watcher runs its command in the background and tells the agent each line it prints.
    case "Monitor": return { kind: "tool", line: `Watched ${clip(input.description ?? input.command, 70)}`,
      doing: `Watching ${clip(input.description ?? input.command ?? "", 50)}`.trim(), waiting: true,
      bg: { kind: "monitor", label: clip(input.description || cmdWords(input.command), 60), cmd: String(input.command ?? "") } };
    case "Grep": return { kind: "search", line: `Searched for “${clip(input.pattern, 50)}”`, doing: `Searching for “${clip(input.pattern, 40)}”` };
    case "Glob": return { kind: "search", line: `Looked for ${clip(input.pattern, 60)}`, doing: `Looking for ${clip(input.pattern, 40)}` };
    case "WebSearch": return { kind: "web", line: `Searched the web for “${clip(input.query, 60)}”`, doing: `Searching the web for “${clip(input.query, 40)}”` };
    case "WebFetch": return { kind: "web", line: `Opened ${clip(input.url, 80)}`, doing: `Reading ${host(input.url)}` };
    // A helper it waits on (one launched to run on its own answers at once: then the call is over).
    case "Agent": case "Task": return { kind: "agent", line: `Asked a helper: ${clip(input.description, 70)}`,
      doing: input.description ? `Waiting for helper: ${clip(input.description, 50)}` : "Waiting for a helper", waiting: true };
    case "TodoWrite": {
      const now = (Array.isArray(input.todos) ? input.todos : []).find((x) => x?.status === "in_progress");
      return { kind: "plan", line: "Updated its plan", doing: clip(now?.activeForm || now?.content, 60) || "Planning" };
    }
    case "TaskCreate": case "TaskUpdate": return { kind: "plan", line: "Updated its plan", doing: clip(input.activeForm, 60) || "Planning" };
    case "AskUserQuestion": return null;
  }
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
  if (mcp) return { kind: "tool", line: `Used ${mcp[1]}: ${mcp[2]}`, doing: `${mcp[2].replace(/[_-]+/g, " ")} (${mcp[1]})` };
  return { kind: "tool", line: `Used ${name}`, doing: input.description ? clip(input.description, 60) : `Using ${name}` };
}

// A Codex call's shell command(s), as one text (sendsOf reads it), else "".
function codexCommand(args) {
  let a = args;
  if (typeof a === "string") { try { a = JSON.parse(a); } catch { return a; } }
  if (!a || typeof a !== "object") return "";
  const c = a.cmd ?? a.command ?? a.input ?? "";
  return Array.isArray(c) ? (/^(ba|z)?sh$/.test(c[0]) && c[1]?.startsWith("-") ? c.slice(2).join(" ") : c.map((x) => /\s/.test(x) ? `'${String(x).replace(/'/g, "'\\''")}'` : x).join(" ")) : String(c);
}

function codexStep(name, args) {
  let a = args;
  if (typeof a === "string") a = parse(a) ?? { input: a };
  a = a ?? {};
  if (name === "shell" || name === "exec_command" || name === "local_shell" || name === "container.exec") {
    const cmd = Array.isArray(a.command) ? a.command.join(" ") : a.cmd ?? a.command ?? "";
    const plain = String(cmd).replace(/^(bash|sh|zsh) -l?c /, "");
    const wait = waitWords(plain);
    return { kind: "run", line: `Ran ${clip(plain, 80)}`, doing: wait ?? `Running ${cmdWords(plain)}`, waiting: Boolean(wait) };
  }
  if (name === "exec") {
    // Code mode: a script that runs commands (tools.exec_command({cmd: "..."})).
    const cmds = [...String(a.input ?? args ?? "").matchAll(/exec_command\(\{\s*cmd:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
    if (cmds.length) return { kind: "run", line: cmds.map((c) => `Ran ${clip(c, 80)}`).join("\n"), doing: `Running ${cmdWords(cmds[cmds.length - 1])}`, count: cmds.length };
    return { kind: "run", line: "Ran a script", doing: "Running a script" };
  }
  if (name === "apply_patch") {
    const files = [...String(a.input ?? args ?? "").matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => short(m[1]));
    return { kind: "edit", line: files.length ? `Edited ${files.join(", ")}` : "Edited files", doing: files.length ? `Editing ${files.map(base).slice(0, 3).join(", ")}` : "Editing files", count: Math.max(1, files.length) };
  }
  if (name === "web_search" || name === "web.run") return { kind: "web", line: "Searched the web", doing: "Searching the web" };
  if (name === "update_plan") return { kind: "plan", line: "Updated its plan", doing: "Planning" };
  if (name === "spawn_agent") return { kind: "agent", line: `Asked a helper: ${clip(a.task ?? a.message ?? a.prompt ?? "", 70)}`, doing: "Starting a helper", spawn: clip(a.task ?? a.message ?? a.prompt ?? "a helper", 60) };
  if (name === "wait_agent") return { kind: "agent", line: "Waited for helpers", doing: "Waiting for helpers", waiting: true };
  return { kind: "tool", line: `Used ${name}`, doing: `Using ${name}` };
}

// The conversation in one log, built from LOG's records ({ off, kind, data }) in file order.
// Items (ids come from byte offsets, so they stay the same when earlier pages are added):
//   { kind: "user", id, text, from?, at, images, paths? }   { kind: "agent", id, text, at }
//   (images: how many were sent; paths: where the ones Claude Code read from files came from;
//   replyTo: the start of the message it answers)
//   { kind: "mark", id }  (a message of only reactions: ends the turn, shows nothing)
//   { kind: "news", id, at, ref, event, text }  (one line of task news Herdr told an Assistant)
//   { kind: "sent", id, at, to, text, how }  (a message the agent sent another agent: sendsOf())
//   a user item's from: who sent it (another agent's address); assistant: { machine, space, reply } when it is
//   another Assistant's (<herdr-assistant>)
//   { kind: "pilot", id, at, reason, steps, said, quiet }  (an Autopilot wake, its quiet line: pilotLine())
//   { kind: "tools", id, steps: [{ id, kind, line, out? }] }  (calls in a row, between texts;
//                                             out: where the call's result line is)
//   { kind: "ask", id, text, questions?, closed? }  (the agent's own question tool, Codex's with its questions; closed once its dialog
//                                          is gone: "answered" | "dismissed")   { kind: "error", id, text }
// `doing` is what it does right now (the last call not answered yet), for the status line.
// `meta` is what the agent runs on, from its newest lines: { model, effort, speed, used, window }
// (used: tokens in its context window now; window: that window's size when the log says it;
// at: when the model was last named).
export class Conversation {
  constructor(kind) {
    this.kind = kind;
    this.items = [];
    // The Autopilot wake whose turn runs now (its line fills in as it goes: pilotLine()).
    this.pilot = null;
    this.replies = new Map();
    this.calls = new Map();
    this.open = new Map();
    this.doing = null;
    this.meta = {};
    // Reactions by message id: [{ emoji, by: "you" | "agent" }].
    this.reactions = new Map();
    // Calls that only wait, while open (`waiting`: the newest open call is one); and the jobs
    // the agent left running in the background, until their end is logged: { id (its call),
    // task (Claude Code's task id, once its result says), kind: "shell" | "monitor", label, cmd,
    // at } (core/bg-jobs.js checks they still run). `stops`: the agent's own TaskStop calls.
    this.waits = new Set();
    this.waiting = false;
    this.bg = [];
    this.stops = new Map();
    // Claude Code's own helpers (Agent/Task calls) by call id: { desc, done }. One launched to
    // run on its own is done when its task-notification comes.
    this.helpers = new Map();
    this.questions = new Map();
    // Claude Code's queue of what was typed while it works, in order: { id, raw, at, text?,
    // images? } (text only for the person's words; a job's end has a place too).
    this.queue = [];
  }

  push(item) {
    this.items.push(item);
    return item;
  }

  // The messages a command sent other agents (sendsOf), each its own item after the call's row:
  // { kind: "sent", id, at, to, text, how }.
  sent(command, off, at) {
    // A send tried again (`|| hc send …`, or `--force` after a refusal) shows once: one already sent this turn.
    const turn = this.items.slice(this.items.findLastIndex((x) => x.kind === "user" || x.kind === "mark") + 1);
    sendsOf(command).forEach((m, i) => {
      if (!turn.some((x) => x.kind === "sent" && x.to === m.to && x.text === m.text)) turn.push(this.push({ kind: "sent", id: `s${off}:${i}`, at, ...m }) ?? m);
    });
  }

  // Tool calls in a row join the last item when it is a tools row.
  step(id, off, st, helper = null) {
    if (!st) return;
    const last = this.items[this.items.length - 1];
    const s = { id, kind: st.kind, line: st.line, count: st.count ?? 1, helper, ...(st.shell ? { shell: st.shell, at: st.at } : {}) };
    if (last?.kind === "tools") last.steps.push(s);
    else this.push({ kind: "tools", id: `t${off}`, steps: [s] });
    if (this.pilot) this.pilot.steps++;
    this.calls.set(id, s);
    this.open.set(id, st.doing);
    if (st.waiting) this.waits.add(id);
    if (st.bg) this.bg = [...this.bg.slice(-20), { id, ...st.bg, at: st.at ?? Date.now() }];
    if (this.open.size > 50) this.open.delete(this.open.keys().next().value);
    this.doing = st.doing;
    this.waiting = Boolean(st.waiting);
  }

  // The agent's own question, by its call id: once the call has its result the dialog is gone,
  // answered or not (`closed`: "answered" | "dismissed").
  asked(id, item) {
    this.push(item);
    this.questions.set(id, item);
    if (this.questions.size > 20) this.questions.delete(this.questions.keys().next().value);
  }

  done(id, off) {
    const q = this.questions.get(id);
    if (q) q.closed ??= "dismissed";
    const s = this.calls.get(id);
    if (s) { s.out = off; this.calls.delete(id); }
    this.waits.delete(id);
    if (!this.open.delete(id)) return;
    this.doing = this.open.size ? [...this.open.values()].pop() : null;
    this.waiting = this.open.size ? this.waits.has([...this.open.keys()].pop()) : false;
  }

  user(id, u) {
    this.waiting = false;
    // taken from the queue: it shows as said now
    const q = u?.text ? this.queue.findIndex((x) => x.text === u.text) : -1;
    if (q >= 0) this.queue.splice(q, 1);
    for (const r of u?.reactions ?? []) this.react("you", r);
    // Task news: an item per line, at the moment Herdr told it.
    (u?.news ?? []).forEach((n, i) => this.push({ kind: "news", id: `${id}:n${i}`, at: u.at, ...n }));
    // An Autopilot wake: its line, which what the Assistant then does fills in (pilotLine()); anything else said to it
    // ends that wake's watch.
    this.pilot = null;
    if (u?.pilot) {
      this.pilot = { kind: "pilot", id: `${id}:p`, at: u.at, reason: u.pilot.reason, steps: 0, said: false, quiet: false };
      this.push(this.pilot);
    }
    // Only reactions: nothing to show, but the agent's turn before it is over (its actions and
    // pills stay while it answers, and its answer is a turn of its own).
    if (!u?.text && !u?.images) { if (u?.reactions?.length) this.push({ kind: "mark", id }); return; }
    // A reply names the message it answers. An old blockquote reply counts when it matches an
    // earlier message's start; else it stays a quote.
    let text = u.text, replyTo = u.replyTo ?? null;
    if (u.quoted && this.items.some((x) => (x.kind === "user" || x.kind === "agent") && x.text && names(x.text, u.quoted.slice(0, 60)))) {
      replyTo = u.quoted;
      text = u.rest;
    }
    this.push({ kind: "user", id, text, replyTo, from: u.from, ...(u.assistant ? { assistant: u.assistant } : {}), at: u.at, images: u.images || 0 });
    this.doing = null;
  }

  // A change to Claude Code's queue: enqueue adds, dequeue takes the oldest, remove takes that
  // one (taken in mid-turn).
  queueOp(l, off) {
    const c = typeof l.content === "string" ? l.content : "";
    if (l.operation === "enqueue") {
      // its pictures are "[Image #1]" markers in the words there
      const images = (c.match(/\[Image #\d+\]/g) ?? []).length;
      const u = c && !c.includes("<task-notification>") ? claudeUser(c.replace(/\[Image #\d+\]\s*/g, "")) : null;
      if (u || images) this.queue.push({ id: `q${off}`, raw: c, at: time(l.timestamp), text: u?.text ?? "", images });
      else this.queue.push({ id: `q${off}`, raw: c, at: time(l.timestamp) });
      if (this.queue.length > 50) this.queue.shift();
    } else if (l.operation === "dequeue" || !c) this.queue.shift();
    else {
      const i = this.queue.findIndex((x) => x.raw === c);
      if (i >= 0) this.queue.splice(i, 1);
    }
  }

  // What the person typed that waits in the queue for the agent to take: [{ id, text, images, at }].
  queued() {
    return this.queue.filter((x) => x.text !== undefined);
  }

  // The helpers still running: [{ desc }]. One silent for three hours is taken as gone (its
  // session ended without telling).
  running() {
    const old = Date.now() - 3 * 3600000;
    return [...this.helpers.values()].filter((h) => !h.done && (!h.at || h.at > old));
  }

  // A call that left a job running in the background (its result named the task): a shell started
  // so, or one moved there mid-run, gets its task id.
  backgrounded(id, task) {
    const j = this.bg.find((x) => x.id === id);
    if (j) { j.task = task; return; }
    const s = this.calls.get(id);
    if (s?.shell) this.bg = [...this.bg.slice(-20), { id, task, ...s.shell, at: s.at ?? Date.now() }];
  }

  // A background job ended (by its call id or its task id): a shell, a watcher, a helper.
  ended(id, task) {
    if (id) { const h = this.helpers.get(id); if (h) h.done = true; }
    this.bg = this.bg.filter((j) => !(id && j.id === id) && !(task && j.task === task));
  }

  // Claude Code's note to the agent that a job ended (<task-notification>). A watcher's note of
  // one line it printed (no status) isn't an end.
  notified(text) {
    const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text)?.[1];
    const task = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1];
    if (id || (task && /<status>/.test(text))) this.ended(id ?? null, /<status>/.test(text) ? task ?? null : null);
  }

  // What the person wrote to answer the agent, as their own message right after its question:
  // a question's answer in their words (an option picked on the card is not a message), or the
  // words that declined a request (mods/chat cards.js replyWith()).
  answers(l, off) {
    const at = time(l.timestamp);
    const said = [];
    const r = l.toolUseResult;
    if (r && typeof r === "object" && r.answers && typeof r.answers === "object") {
      const qs = Array.isArray(r.questions) ? r.questions : [];
      for (const [q, a] of Object.entries(r.answers)) {
        const labels = (qs.find((x) => x?.question === q)?.options ?? []).flatMap((o) => {
          const l = String(o?.label ?? o).trim();
          return [l, l.replace(/\s*\(recommended\)\s*$/i, "")];
        });
        const picked = String(a ?? "").split(",").map((x) => x.trim()).filter(Boolean);
        if (a && !(picked.length && picked.every((x) => labels.includes(x)))) said.push(String(a).trim());
      }
    }
    for (const b of l.message.content) {
      if (b?.type !== "tool_result") continue;
      // Its question got an answer: picked, written, or words from the chat (not dismissed).
      const q = this.questions.get(String(b.tool_use_id ?? ""));
      if (q) q.closed = "answered";
      const c = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x) => x?.text ?? "").join("\n") : "";
      const m = /wrote in the chat instead: ([\s\S]*)$/.exec(c);
      if (m && m[1].trim()) said.push(m[1].trim());
    }
    if (said.length) { this.waiting = false; this.push({ kind: "user", id: `ua${off}`, text: said.join("\n\n"), at, answer: true }); }
  }

  // A reaction lands on the latest message its `to` names: any message for the person's
  // reactions, the person's for the agent's.
  react(by, r) {
    const kinds = by === "you" ? ["agent", "user"] : ["user"];
    const target = [...this.items].reverse().find((x) => kinds.includes(x.kind) && x.text && names(x.text, r.to));
    if (!target) return;
    const list = (this.reactions.get(target.id) ?? []).filter((x) => !(x.by === by && x.emoji === r.emoji));
    if (r.on !== false) list.push({ emoji: r.emoji, by });
    this.reactions.set(target.id, list);
  }

  // What the agent wrote, without its reaction and no-reply lines (those act instead).
  agentText(text) {
    const out = [];
    for (const line of String(text).split("\n")) {
      // A react tag also counts at the start of a paragraph, its words after it on the same line;
      // one that still doesn't read (a broken tag) never shows as text either, only what follows it.
      const t = /^\s*<hc\s/.test(line) ? tagAt(line) : null;
      if (t?.a.react || /^\s*<hc\s+react=/.test(line)) {
        const end = line.indexOf("/>");
        if (t?.a.react) this.react("agent", { emoji: t.a.react, to: t.a.to ?? "", on: true });
        const rest = t ? t.rest : end < 0 ? "" : line.slice(end + 2).trim();
        if (rest) out.push(rest);
        continue;
      }
      const a = tagOf(line);
      // <no-reply> too (an Assistant's answer to task news it has nothing to add to).
      if (!(a && "no-reply" in a) && !/^<hc\s+no-reply\s*\/>/.test(line.trim()) && !/^<\/?no-reply\b/.test(line.trim())) out.push(line);
      else if (this.pilot) { this.pilot.quiet = true; if (a?.why) this.pilot.why = unattr(a.why); }
    }
    const said = out.join("\n").trim();
    if (said && this.pilot) this.pilot.said = true;
    return said;
  }

  feed(records) {
    for (const r of records) {
      if (r.kind === "R") {
        const ids = r.data.split(" ").filter(Boolean);
        const async = ids.includes("ASYNC");
        const task = ids.find((x) => x.startsWith("TASK="))?.slice(5);
        for (const id of ids) {
          if (id === "ASYNC" || id.startsWith("TASK=")) continue;
          if (task) this.backgrounded(id, task);
          // A background call answered without a task id never started (cancelled, denied, failed): no job.
          else this.bg = this.bg.filter((j) => j.id !== id || j.task);
          // The agent stopped a job itself (TaskStop): gone once that call is answered.
          if (this.stops.has(id)) { this.ended(null, this.stops.get(id)); this.stops.delete(id); }
          // A helper that answered (not one launched to run on its own) is done.
          const h = this.helpers.get(id);
          if (h && !async) h.done = true;
          this.done(id, r.off);
        }
        continue;
      }
      if (r.kind === "N") {
        const [id, task] = r.data.split(" ").map((x) => (x === "-" ? null : x));
        this.ended(id ?? null, task ?? null);
        continue;
      }
      if (r.kind === "T") {
        // A call too big to send whole: its name and small fields ("file_path=…").
        const [name, ...fields] = r.data.split("\x1f");
        const input = Object.fromEntries(fields.map((f) => { const i = f.indexOf("="); let v = f.slice(i + 1); try { v = JSON.parse(`"${v.replace(/\\$/, "")}"`); } catch {} return [f.slice(0, i), v]; }));
        if (name) this.step(`big${r.off}`, r.off, claudeStep(name, input) ?? { kind: "tool", line: `Used ${name}`, doing: "Working" });
        continue;
      }
      const l = parse(r.data);
      if (!l || typeof l !== "object") continue;
      if (this.kind === "codex") this.codex(l, r.off); else this.claude(l, r.off);
    }
  }

  claude(l, off) {
    if (l.isSidechain) return;
    if (l.type === "queue-operation") { this.queueOp(l, off); return; }
    if (l.type === "user" && l.origin?.kind === "task-notification") {
      // A helper or a background job finished (Claude Code tells the agent so): it's done.
      const c = l.message?.content;
      this.notified(typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join("\n") : "");
      return;
    }
    if (l.type === "user") {
      // After a message with images, Claude Code notes where each came from: the chat shows them.
      if (l.isMeta) {
        const c = l.message?.content;
        const texts = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text) : [];
        const last = this.items[this.items.length - 1];
        for (const t of texts) {
          const m = /^\[Image: source: (.+)\]$/.exec(String(t ?? "").trim());
          if (m && last?.kind === "user") (last.paths ??= []).push(m[1]);
        }
        return;
      }
      if (l.isCompactSummary || l.isVisibleInTranscriptOnly) return;
      if (Array.isArray(l.message?.content) && l.message.content.some((b) => b?.type === "tool_result")) { this.answers(l, off); return; }
      if (l.origin?.kind && l.origin.kind !== "human") return;
      const u = claudeUser(l.message?.content);
      if (u) this.user(`u${off}`, { ...u, at: time(l.timestamp) });
    } else if (l.type === "attachment" && l.attachment?.type === "queued_command") {
      // A message typed while the agent was busy, taken in mid-turn.
      const a = l.attachment;
      // Or a job's end, read by the agent mid-turn.
      if (a.commandMode === "task-notification") { this.notified(String(a.prompt ?? "")); return; }
      if (a.commandMode !== "prompt" || (a.origin?.kind && a.origin.kind !== "human")) return;
      const u = claudeUser(a.prompt);
      if (u) this.user(`u${off}`, { ...u, at: time(a.timestamp ?? l.timestamp) });
    } else if (l.type === "assistant") {
      if (l.isApiErrorMessage) {
        const err = (l.message?.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
        if (err) this.push({ kind: "error", id: `e${off}`, text: err });
        return;
      }
      const m = l.message ?? {};
      const id = String(m.id ?? l.uuid);
      if (m.model && m.model !== "<synthetic>") {
        const u = m.usage ?? {};
        const used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
        this.meta = { ...this.meta, model: m.model, effort: l.perTurnEffort ?? this.meta.effort, speed: u.speed ?? this.meta.speed, used: used || this.meta.used, at: time(l.timestamp) };
      }
      for (const b of Array.isArray(m.content) ? m.content : []) {
        const told = narration(l, b);
        if (b?.type === "thinking" && !told && !this.open.size) this.doing = "Thinking";
        const said = b?.type === "text" ? this.agentText(b.text ?? "") : told ? this.agentText(b.thinking) : "";
        if (said) {
          // One reply can be written over several lines with the same id.
          const prev = this.replies.get(id);
          if (prev && this.items[this.items.length - 1] === prev) prev.text += "\n\n" + said;
          else {
            const item = { kind: "agent", id: `a${off}`, text: said, at: time(l.timestamp) };
            this.replies.set(id, item);
            if (this.replies.size > 20) this.replies.delete(this.replies.keys().next().value);
            this.push(item);
          }
        } else if (b?.type === "tool_use") {
          if (b.name === "AskUserQuestion") {
            const qs = Array.isArray(b.input?.questions) ? b.input.questions : [];
            const text = qs.map((q) => q?.question).filter(Boolean).join("\n\n");
            if (text) this.asked(String(b.id), { kind: "ask", id: `q${off}`, text });
            this.open.set(b.id, "Asking you something");
            this.doing = "Asking you something";
          } else {
            if (b.name === "Agent" || b.name === "Task") this.helpers.set(String(b.id), { desc: String(b.input?.description ?? "a helper"), done: false, at: time(l.timestamp) });
            if (b.name === "TaskStop" || b.name === "KillShell") {
              this.stops.set(String(b.id), String(b.input?.task_id ?? b.input?.shell_id ?? ""));
              if (this.stops.size > 20) this.stops.delete(this.stops.keys().next().value);
            }
            const st = claudeStep(String(b.name ?? ""), b.input ?? {});
            if (st) st.at = time(l.timestamp) || Date.now();
            this.step(String(b.id), off, st, b.name === "Agent" || b.name === "Task" ? String(b.id) : null);
            if (b.name === "Bash" && ARTIFACT.test(String(b.input?.command ?? ""))) this.push({ kind: "artifact", id: `art${off}`, at: time(l.timestamp) });
            if (b.name === "Bash") this.sent(String(b.input?.command ?? ""), off, time(l.timestamp));
          }
        }
      }
    }
  }

  codex(l, off) {
    const p = l.payload;
    if (!p || typeof p !== "object") return;
    if (l.type === "response_item") {
      if (p.type === "message" && p.role === "user") {
        const items = Array.isArray(p.content) ? p.content : [];
        const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
        const words = items.map((it, i) => {
          if (it?.type !== "input_text" || typeof it.text !== "string") return "";
          if (Array.isArray(kinds) && kinds.length === items.length) return kinds[i] === "user.text" ? it.text.trim() : "";
          return CODEX_INJECTED.test(it.text) ? "" : it.text.trim();
        }).filter(Boolean).join("\n\n");
        const u = words ? cleanUser(words) : null;
        if (u) this.user(`u${off}`, { ...u, at: time(l.timestamp) });
      } else if (p.type === "message" && p.role === "assistant") {
        const words = this.agentText((Array.isArray(p.content) ? p.content : []).filter((it) => it?.type === "output_text" && it.text?.trim()).map((it) => it.text.trim()).join("\n\n"));
        if (words) this.push({ kind: "agent", id: `a${off}`, text: words, at: time(l.timestamp) });
      } else if ((p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") && p.name !== "wait" && p.name !== "sleep") {
        const cid = String(p.call_id ?? p.id ?? `c${off}`);
        // Codex's own questions (Plan mode): answered in its terminal, shown here as asked.
        if (p.name === "request_user_input") {
          let a = p.arguments;
          try { a = typeof a === "string" ? JSON.parse(a) : a; } catch {}
          const text = (Array.isArray(a?.questions) ? a.questions : []).map((q) => [q?.question, ...(Array.isArray(q?.options) ? q.options.map((o) => `- ${o?.label ?? o}`) : [])].filter(Boolean).join("\n")).join("\n\n");
          // its questions as they were asked, for the card that answers them on its screen (core/asks.js codexSteps)
          const questions = codexQuestions(a);
          if (text) this.asked(cid, { kind: "ask", id: `q${off}`, text, ...(questions.length ? { questions } : {}) });
          this.open.set(cid, "Asking you something");
          this.doing = "Asking you something";
          return;
        }
        const st = codexStep(String(p.name ?? "shell"), p.arguments ?? p.input ?? p.action);
        // Codex's helpers count as running until its turn ends (its log says no more).
        if (st?.spawn) this.helpers.set(cid, { desc: st.spawn, done: false, untilTurn: true });
        this.step(cid, off, st, st?.spawn ? cid : null);
        if (ARTIFACT.test(JSON.stringify(p.arguments ?? p.input ?? p.action ?? ""))) this.push({ kind: "artifact", id: `art${off}`, at: time(l.timestamp) });
        this.sent(codexCommand(p.arguments ?? p.input ?? p.action), off, time(l.timestamp));
      }
    } else if (l.type === "turn_context") {
      this.meta = { ...this.meta, model: p.model ?? this.meta.model, effort: p.effort ?? p.reasoning_effort ?? this.meta.effort, at: time(l.timestamp) };
    } else if (p.type === "token_count") {
      const i = p.info ?? {};
      const used = i.last_token_usage?.total_tokens;
      this.meta = { ...this.meta, used: used ?? this.meta.used, window: i.model_context_window ?? this.meta.window };
    } else if (p.type === "task_complete" || p.type === "turn_aborted") {
      for (const h of this.helpers.values()) if (h.untilTurn) h.done = true;
      this.open.clear();
      this.waits.clear();
      this.waiting = false;
      this.doing = null;
    }
  }
}

// Turns LOG's output into its header line and records.
export function records(stdout) {
  const lines = stdout.split("\n");
  const head = lines.shift() ?? "";
  const out = [];
  for (const line of lines) {
    const a = line.indexOf("\t");
    if (a < 1 || line[0] === "#") continue;
    const b = line.indexOf("\t", a + 1);
    if (b < 0) continue;
    out.push({ off: Number(line.slice(0, a)), kind: line.slice(a + 1, b), data: line.slice(b + 1) });
  }
  return { head: head.trim().split(" "), records: out };
}

// A tool's output from the line LOG's `results` sent back for it (possibly cut at 64 KB):
// its first few lines.
export function resultText(line, id) {
  let text = null;
  const l = parse(line);
  if (l) {
    const c = l.message?.content;
    if (Array.isArray(c)) {
      const b = c.find((x) => x?.type === "tool_result" && x.tool_use_id === id) ?? c.find((x) => x?.type === "tool_result");
      const v = b?.content;
      text = typeof v === "string" ? v : Array.isArray(v) ? v.map((x) => x?.text ?? "").join("\n") : null;
    }
    const o = l.payload?.output;
    if (text === null && o !== undefined) text = typeof o === "string" ? o : String(o?.output ?? o?.content ?? JSON.stringify(o));
  } else {
    // Cut short: take the first string after its content key, up to the cut.
    const m = /"(?:content|text|output)":"((?:[^"\\]|\\.)*)/.exec(line);
    if (m) { try { text = JSON.parse(`"${m[1].replace(/\\[^"]{0,5}$/, "")}"`); } catch { text = m[1]; } }
  }
  if (text === null) return null;
  const rows = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split("\n");
  const shown = rows.slice(0, 8).map((r) => (r.length > 160 ? r.slice(0, 159) + "…" : r));
  if (rows.length > 8) shown.push(`… ${rows.length - 8} more lines`);
  return shown.join("\n").trim() || "(no output)";
}

// The open row's summary: "Read 3 files, ran 2 commands".
export function summary(steps) {
  const n = {};
  for (const s of steps) n[s.kind] = (n[s.kind] ?? 0) + (s.count ?? 1);
  const say = (k, one, many) => n[k] ? (n[k] === 1 ? one : many.replace("#", n[k])) : null;
  const parts = [
    say("read", "read a file", "read # files"),
    say("edit", "edited a file", "edited # files"),
    say("run", "ran a command", "ran # commands"),
    say("search", "searched", "searched # times"),
    say("web", "looked on the web", "looked on the web # times"),
    say("agent", "asked a helper", "asked # helpers"),
    say("plan", "updated its plan", "updated its plan"),
    say("tool", "used a tool", "used # tools"),
  ].filter(Boolean);
  const s = parts.join(", ");
  return s ? s[0].toUpperCase() + s.slice(1) : "Worked";
}

