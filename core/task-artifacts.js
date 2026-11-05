// A task's artifacts (SHEP-60): every artifact its agent (and its helpers) made or updated, for the Artifacts tab of
// its view, in the web app (service/compat.ts) and the window (mods/task-artifacts, mods/chat/panel.js) alike.
// Found from herdr-artifact's own records: an artifact names its task (herdr-artifact publish keeps it, from the
// publishing terminal's herdr.task label), else one of its versions was published by one of the task's own agent
// terminals while that agent ran; an older one with neither is found by its id in the task's chat log ("Published <id>
// v<n>", publish's words). Its proof (herdr-task ready --proof) always counts, and comes first; the rest newest first.

const ID = "[a-z0-9][a-z0-9-]*-[0-9a-f]{4}";
// publish's words ("Published <id> v2: ..."), and its --json answer ("mod": "art-<id>"), as a chat log keeps them
// (inside JSON strings: quotes escaped). GREP is the same as grep -E reads it (the window greps a log where it is).
export const GREP = `Published ${ID} v[0-9]+|mod[\\\\"]*: ?[\\\\"]*art-${ID}`;
const SAID = new RegExp(`Published (${ID}) v\\d+|mod[\\\\"]*: ?[\\\\"]*art-(${ID})`, "g");

/** The artifact ids a chat log's text says were published, in order, once each. */
export function publishedIds(text) {
  const out = new Set();
  for (const m of String(text ?? "").matchAll(SAID)) out.add(m[1] ?? m[2]);
  return [...out];
}

// a version published by one of the task's agents while it ran (a minute's slack either side: clocks and the end
// being noted late); an address used again later by another program never counts
const byAgent = (agents, v) => agents.some((g) => g?.address && v?.publisher === g.address
  && (v.at ?? 0) >= (g.at ?? 0) - 60000 && (!g.ended || (v.at ?? 0) <= g.ended + 60000));

/**
 * The ids of a task's artifacts, its proof first, then newest first.
 * arts: herdr-artifact's records ({ id, task, folder, at, machine?, versions: [{ publisher, at }] }).
 * task: { ref ("SHEP-60"), folder (its list's), machine (null: here), agents: [{ address, at, ended }], proof (its id) }.
 * logIds: ids its chat logs say were published (publishedIds()).
 */
export function taskArtifacts(arts, task, logIds = []) {
  const ref = String(task?.ref ?? "").toUpperCase(), machine = task?.machine ?? null, proof = task?.proof ?? null;
  const agents = Array.isArray(task?.agents) ? task.agents : [], said = new Set(logIds);
  const mine = (Array.isArray(arts) ? arts : []).filter((a) => {
    if (!a?.id || (a.machine ?? null) !== machine) return false;
    if (a.id === proof) return true;
    // kept for another folder: another list's task of the same number
    if (task?.folder && a.folder && a.folder !== task.folder) return false;
    // it names its task: that one only
    if (a.task) return String(a.task).toUpperCase() === ref;
    return (a.versions ?? []).some((v) => byAgent(agents, v)) || said.has(a.id);
  });
  return mine.sort((x, y) => Number(y.id === proof) - Number(x.id === proof) || (y.at ?? 0) - (x.at ?? 0)).map((a) => a.id);
}

/** Its title as the task's tab lists it: without the task's id in front ("SHEP-60: Coverage" -> "Coverage"), and a
 *  proof's without " · Proof" at its end (its Proof mark says it). */
export function titleInTask(title, ref, proof = false) {
  let t = String(title ?? "");
  const r = String(ref ?? "");
  // SHOP-4 never cuts SHOP-40's
  if (r && t.slice(0, r.length).toUpperCase() === r.toUpperCase() && !/\d/.test(t[r.length] ?? "")) t = t.slice(r.length).replace(/^[:\s·-]+/, "") || t;
  if (proof) t = t.replace(/\s*·\s*proof\s*$/i, "") || t;
  return t;
}
