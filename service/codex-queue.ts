// Codex logs the questions and their answers. Skipping in the TUI is local to its picker.
export type QueuedQuestion = { id: string; text: string; choices: string[]; at: number; closed?: string };
type Read = () => Promise<string | null>;
type Screen = { count: number; editor?: { index: number; title: string; body: string; selected?: number; label?: string } };

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const gone = "That question is no longer in Codex's queue.";

/** null means another view is in front, so the screen cannot confirm what's in the queue. */
export function questionScreen(text: string): Screen | null {
  const lines = text.trimEnd().split("\n").map((line) => line.trim());
  const last = lines.findLastIndex((line) => /^[•◦]\s+Queued follow-up inputs$/.test(line));
  const foot = lines.findLastIndex((line) => line.includes("for shortcuts"));
  if (last >= 0) {
    const start = lines.findIndex((line, i) => i > last && !!line);
    const view = start < 0 ? [] : lines.slice(start);
    const summary = view.find((line) => /^\? \d+ questions?\b/.test(line));
    if (summary) return { count: Number(/^\? (\d+)/.exec(summary)![1]) };
    const end = view.findIndex((line, i) => /^\S+ submit\b/.test(line) && /\bskip\b/.test(view.slice(i, i + 2).join(" ")));
    if (end >= 0) {
      const position = /^(\d+) of (\d+)$/.exec(view[0] ?? "");
      const body = view.slice(position ? 1 : 0, end);
      while (body[0] === "") body.shift();
      const option = /^(?:›\s+)?\d+\.\s/;
      const split = body.findIndex((line) => !line || option.test(line) || line === "Type your answer");
      const selected = body.findIndex((line) => /^›\s+\d+\.\s/.test(line));
      const pick = selected < 0 ? null : /^›\s+(\d+)\.\s(.*)/.exec(body[selected]!);
      const continuation = pick ? body.slice(selected + 1) : [];
      const next = continuation.findIndex((line) => !line || option.test(line));
      const label = pick ? tidy([pick[2], ...continuation.slice(0, next < 0 ? continuation.length : next)].join(" ")) : undefined;
      return { count: Number(position?.[2] ?? 1), editor: {
        index: Number(position?.[1] ?? 1) - 1, title: tidy(body.slice(0, split < 0 ? body.length : split).join(" ")),
        body: body.filter(Boolean).join("\n"), ...(pick ? { selected: Number(pick[1]) - 1, label } : {}),
      } };
    }
    if (foot > last && !summary && view.some((line) => line.startsWith("›"))) return { count: 0 };
  }
  return foot >= 0 && lines.slice(0, foot).some((line) => line.startsWith("›")) ? { count: 0 } : null;
}

function matches(screen: Screen, q: QueuedQuestion) {
  return screen.editor?.title === tidy(q.text);
}

/** A live session's picker, reconciled with the durable question IDs from its rollout. */
export class CodexQueue {
  private skipped = new Set<string>();
  private path: string | null = null;
  private observed: { ids: string[]; count: number; selected?: string } | null = null;

  pending(reader: { path: string | null; conv?: { asyncQuestions: Map<string, QueuedQuestion> } | null }) {
    if (this.path !== reader.path) {
      this.path = reader.path;
      this.skipped.clear();
      this.observed = null;
    }
    const questions = reader.conv?.asyncQuestions ?? new Map<string, QueuedQuestion>();
    for (const id of this.skipped) if (!questions.has(id)) this.skipped.delete(id);
    return [...questions.values()].filter((q) => !this.skipped.has(q.id));
  }

  observe(pending: QueuedQuestion[], text: string) {
    const view = questionScreen(text);
    if (!view || !pending.length) return;
    const before = this.observed;
    const ids = pending.map((q) => q.id);
    if (before && view.count === 0) {
      for (const id of before.ids) if (ids.includes(id)) this.skipped.add(id);
    } else if (before?.selected && ids.includes(before.selected) && view.count === ids.length - 1 && before.count === before.ids.length) {
      // A terminal skip removes its displayed question without recording an answer in the rollout.
      const next = view.editor && pending.filter((q) => q.id !== before.selected)[view.editor.index];
      if (next && matches(view, next)) this.skipped.add(before.selected);
    } else if (view.count === 1 && view.editor && ids.length > 1) {
      // After reattaching, a picker with exactly one visible question identifies all the old ones it skipped.
      const matching = pending.filter((q) => matches(view, q));
      if (matching.length === 1) for (const id of ids) if (id !== matching[0]!.id) this.skipped.add(id);
    }
    const left = pending.filter((q) => !this.skipped.has(q.id));
    const byIndex = view.count === left.length && view.editor ? left[view.editor.index] : undefined;
    this.observed = { ids: left.map((q) => q.id), count: view.count, selected: byIndex && matches(view, byIndex) ? byIndex.id : undefined };
  }

