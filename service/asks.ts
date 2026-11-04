// Questions, permissions and plans an agent asks through Claude Code's PermissionRequest hook (mods/chat/ask-hook.sh):
// each request waits in data/chat-asks/req/<id>.json until an answer lands in ans/<id>.json, from the window's card or
// from here. The words and the answers are the shared core's (core/asks.js), so a card says and does the same on both;
// whichever answers first wins (the hook reads one answer, then the card closes everywhere).
import { watch, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./paths.ts";
import * as A from "../core/asks.js";

const { words, allow, deny, answers, howAnswered } = A as any;
const DIR = join(process.env.HERDR_APP_HOME || join(HOME, ".config", "herdr-app"), "data", "chat-asks");
const ID = /^[\w.-]+$/;

export type Ask = { id: string; terminal: string; at: number; req: any; words: any };

export class Asks {
  open = new Map<string, Ask>();
  private listeners = new Set<() => void>();

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    const req = join(DIR, "req");
    if (existsSync(req)) watch(req, () => this.read());
    setInterval(() => this.read(), 4000);
    this.read();
  }

  /** What waits now. The id is <terminal>.<seconds>.<pid> (ask-hook.sh). */
  private read() {
    const next = new Map<string, Ask>();
    let names: string[] = [];
    try { names = readdirSync(join(DIR, "req")).filter((n) => n.endsWith(".json")); } catch {}
    for (const n of names) {
      const id = n.slice(0, -5);
      if (!ID.test(id) || existsSync(join(DIR, "ans", n))) continue;
      const old = this.open.get(id);
      if (old) { next.set(id, old); continue; }
      try {
        const req = JSON.parse(readFileSync(join(DIR, "req", n), "utf8"));
        next.set(id, { id, terminal: id.split(".")[0], at: statSync(join(DIR, "req", n)).mtimeMs, req, words: words(req) });
      } catch {}
    }
    const changed = next.size !== this.open.size || [...next.keys()].some((k) => !this.open.has(k));
    this.open = next;
    if (changed) for (const fn of this.listeners) fn();
  }

  of(terminal: string) { return [...this.open.values()].filter((a) => a.terminal === terminal); }

  /** Answers it as the window's card would: a permission or plan allowed or declined, a question's pick. */
  answer(id: string, a: { choice?: number; choices?: number[]; note?: string; other?: string; answers?: string[] }) {
    const ask = this.open.get(id);
    if (!ask) throw new Error("That question was answered already.");
    const w = ask.words;
    let out: string;
    if (w.kind === "questions" && w.questions.length > 1) {
      // the multi-step card: each question's answer in order, all of them
      const got = (a.answers ?? []).map((x) => String(x ?? "").trim());
      if (got.length !== w.questions.length || got.some((x) => !x)) throw new Error("Answer every question first.");
      out = answers(ask.req, Object.fromEntries(w.questions.map((q: any, i: number) => [q.text, got[i]])));
    } else if (w.kind === "questions") {
      const q = w.questions[0];
      const picked = a.other ? [a.other] : (a.choices ?? (a.choice != null ? [a.choice] : [])).map((i) => q.options[i]?.name).filter(Boolean);
      if (!picked.length) throw new Error("Pick an answer first.");
      out = answers(ask.req, { [q.text]: picked.join(", ") });
    } else if (a.choice === 0) {
      // never allowed unseen: a request too long for the card is answered where it shows whole, the terminal
      if (w.cut) throw new Error("Too long to show here in full: answer it in the terminal.");
      out = allow();
    }
    else out = deny(a.note?.trim() || (w.kind === "plan" ? "The person didn't approve this plan yet. Ask them what to change." : undefined));
    // As the window's answerAsk(): first how it went (end/<id>, for every other copy of the card), then the answer.
    const how = howAnswered(ask, out, "on the web");
    if (how) writeFileSync(join(DIR, "end", id), `${how}\n`);
    const file = join(DIR, "ans", `${id}.json`);
    writeFileSync(`${file}.tmp`, out);
    renameSync(`${file}.tmp`, file);
    this.open.delete(id);
    for (const fn of this.listeners) fn();
  }
}
