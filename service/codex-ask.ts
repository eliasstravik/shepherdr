// Codex's own questions (request_user_input) answered from a chat card (SHEP-91): Codex gives no hook for its question
// tool, so the card's answer is pressed on its screen (core/asks.js codexSteps). hc: service/actions.ts's.
import * as AS from "../core/asks.js";

type Hc = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** A Codex question card's answer (core/asks.js codexSteps) pressed on its screen, only while that shows the questions
 *  the card was drawn from. "Answer in terminal" presses nothing; "Dismiss" and "Chat about this" are Esc, as in its
 *  own picker. Resolves with what went wrong, or null. */
export async function answerCodex(hc: Hc, addr: string, questions: any[], b: any): Promise<string | null> {
  if (b.terminal === true) return null;
  const screen = await hc(["read", addr]);
  if (screen.code !== 0) return "Its terminal can't be read: answer it there.";
  if (!AS.codexOnScreen(screen.stdout, questions)) return "Its screen shows something else now: answer it in the terminal.";
  if (b.dismiss === true || b.talk === true) return (await hc(["keys", addr, "esc"])).code === 0 ? null : "It didn't go through.";
  const said = (i: number) => {
    const q = questions[i];
    return typeof b.other === "string" && b.other.trim() ? b.other : typeof b.choice === "number" ? q.choices[b.choice]?.label : undefined;
  };
  const answers = questions.length > 1 ? (Array.isArray(b.answers) ? b.answers.map((x: unknown) => String(x ?? "")) : []) : [said(0) ?? ""];
  const steps = AS.codexSteps(questions, answers);
  if (!steps) throw new Error(questions.length > 1 ? "Answer every question first." : "Pick an answer first.");
  for (const step of steps) {
    const r = step.paste !== undefined ? await hc(["send", "--force", addr, step.paste]) : await hc(["keys", addr, ...step.keys]);
    if (r.code !== 0) return "It didn't go through: answer it in the terminal.";
    await Bun.sleep(150);
  }
  return null;
}