  forgetScreen() { this.observed = null; }
}

type Picker = { read: Read; keys: (...keys: string[]) => Promise<boolean>; paste: (words: string) => Promise<boolean> };

/** Use the native picker so Codex records the stable question ID and keeps the other questions queued. */
export async function answerQueued(io: Picker, pending: QueuedQuestion[], target: QueuedQuestion, answer: { choice?: number; other?: string }): Promise<string | null> {
  const other = typeof answer.other === "string" ? answer.other.trim() : "";
  const choice = Number.isInteger(answer.choice) ? answer.choice! : -1;
  if (other.length > 4000 || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(other)) throw new Error("Use a shorter answer with plain text.");
  if (!other && !target.choices[choice]) throw new Error("Pick or type an answer first.");
  const want = pending.findIndex((q) => q.id === target.id);
  if (want < 0) return gone;
  const changed = "Codex's picker changed. Check the question in the terminal.";
  const read = async () => questionScreen((await io.read()) ?? "");
  const press = async (...keys: string[]) => {
    if (!(await io.keys(...keys))) return null;
    await Bun.sleep(100);
    return read();
  };
  let view = await read();
  if (!view) return changed;
  if (!view.count) return gone;
  const opened = !view.editor;
  try {
    if (opened) view = await press("shift+left");
    if (!view?.editor) return changed;

    // In the usual case the ordered rollout IDs align with the native positions, including repeated titles.
    const at = view.editor.index;
    const aligned = view.count === pending.length && !!pending[at] && matches(view, pending[at]!);
    if (aligned && at !== want) {
      if (Math.abs(at - want) > 32) return changed;
      view = await press(...Array<string>(Math.abs(at - want)).fill(at < want ? "shift+left" : "shift+right"));
    }
    // A local skip won't be in the log. Walk the remaining picker only when this title identifies the question.
    if (!aligned && view?.editor) {
      if (pending.filter((q) => tidy(q.text) === tidy(target.text)).length !== 1 || view.count > 32) return changed;
      if (view.editor.index && !matches(view, target)) view = await press(...Array<string>(view.editor.index).fill("shift+right"));
      while (view?.editor && !matches(view, target) && view.editor.index + 1 < view.count) {
        const before = view.editor.index;
        view = await press("shift+left");
        if (view?.editor?.index !== before + 1) return changed;
      }
    }
    if (!view?.editor || !matches(view, target) || (aligned && view.editor.index !== want)) return changed;
    const count = view.count;
    const pos = view.editor.index;
    const stillHere = (s: Screen | null) => s?.count === count && s.editor?.index === pos && matches(s, target);
    if (target.choices.length) {
      const pick = other ? target.choices.length : choice;
      const selected = view.editor.selected;
      if (selected === undefined || selected > target.choices.length) return changed;
      if (selected !== pick) view = await press(...Array<string>(Math.abs(selected - pick)).fill(selected < pick ? "down" : "up"));
      if (!stillHere(view) || view?.editor?.selected !== pick) return changed;
      if (!other && view.editor.label !== tidy(target.choices[choice]!)) return changed;
    }
    if (other) {
      const placeholder = target.choices.some((label) => /^other$/i.test(label)) ? "Other (write an answer)" : "Other";
      const blank = target.choices.length ? view?.editor?.label === placeholder : /\nType your answer$/.test(view?.editor?.body ?? "");
      if (!blank) return "There's an answer draft in Codex's terminal. Finish it there first.";
      if (!(await io.paste(other))) return changed;
    } else if (!(await io.keys("enter"))) {
      return changed;
    }
    await Bun.sleep(100);
    const after = await read();
    if (after?.count === count) return "Codex kept the question open. Check the answer in the terminal.";
    return null;
  } finally {
    // Leave the main composer in front if this action opened the picker, even if the answer failed.
    if (opened) {
      const current = await read();
      if (current?.editor && current.editor.index < 32 && pending.some((q) => matches(current, q))) {
        await io.keys(...Array<string>(current.editor.index + 1).fill("shift+right"));
      }
    }
  }
}
