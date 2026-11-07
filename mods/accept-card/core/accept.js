// The Accept card's words and its summary and details as read: what the person approves before a Ready task merges.
// mods/accept-card draws it in the window, web/src/screens/Accept.tsx in the web app; both read the same words and
// the same reading of `herdr-task show --evidence` from here.
// Shared core: the source is core/accept.js; bin/sync-shared copies it into the mods in lib/COPIES. Edit it here,
// never a copy.

// The card's words, as the window shows them.
export const ACCEPT = {
  title: (ref) => `Accept ${ref}?`,
  reading: "Reading the task…",
  noSummary: "No summary.",
  changes: "Changes",
  checks: "Checks",
  proof: "Proof",
  artifacts: "Artifacts",
  details: "Details",
  notGit: "Not a git folder.",
  noCommits: "No commits.",
  noFiles: "· Couldn't read the files",
  noChecks: "No GitHub checks here",
  noProof: "No proof artifact.",
  open: "Open",
  opening: "Opening…",
  cancel: "Cancel",
  close: "Close",
  accept: "Accept",
  accepting: "Accepting…",
  noTask: "No task to accept.",
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "3 commits", "12 files changed", "And 4 more"
export const commitsLine = (n) => plural(n, "commit");
export const filesLine = (n) => `${plural(n, "file")} changed`;
export const moreLine = (n) => `And ${n} more`;
// A proof artifact's title without its task's ref ("HERD-4: Login works" -> "Login works").
export const proofTitle = (title) => String(title ?? "").replace(/^[A-Z]+-\d+:\s*/, "");

// Where a task no longer Ready is now, calmly: x = { state, accepted_at?, status_text? }.
export function whereNow(x) {
  if (x.state === "done") return x.accepted_at ? "Already accepted." : "Already done.";
  return `Not ready right now: it's in ${x.status_text ?? x.state}.`;
}

// herdr-task ready's SUMMARY_MAX (as Shepherdr's): an older, longer summary shows its first sentence and folds the
// rest under Details.
export const SUMMARY_MAX = 160;

// { summary, details }: a summary written before the limit, too long to read at a glance, keeps its first sentence
// (or its first words) up top and the whole text under Details.
export function words(e) {
  const said = String(e?.summary ?? "").replace(/\s+/g, " ").trim();
  const details = String(e?.details ?? "").trim();
  if (said.length <= SUMMARY_MAX || details) return { summary: said, details };
  const head = said.slice(0, SUMMARY_MAX);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  const cut = stop >= 40 ? head.slice(0, stop + 1) : `${head.slice(0, Math.max(head.lastIndexOf(" "), 40)).trim()}…`;
  return { summary: cut, details: e.summary.trim() };
}

// Details to read, as markdown. An agent's own markdown (bullets, headings, code blocks) stays as written. Older plain
// text, one dense paragraph or plain lines, becomes short bullets: split at "; " and at sentence ends outside
// brackets, without their end punctuation, a leftover fragment of one or two words joined to the bullet before, and
// only clear paths (a folder and a file with its extension, or ~/ ./ /) as code; other file names stay plain words.
const MARKDOWN = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|```|>\s)/m;
const PATH = /(^|[\s(,;:"'])((?:~|\.{1,2})?\/?[\w.@-]+(?:\/[\w.@-]+)+\/?)(?=$|[\s),;:"'.!?])/g;
const ABBR = /(?:^|\s)(?:e\.g|i\.e|etc|vs|cf|approx|incl|[A-Za-z])\.$/i;

const codify = (s) => s.replace(PATH, (m, pre, tok) => {
  const end = tok.match(/\.+$/)?.[0] ?? "";
  const path = tok.slice(0, tok.length - end.length);
  const clear = /^(?:~|\.{1,2})?\//.test(path) || path.endsWith("/") || /\.[A-Za-z]{1,5}$/.test(path);
  return clear ? `${pre}\`${path}\`${end}` : m;
});

function sentences(line) {
  const out = [];
  let cur = "", depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    cur += c;
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ";" || (/[.!?]/.test(c) && /^\s/.test(line[i + 1] ?? "") && !ABBR.test(cur)))) {
      out.push(cur);
      cur = "";
    }
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/[;.,:]+$/, "").trim()).filter(Boolean);
}

export function readable(text) {
  const s = String(text ?? "").trim();
  if (!s || MARKDOWN.test(s)) return s;
  const items = [];
  for (const x of s.split(/\n+/).flatMap((l) => sentences(l.trim()))) {
    if (items.length && x.split(/\s+/).length < 3) items[items.length - 1] += `; ${x}`;
    else items.push(x);
  }
  return items.length < 2 ? codify(s) : items.map((x) => `- ${codify(x)}`).join("\n");
}
