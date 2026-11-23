// Extra flags for a space's task agents (#1222, Settings › Tasks): herdr-task checks them as it checks a task's own
// (`herdr-task flags`, flags.py: real Claude Code or Codex flags only, none Shepherdr sets itself) and says how it keeps
// them; its refusal is said as herdr-task says it.
import { spawn } from "./spawn.ts";

/** The flags as herdr-task keeps them (one word each: --advisor=opus), or its refusal as an Error. */
export async function checkFlags(agent: string, words: string, bin = "herdr-task"): Promise<string[]> {
  const p = spawn([bin, "flags", "--agent", agent, "--json", "--", words.slice(0, 4000)], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  let json: any = null;
  try { json = JSON.parse(out); } catch {}
  if ((await p.exited) !== 0 || !Array.isArray(json?.flags)) {
    const why = String(json?.error ?? "") || err.trim().split("\n").pop()?.replace(/^herdr-task: /, "") || "";
    throw new Error(/invalid choice/.test(why) ? "herdr-task here is older than this page: update Shepherdr to save extra flags." : why || "Those flags weren't saved.");
  }
  return json.flags.map(String);
}
