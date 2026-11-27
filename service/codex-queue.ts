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
